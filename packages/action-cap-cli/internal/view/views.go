package view

import (
	"sort"

	"github.com/auron-labs/action-cap-cli/internal/archive"
	"github.com/auron-labs/action-cap-cli/internal/filter"
)

type SummaryView struct {
	Session   *archive.SessionRecord `json:"session"`
	Duration  *int64                 `json:"duration"`
	Tabs      []TabSummary           `json:"tabs"`
	TimeRange *TimeRange             `json:"timeRange"`
	Counts    Counts                 `json:"counts"`
}

type TabSummary struct {
	TabID    int    `json:"tabId"`
	WindowID int    `json:"windowId"`
	Title    string `json:"title,omitempty"`
	URL      string `json:"url,omitempty"`
}

type TimeRange struct {
	Start int64 `json:"start"`
	End   int64 `json:"end"`
}

type Counts struct {
	Tabs     int `json:"tabs"`
	Actions  int `json:"actions"`
	Network  int `json:"network"`
	Replay   int `json:"replay"`
}

func SessionSummary(bundle *archive.SessionBundle) SummaryView {
	view := SummaryView{
		Session: bundle.Session,
		Counts: Counts{
			Tabs:    len(bundle.Tabs),
			Actions: len(bundle.UserActions),
			Network: len(bundle.NetworkEvents),
			Replay:  len(bundle.ReplayEvents),
		},
		Tabs: make([]TabSummary, 0, len(bundle.Tabs)),
	}
	for _, tab := range bundle.Tabs {
		view.Tabs = append(view.Tabs, TabSummary{
			TabID:    tab.TabID,
			WindowID: tab.WindowID,
			Title:    tab.Title,
			URL:      tab.URL,
		})
	}

	timestamps := make([]int64, 0)
	for _, a := range bundle.UserActions {
		timestamps = append(timestamps, a.TS)
	}
	for _, n := range bundle.NetworkEvents {
		timestamps = append(timestamps, n.TS)
	}
	for _, r := range bundle.ReplayEvents {
		timestamps = append(timestamps, r.TS)
	}
	if bundle.Session != nil {
		timestamps = append(timestamps, bundle.Session.StartTime)
		if bundle.Session.EndTime != nil {
			timestamps = append(timestamps, *bundle.Session.EndTime)
		}
	}
	if len(timestamps) > 0 {
		sort.Slice(timestamps, func(i, j int) bool { return timestamps[i] < timestamps[j] })
		start := timestamps[0]
		end := timestamps[len(timestamps)-1]
		view.TimeRange = &TimeRange{Start: start, End: end}
		duration := end - start
		view.Duration = &duration
	}
	return view
}

type ActionView struct {
	TS         int64           `json:"ts"`
	Type       string          `json:"type"`
	TabID      int             `json:"tabId"`
	URL        string          `json:"url,omitempty"`
	Selector   string          `json:"selector,omitempty"`
	TagName    string          `json:"tagName,omitempty"`
	Text       string          `json:"text,omitempty"`
	Value      string          `json:"value,omitempty"`
	Masked     *bool           `json:"masked,omitempty"`
	Coordinates *archive.Coordinates `json:"coordinates,omitempty"`
	Key        string          `json:"key,omitempty"`
}

type ActionOptions struct {
	IncludeScroll bool
	Type          string
	Tab           *int
	From          *int64
	To            *int64
	Limit         *int
}

