package filter

import (
	"fmt"
	"strconv"
	"strings"
)

type Options struct {
	Tab   *int
	Type  string
	From  *int64
	To    *int64
	Limit *int
}

type StatusPredicate func(status int) bool

func ParseInt(s string) (*int, error) {
	if s == "" {
		return nil, nil
	}
	v, err := strconv.Atoi(s)
	if err != nil {
		return nil, fmt.Errorf("invalid number %q", s)
	}
	return &v, nil
}

func ParseInt64(s string) (*int64, error) {
	if s == "" {
		return nil, nil
	}
	v, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return nil, fmt.Errorf("invalid number %q", s)
	}
	return &v, nil
}

func ParsePositiveInt(s string) (*int, error) {
	v, err := ParseInt(s)
	if err != nil {
		return nil, err
	}
	if v != nil && *v < 0 {
		return nil, fmt.Errorf("limit must be >= 0")
	}
	return v, nil
}

func Tabbed(tabID int) bool { return tabID != 0 }

func ByTab[T any](items []T, tabID *int, get func(T) int) []T {
	if tabID == nil {
		return items
	}
	out := make([]T, 0, len(items))
	for _, item := range items {
		if get(item) == *tabID {
			out = append(out, item)
		}
	}
	return out
}

func ByType[T any](items []T, types string, get func(T) string) []T {
	if types == "" {
		return items
	}
	wanted := make(map[string]struct{})
	for _, raw := range strings.Split(types, ",") {
		t := strings.TrimSpace(raw)
		if t != "" {
			wanted[t] = struct{}{}
		}
	}
	out := make([]T, 0, len(items))
	for _, item := range items {
		if _, ok := wanted[get(item)]; ok {
			out = append(out, item)
		}
	}
	return out
}

func ByTimeRange[T any](items []T, from, to *int64, get func(T) int64) []T {
	out := make([]T, 0, len(items))
	for _, item := range items {
		ts := get(item)
		if from != nil && ts < *from {
			continue
		}
		if to != nil && ts > *to {
			continue
		}
		out = append(out, item)
	}
	return out
}

func WithLimit[T any](items []T, limit *int) []T {
	if limit == nil {
		return items
	}
	if *limit <= 0 || *limit >= len(items) {
		return items
	}
	return items[:*limit]
}

// ParseStatusFilter accepts forms like "4xx", "200", ">=400", ">500".
func ParseStatusFilter(filter string) (StatusPredicate, error) {
	normalized := strings.ToLower(strings.TrimSpace(filter))
	if normalized == "" {
		return nil, fmt.Errorf("invalid status filter: %q", filter)
	}
	if strings.HasPrefix(normalized, ">=") || strings.HasPrefix(normalized, ">") {
		op := ">="
		rest := strings.TrimPrefix(normalized, ">=")
		if rest == normalized {
			op = ">"
			rest = strings.TrimPrefix(normalized, ">")
		}
		threshold, err := strconv.Atoi(rest)
		if err != nil {
			return nil, fmt.Errorf("invalid status filter: %q. Use formats like 4xx, 5xx, 200, >=400", filter)
		}
		if op == ">" {
			return func(s int) bool { return s > threshold }, nil
		}
		return func(s int) bool { return s >= threshold }, nil
	}
	if len(normalized) == 3 {
		if code, err := strconv.Atoi(normalized); err == nil {
			return func(s int) bool { return s == code }, nil
		}
	}
	if strings.HasSuffix(normalized, "xx") && len(normalized) == 3 {
		digit, err := strconv.Atoi(normalized[:1])
		if err == nil {
			min := digit * 100
			max := min + 99
			return func(s int) bool { return s >= min && s <= max }, nil
		}
	}
	return nil, fmt.Errorf("invalid status filter: %q. Use formats like 4xx, 5xx, 200, >=400", filter)
}

func ByStatus[T any](items []T, filter string, get func(T) (int, bool)) ([]T, error) {
	if filter == "" {
		return items, nil
	}
	predicate, err := ParseStatusFilter(filter)
	if err != nil {
		return nil, err
	}
	out := make([]T, 0, len(items))
	for _, item := range items {
		status, ok := get(item)
		if !ok {
			continue
		}
		if predicate(status) {
			out = append(out, item)
		}
	}
	return out, nil
}
