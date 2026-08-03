package output

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestStripUndefined(t *testing.T) {
	in := map[string]any{
		"a": "value",
		"b": nil,
		"nested": map[string]any{"k": nil, "keep": true},
	}
	out := stripUndefined(in).(map[string]any)
	if _, ok := out["b"]; ok {
		t.Fatalf("expected nil value to be removed")
	}
	nested := out["nested"].(map[string]any)
	if _, ok := nested["k"]; ok {
		t.Fatalf("expected nested nil value to be removed")
	}
}

func TestEncodeToonObject(t *testing.T) {
	in := map[string]any{
		"session": map[string]any{"id": "abc", "name": "Test", "count": float64(5)},
		"tags":    []any{"alpha", "beta"},
	}
	got := EncodeToon(in)
	if !strings.Contains(got, "session:") || !strings.Contains(got, "id: abc") {
		t.Fatalf("missing session fields in TOON output:\n%s", got)
	}
	if !strings.Contains(got, "[alpha, beta]") {
		t.Fatalf("missing inline array in TOON output:\n%s", got)
	}
}

func TestEncodeToonTabularArray(t *testing.T) {
	in := map[string]any{
		"items": []any{
			map[string]any{"name": "alpha", "count": float64(1)},
			map[string]any{"name": "beta", "count": float64(2)},
		},
	}
	got := EncodeToon(in)
	if !strings.Contains(got, "items:") {
		t.Fatalf("expected items key, got:\n%s", got)
	}
	if !strings.Contains(got, "count,name") {
		t.Fatalf("expected tabular header, got:\n%s", got)
	}
	if !strings.Contains(got, "1,alpha") || !strings.Contains(got, "2,beta") {
		t.Fatalf("expected tabular rows, got:\n%s", got)
	}
}

func TestEncodeToonEmptyArray(t *testing.T) {
	got := EncodeToon(map[string]any{"items": []any{}})
	if !strings.Contains(got, "items:\n[]") {
		t.Fatalf("expected empty inline marker, got:\n%s", got)
	}
}

func TestEncodeToonQuotedString(t *testing.T) {
	got := EncodeToon(map[string]any{"label": "needs: quoting"})
	if !strings.Contains(got, `label: "needs: quoting"`) {
		t.Fatalf("expected quoted string, got:\n%s", got)
	}
}

func TestEncodeToonEscapeSequences(t *testing.T) {
	got := EncodeToon(map[string]any{"label": "line1\nline2"})
	if !strings.Contains(got, `label: "line1\nline2"`) {
		t.Fatalf("expected escaped newline, got:\n%s", got)
	}
}

func TestEncodeToonBooleanAndNull(t *testing.T) {
	got := EncodeToon(map[string]any{"active": true, "missing": nil})
	if !strings.Contains(got, "active: true") || !strings.Contains(got, "missing: null") {
		t.Fatalf("missing scalar types, got:\n%s", got)
	}
}

func TestEncodeToonJSONRoundTrip(t *testing.T) {
	cases := []map[string]any{
		{"session": map[string]any{"id": "abc", "name": "Test", "count": float64(5)}},
		{"items": []any{map[string]any{"name": "alpha"}, map[string]any{"name": "beta"}}},
		{"flag": true, "score": float64(3.5), "tags": []any{"x", "y"}},
	}
	for _, original := range cases {
		toonStr := EncodeToon(original)
		decoded := DecodeToon(toonStr)
		if !equalValue(original, decoded) {
			t.Fatalf("round-trip mismatch:\noriginal=%#v\ntoon=%s\ndecoded=%#v", original, toonStr, decoded)
		}
	}
}

func TestEncodeToonInlineArrayRoundTrip(t *testing.T) {
	original := map[string]any{
		"empty":  []any{},
		"ints":   []any{1, 2, 3},
		"mixed":  []any{"alpha", "beta", "gamma"},
		"booleans": []any{true, false, true},
		"nested": map[string]any{"items": []any{"a", "b"}},
	}
	decoded := DecodeToon(EncodeToon(original))
	if !equalValue(original, decoded) {
		t.Fatalf("inline array round-trip mismatch:\noriginal=%#v\ndecoded=%#v", original, decoded)
	}
}

func TestDecodeInlineArrayValue(t *testing.T) {
	cases := []struct {
		input   string
		isArray bool
		asArray []any
	}{
		{"[x, y]", true, []any{"x", "y"}},
		{"[]", true, []any{}},
		{"[1, 2, 3]", true, []any{1.0, 2.0, 3.0}},
		{`"["`, false, nil},
		{`"[a, b]"`, false, nil},
		{"hello", false, nil},
		{"[", false, nil},
		{"]", false, nil},
	}
	for _, c := range cases {
		arr, ok := parseInlineArrayValue(c.input)
		if ok != c.isArray {
			t.Fatalf("parseInlineArrayValue(%q) ok=%v want %v", c.input, ok, c.isArray)
		}
		if !ok {
			continue
		}
		if !equalValue(c.asArray, arr) {
			t.Fatalf("parseInlineArrayValue(%q)=%#v want %#v", c.input, arr, c.asArray)
		}
	}
}

func equalValue(a, b any) bool {
	switch av := a.(type) {
	case map[string]any:
		bv, ok := b.(map[string]any)
		if !ok || len(av) != len(bv) {
			return false
		}
		for k, v := range av {
			if !equalValue(v, bv[k]) {
				return false
			}
		}
		return true
	case []any:
		bv, ok := b.([]any)
		if !ok || len(av) != len(bv) {
			return false
		}
		for i := range av {
			if !equalValue(av[i], bv[i]) {
				return false
			}
		}
		return true
	case string:
		bv, ok := b.(string)
		return ok && av == bv
	case float64:
		switch bv := b.(type) {
		case float64:
			return av == bv
		case json.Number:
			x, err := bv.Float64()
			return err == nil && x == av
		case int:
			return int64(av) == int64(bv)
		case int64:
			return int64(av) == bv
		}
	case int:
		switch bv := b.(type) {
		case float64:
			return float64(av) == bv
		case int:
			return av == bv
		case int64:
			return int64(av) == bv
		}
	case bool:
		bv, ok := b.(bool)
		return ok && av == bv
	case nil:
		return b == nil
	}
	return false
}