func ActionTimeline(bundle *archive.SessionBundle, opts ActionOptions) []ActionView {
	actions := bundle.UserActions
	actions = filter.ByTab(actions, opts.Tab, func(a archive.UserActionEvent) int { return a.TabID })
	actions = filter.ByType(actions, opts.Type, func(a archive.UserActionEvent) string { return a.Type })
	actions = filter.ByTimeRange(actions, opts.From, opts.To, func(a archive.UserActionEvent) int64 { return a.TS })
	actions = filter.WithLimit(actions, opts.Limit)
	sort.Slice(actions, func(i, j int) bool { return actions[i].TS < actions[j].TS })
	views := make([]ActionView, 0, len(actions))
	for _, a := range actions {
		if !opts.IncludeScroll && a.Type == "scroll" {
			continue
		}
		v := ActionView{
			TS:       a.TS,
			Type:     a.Type,
			TabID:    a.TabID,
			URL:      a.URL,
			Selector: a.Selector,
			Value:    a.Value,
			Masked:   a.Masked,
			Coordinates: a.Coordinates,
		}
		if a.Element != nil {
			v.TagName = a.Element.TagName
			v.Text = a.Element.Text
		}
		if key, ok := a.Metadata["key"].(string); ok {
			v.Key = key
		}
		views = append(views, v)
	}
	return views
}

type NetworkView struct {
	TS              int64             `json:"ts"`
	TabID           int               `json:"tabId"`
	RequestID       string            `json:"requestId"`
	Phase           string            `json:"phase"`
	Method          string            `json:"method,omitempty"`
	URL             string            `json:"url"`
	Status          *int              `json:"status,omitempty"`
	StatusText      string            `json:"statusText,omitempty"`
	MimeType        string            `json:"mimeType,omitempty"`
	ResourceType    string            `json:"resourceType,omitempty"`
	DurationMs      *int              `json:"durationMs,omitempty"`
	RequestBody     string            `json:"requestBody,omitempty"`
	ResponseBody    string            `json:"responseBody,omitempty"`
	BodyEncoding    string            `json:"bodyEncoding,omitempty"`
	ErrorText       string            `json:"errorText,omitempty"`
	RequestHeaders  map[string]string `json:"requestHeaders,omitempty"`
	ResponseHeaders map[string]string `json:"responseHeaders,omitempty"`
	Truncated       *bool             `json:"truncated,omitempty"`
}

type NetworkOptions struct {
	Headers        bool
	TruncateLength int
	Status         string
	filter.Options
}

func NetworkRequests(bundle *archive.SessionBundle, opts NetworkOptions) ([]NetworkView, error) {
	events := bundle.NetworkEvents
	events = filter.ByTab(events, opts.Tab, func(e archive.NetworkEvent) int { return e.TabID })
	filtered, err := filter.ByStatus(events, opts.Status, func(e archive.NetworkEvent) (int, bool) {
		if e.Status == nil {
			return 0, false
		}
		return *e.Status, true
	})
	if err != nil {
		return nil, err
	}
	events = filtered
	events = filter.ByTimeRange(events, opts.From, opts.To, func(e archive.NetworkEvent) int64 { return e.TS })
	events = filter.WithLimit(events, opts.Limit)
	sort.Slice(events, func(i, j int) bool { return events[i].TS < events[j].TS })

	maxLen := opts.TruncateLength
	if maxLen == 0 {
		maxLen = 500
	}
	views := make([]NetworkView, 0, len(events))
	for _, e := range events {
		v := NetworkView{
			TS:              e.TS,
			TabID:           e.TabID,
			RequestID:       e.RequestID,
			Phase:           e.Phase,
			Method:          e.Method,
			URL:             e.URL,
			Status:          e.Status,
			StatusText:      e.StatusText,
			MimeType:        e.MimeType,
			ResourceType:    e.ResourceType,
			DurationMs:      e.DurationMs,
			BodyEncoding:    e.BodyEncoding,
			ErrorText:       e.ErrorText,
			Truncated:       e.Truncated,
		}
		if opts.Headers {
			v.RequestBody = e.RequestBody
			v.ResponseBody = e.ResponseBody
			v.RequestHeaders = e.RequestHeaders
			v.ResponseHeaders = e.ResponseHeaders
		} else {
			v.RequestBody = truncate(e.RequestBody, maxLen)
			v.ResponseBody = truncate(e.ResponseBody, maxLen)
		}
		views = append(views, v)
	}
	return views, nil
}

