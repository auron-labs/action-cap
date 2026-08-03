package view

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/auron-labs/action-cap-cli/internal/archive"
)

func loadBundle(t *testing.T) *archive.SessionBundle {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "test", "fixtures", "sample.bxdac"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	ar, err := archive.ParseArchive(data)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	return &ar.Bundle
}

func TestSessionSummary(t *testing.T) {
	b := loadBundle(t)
	v := SessionSummary(b)
	if v.Session == nil || v.Session.ID != "sess-001" {
		t.Fatalf("unexpected session: %#v", v.Session)
	}
	if v.Duration == nil || *v.Duration != 60000 {
		t.Fatalf("expected duration 60000, got %v", v.Duration)
	}
	if v.Counts.Actions != 8 || v.Counts.Network != 5 || v.Counts.Replay != 3 || v.Counts.Tabs != 2 {
		t.Fatalf("unexpected counts: %#v", v.Counts)
	}
}

func TestActionTimeline(t *testing.T) {
	b := loadBundle(t)
	defaults := ActionTimeline(b, ActionOptions{})
	if len(defaults) != 7 {
		t.Fatalf("expected 7 actions without scroll, got %d", len(defaults))
	}
	withScroll := ActionTimeline(b, ActionOptions{IncludeScroll: true})
	if len(withScroll) != 8 {
		t.Fatalf("expected 8 actions with scroll, got %d", len(withScroll))
	}
	clicks := ActionTimeline(b, ActionOptions{Type: "click"})
	if len(clicks) != 1 || clicks[0].Type != "click" {
		t.Fatalf("expected one click action, got %#v", clicks)
	}
	if clicks[0].TagName != "input" {
		t.Fatalf("expected tagName input, got %q", clicks[0].TagName)
	}
	masked := ActionTimeline(b, ActionOptions{Type: "input"})
	for _, a := range masked {
		if a.Masked != nil && *a.Masked {
			if a.Value != "al***ab" {
				t.Fatalf("expected masked value al***ab, got %q", a.Value)
			}
		}
	}
}

func TestNetworkRequests(t *testing.T) {
	b := loadBundle(t)
	events, err := NetworkRequests(b, NetworkOptions{TruncateLength: 500})
	if err != nil {
		t.Fatalf("NetworkRequests: %v", err)
	}
	if len(events) != 5 {
		t.Fatalf("expected 5 events, got %d", len(events))
	}
	if events[0].TS > events[1].TS {
		t.Fatalf("expected sorted events, got %d > %d", events[0].TS, events[1].TS)
	}
	if events[0].RequestHeaders != nil {
		t.Fatalf("expected no headers without flag")
	}
	withHeaders, err := NetworkRequests(b, NetworkOptions{Headers: true})
	if err != nil {
		t.Fatalf("NetworkRequests headers: %v", err)
	}
	if withHeaders[0].RequestHeaders == nil {
		t.Fatalf("expected headers with flag")
	}
	fourxx, err := NetworkRequests(b, NetworkOptions{Status: "4xx"})
	if err != nil {
		t.Fatalf("NetworkRequests 4xx: %v", err)
	}
	if len(fourxx) != 1 || fourxx[0].Status == nil || *fourxx[0].Status != 401 {
		t.Fatalf("expected 401 in 4xx results, got %#v", fourxx)
	}
}

func TestNetworkErrors(t *testing.T) {
	b := loadBundle(t)
	errs := NetworkErrors(b)
	if len(errs) != 2 {
		t.Fatalf("expected 2 errors, got %d", len(errs))
	}
	for _, e := range errs {
		if e.Status != nil && *e.Status < 400 && e.ErrorText == "" {
			t.Fatalf("unexpected non-error event: %#v", e)
		}
	}
	has401 := false
	for _, e := range errs {
		if e.Status != nil && *e.Status == 401 {
			has401 = true
		}
	}
	if !has401 {
		t.Fatal("expected a 401 in errors")
	}
}

func TestAPIEndpoints(t *testing.T) {
	b := loadBundle(t)
	endpoints := APIEndpoints(b)
	auth := findEndpoint(endpoints, "/auth")
	if auth == nil || len(auth.Methods) != 1 || auth.Methods[0].Count != 2 {
		t.Fatalf("expected /auth with 2 calls, got %#v", auth)
	}
	users := findEndpoint(endpoints, "/users")
	if users == nil || len(users.Methods) == 0 {
		t.Fatalf("expected /users endpoint, got %#v", users)
	}
	if users.Methods[0].Count != 2 {
		t.Fatalf("expected /users count 2, got %d", users.Methods[0].Count)
	}
	if !containsStatus(users.Methods[0].Statuses, 200) || !containsStatus(users.Methods[0].Statuses, 500) {
		t.Fatalf("expected statuses 200 and 500, got %#v", users.Methods[0].Statuses)
	}
}

