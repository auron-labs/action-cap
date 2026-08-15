package cli

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/auron-labs/action-cap-cli/internal/archive"
)

type screenshotManifest struct {
	Count int `json:"count"`
	Files []struct {
		Path    string `json:"path"`
		TS      int64  `json:"ts"`
		TabID   int    `json:"tabId"`
		URL     string `json:"url"`
		EventID string `json:"eventId"`
	} `json:"files"`
}

func TestScreenshotsExtractsJPEGsAndPrintsManifest(t *testing.T) {
	first := testJPEG(t, color.RGBA{R: 255, A: 255})
	second := testJPEG(t, color.RGBA{B: 255, A: 255})
	archivePath := writeScreenshotArchive(t, []archive.UserActionEvent{
		{
			ID: "late-event", SessionID: "session", TabID: 22, TS: 200,
			URL:      "https://example.test/late",
			Metadata: map[string]any{"screenshot": jpegDataURL(second)},
		},
		{
			ID: "early-event", SessionID: "session", TabID: 11, TS: 100,
			URL:      "https://example.test/early",
			Metadata: map[string]any{"screenshot": jpegDataURL(first)},
		},
		{
			ID: "ignored-event", SessionID: "session", TabID: 33, TS: 300,
			Metadata: map[string]any{"screenshot": "data:image/png;base64,not-used"},
		},
	})
	outputDir := filepath.Join(t.TempDir(), "screenshots")

	out, stderr, code := runCLI([]string{
		"screenshots", "--output-dir", outputDir, "--format", "json", archivePath,
	})
	if code != 0 {
		t.Fatalf("expected success, code=%d stderr=%s", code, stderr)
	}
	if stderr != "" {
		t.Fatalf("unexpected stderr: %s", stderr)
	}
	if strings.Contains(out, "data:image") {
		t.Fatalf("manifest must not contain base64 data: %s", out)
	}

	var manifest screenshotManifest
	if err := json.Unmarshal([]byte(out), &manifest); err != nil {
		t.Fatalf("decode manifest: %v\n%s", err, out)
	}
	if manifest.Count != 2 || len(manifest.Files) != 2 {
		t.Fatalf("unexpected manifest count: %+v", manifest)
	}
	want := []struct {
		name  string
		data  []byte
		ts    int64
		tabID int
		url   string
		event string
	}{
		{"0001-100-tab-11.jpg", first, 100, 11, "https://example.test/early", "early-event"},
		{"0002-200-tab-22.jpg", second, 200, 22, "https://example.test/late", "late-event"},
	}
	for i, file := range manifest.Files {
		if filepath.Base(file.Path) != want[i].name || file.TS != want[i].ts || file.TabID != want[i].tabID || file.URL != want[i].url || file.EventID != want[i].event {
			t.Fatalf("unexpected manifest file %d: %+v", i, file)
		}
		data, err := os.ReadFile(file.Path)
		if err != nil {
			t.Fatalf("read extracted file: %v", err)
		}
		if !bytes.Equal(data, want[i].data) {
			t.Fatalf("extracted bytes for %s differ", file.Path)
		}
		info, err := os.Stat(file.Path)
		if err != nil {
			t.Fatalf("stat extracted file: %v", err)
		}
		if got := info.Mode().Perm(); got != 0600 {
			t.Fatalf("extracted file mode = %o, want 600", got)
		}
	}

	secondOut, _, secondCode := runCLI([]string{"screenshots", "--output-dir", outputDir, archivePath})
	if secondCode != 0 || secondOut == "" {
		t.Fatalf("expected deterministic rerun, code=%d output=%q", secondCode, secondOut)
	}
}

func TestScreenshotsRequiresOutputDir(t *testing.T) {
	archivePath := writeScreenshotArchive(t, nil)
	_, stderr, code := runCLI([]string{"screenshots", archivePath})
	if code == 0 {
		t.Fatal("expected missing output-dir error")
	}
	if !strings.Contains(stderr, "screenshots requires --output-dir DIR") {
		t.Fatalf("unexpected error: %s", stderr)
	}
}

func TestScreenshotsRejectMalformedDataWithoutPartialWrites(t *testing.T) {
	valid := testJPEG(t, color.RGBA{G: 255, A: 255})
	tests := []struct {
		name string
		data string
		want string
	}{
		{name: "base64", data: jpegScreenshotPrefix + "not-base64", want: "invalid base64"},
		{name: "jpeg", data: jpegDataURL([]byte("not a jpeg")), want: "invalid JPEG"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			archivePath := writeScreenshotArchive(t, []archive.UserActionEvent{
				{
					ID: "valid-event", SessionID: "session", TabID: 1, TS: 1,
					Metadata: map[string]any{"screenshot": jpegDataURL(valid)},
				},
				{
					ID: "bad-event", SessionID: "session", TabID: 2, TS: 2,
					Metadata: map[string]any{"screenshot": tc.data},
				},
			})
			outputDir := filepath.Join(t.TempDir(), "screenshots")

			_, stderr, code := runCLI([]string{"screenshots", "--output-dir", outputDir, archivePath})
			if code == 0 {
				t.Fatal("expected malformed screenshot error")
			}
			if !strings.Contains(stderr, tc.want) || !strings.Contains(stderr, "bad-event") {
				t.Fatalf("unexpected error: %s", stderr)
			}
			if _, err := os.Stat(outputDir); !os.IsNotExist(err) {
				t.Fatalf("output directory was created after validation failure: %v", err)
			}
		})
	}
}

func testJPEG(t *testing.T, fill color.RGBA) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 1, 1))
	img.SetRGBA(0, 0, fill)
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 100}); err != nil {
		t.Fatalf("encode test JPEG: %v", err)
	}
	return buf.Bytes()
}

func jpegDataURL(data []byte) string {
	return jpegScreenshotPrefix + base64.StdEncoding.EncodeToString(data)
}

func writeScreenshotArchive(t *testing.T, actions []archive.UserActionEvent) string {
	t.Helper()
	data, err := json.Marshal(archive.SessionArchive{
		Format:  "actioncap-session-archive",
		Version: 1,
		Bundle: archive.SessionBundle{
			UserActions: actions,
		},
	})
	if err != nil {
		t.Fatalf("marshal test archive: %v", err)
	}
	path := filepath.Join(t.TempDir(), "recording.bxdac")
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatalf("write test archive: %v", err)
	}
	return path
}