func NetworkErrors(bundle *archive.SessionBundle) []NetworkView {
	events := make([]archive.NetworkEvent, 0)
	for _, e := range bundle.NetworkEvents {
		if (e.Status != nil && *e.Status >= 400) || e.ErrorText != "" {
			events = append(events, e)
		}
	}
	sort.Slice(events, func(i, j int) bool { return events[i].TS < events[j].TS })
	views := make([]NetworkView, 0, len(events))
	for _, e := range events {
		views = append(views, NetworkView{
			TS:              e.TS,
			TabID:           e.TabID,
			RequestID:       e.RequestID,
			Phase:           e.Phase,
			Method:          e.Method,
			URL:             e.URL,
			Status:          e.Status,
			StatusText:      e.StatusText,
			MimeType:        e.MimeType,
			ResourceType:    e.ResourceType,
			DurationMs:      e.DurationMs,
			RequestBody:     e.RequestBody,
			ResponseBody:    e.ResponseBody,
			BodyEncoding:    e.BodyEncoding,
			ErrorText:       e.ErrorText,
			RequestHeaders:  e.RequestHeaders,
			ResponseHeaders: e.ResponseHeaders,
			Truncated:       e.Truncated,
		})
	}
	return views
}

type EndpointMethod struct {
	Method   string `json:"method"`
	Statuses []int  `json:"statuses"`
	Count    int    `json:"count"`
}

type Endpoint struct {
	Path    string            `json:"path"`
	Methods []EndpointMethod  `json:"methods"`
}

func APIEndpoints(bundle *archive.SessionBundle) []Endpoint {
	endpointMap := map[string]map[string]*EndpointMethod{}
	for _, e := range bundle.NetworkEvents {
		if e.Method == "" {
			continue
		}
		path := networkPath(e.URL)
		if endpointMap[path] == nil {
			endpointMap[path] = map[string]*EndpointMethod{}
		}
		methodKey := upper(e.Method)
		entry := endpointMap[path][methodKey]
		if entry == nil {
			entry = &EndpointMethod{Method: methodKey}
			endpointMap[path][methodKey] = entry
		}
		entry.Count++
		if e.Status != nil && !containsInt(entry.Statuses, *e.Status) {
			entry.Statuses = append(entry.Statuses, *e.Status)
		}
	}
	paths := make([]string, 0, len(endpointMap))
	for p := range endpointMap {
		paths = append(paths, p)
	}
	sort.Strings(paths)
	endpoints := make([]Endpoint, 0, len(paths))
	for _, p := range paths {
		methods := make([]EndpointMethod, 0, len(endpointMap[p]))
		for _, m := range endpointMap[p] {
			methods = append(methods, *m)
		}
		sort.Slice(methods, func(i, j int) bool { return methods[i].Method < methods[j].Method })
		endpoints = append(endpoints, Endpoint{Path: p, Methods: methods})
	}
	return endpoints
}

type FormValue struct {
	Selector string `json:"selector,omitempty"`
	TagName  string `json:"tagName,omitempty"`
	Name     string `json:"name,omitempty"`
	Value    string `json:"value,omitempty"`
	Masked   *bool  `json:"masked,omitempty"`
}

type FormView struct {
	TS         int64       `json:"ts"`
	TabID      int         `json:"tabId"`
	URL        string      `json:"url,omitempty"`
	Selector   string      `json:"selector,omitempty"`
	FormValues []FormValue `json:"formValues"`
}

func FormSubmissions(bundle *archive.SessionBundle) []FormView {
	sorted := make([]archive.UserActionEvent, len(bundle.UserActions))
	copy(sorted, bundle.UserActions)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].TS < sorted[j].TS })
	views := make([]FormView, 0)
	for _, submit := range sorted {
		if submit.Type != "submit" {
			continue
		}
		var values []FormValue
		for _, a := range sorted {
			if a.TS > submit.TS || a.TabID != submit.TabID {
				continue
			}
			if (a.Type != "input" && a.Type != "change") || a.Value == "" {
				continue
			}
			fv := FormValue{
				Selector: a.Selector,
				Value:    a.Value,
				Masked:   a.Masked,
			}
			if a.Element != nil {
				fv.TagName = a.Element.TagName
				fv.Name = a.Element.Name
			}
			values = append(values, fv)
		}
		views = append(views, FormView{
			TS:         submit.TS,
			TabID:      submit.TabID,
			URL:        submit.URL,
			Selector:   submit.Selector,
			FormValues: values,
		})
	}
	return views
}

