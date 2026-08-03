package archive

import "errors"

var (
	ErrInvalidFormat  = errors.New("invalid archive format")
	ErrInvalidVersion = errors.New("unsupported archive version")
	ErrMissingBundle  = errors.New("archive missing bundle")
	ErrInvalidJSON    = errors.New("invalid JSON")
	ErrReadFailed     = errors.New("failed to read archive")
)

type ArchiveError struct {
	Op   string
	Err  error
	Path string
}

func (e *ArchiveError) Error() string {
	if e.Path != "" {
		return e.Op + " " + e.Path + ": " + e.Err.Error()
	}
	return e.Op + ": " + e.Err.Error()
}

func (e *ArchiveError) Unwrap() error { return e.Err }