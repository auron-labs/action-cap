package cli

import (
	"flag"
	"fmt"
	"io"
	"os"
	"sort"
	"strings"

	"github.com/auron-labs/action-cap-cli/internal/archive"
	"github.com/auron-labs/action-cap-cli/internal/filter"
	"github.com/auron-labs/action-cap-cli/internal/output"
	"github.com/auron-labs/action-cap-cli/internal/view"
)

const usage = `Usage: actioncap <command> [flags] <file>

Commands:
  summary      Session overview: metadata, duration, counts, tabs, time range
  actions      Chronological user action timeline (clicks, inputs, navigations)
  network      All network requests with method, URL, status, timing
  errors       Failed network requests (4xx/5xx) with full response bodies
  endpoints    Deduplicated API endpoints with methods, statuses, call counts
  forms        Form submissions with associated input values
  navigation   Navigation and tab lifecycle events
  elements     Unique elements interacted with, with action types and counts
  tabs         Tab lifecycle: creation, activation, removal
  replay       rrweb replay event metadata (count, time range, size)
  dump         Complete archive dump
  help         Show this help message

Global flags:
  --format json|table|toon   Output format (default json)
  --verbose                  Verbose logging to stderr

Run 'actioncap <command> --help' for command-specific flags.
`

type commandFlags struct {
	Tab          string
	Type         string
	Status       string
	From         string
	To           string
	Limit        string
	IncludeScroll bool
	Headers      bool
	Full         bool
	NoReplay     bool
}

func registerFlags(fs *flag.FlagSet) *commandFlags {
	cf := &commandFlags{}
	fs.StringVar(&cf.Tab, "tab", "", "Filter to a specific tab ID")
	fs.StringVar(&cf.Type, "type", "", "Filter by event type (comma-separated)")
	fs.StringVar(&cf.Status, "status", "", "Filter network by status (4xx, 5xx, 200, >=400)")
	fs.StringVar(&cf.From, "from", "", "Start timestamp (ms since epoch)")
	fs.StringVar(&cf.To, "to", "", "End timestamp (ms since epoch)")
	fs.StringVar(&cf.Limit, "limit", "", "Max events to output")
	fs.BoolVar(&cf.IncludeScroll, "include-scroll", false, "Include scroll events (excluded by default)")
	fs.BoolVar(&cf.Headers, "headers", false, "Include request/response headers (excluded by default)")
	fs.BoolVar(&cf.Full, "full", false, "Output raw rrweb event payloads")
	fs.BoolVar(&cf.NoReplay, "no-replay", false, "Exclude rrweb replay events")
	return cf
}

func Run(args []string, stdout, stderr io.Writer) int {
	if len(args) < 2 {
		fmt.Fprint(stderr, usage)
		return 2
	}
	cmd := args[1]
	if cmd == "help" || cmd == "-h" || cmd == "--help" {
		fmt.Fprint(stdout, usage)
		return 0
	}
	fs := flag.NewFlagSet(cmd, flag.ContinueOnError)
	fs.SetOutput(stderr)
	format := fs.String("format", "json", "Output format: json, table, toon")
	verbose := fs.Bool("verbose", false, "Verbose logging to stderr")
	cf := registerFlags(fs)
	if err := fs.Parse(args[2:]); err != nil {
		return 2
	}
	if fs.NArg() == 0 {
		fmt.Fprintf(stderr, "actioncap: missing <file> argument\n")
		return 2
	}
	path := fs.Arg(0)
	if *verbose {
		fmt.Fprintf(stderr, "reading archive %s\n", path)
	}
	ar, err := archive.ReadArchive(path)
	if err != nil {
		fmt.Fprintf(stderr, "actioncap: %s\n", err.Error())
		return 1
	}
	f, err := parseFormat(*format)
	if err != nil {
		fmt.Fprintf(stderr, "actioncap: %s\n", err.Error())
		return 2
	}
	enc := output.New(stdout)
	if err := dispatch(cmd, cf, ar, enc, f); err != nil {
		fmt.Fprintf(stderr, "actioncap: %s\n", err.Error())
		return 1
	}
	return 0
}

