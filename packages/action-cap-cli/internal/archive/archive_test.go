package archive

import (
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseArchiveValid(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("testdata", "sample.bxdac"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	ar, err := ParseArchive(data)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if ar.Format != "actioncap-session-archive" {
		t.Fatalf("unexpected format %q", ar.Format)
	}
	if ar.Version != 1 {
		t.Fatalf("unexpected version %d", ar.Version)
	}
	if ar.Bundle.Session == nil || ar.Bundle.Session.ID != "sess-001" {
		t.Fatalf("missing session id")
	}
	if len(ar.Bundle.Tabs) != 2 {
		t.Fatalf("expected 2 tabs, got %d", len(ar.Bundle.Tabs))
	}
	if len(ar.Bundle.UserActions) != 8 {
		t.Fatalf("expected 8 actions, got %d", len(ar.Bundle.UserActions))
	}
	if len(ar.Bundle.NetworkEvents) != 5 {
		t.Fatalf("expected 5 network events, got %d", len(ar.Bundle.NetworkEvents))
	}
	if len(ar.Bundle.ReplayEvents) != 3 {
		t.Fatalf("expected 3 replay events, got %d", len(ar.Bundle.ReplayEvents))
	}
}

func TestParseArchiveRejectsBadFormat(t *testing.T) {
	bad := []byte(`{"format":"wrong","version":1,"exportedAt":0,"bundle":{}}`)
	if _, err := ParseArchive(bad); err == nil {
		t.Fatal("expected error for bad format")
	}
}

func TestParseArchiveRejectsBadVersion(t *testing.T) {
	bad := []byte(`{"format":"actioncap-session-archive","version":2,"exportedAt":0,"bundle":{}}`)
	if _, err := ParseArchive(bad); err == nil {
		t.Fatal("expected error for bad version")
	}
}

func TestParseArchiveRejectsMissingBundle(t *testing.T) {
	bad := []byte(`{"format":"actioncap-session-archive","version":1,"exportedAt":0}`)
	if _, err := ParseArchive(bad); err == nil {
		t.Fatal("expected error for missing bundle")
	}
}

func TestSanitizationMasksSecretsWithoutMutatingInput(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("testdata", "sample.bxdac"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	raw := string(data)
	ar, err := ParseArchive(data)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(ar.Bundle.NetworkEvents) == 0 {
		t.Fatal("expected network events")
	}
	event := ar.Bundle.NetworkEvents[0]
	if event.RequestHeaders == nil || event.ResponseHeaders == nil {
		t.Fatal("expected headers")
	}
	for k := range event.RequestHeaders {
		if shouldMaskHeaderName(k) {
			if event.RequestHeaders[k] != maskPlaceholder {
				t.Fatalf("expected %q masked, got %q", k, event.RequestHeaders[k])
			}
		}
	}
	for k := range event.ResponseHeaders {
		if shouldMaskHeaderName(k) {
			if event.ResponseHeaders[k] != maskPlaceholder {
				t.Fatalf("expected %q masked, got %q", k, event.ResponseHeaders[k])
			}
		}
	}
	if string(data) != raw {
		t.Fatal("sanitization mutated the input bytes")
	}
}

func TestShouldMaskHeaderName(t *testing.T) {
	cases := []struct {
		name string
		want bool
	}{
		{"Authorization", true},
		{"x token", true},
		{"x-token", true},
		{"X-Token-Custom", true},
		{"Accept", false},
		{"Content-Type", false},
	}
	for _, tc := range cases {
		if got := shouldMaskHeaderName(tc.name); got != tc.want {
			t.Errorf("%s: got %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestShouldMaskHeaderNameCoversAllTokens(t *testing.T) {
	// Keep this list in lockstep with packages/action-cap-cli/src/lib/archive.ts.
	required := []string{
		"password", "passwd", "passcode", "token", "authorization", "cookie",
		"secret", "apikey", "clientkey", "privatekey", "credential", "csrf",
		"xsrf", "nonce", "otp", "pin", "cvv", "cvc", "ssn", "taxid",
		"passport", "phone", "idcard",
	}
	for _, tok := range required {
		if !shouldMaskHeaderName(tok) {
			t.Errorf("expected token %q to mask", tok)
		}
		if !shouldMaskHeaderName("X-" + tok) {
			t.Errorf("expected prefix variant X-%q to mask", tok)
		}
	}
}

func TestSanitizeURLMasksSensitiveQuery(t *testing.T) {
	cases := []struct {
		name    string
		url     string
		must    []string
		mustNot []string
	}{
		{
			name:    "api_key",
			url:     "https://api.example.com/login?api_key=secret&page=1",
			must:    []string{"api_key=***"},
			mustNot: []string{"api_key=secret"},
		},
		{
			name:    "preserve percent-encoded value",
			url:     "https://api.example.com/login?api_key=secret%2Dvalue&page=1",
			must:    []string{"api_key=***"},
			mustNot: []string{"secret-value", "secret%2Dvalue"},
		},
		{
			name: "jwt in query value",
			url:  "https://example.com/?token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature",
			must:    []string{"token=***"},
			mustNot: []string{"eyJhbGciOiJIUzI1NiJ9"},
		},
		{
			name: "preserves safe query",
			url:  "https://example.com/?page=1&size=20",
			must: []string{"page=1", "size=20"},
		},
		{
			name: "bearer token stays masked even when URL has no scheme",
			url:  "https://api.example.com/oauth?token=abcdefghijklmnop",
			must:    []string{"token=***"},
			mustNot: []string{"abcdefghijklmnop"},
		},
	}
	for _, tc := range cases {
		got := sanitizeURL(tc.url)
		for _, want := range tc.must {
			if !strings.Contains(got, want) {
				t.Errorf("%s: expected output to contain %q, got %q", tc.name, want, got)
			}
		}
		for _, banned := range tc.mustNot {
			if strings.Contains(got, banned) {
				t.Errorf("%s: expected output to omit %q, got %q", tc.name, banned, got)
			}
		}
	}
}

func TestSanitizeURLTextFallback(t *testing.T) {
	// No parseable query: only text-secrets scrub runs, so a raw JWT inside
	// the URL should still be masked.
	got := sanitizeURL("https://example.com/path?eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature")
	if strings.Contains(got, "eyJhbGciOiJIUzI1NiJ9") {
		t.Fatalf("expected JWT scrubbed via text-secrets, got %q", got)
	}
}

func TestSanitizeBodyJSON(t *testing.T) {
	body := `{"username":"alice","password":"hunter2","nested":{"apiKey":"abc"}}`
	got := sanitizeBody(body, "application/json")
	var parsed map[string]any
	if err := json.Unmarshal([]byte(got), &parsed); err != nil {
		t.Fatalf("expected valid JSON, got %q (%v)", got, err)
	}
	if parsed["password"] != maskPlaceholder {
		t.Errorf("expected password masked, got %v", parsed["password"])
	}
	nested := parsed["nested"].(map[string]any)
	if nested["apiKey"] != maskPlaceholder {
		t.Errorf("expected nested apiKey masked, got %v", nested["apiKey"])
	}
	if parsed["username"] != "alice" {
		t.Errorf("expected username preserved, got %v", parsed["username"])
	}
}

func TestSanitizeBodyJSONByHeuristic(t *testing.T) {
	body := `{"csrf":"abc","keep":"value"}`
	got := sanitizeBody(body, "")
	var parsed map[string]any
	if err := json.Unmarshal([]byte(got), &parsed); err != nil {
		t.Fatalf("expected valid JSON, got %q (%v)", got, err)
	}
	if parsed["csrf"] != maskPlaceholder {
		t.Errorf("expected csrf masked, got %v", parsed["csrf"])
	}
}

func TestSanitizeBodyFormURLEncoded(t *testing.T) {
	body := "username=alice&password=hunter2&csrf=abc&page=1"
	got := sanitizeBody(body, "application/x-www-form-urlencoded")
	values, err := url.ParseQuery(got)
	if err != nil {
		t.Fatalf("expected form-encoded body, got %q (%v)", got, err)
	}
	if values.Get("password") != maskPlaceholder {
		t.Errorf("expected password masked, got %q", values.Get("password"))
	}
	if values.Get("csrf") != maskPlaceholder {
		t.Errorf("expected csrf masked, got %q", values.Get("csrf"))
	}
	if values.Get("username") != "alice" {
		t.Errorf("expected username preserved, got %q", values.Get("username"))
	}
	if values.Get("page") != "1" {
		t.Errorf("expected page preserved, got %q", values.Get("page"))
	}
}

func TestSanitizeBodyTextWithBearer(t *testing.T) {
	body := "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789"
	got := sanitizeBody(body, "text/plain")
	if strings.Contains(got, "abcdefghijklmnopqrstuvwxyz0123456789") {
		t.Fatalf("expected bearer token masked, got %q", got)
	}
	if !strings.Contains(got, "Bearer ***") {
		t.Fatalf("expected bearer mask placeholder, got %q", got)
	}
}

func TestSanitizeTextSecretsJWT(t *testing.T) {
	raw := "header.eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature.footer"
	got := sanitizeTextSecrets(raw)
	if strings.Contains(got, "eyJhbGciOiJIUzI1NiJ9") {
		t.Fatalf("expected JWT segments masked, got %q", got)
	}
	if !strings.Contains(got, "header.") || !strings.Contains(got, ".footer") {
		t.Fatalf("expected non-JWT text preserved, got %q", got)
	}
}

func TestSanitizeBundleMasksNetworkEventWithoutMutatingRaw(t *testing.T) {
	input := []byte(`{
		"format":"actioncap-session-archive",
		"version":1,
		"exportedAt":0,
		"bundle":{
			"networkEvents":[{
				"id":"n1","sessionId":"s","tabId":1,"requestId":"r","ts":1,"phase":"response",
				"url":"https://example.com/login?token=secret",
				"method":"POST","status":200,
				"requestHeaders":{"Authorization":"Bearer xyz","Content-Type":"application/json"},
				"responseHeaders":{"Content-Type":"application/json"},
				"requestBody":"{\"password\":\"hunter2\"}",
				"responseBody":"{\"data\":\"ok\"}",
				"mimeType":"application/json"
			}]
		}
	}`)
	raw := string(input)
	ar, err := ParseArchive(input)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	event := ar.Bundle.NetworkEvents[0]
	if event.URL == "https://example.com/login?token=secret" {
		t.Errorf("expected URL query token masked, got %q", event.URL)
	}
	if event.RequestHeaders["Authorization"] != maskPlaceholder {
		t.Errorf("expected Authorization header masked, got %q", event.RequestHeaders["Authorization"])
	}
	if event.RequestHeaders["Content-Type"] != "application/json" {
		t.Errorf("expected Content-Type preserved, got %q", event.RequestHeaders["Content-Type"])
	}
	if !strings.Contains(event.RequestBody, maskPlaceholder) {
		t.Errorf("expected request body to mask password, got %q", event.RequestBody)
	}
	if string(input) != raw {
		t.Fatal("ParseArchive mutated the raw input bytes")
	}
}