type NavigationEvent struct {
	TS    int64  `json:"ts"`
	Type  string `json:"type"`
	TabID int    `json:"tabId"`
	URL   string `json:"url,omitempty"`
	Title string `json:"title,omitempty"`
}

func NavigationFlow(bundle *archive.SessionBundle) []NavigationEvent {
	navTypes := map[string]struct{}{
		"navigation":   {},
		"tab-activated": {},
		"tab-created":   {},
		"tab-removed":   {},
		"window-focus":  {},
	}
	events := make([]archive.UserActionEvent, 0)
	for _, a := range bundle.UserActions {
		if _, ok := navTypes[a.Type]; ok {
			events = append(events, a)
		}
	}
	sort.Slice(events, func(i, j int) bool { return events[i].TS < events[j].TS })
	views := make([]NavigationEvent, 0, len(events))
	for _, a := range events {
		views = append(views, NavigationEvent{
			TS:    a.TS,
			Type:  a.Type,
			TabID: a.TabID,
			URL:   a.URL,
			Title: a.Title,
		})
	}
	return views
}

type ElementInteraction struct {
	Type  string `json:"type"`
	Count int    `json:"count"`
}

type ElementView struct {
	Selector    string               `json:"selector"`
	TagName     string               `json:"tagName,omitempty"`
	Text        string               `json:"text,omitempty"`
	Role        string               `json:"role,omitempty"`
	Name        string               `json:"name,omitempty"`
	Interactions []ElementInteraction `json:"interactions"`
}

func InteractedElements(bundle *archive.SessionBundle) []ElementView {
	interactionTypes := map[string]struct{}{
		"click":      {},
		"dblclick":   {},
		"contextmenu": {},
		"input":      {},
		"change":     {},
		"submit":     {},
		"keydown":    {},
		"keyup":      {},
		"focus":      {},
		"blur":       {},
	}
	elementMap := map[string]*ElementView{}
	for _, a := range bundle.UserActions {
		if _, ok := interactionTypes[a.Type]; !ok {
			continue
		}
		key := a.Selector
		if key == "" {
			tag := "<unknown>"
			if a.Element != nil && a.Element.TagName != "" {
				tag = "<" + a.Element.TagName + ">"
			}
			key = tag
		}
		entry := elementMap[key]
		if entry == nil {
			entry = &ElementView{Selector: key}
			if a.Element != nil {
				entry.TagName = a.Element.TagName
				entry.Text = a.Element.Text
				entry.Role = a.Element.Role
				entry.Name = a.Element.Name
			}
			elementMap[key] = entry
		}
		found := false
		for i, inter := range entry.Interactions {
			if inter.Type == a.Type {
				entry.Interactions[i].Count++
				found = true
				break
			}
		}
		if !found {
			entry.Interactions = append(entry.Interactions, ElementInteraction{Type: a.Type, Count: 1})
		}
	}
	elements := make([]ElementView, 0, len(elementMap))
	for _, e := range elementMap {
		elements = append(elements, *e)
	}
	sort.Slice(elements, func(i, j int) bool {
		ti := 0
		for _, inter := range elements[i].Interactions {
			ti += inter.Count
		}
		tj := 0
		for _, inter := range elements[j].Interactions {
			tj += inter.Count
		}
		return ti > tj
	})
	return elements
}

type TabEvent struct {
	TS    int64  `json:"ts"`
	Type  string `json:"type"`
	URL   string `json:"url,omitempty"`
	Title string `json:"title,omitempty"`
}

