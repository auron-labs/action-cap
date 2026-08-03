package output

import (
	"fmt"
	"strconv"
	"strings"
)

// DecodeToon parses TOON output produced by EncodeToon and returns the
// original Go value. It supports the object, primitive inline array, and
// tabular object array forms.
func DecodeToon(input string) any {
	lines := strings.Split(strings.ReplaceAll(input, "\r\n", "\n"), "\n")
	tokens := make([]toonToken, 0, len(lines))
	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		indent := leadingSpaces(line)
		body := line[indent:]
		switch body {
		case "[":
			tokens = append(tokens, toonToken{kind: tokBracketOpen, indent: indent})
		case "]":
			tokens = append(tokens, toonToken{kind: tokBracketClose, indent: indent})
		case "{":
			tokens = append(tokens, toonToken{kind: tokBraceOpen, indent: indent})
		case "}":
			tokens = append(tokens, toonToken{kind: tokBraceClose, indent: indent})
		default:
			key, value, hasValue := splitKeyValue(body)
			if key != "" {
				tokens = append(tokens, toonToken{kind: tokKey, text: key, indent: indent})
				if hasValue {
					tokens = append(tokens, toonToken{kind: tokValue, text: value})
				}
				continue
			}
			tokens = append(tokens, toonToken{kind: tokValue, text: body})
		}
	}
	d := &toonDecoder{tokens: tokens}
	return d.parseObject(0)
}

const (
	tokKey         = "key"
	tokValue       = "value"
	tokBracketOpen = "bracketOpen"
	tokBracketClose = "bracketClose"
	tokBraceOpen   = "braceOpen"
	tokBraceClose  = "braceClose"
)

type toonToken struct {
	kind   string
	text   string
	indent int
}

type toonDecoder struct {
	tokens []toonToken
	pos    int
}

func leadingSpaces(line string) int {
	count := 0
	for _, r := range line {
		if r == ' ' {
			count++
		} else {
			break
		}
	}
	return count
}

func splitKeyValue(s string) (string, string, bool) {
	colon := indexUnquotedColon(s)
	if colon < 0 {
		return "", "", false
	}
	key := strings.TrimSpace(s[:colon])
	rest := strings.TrimSpace(s[colon+1:])
	return key, rest, rest != ""
}

func indexUnquotedColon(s string) int {
	inQuote := false
	escape := false
	for i, r := range s {
		switch {
		case escape:
			escape = false
		case r == '\\':
			escape = true
		case r == '"':
			inQuote = !inQuote
		case r == ':' && !inQuote:
			return i
		}
	}
	return -1
}

func (d *toonDecoder) peek() (toonToken, bool) {
	if d.pos >= len(d.tokens) {
		return toonToken{}, false
	}
	return d.tokens[d.pos], true
}

func (d *toonDecoder) next() (toonToken, bool) {
	if d.pos >= len(d.tokens) {
		return toonToken{}, false
	}
	t := d.tokens[d.pos]
	d.pos++
	return t, true
}

func (d *toonDecoder) parseObject(minIndent int) map[string]any {
	out := map[string]any{}
	for {
		tok, ok := d.peek()
		if !ok {
			return out
		}
		if tok.kind == tokBraceClose || tok.kind == tokBracketClose {
			return out
		}
		if tok.kind != tokKey {
			return out
		}
		if tok.indent < minIndent {
			return out
		}
		d.next()
		key := tok.text
		next, ok := d.peek()
		if !ok {
			out[key] = nil
			return out
		}
		switch next.kind {
		case tokValue:
			d.next()
			if items, isArray := parseInlineArrayValue(next.text); isArray {
				out[key] = items
			} else {
				out[key] = parseScalar(next.text)
			}
		case tokKey:
			out[key] = d.parseObject(tok.indent + 2)
		case tokBracketOpen:
			d.next()
			out[key] = d.parseArray(tok.indent + 2)
		case tokBraceOpen:
			d.next()
			out[key] = d.parseTabular(tok.indent + 2)
		default:
			d.next()
			out[key] = nil
		}
	}
}

func (d *toonDecoder) parseArray(minIndent int) any {
	// Inline `[v, v, v]` on the value line OR block array.
	if tok, ok := d.peek(); ok && tok.kind == tokValue {
		d.next()
		text := tok.text
		if strings.HasPrefix(text, "[") {
			items := splitInlineArray(text)
			if d.pos < len(d.tokens) && d.tokens[d.pos].kind == tokBracketClose {
				d.pos++
			}
			return items
		}
		return parseScalar(text)
	}
	if tok, ok := d.peek(); ok && tok.kind == tokBraceOpen {
		d.next()
		return d.parseTabular(minIndent)
	}
	out := []any{}
	for {
		tok, ok := d.peek()
		if !ok {
			return out
		}
		if tok.kind == tokBracketClose || tok.kind == tokBraceClose {
			d.next()
			return out
		}
		if tok.kind == tokValue {
			d.next()
			out = append(out, parseScalar(tok.text))
			continue
		}
		if tok.kind == tokKey {
			d.next()
			if ntok, ok2 := d.peek(); ok2 && ntok.kind == tokValue {
				d.next()
				out = append(out, map[string]any{tok.text: parseScalar(ntok.text)})
				continue
			}
			out = append(out, map[string]any{tok.text: d.parseObject(tok.indent + 2)})
			continue
		}
		return out
	}
}

