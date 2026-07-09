# GrayScale

Local gaming clip viewer/organizer with potentially a lot more to come....

A local tool that turns your NVIDIA clips folder into a tagged, filterable,
per-game library. Runs on your machine — no account, no cloud.

## Features

- **Dashboard** — a tab per game, with a thumbnail grid (thumbnails generated
  with ffmpeg and cached to disk).
- **Playback** — hover a clip for a muted inline preview, or hit play to open a
  large in-app player with native controls and ← / → to step through the game's
  clips. Streamed with HTTP range support (seeking); originals never touched.
- **Tagging** — add freeform comma-separated tags to any clip; stored in SQLite
  so they survive a restart.
- **Filter** — narrow the grid to clips matching a tag, within the active tab.
- **Export** — multi-select clips and copy them into a new folder you name.
  **Copy only — originals are never touched.** Exports land in
  `~/Videos/GrayScale Exports/<name>`.
- **Editor** — scissors icon on a clip opens a non-destructive editor:
  trim, split at the playhead, delete segments, undo/redo. Edits are saved
  as JSON projects (never touching the original) and can be exported as a
  new MP4, rendered by ffmpeg with a live progress bar. Edited exports land
  in `~/Videos/GrayScale Exports/Edited`.

## Requirements

- [ffmpeg](https://ffmpeg.org/) on your PATH (used for thumbnails)
- Python 3.10+
- `pip install -r requirements.txt`

## Run

```
python app.py                 # defaults to ~/Videos/NVIDIA
python app.py "C:\path\to\NVIDIA"
```

Then open http://127.0.0.1:5000

## Project layout

```
app.py               # Flask server (dashboard, thumbnails, streaming, tags, export)
db.py                # SQLite tag storage
editor.py            # non-destructive editor: JSON projects + ffmpeg rendering
templates/index.html # single-page front end
static/              # stylesheet + JS (app, theme, arcade, editor)
requirements.txt
```

Runtime data (`tags.db`, `thumbnails/`, `projects/`) is created on first run
and is git-ignored. The tool was built in phases (thumbnail proof-of-concept → scan →
dashboard → tagging → filter/export); that history lives in the git log.

See [BACKLOG.md](BACKLOG.md) for what is intentionally out of scope for v1.
