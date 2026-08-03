package output

import (
	"encoding/json"
	"fmt"
	"reflect"
	"sort"
	"strings"
)

// EncodeToon renders a deterministic Token-Oriented Object Notation
// representation of arbitrary JSON-compatible values. The format favors
// readability for LLMs and round-trips through DecodeToon.
//
// Supported shapes:
//   - object         -> indented `key: value` lines; nested objects/arrays
//                        use a `key:` header line followed by indented
//                        children
//   - uniform object arrays -> tabular block with a `{ headers }` section
//   - primitive arrays -> inline `[v, v, v]`
//   - mixed arrays    -> one element per line
//   - scalars         -> string, number, boolean, or null
func EncodeToon(value any) string {
	normalized := normalizeForToon(value)
	var b strings.Builder
	encodeValue(&b, normalized, "", 0)
	return strings.TrimRight(b.String(), "\n")
}

// normalizeForToon converts structs into map[string]any representations so
// the encoder only needs to handle JSON-compatible types. Pointers are
// dereferenced when non-nil; nil pointers become nil values.
func normalizeForToon(value any) any {
	if value == nil {
		return nil
	}
	switch v := value.(type) {
	case map[string]any, []any, string, float64, bool:
		return v
	}
	rv := reflect.ValueOf(value)
	for rv.Kind() == reflect.Pointer {
		if rv.IsNil() {
			return nil
		}
		rv = rv.Elem()
	}
	switch rv.Kind() {
	case reflect.Struct:
		data, err := json.Marshal(rv.Interface())
		if err != nil {
			return value
		}
		var asMap map[string]any
		if err := json.Unmarshal(data, &asMap); err != nil {
			return value
		}
		return asMap
	case reflect.Slice, reflect.Array:
		out := make([]any, rv.Len())
		for i := 0; i < rv.Len(); i++ {
			out[i] = normalizeForToon(rv.Index(i).Interface())
		}
		return out
	case reflect.Map:
		out := make(map[string]any, rv.Len())
		for _, key := range rv.MapKeys() {
			out[fmt.Sprintf("%v", key.Interface())] = normalizeForToon(rv.MapIndex(key).Interface())
		}
		return out
	}
	return value
}

func encodeValue(b *strings.Builder, value any, key string, indent int) {
	switch v := value.(type) {
	case map[string]any:
		encodeObjectBody(b, v, key, indent)
	case []any:
		encodeArray(b, v, key, indent)
	case nil:
		writeScalarField(b, key, indent, "null")
	case string:
		writeScalarField(b, key, indent, quoteString(v))
	case bool:
		writeScalarField(b, key, indent, fmt.Sprintf("%v", v))
	case float64:
		writeScalarField(b, key, indent, formatNumber(v))
	default:
		writeScalarField(b, key, indent, fmt.Sprintf("%v", v))
	}
}