func dispatch(name string, cf *commandFlags, ar *archive.SessionArchive, enc *output.Encoder, f output.Format) error {
	bundle := &ar.Bundle
	switch name {
	case "summary":
		return enc.Write(view.SessionSummary(bundle), f)
	case "actions":
		opts, err := actionOptions(cf)
		if err != nil {
			return err
		}
		return enc.Write(view.ActionTimeline(bundle, opts), f)
	case "network":
		opts, err := networkOptions(cf)
		if err != nil {
			return err
		}
		events, err := view.NetworkRequests(bundle, opts)
		if err != nil {
			return err
		}
		return enc.Write(events, f)
	case "errors":
		return enc.Write(view.NetworkErrors(bundle), f)
	case "endpoints":
		return enc.Write(map[string]any{"endpoints": view.APIEndpoints(bundle)}, f)
	case "forms":
		return enc.Write(view.FormSubmissions(bundle), f)
	case "navigation":
		return enc.Write(map[string]any{"navigations": view.NavigationFlow(bundle)}, f)
	case "elements":
		return enc.Write(map[string]any{"elements": view.InteractedElements(bundle)}, f)
	case "tabs":
		return enc.Write(map[string]any{"tabs": view.TabLifecycle(bundle)}, f)
	case "replay":
		return enc.Write(view.ReplayMetadata(bundle, cf.Full), f)
	case "dump":
		return enc.Write(view.FullDump(bundle, cf.NoReplay), f)
	default:
		return fmt.Errorf("unknown command %q (try %s)", name, suggestCommand(name))
	}
}

// suggestCommand returns the closest known command name by Levenshtein
// distance, or the full sorted list when no near match exists.
func suggestCommand(name string) string {
	known := []string{
		"summary", "actions", "network", "errors", "endpoints",
		"forms", "navigation", "elements", "tabs", "replay", "dump",
	}
	best := ""
	bestDist := -1
	for _, k := range known {
		d := levenshtein(name, k)
		if bestDist == -1 || d < bestDist {
			bestDist = d
			best = k
		}
	}
	if bestDist > 0 && bestDist <= len(name) {
		return best
	}
	return strings.Join(known, ", ")
}

func levenshtein(a, b string) int {
	if len(a) == 0 {
		return len(b)
	}
	if len(b) == 0 {
		return len(a)
	}
	prev := make([]int, len(b)+1)
	curr := make([]int, len(b)+1)
	for j := 0; j <= len(b); j++ {
		prev[j] = j
	}
	for i := 1; i <= len(a); i++ {
		curr[0] = i
		for j := 1; j <= len(b); j++ {
			cost := 1
			if a[i-1] == b[j-1] {
				cost = 0
			}
			curr[j] = min3(curr[j-1]+1, prev[j]+1, prev[j-1]+cost)
		}
		prev, curr = curr, prev
	}
	return prev[len(b)]
}

func min3(a, b, c int) int {
	m := a
	if b < m {
		m = b
	}
	if c < m {
		m = c
	}
	return m
}

func actionOptions(cf *commandFlags) (view.ActionOptions, error) {
	base, err := readFilter(cf)
	if err != nil {
		return view.ActionOptions{}, err
	}
	return view.ActionOptions{
		IncludeScroll: cf.IncludeScroll,
		Type:          base.Type,
		Tab:           base.Tab,
		From:          base.From,
		To:            base.To,
		Limit:         base.Limit,
	}, nil
}

func networkOptions(cf *commandFlags) (view.NetworkOptions, error) {
	base, err := readFilter(cf)
	if err != nil {
		return view.NetworkOptions{}, err
	}
	return view.NetworkOptions{
		Headers:        cf.Headers,
		TruncateLength: 500,
		Status:         cf.Status,
		Options:        base,
	}, nil
}

func readFilter(cf *commandFlags) (filter.Options, error) {
	var opts filter.Options
	if cf.Tab != "" {
		n, err := filter.ParseInt(cf.Tab)
		if err != nil {
			return opts, fmt.Errorf("invalid --tab: %s", err.Error())
		}
		opts.Tab = n
	}
	opts.Type = cf.Type
	if cf.From != "" {
		n, err := filter.ParseInt64(cf.From)
		if err != nil {
			return opts, fmt.Errorf("invalid --from: %s", err.Error())
		}
		opts.From = n
	}
	if cf.To != "" {
		n, err := filter.ParseInt64(cf.To)
		if err != nil {
			return opts, fmt.Errorf("invalid --to: %s", err.Error())
		}
		opts.To = n
	}
	if cf.Limit != "" {
		n, err := filter.ParsePositiveInt(cf.Limit)
		if err != nil {
			return opts, fmt.Errorf("invalid --limit: %s", err.Error())
		}
		opts.Limit = n
	}
	return opts, nil
}

func parseFormat(s string) (output.Format, error) {
	switch strings.ToLower(s) {
	case "json":
		return output.FormatJSON, nil
	case "table":
		return output.FormatTable, nil
	case "toon":
		return output.FormatToon, nil
	default:
		return "", fmt.Errorf("unknown --format %q (expected json, table, toon)", s)
	}
}

// SortedCommands is exposed for help text rendering and tests.
func SortedCommands() []string {
	cmds := []string{
		"summary", "actions", "network", "errors", "endpoints",
		"forms", "navigation", "elements", "tabs", "replay", "dump",
	}
	sort.Strings(cmds)
	return cmds
}

// Execute is the package entrypoint used by main and tests.
func Execute() int { return Run(os.Args, os.Stdout, os.Stderr) }