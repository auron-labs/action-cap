package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"github.com/auron-labs/action-cap-cli/internal/cli"
)

func main() {
	_, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	os.Exit(cli.Execute())
}