func (d *toonDecoder) parseTabular(minIndent int) []any {
	if debug {
		fmt.Printf("parseTabular(minIndent=%d) pos=%d\n", minIndent, d.pos)
	}
	rows := []any{}
	if d.pos >= len(d.tokens) {
		return rows
	}
	header := d.tokens[d.pos]
	if header.kind != tokValue {
		if debug {
			fmt.Printf("  header not value, returning empty\n")
		}
		return rows
	}
	headers := splitCSV(header.text)
	d.pos++
	if debug {
		fmt.Printf("  headers=%v pos=%d\n", headers, d.pos)
	}
	for {
		tok, ok := d.peek()
		if !ok {
			return rows
		}
		if debug {
			fmt.Printf("  loop kind=%s text=%q indent=%d pos=%d\n", tok.kind, tok.text, tok.indent, d.pos)
		}
		if tok.kind == tokBraceClose {
			d.next()
			if debug {
				fmt.Printf("  returning %d rows\n", len(rows))
			}
			return rows
		}
		if tok.kind != tokValue {
			break
		}
		cells := splitCSV(tok.text)
		d.pos++
		obj := map[string]any{}
		for i, h := range headers {
			if i < len(cells) {
				obj[h] = parseScalar(cells[i])
			}
		}
		rows = append(rows, obj)
	}
	return rows
}

var debug = false

func splitInlineArray(s string) []any {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "[")
	s = strings.TrimSuffix(s, "]")
	if s == "" {
		return []any{}
	}
	parts := splitCSV(s)
	out := make([]any, 0, len(parts))
	for _, p := range parts {
		out = append(out, parseScalar(p))
	}
	return out
}

// parseInlineArrayValue reports whether raw is an inline scalar-array literal
// like `[x, y]` and returns the parsed slice. The encoder emits this form for
// primitive arrays, so the decoder must distinguish it from a quoted string.
func parseInlineArrayValue(raw string) ([]any, bool) {
	trimmed := strings.TrimSpace(raw)
	if len(trimmed) < 2 || trimmed[0] != '[' || trimmed[len(trimmed)-1] != ']' {
		return nil, false
	}
	if hasUnquotedBrackets(trimmed[1 : len(trimmed)-1]) {
		return nil, false
	}
	return splitInlineArray(trimmed), true
}

// hasUnquotedBrackets returns true if s contains `[` or `]` outside of double
// quotes, which would indicate the value is not a flat inline array.
func hasUnquotedBrackets(s string) bool {
	inQuote := false
	escape := false
	for _, r := range s {
		switch {
		case escape:
			escape = false
		case r == '\\':
			escape = true
		case r == '"':
			inQuote = !inQuote
		case !inQuote && (r == '[' || r == ']'):
			return true
		}
	}
	return false
}

func splitCSV(s string) []string {
	parts := []string{}
	var current strings.Builder
	inQuote := false
	escape := false
	for _, r := range s {
		switch {
		case escape:
			current.WriteRune(r)
			escape = false
		case r == '\\':
			current.WriteRune(r)
			escape = true
		case r == '"':
			current.WriteRune(r)
			inQuote = !inQuote
		case r == ',' && !inQuote:
			parts = append(parts, strings.TrimSpace(current.String()))
			current.Reset()
		default:
			current.WriteRune(r)
		}
	}
	if current.Len() > 0 {
		parts = append(parts, strings.TrimSpace(current.String()))
	}
	return parts
}

func parseScalar(raw string) any {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if raw == "null" {
		return nil
	}
	if raw == "true" {
		return true
	}
	if raw == "false" {
		return false
	}
	if strings.HasPrefix(raw, "\"") {
		if unq, err := unquoteString(raw); err == nil {
			return unq
		}
	}
	if num, err := strconv.ParseFloat(raw, 64); err == nil {
		return num
	}
	return unescape(raw)
}

func unquoteString(s string) (string, error) {
	if !strings.HasPrefix(s, "\"") || !strings.HasSuffix(s, "\"") {
		return "", fmt.Errorf("not quoted")
	}
	s = s[1 : len(s)-1]
	var b strings.Builder
	inEscape := false
	for _, r := range s {
		switch {
		case inEscape:
			switch r {
			case 'n':
				b.WriteByte('\n')
			case 'r':
				b.WriteByte('\r')
			case 't':
				b.WriteByte('\t')
			case '"':
				b.WriteByte('"')
			case '\\':
				b.WriteByte('\\')
			default:
				b.WriteRune(r)
			}
			inEscape = false
		case r == '\\':
			inEscape = true
		default:
			b.WriteRune(r)
		}
	}
	return b.String(), nil
}

func unescape(s string) string {
	replacer := strings.NewReplacer(`\n`, "\n", `\r`, "\r", `\t`, "\t")
	return replacer.Replace(s)
}