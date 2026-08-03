package filter

import "testing"

func TestParseStatusFilter(t *testing.T) {
	cases := []struct {
		input string
		check func(p StatusPredicate) bool
	}{
		{"4xx", func(p StatusPredicate) bool { return p(400) && p(499) && !p(500) }},
		{"5xx", func(p StatusPredicate) bool { return p(500) && p(599) && !p(499) }},
		{"200", func(p StatusPredicate) bool { return p(200) && !p(201) }},
		{">=400", func(p StatusPredicate) bool { return p(400) && p(500) && !p(399) }},
		{">500", func(p StatusPredicate) bool { return p(501) && !p(500) }},
	}
	for _, tc := range cases {
		p, err := ParseStatusFilter(tc.input)
		if err != nil {
			t.Errorf("ParseStatusFilter(%q): %v", tc.input, err)
			continue
		}
		if !tc.check(p) {
			t.Errorf("ParseStatusFilter(%q): predicate failed sanity check", tc.input)
		}
	}
	if _, err := ParseStatusFilter("invalid"); err == nil {
		t.Fatal("expected error for invalid filter")
	}
}

func TestByStatus(t *testing.T) {
	items := []struct {
		Status *int
	}{}
	v := func(s int) *int { x := s; return &x }
	items = append(items, struct{ Status *int }{v(200)})
	items = append(items, struct{ Status *int }{v(404)})
	items = append(items, struct{ Status *int }{v(503)})
	out, err := ByStatus(items, "4xx", func(s struct{ Status *int }) (int, bool) {
		if s.Status == nil {
			return 0, false
		}
		return *s.Status, true
	})
	if err != nil {
		t.Fatalf("ByStatus: %v", err)
	}
	if len(out) != 1 || *out[0].Status != 404 {
		t.Fatalf("expected only 404, got %#v", out)
	}
}