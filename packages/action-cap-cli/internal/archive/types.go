package archive

import (
	"encoding/json"
	"strings"
)

const maskPlaceholder = "***"

type ElementSnapshot struct {
	TagName   string `json:"tagName,omitempty"`
	Text      string `json:"text,omitempty"`
	ID        string `json:"id,omitempty"`
	ClassName string `json:"className,omitempty"`
	Role      string `json:"role,omitempty"`
	Name      string `json:"name,omitempty"`

	Extra map[string]any `json:"-"`
}

type UserActionEvent struct {
	ID         string            `json:"id"`
	SessionID  string            `json:"sessionId"`
	TabID      int               `json:"tabId"`
	FrameID    int               `json:"frameId,omitempty"`
	TS         int64             `json:"ts"`
	Type       string            `json:"type"`
	URL        string            `json:"url,omitempty"`
	Title      string            `json:"title,omitempty"`
	Selector   string            `json:"selector,omitempty"`
	Element    *ElementSnapshot  `json:"element,omitempty"`
	Coordinates *Coordinates     `json:"coordinates,omitempty"`
	Scroll     *Coordinates      `json:"scroll,omitempty"`
	Value      string            `json:"value,omitempty"`
	Masked     *bool             `json:"masked,omitempty"`
	Metadata   map[string]any    `json:"metadata,omitempty"`
}

type Coordinates struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type NetworkEvent struct {
	ID              string            `json:"id"`
	SessionID       string            `json:"sessionId"`
	TabID           int               `json:"tabId"`
	RequestID       string            `json:"requestId"`
	TS              int64             `json:"ts"`
	Phase           string            `json:"phase"`
	URL             string            `json:"url"`
	Method          string            `json:"method,omitempty"`
	Status          *int              `json:"status,omitempty"`
	StatusText      string            `json:"statusText,omitempty"`
	ResourceType    string            `json:"resourceType,omitempty"`
	MimeType        string            `json:"mimeType,omitempty"`
	RequestHeaders  map[string]string `json:"requestHeaders,omitempty"`
	ResponseHeaders map[string]string `json:"responseHeaders,omitempty"`
	RequestBody     string            `json:"requestBody,omitempty"`
	ResponseBody    string            `json:"responseBody,omitempty"`
	BodyEncoding    string            `json:"bodyEncoding,omitempty"`
	DurationMs      *int              `json:"durationMs,omitempty"`
	Initiator       string            `json:"initiator,omitempty"`
	Truncated       *bool             `json:"truncated,omitempty"`
	ErrorText       string            `json:"errorText,omitempty"`
}

type TrackedTabRecord struct {
	ID               string `json:"id"`
	SessionID        string `json:"sessionId"`
	TabID            int    `json:"tabId"`
	WindowID         int    `json:"windowId"`
	Title            string `json:"title,omitempty"`
	URL              string `json:"url,omitempty"`
	FaviconURL       string `json:"faviconUrl,omitempty"`
	AttachedDebugger *bool  `json:"attachedDebugger,omitempty"`
	FirstSeenAt      int64  `json:"firstSeenAt"`
	LastSeenAt       int64  `json:"lastSeenAt"`
}

type SessionRecord struct {
	ID            string `json:"id"`
	Name          string `json:"name,omitempty"`
	Scope         string `json:"scope"`
	Status        string `json:"status"`
	StartTime     int64  `json:"startTime"`
	EndTime       *int64 `json:"endTime,omitempty"`
	StartTabID    *int   `json:"startTabId,omitempty"`
	StartWindowID *int   `json:"startWindowId,omitempty"`
	TabCount      *int   `json:"tabCount,omitempty"`
	ActionCount   *int   `json:"actionCount,omitempty"`
	NetworkCount  *int   `json:"networkCount,omitempty"`
	ReplayCount   *int   `json:"replayCount,omitempty"`
}

type ReplayEventRecord struct {
	ID        string `json:"id"`
	SessionID string `json:"sessionId"`
	TabID     int    `json:"tabId"`
	TS        int64  `json:"ts"`
	Payload   any    `json:"payload"`
}

type SessionBundle struct {
	Session        *SessionRecord       `json:"session,omitempty"`
	Tabs           []TrackedTabRecord   `json:"tabs,omitempty"`
	UserActions    []UserActionEvent    `json:"userActions,omitempty"`
	NetworkEvents  []NetworkEvent       `json:"networkEvents,omitempty"`
	ReplayEvents   []ReplayEventRecord  `json:"replayEvents,omitempty"`
}

type SessionArchive struct {
	Format     string        `json:"format"`
	Version    int           `json:"version"`
	ExportedAt int64         `json:"exportedAt"`
	Bundle     SessionBundle `json:"bundle"`
}

// envelope matches the wire format and lets unknown fields survive decoding
// for dump-style commands.
type envelope struct {
	Format     string          `json:"format"`
	Version    int             `json:"version"`
	ExportedAt int64           `json:"exportedAt"`
	Bundle     json.RawMessage `json:"bundle"`
}

// ParseArchive validates the envelope, then unmarshals the bundle while
// tolerating unknown fields on every leaf struct.
func ParseArchive(data []byte) (*SessionArchive, error) {
	if strings.TrimSpace(string(data)) == "" {
		return nil, &ArchiveError{Op: "parse archive", Err: ErrInvalidJSON}
	}
	var env envelope
	if err := json.Unmarshal(data, &env); err != nil {
		return nil, &ArchiveError{Op: "parse archive", Err: ErrInvalidJSON}
	}
	if env.Format != "actioncap-session-archive" {
		return nil, &ArchiveError{Op: "parse archive", Err: ErrInvalidFormat}
	}
	if env.Version != 1 {
		return nil, &ArchiveError{Op: "parse archive", Err: ErrInvalidVersion}
	}
	if len(env.Bundle) == 0 {
		return nil, &ArchiveError{Op: "parse archive", Err: ErrMissingBundle}
	}
	var bundle SessionBundle
	dec := json.NewDecoder(strings.NewReader(string(env.Bundle)))
	dec.UseNumber()
	if err := dec.Decode(&bundle); err != nil {
		return nil, &ArchiveError{Op: "parse archive", Err: ErrInvalidJSON}
	}
	SanitizeBundle(&bundle)
	return &SessionArchive{
		Format:     env.Format,
		Version:    env.Version,
		ExportedAt: env.ExportedAt,
		Bundle:     bundle,
	}, nil
}