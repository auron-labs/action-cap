package cli

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func fixturePath(t *testing.T) string {
	t.Helper()
	root, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		t.Fatalf("abs: %v", err)
	}
	candidate := filepath.Join(root, "test", "fixtures", "sample.bxdac")
	if _, err := os.Stat(candidate); err != nil {
		t.Fatalf("missing fixture %s: %v", candidate, err)
	}
	return candidate
}

func runCLI(args []string) (string, string, int) {
	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}
	code := Run(append([]string{"actioncap"}, args...), stdout, stderr)
	return stdout.String(), stderr.String(), code
}

func TestHelpCommand(t *testing.T) {
	out, _, code := runCLI([]string{"help"})
	if code != 0 {
		t.Fatalf("expected 0, got %d", code)
	}
	if !strings.Contains(out, "Usage: actioncap") {
		t.Fatalf("help missing usage: %s", out)
	}
}

func TestSummaryJSON(t *testing.T) {
	out, _, code := runCLI([]string{"summary", fixturePath(t)})
	if code != 0 {
		t.Fatalf("expected 0, got %d stderr=%s", code, out)
	}
	if !strings.Contains(out, `"id": "sess-001"`) {
		t.Fatalf("missing session id: %s", out)
	}
}

func TestSummaryToon(t *testing.T) {
	out, _, code := runCLI([]string{"summary", "--format", "toon", fixturePath(t)})
	if code != 0 {
		t.Fatalf("expected 0, got %d", code)
	}
	if !strings.Contains(out, "session:") {
		t.Fatalf("missing session key: %s", out)
	}
	if !strings.Contains(out, "sess-001") {
		t.Fatalf("missing session id: %s", out)
	}
}

func TestNetworkWithFilters(t *testing.T) {
	out, _, code := runCLI([]string{"network", "--status", "4xx", "--format", "json", fixturePath(t)})
	if code != 0 {
		t.Fatalf("expected 0, got %d", code)
	}
	if !strings.Contains(out, "401") {
		t.Fatalf("expected 401 status: %s", out)
	}
}

func TestNetworkInvalidStatus(t *testing.T) {
	_, stderr, code := runCLI([]string{"network", "--status", "bogus", fixturePath(t)})
	if code == 0 {
		t.Fatalf("expected nonzero code")
	}
	if !strings.Contains(stderr, "Invalid status filter") && !strings.Contains(stderr, "invalid status filter") {
		t.Fatalf("expected status filter error, got %s", stderr)
	}
}

func TestDumpWithNoReplay(t *testing.T) {
	out, _, code := runCLI([]string{"dump", "--no-replay", "--format", "json", fixturePath(t)})
	if code != 0 {
		t.Fatalf("expected 0, got %d", code)
	}
	if strings.Contains(out, `"replayEvents": [`) {
		t.Fatalf("expected replay events stripped: %s", out)
	}
}

func TestReplayFullToon(t *testing.T) {
	out, _, code := runCLI([]string{"replay", "--full", "--format", "toon", fixturePath(t)})
	if code != 0 {
		t.Fatalf("expected 0, got %d", code)
	}
	if !strings.Contains(out, "events:") {
		t.Fatalf("expected events block: %s", out)
	}
}

func TestErrorsOnMissingFile(t *testing.T) {
	_, stderr, code := runCLI([]string{"summary", "/no/such/file.bxdac"})
	if code == 0 {
		t.Fatalf("expected nonzero exit code")
	}
	if !strings.Contains(stderr, "actioncap:") {
		t.Fatalf("expected actioncap error prefix, got %s", stderr)
	}
}

func TestUnknownCommand(t *testing.T) {
	_, stderr, code := runCLI([]string{"bogus", fixturePath(t)})
	if code == 0 {
		t.Fatalf("expected nonzero exit code")
	}
	if !strings.Contains(stderr, "unknown command") {
		t.Fatalf("expected unknown command error, got %s", stderr)
	}
}

func TestUnknownCommandSuggestsMatch(t *testing.T) {
	_, stderr, _ := runCLI([]string{"sumary", fixturePath(t)})
	if !strings.Contains(stderr, "summary") {
		t.Fatalf("expected suggestion to mention summary, got %s", stderr)
	}
}

func TestMissingFileArgument(t *testing.T) {
	_, stderr, code := runCLI([]string{"summary"})
	if code == 0 {
		t.Fatalf("expected nonzero exit code")
	}
	if !strings.Contains(stderr, "missing <file>") {
		t.Fatalf("expected missing file error, got %s", stderr)
	}
}

func TestUnknownFormat(t *testing.T) {
	_, stderr, code := runCLI([]string{"summary", "--format", "yaml", fixturePath(t)})
	if code == 0 {
		t.Fatalf("expected nonzero exit code")
	}
	if !strings.Contains(stderr, "--format") {
		t.Fatalf("expected format error, got %s", stderr)
	}
}