# GrayScale

Local gaming clip viewer/organizer with potentially a lot more to come....

A local tool that turns your NVIDIA clips folder into a tagged, filterable,
per-game library. Runs on your machine — no account, no cloud.

## Features

- **Dashboard** — a tab per game, with a thumbnail grid (thumbnails generated
  with ffmpeg and cached to disk).
- **Tagging** — add freeform comma-separated tags to any clip; stored in SQLite
  so they survive a restart.
- **Filter** — narrow the grid to clips matching a tag, within the active tab.
- **Export** — multi-select clips and copy them into a new folder you name.
  **Copy only — originals are never touched.** Exports land in
  `~/Videos/GrayScale Exports/<name>`.

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
app.py               # Flask server (dashboard, thumbnails, tags, export)
db.py                # SQLite tag storage
templates/index.html # single-page front end
requirements.txt
```

Runtime data (`tags.db`, `thumbnails/`) is created on first run and is
git-ignored. The tool was built in phases (thumbnail proof-of-concept → scan →
dashboard → tagging → filter/export); that history lives in the git log.

See [BACKLOG.md](BACKLOG.md) for what is intentionally out of scope for v1.
