# GrayScale

Local gaming clip viewer/organizer with potentially a lot more to come....

A local tool that turns your NVIDIA clips folder into a tagged, filterable,
per-game library. Runs on your machine — no account, no cloud.

Built in phases, in order. Each phase works before the next begins.

## Requirements

- [ffmpeg](https://ffmpeg.org/) on your PATH (used for thumbnails)
- Python 3.10+
- `pip install flask` (needed from Phase 2 on)

## Run the app

Phase 4 is the complete app (dashboard + tagging + filter + export):

```
python phase4/app.py             # defaults to ~/Videos/NVIDIA
python phase4/app.py "C:\path\to\NVIDIA"
```

Then open http://127.0.0.1:5000

## Phases

Each `phaseN/` folder is a self-contained, runnable snapshot of the build at
that step.

### Phase 0 — thumbnail proof-of-concept
Grab a frame ~1s into an mp4 and save it as a jpg.
`python phase0/thumbnail.py "path/to/clip.mp4" out.jpg`

### Phase 1 — scan and structure
Scan the NVIDIA folder, list each game (subfolder) and clip (video file) with
filename, path, length, date, and size. Stray root files are listed, not
crashed on. `python phase1/scan.py`

### Phase 2 — local server + dashboard
Flask server: a tab per game, a thumbnail grid below. Thumbnails generated with
ffmpeg on first request and cached to disk.

### Phase 3 — tagging + storage
Click a clip, add freeform comma-separated tags. Stored in SQLite, keyed by file
path, so they survive a restart.

### Phase 4 — filter + export
Filter the grid by tag, multi-select clips, and "Export Set" to copy the
selection into a new folder you name. **Copy only — originals are never touched.**
Exports go to `~/Videos/GrayScale Exports/<name>`.

See [BACKLOG.md](BACKLOG.md) for what is intentionally out of scope for v1.
