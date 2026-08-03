package output

import (
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strings"
)

type Format string

const (
	FormatJSON  Format = "json"
	FormatTable Format = "table"
	FormatToon  Format = "toon"
)

type Encoder struct {
	w io.Writer
}

func New(w io.Writer) *Encoder { return &Encoder{w: w} }

func (e *Encoder) Write(value any, format Format) error {
	cleaned := stripUndefined(value)
	switch format {
	case FormatJSON, "":
		enc := json.NewEncoder(e.w)
		enc.SetIndent("", "  ")
		enc.SetEscapeHTML(false)
		return enc.Encode(cleaned)
	case FormatTable:
		_, err := io.WriteString(e.w, renderTable(cleaned)+"\n")
		return err
	case FormatToon:
		_, err := io.WriteString(e.w, EncodeToon(cleaned)+"\n")
		return err
	default:
		return fmt.Errorf("unknown format %q", format)
	}
}

// stripUndefined removes map entries with nil value to keep parity with the
// TypeScript CLI, which drops undefined keys before encoding.
func stripUndefined(value any) any {
	switch v := value.(type) {
	case map[string]any:
		out := make(map[string]any, len(v))
		for k, val := range v {
			if val == nil {
				continue
			}
			out[k] = stripUndefined(val)
		}
		return out
	case []any:
		out := make([]any, len(v))
		for i, val := range v {
			out[i] = stripUndefined(val)
		}
		return out
	}
	return value
}

func renderTable(value any) string {
	switch v := value.(type) {
	case []any:
		return renderArrayTable(v)
	case map[string]any:
		allArrays := len(v) > 0
		for _, child := range v {
			if _, ok := child.([]any); !ok {
				allArrays = false
				break
			}
		}
		if allArrays {
			keys := make([]string, 0, len(v))
			for k := range v {
				keys = append(keys, k)
			}
			sort.Strings(keys)
			var parts []string
			for _, k := range keys {
				parts = append(parts, "\n=== "+k+" ===")
				parts = append(parts, renderArrayTable(v[k].([]any)))
			}
			return strings.Join(parts, "\n")
		}
		return renderKeyValueTable(v)
	}
	return fmt.Sprintf("%v", value)
}

func renderKeyValueTable(m map[string]any) string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	width := 3
	for _, k := range keys {
		if len(k) > width {
			width = len(k)
		}
	}
	var b strings.Builder
	for _, k := range keys {
		fmt.Fprintf(&b, "%-*s  %s\n", width, k, formatTableCell(m[k]))
	}
	return strings.TrimRight(b.String(), "\n")
}

func renderArrayTable(items []any) string {
	if len(items) == 0 {
		return "(empty)"
	}
	first, ok := items[0].(map[string]any)
	if !ok {
		var rows []string
		for _, item := range items {
			rows = append(rows, formatTableCell(item))
		}
		return strings.Join(rows, "\n")
	}
	headers := orderedKeys(first)
	headerSet := make(map[string]struct{}, len(headers))
	for _, h := range headers {
		headerSet[h] = struct{}{}
	}
	for _, item := range items {
		if obj, ok := item.(map[string]any); ok {
			for k := range obj {
				if _, ok := headerSet[k]; !ok {
					headers = append(headers, k)
					headerSet[k] = struct{}{}
				}
			}
		}
	}
	widths := make([]int, len(headers))
	for i, h := range headers {
		widths[i] = len(h)
	}
	rows := make([][]string, len(items))
	for i, item := range items {
		obj, ok := item.(map[string]any)
		if !ok {
			row := make([]string, len(headers))
			row[0] = formatTableCell(item)
			rows[i] = row
			continue
		}
		row := make([]string, len(headers))
		for j, h := range headers {
			cell := formatTableCell(obj[h])
			row[j] = cell
			if len(cell) > widths[j] {
				widths[j] = len(cell)
			}
		}
		rows[i] = row
	}
	var b strings.Builder
	b.WriteString(formatRow(headers, widths))
	b.WriteByte('\n')
	for i := range widths {
		if i > 0 {
			b.WriteString("-+-")
		}
		b.WriteString(strings.Repeat("-", widths[i]))
	}
	b.WriteByte('\n')
	for _, row := range rows {
		b.WriteString(formatRow(row, widths))
		b.WriteByte('\n')
	}
	return strings.TrimRight(b.String(), "\n")
}

func formatRow(cells []string, widths []int) string {
	parts := make([]string, len(cells))
	for i, cell := range cells {
		parts[i] = padRight(cell, widths[i])
	}
	return strings.Join(parts, " | ")
}

func padRight(s string, w int) string {
	if len(s) >= w {
		return s
	}
	return s + strings.Repeat(" ", w-len(s))
}

func formatTableCell(v any) string {
	switch val := v.(type) {
	case nil:
		return ""
	case string:
		return val
	case float64:
		return trimFloat(val)
	case bool:
		return strings.ToLower(fmt.Sprintf("%v", val))
	case []any:
		return fmt.Sprintf("[%d items]", len(val))
	case map[string]any:
		b, _ := json.Marshal(val)
		return string(b)
	}
	return fmt.Sprintf("%v", v)
}

func trimFloat(f float64) string {
	s := fmt.Sprintf("%g", f)
	return s
}

func orderedKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}