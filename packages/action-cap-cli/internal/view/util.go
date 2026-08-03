package view

import (
	"encoding/json"
	"net/url"
)

func parseURL(raw string) (*url.URL, error) {
	return url.Parse(raw)
}

func marshalJSON(value any) ([]byte, error) {
	return json.Marshal(value)
}