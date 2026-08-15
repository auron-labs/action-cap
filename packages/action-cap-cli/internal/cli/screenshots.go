package cli

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image/jpeg"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/auron-labs/action-cap-cli/internal/archive"
	"github.com/auron-labs/action-cap-cli/internal/output"
)

const jpegScreenshotPrefix = "data:image/jpeg;base64,"

type extractedScreenshot struct {
	action archive.UserActionEvent
	data   []byte
}

func extractAndWriteScreenshots(bundle *archive.SessionBundle, outputDir string, enc *output.Encoder, format output.Format) error {
	screenshots, err := extractScreenshots(bundle)
	if err != nil {
		return err
	}

	files := make([]any, 0, len(screenshots))
	if len(screenshots) > 0 {
		if err := os.MkdirAll(outputDir, 0700); err != nil {
			return fmt.Errorf("create screenshot output directory: %w", err)
		}
	}
	for i, screenshot := range screenshots {
		name := fmt.Sprintf("%04d-%d-tab-%d.jpg", i+1, screenshot.action.TS, screenshot.action.TabID)
		path := filepath.Join(outputDir, name)
		if err := writePrivateFile(path, screenshot.data); err != nil {
			return fmt.Errorf("write screenshot %q: %w", path, err)
		}

		file := map[string]any{
			"path":  path,
			"ts":    screenshot.action.TS,
			"tabId": screenshot.action.TabID,
		}
		if screenshot.action.ID != "" {
			file["eventId"] = screenshot.action.ID
		}
		if screenshot.action.URL != "" {
			file["url"] = screenshot.action.URL
		}
		files = append(files, file)
	}

	return enc.Write(map[string]any{
		"count": len(files),
		"files": files,
	}, format)
}

func extractScreenshots(bundle *archive.SessionBundle) ([]extractedScreenshot, error) {
	result := make([]extractedScreenshot, 0)
	for _, action := range bundle.UserActions {
		value, ok := action.Metadata["screenshot"].(string)
		if !ok || !strings.HasPrefix(value, jpegScreenshotPrefix) {
			continue
		}

		encoded := strings.TrimPrefix(value, jpegScreenshotPrefix)
		data, err := base64.StdEncoding.Strict().DecodeString(encoded)
		if err != nil {
			return nil, fmt.Errorf("screenshot event %q has invalid base64: %w", action.ID, err)
		}
		if err := validateJPEG(data); err != nil {
			return nil, fmt.Errorf("screenshot event %q has invalid JPEG: %w", action.ID, err)
		}
		result = append(result, extractedScreenshot{action: action, data: data})
	}

	sort.SliceStable(result, func(i, j int) bool {
		return result[i].action.TS < result[j].action.TS
	})
	return result, nil
}

func validateJPEG(data []byte) error {
	if len(data) < 4 || data[0] != 0xff || data[1] != 0xd8 {
		return fmt.Errorf("missing JPEG start marker")
	}
	if data[len(data)-2] != 0xff || data[len(data)-1] != 0xd9 {
		return fmt.Errorf("missing JPEG end marker")
	}
	if _, err := jpeg.DecodeConfig(bytes.NewReader(data)); err != nil {
		return err
	}
	return nil
}

func writePrivateFile(path string, data []byte) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE, 0600)
	if err != nil {
		return err
	}
	if err := file.Chmod(0600); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Truncate(0); err != nil {
		_ = file.Close()
		return err
	}
	if _, err := file.Write(data); err != nil {
		_ = file.Close()
		return err
	}
	return file.Close()
}
