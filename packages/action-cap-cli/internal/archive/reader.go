package archive

import (
	"errors"
	"fmt"
	"os"
)

// ReadArchive loads a JSON archive from disk and returns a sanitized bundle.
func ReadArchive(path string) (*SessionArchive, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, &ArchiveError{Op: "read archive", Err: fmt.Errorf("%w: %s", ErrReadFailed, err.Error()), Path: path}
	}
	if info.IsDir() {
		return nil, &ArchiveError{Op: "read archive", Err: errors.New("path is a directory"), Path: path}
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, &ArchiveError{Op: "read archive", Err: fmt.Errorf("%w: %s", ErrReadFailed, err.Error()), Path: path}
	}
	archive, err := ParseArchive(data)
	if err != nil {
		if ae, ok := err.(*ArchiveError); ok && ae.Path == "" {
			ae.Path = path
		}
	}
	return archive, err
}