func encodeObjectBody(b *strings.Builder, obj map[string]any, key string, indent int) {
	keys := make([]string, 0, len(obj))
	for k := range obj {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	if key != "" {
		writeKeyHeader(b, key, indent)
	}
	childIndent := indent + 1
	for _, k := range keys {
		child := obj[k]
		switch v := child.(type) {
		case map[string]any:
			encodeObjectBody(b, v, k, childIndent)
		case []any:
			encodeArray(b, v, k, childIndent)
		default:
			writeScalarField(b, k, childIndent, v)
		}
	}
}

func encodeArray(b *strings.Builder, arr []any, key string, indent int) {
	if len(arr) == 0 {
		if key != "" {
			writeKeyHeader(b, key, indent)
		}
		b.WriteString("[]\n")
		return
	}
	if isUniformObjectArray(arr) {
		encodeTabularArray(b, arr, key, indent)
		return
	}
	if isPrimitiveArray(arr) {
		if key != "" {
			b.WriteString(strings.Repeat("  ", indent))
			b.WriteString(quoteKeyIfNeeded(key))
			b.WriteString(": ")
		}
		b.WriteString("[")
		for i, item := range arr {
			if i > 0 {
				b.WriteString(", ")
			}
			encodeCell(b, item)
		}
		b.WriteString("]\n")
		return
	}
	// Mixed array
	if key != "" {
		writeKeyHeader(b, key, indent)
	}
	childIndent := indent + 1
	for _, item := range arr {
		encodeValue(b, item, "", childIndent)
	}
}

func encodeTabularArray(b *strings.Builder, arr []any, key string, indent int) {
	keys := objectKeys(arr[0].(map[string]any))
	if key != "" {
		writeKeyHeader(b, key, indent)
	}
	b.WriteString(strings.Repeat("  ", indent+1))
	b.WriteString("[\n")
	innerIndent := indent + 2
	b.WriteString(strings.Repeat("  ", innerIndent))
	b.WriteString("{\n")
	headerIndent := innerIndent + 1
	b.WriteString(strings.Repeat("  ", headerIndent))
	for i, k := range keys {
		if i > 0 {
			b.WriteString(",")
		}
		b.WriteString(quoteKeyIfNeeded(k))
	}
	b.WriteByte('\n')
	rowIndent := headerIndent
	for _, item := range arr {
		obj := item.(map[string]any)
		b.WriteString(strings.Repeat("  ", rowIndent))
		for i, k := range keys {
			if i > 0 {
				b.WriteString(",")
			}
			encodeCell(b, obj[k])
		}
		b.WriteByte('\n')
	}
	b.WriteString(strings.Repeat("  ", innerIndent))
	b.WriteString("}\n")
	b.WriteString(strings.Repeat("  ", indent+1))
	b.WriteString("]\n")
}

func encodeScalarInline(b *strings.Builder, value any) {
	switch v := value.(type) {
	case nil:
		b.WriteString("null")
	case string:
		b.WriteString(quoteString(v))
	case bool:
		if v {
			b.WriteString("true")
		} else {
			b.WriteString("false")
		}
	case float64:
		b.WriteString(formatNumber(v))
	default:
		fmt.Fprintf(b, "%v", v)
	}
}

func encodeCell(b *strings.Builder, value any) {
	switch v := value.(type) {
	case nil:
		b.WriteString("null")
	case string:
		s := strings.ReplaceAll(v, "\n", "\\n")
		s = strings.ReplaceAll(s, "\r", "\\r")
		s = strings.ReplaceAll(s, "\t", "\\t")
		b.WriteString(quoteString(s))
	case bool:
		if v {
			b.WriteString("true")
		} else {
			b.WriteString("false")
		}
	case float64:
		b.WriteString(formatNumber(v))
	default:
		fmt.Fprintf(b, "%v", v)
	}
}

func writeKeyHeader(b *strings.Builder, key string, indent int) {
	if key == "" {
		return
	}
	b.WriteString(strings.Repeat("  ", indent))
	b.WriteString(quoteKeyIfNeeded(key))
	b.WriteString(":\n")
}

func writeScalarField(b *strings.Builder, key string, indent int, value any) {
	b.WriteString(strings.Repeat("  ", indent))
	if key != "" {
		b.WriteString(quoteKeyIfNeeded(key))
		b.WriteString(": ")
	}
	encodeScalarInline(b, value)
	b.WriteByte('\n')
}

func isUniformObjectArray(arr []any) bool {
	if len(arr) == 0 {
		return false
	}
	first, ok := arr[0].(map[string]any)
	if !ok {
		return false
	}
	keys := objectKeys(first)
	for _, item := range arr[1:] {
		obj, ok := item.(map[string]any)
		if !ok || len(obj) != len(keys) {
			return false
		}
		for _, k := range keys {
			if _, ok := obj[k]; !ok {
				return false
			}
		}
	}
	return true
}

func isPrimitiveArray(arr []any) bool {
	for _, item := range arr {
		switch item.(type) {
		case map[string]any, []any:
			return false
		}
	}
	return true
}

func objectKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func formatNumber(f float64) string {
	if f == float64(int64(f)) {
		return fmt.Sprintf("%d", int64(f))
	}
	return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%f", f), "0"), ".")
}

func quoteString(s string) string {
	if s == "" {
		return `""`
	}
	if isSafeUnquoted(s) {
		return s
	}
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		default:
			b.WriteRune(r)
		}
	}
	b.WriteByte('"')
	return b.String()
}

func quoteKeyIfNeeded(key string) string {
	if key == "" {
		return `""`
	}
	if isSafeUnquoted(key) {
		return key
	}
	return quoteString(key)
}

func isSafeUnquoted(s string) bool {
	if s == "" {
		return false
	}
	if strings.ContainsAny(s, ":#\n\r\t") {
		return false
	}
	for _, r := range s {
		if r <= ' ' || r == '"' || r == '\\' {
			return false
		}
	}
	return true
}