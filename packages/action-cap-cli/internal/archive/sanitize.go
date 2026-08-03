package archive

import (
	"encoding/json"
	"net/url"
	"regexp"
	"strings"
)

// sensitiveTokens mirrors the TypeScript implementation's mask list. Keep
// these in sync so the rewrite never weakens sanitization.
var sensitiveTokens = []string{
	"password",
	"passwd",
	"passcode",
	"token",
	"authorization",
	"cookie",
	"secret",
	"apikey",
	"clientkey",
	"privatekey",
	"credential",
	"csrf",
	"xsrf",
	"nonce",
	"otp",
	"pin",
	"cvv",
	"cvc",
	"ssn",
	"taxid",
	"passport",
	"phone",
	"idcard",
}

var (
	jwtPattern   = regexp.MustCompile(`\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b`)
	bearerPattern = regexp.MustCompile(`(?i)\bBearer\s+[A-Za-z0-9._~+/-]+=*`)
)

func shouldMaskHeaderName(name string) bool {
	lowered := strings.ToLower(name)
	normalized := strings.Map(func(r rune) rune {
		if r == ' ' || r == '_' || r == '-' {
			return -1
		}
		return r
	}, lowered)
	for _, token := range sensitiveTokens {
		if strings.Contains(lowered, token) || strings.Contains(normalized, token) {
			return true
		}
	}
	return false
}

func sanitizeHeaders(headers map[string]string) map[string]string {
	if headers == nil {
		return nil
	}
	out := make(map[string]string, len(headers))
	for k, v := range headers {
		if shouldMaskHeaderName(k) {
			out[k] = maskPlaceholder
		} else {
			out[k] = v
		}
	}
	return out
}

func sanitizeTextSecrets(value string) string {
	value = bearerPattern.ReplaceAllString(value, "Bearer "+maskPlaceholder)
	value = jwtPattern.ReplaceAllString(value, maskPlaceholder)
	return value
}

func sanitizeJSONValue(value any) any {
	switch v := value.(type) {
	case string:
		return sanitizeTextSecrets(v)
	case []any:
		for i := range v {
			v[i] = sanitizeJSONValue(v[i])
		}
		return v
	case map[string]any:
		for k, entry := range v {
			if shouldMaskHeaderName(k) {
				if entry == nil {
					v[k] = nil
				} else {
					v[k] = maskPlaceholder
				}
			} else {
				v[k] = sanitizeJSONValue(entry)
			}
		}
		return v
	}
	return value
}

func sanitizeBody(body, contentType string) string {
	if body == "" {
		return body
	}
	lower := strings.ToLower(contentType)
	if strings.Contains(lower, "json") || (len(body) > 0 && (body[0] == '{' || body[0] == '[')) {
		var parsed any
		if err := json.Unmarshal([]byte(body), &parsed); err == nil {
			cleaned := sanitizeJSONValue(parsed)
			out, err := json.Marshal(cleaned)
			if err == nil {
				return string(out)
			}
		}
		return sanitizeTextSecrets(body)
	}
	if strings.Contains(lower, "form-urlencoded") {
		values, err := url.ParseQuery(body)
		if err == nil {
			for key := range values {
				if shouldMaskHeaderName(key) {
					values.Set(key, maskPlaceholder)
				}
			}
			return values.Encode()
		}
	}
	return sanitizeTextSecrets(body)
}

func sanitizeURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.RawQuery == "" {
		return sanitizeTextSecrets(raw)
	}
	if _, perr := url.ParseQuery(u.RawQuery); perr != nil {
		return sanitizeTextSecrets(raw)
	}
	u.RawQuery = maskRawQuery(u.RawQuery, shouldMaskHeaderName)
	return sanitizeTextSecrets(u.String())
}

// queryKeyPattern matches `key=` followed by either an unquoted token or a
// double-quoted token, terminated at the next `&` or end of string.
var queryKeyPattern = regexp.MustCompile(`([^&=?]+)=((?:%[0-9A-Fa-f]{2}|[^&])*)`)

func maskRawQuery(query string, sensitive func(string) bool) string {
	return queryKeyPattern.ReplaceAllStringFunc(query, func(match string) string {
		eq := strings.IndexByte(match, '=')
		if eq < 0 {
			return match
		}
		key := match[:eq]
		if !sensitive(key) {
			return match
		}
		return key + "=" + maskPlaceholder
	})
}

func contentType(headers map[string]string) string {
	if headers == nil {
		return ""
	}
	if v, ok := headers["content-type"]; ok {
		return v
	}
	if v, ok := headers["Content-Type"]; ok {
		return v
	}
	return ""
}

func sanitizeNetworkEvent(event *NetworkEvent) {
	if event == nil {
		return
	}
	event.RequestHeaders = sanitizeHeaders(event.RequestHeaders)
	event.ResponseHeaders = sanitizeHeaders(event.ResponseHeaders)
	event.URL = sanitizeURL(event.URL)
	reqCT := contentType(event.RequestHeaders)
	if reqCT != "" {
		event.RequestBody = sanitizeBody(event.RequestBody, reqCT)
	}
	respCT := event.MimeType
	if respCT == "" {
		respCT = contentType(event.ResponseHeaders)
	}
	if respCT != "" {
		event.ResponseBody = sanitizeBody(event.ResponseBody, respCT)
	} else if event.ResponseBody != "" {
		event.ResponseBody = sanitizeBody(event.ResponseBody, "")
	}
}

// SanitizeBundle masks network request/response secrets in place. Callers
// should pass a freshly decoded bundle to avoid mutating the raw input.
func SanitizeBundle(bundle *SessionBundle) {
	if bundle == nil {
		return
	}
	for i := range bundle.NetworkEvents {
		sanitizeNetworkEvent(&bundle.NetworkEvents[i])
	}
}