func TestFormSubmissions(t *testing.T) {
	b := loadBundle(t)
	forms := FormSubmissions(b)
	if len(forms) != 1 || len(forms[0].FormValues) != 2 {
		t.Fatalf("expected one form with two values, got %#v", forms)
	}
	username := findFormValue(forms[0].FormValues, "#username")
	if username == nil || username.Value != "alice" {
		t.Fatalf("expected username alice, got %#v", username)
	}
	password := findFormValue(forms[0].FormValues, "#password")
	if password == nil || password.Masked == nil || !*password.Masked {
		t.Fatalf("expected masked password, got %#v", password)
	}
}

func TestNavigationFlow(t *testing.T) {
	b := loadBundle(t)
	nav := NavigationFlow(b)
	if len(nav) != 3 {
		t.Fatalf("expected 3 navigations, got %d", len(nav))
	}
	for i := 1; i < len(nav); i++ {
		if nav[i].TS < nav[i-1].TS {
			t.Fatalf("expected chronological order")
		}
	}
}

func TestInteractedElements(t *testing.T) {
	b := loadBundle(t)
	elements := InteractedElements(b)
	username := findElement(elements, "#username")
	if username == nil {
		t.Fatalf("expected #username element, got %#v", elements)
	}
	if len(username.Interactions) != 2 {
		t.Fatalf("expected 2 interaction types, got %#v", username.Interactions)
	}
	if containsSelector(elements, "scroll") {
		t.Fatalf("expected no scroll interactions")
	}
}

func TestTabLifecycle(t *testing.T) {
	b := loadBundle(t)
	tabs := TabLifecycle(b)
	if len(tabs) < 2 {
		t.Fatalf("expected at least 2 tabs, got %d", len(tabs))
	}
	tab100 := findTab(tabs, 100)
	if tab100 == nil || len(tab100.Events) != 3 {
		t.Fatalf("expected 3 events on tab 100, got %#v", tab100)
	}
}

func TestReplayMetadata(t *testing.T) {
	b := loadBundle(t)
	meta := ReplayMetadata(b, false)
	if meta.Count != 3 || meta.TimeRange == nil || meta.EstimatedSizeBytes <= 0 {
		t.Fatalf("unexpected metadata: %#v", meta)
	}
	if meta.Events != nil {
		t.Fatalf("expected no events without --full")
	}
	full := ReplayMetadata(b, true)
	if len(full.Events) != 3 {
		t.Fatalf("expected 3 events with --full, got %d", len(full.Events))
	}
	empty := ReplayMetadata(&archive.SessionBundle{}, false)
	if empty.Count != 0 || empty.TimeRange != nil {
		t.Fatalf("expected empty metadata, got %#v", empty)
	}
}

func TestFullDump(t *testing.T) {
	b := loadBundle(t)
	dump := FullDump(b, false)
	if len(dump.ReplayEvents) != 3 || len(dump.UserActions) != 8 {
		t.Fatalf("expected full dump, got %#v", dump)
	}
	stripped := FullDump(b, true)
	if len(stripped.ReplayEvents) != 0 || len(stripped.UserActions) != 8 {
		t.Fatalf("expected replay stripped, got %#v", stripped)
	}
}

func findEndpoint(endpoints []Endpoint, path string) *Endpoint {
	for i := range endpoints {
		if endpoints[i].Path == path {
			return &endpoints[i]
		}
	}
	return nil
}

func containsStatus(s []int, target int) bool {
	for _, v := range s {
		if v == target {
			return true
		}
	}
	return false
}

func findFormValue(values []FormValue, selector string) *FormValue {
	for i := range values {
		if values[i].Selector == selector {
			return &values[i]
		}
	}
	return nil
}

func findElement(elements []ElementView, selector string) *ElementView {
	for i := range elements {
		if elements[i].Selector == selector {
			return &elements[i]
		}
	}
	return nil
}

func containsSelector(elements []ElementView, fragment string) bool {
	for _, e := range elements {
		if e.Selector != "" && stringIndex(e.Selector, fragment) {
			return true
		}
	}
	return false
}

func stringIndex(haystack, needle string) bool {
	if len(needle) == 0 {
		return true
	}
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}

func findTab(tabs []TabView, id int) *TabView {
	for i := range tabs {
		if tabs[i].TabID == id {
			return &tabs[i]
		}
	}
	return nil
}