type TabView struct {
	TabID       int        `json:"tabId"`
	WindowID    int        `json:"windowId"`
	Title       string     `json:"title,omitempty"`
	URL         string     `json:"url,omitempty"`
	FirstSeenAt int64      `json:"firstSeenAt"`
	LastSeenAt  int64      `json:"lastSeenAt"`
	Events      []TabEvent `json:"events"`
}

func TabLifecycle(bundle *archive.SessionBundle) []TabView {
	lifecycleTypes := map[string]struct{}{
		"tab-activated": {},
		"tab-created":   {},
		"tab-removed":   {},
		"window-focus":  {},
		"navigation":    {},
	}
	tabMap := map[int]*TabView{}
	for _, tab := range bundle.Tabs {
		tabMap[tab.TabID] = &TabView{
			TabID:       tab.TabID,
			WindowID:    tab.WindowID,
			Title:       tab.Title,
			URL:         tab.URL,
			FirstSeenAt: tab.FirstSeenAt,
			LastSeenAt:  tab.LastSeenAt,
			Events:      []TabEvent{},
		}
	}
	for _, a := range bundle.UserActions {
		if _, ok := lifecycleTypes[a.Type]; !ok {
			continue
		}
		entry := tabMap[a.TabID]
		if entry == nil {
			entry = &TabView{
				TabID:       a.TabID,
				WindowID:    0,
				FirstSeenAt: a.TS,
				LastSeenAt:  a.TS,
				Events:      []TabEvent{},
			}
			tabMap[a.TabID] = entry
		}
		entry.Events = append(entry.Events, TabEvent{
			TS:    a.TS,
			Type:  a.Type,
			URL:   a.URL,
			Title: a.Title,
		})
	}
	tabs := make([]TabView, 0, len(tabMap))
	for _, t := range tabMap {
		tabs = append(tabs, *t)
	}
	sort.Slice(tabs, func(i, j int) bool { return tabs[i].FirstSeenAt < tabs[j].FirstSeenAt })
	return tabs
}

type ReplayView struct {
	Count              int        `json:"count"`
	TimeRange          *TimeRange `json:"timeRange"`
	EstimatedSizeBytes int        `json:"estimatedSizeBytes"`
	Events             []any      `json:"events,omitempty"`
}

func ReplayMetadata(bundle *archive.SessionBundle, full bool) ReplayView {
	events := make([]archive.ReplayEventRecord, len(bundle.ReplayEvents))
	copy(events, bundle.ReplayEvents)
	sort.Slice(events, func(i, j int) bool { return events[i].TS < events[j].TS })
	if len(events) == 0 {
		return ReplayView{}
	}
	start := events[0].TS
	end := events[len(events)-1].TS
	view := ReplayView{
		Count:     len(events),
		TimeRange: &TimeRange{Start: start, End: end},
	}
	for _, e := range events {
		raw, err := marshalJSON(e.Payload)
		if err != nil {
			continue
		}
		view.EstimatedSizeBytes += len(raw)
	}
	if full {
		payloads := make([]any, 0, len(events))
		for _, e := range events {
			payloads = append(payloads, e.Payload)
		}
		view.Events = payloads
	}
	return view
}

func FullDump(bundle *archive.SessionBundle, noReplay bool) archive.SessionBundle {
	clone := *bundle
	if noReplay {
		clone.ReplayEvents = nil
	}
	return clone
}

// helpers

func truncate(s string, max int) string {
	if max == 0 || len(s) <= max {
		return s
	}
	return s[:max] + "...[truncated]"
}

func networkPath(raw string) string {
	if u, err := parseURL(raw); err == nil {
		return u.Path
	}
	for i, r := range raw {
		if r == '?' {
			return raw[:i]
		}
	}
	return raw
}

func containsInt(s []int, target int) bool {
	for _, v := range s {
		if v == target {
			return true
		}
	}
	return false
}

func upper(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'a' && c <= 'z' {
			b[i] = c - 32
		}
	}
	return string(b)
}
