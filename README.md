# GrayScale
<<<<<<< HEAD
Local gaming clip viewer/organizer with potentially a lot more to come....
=======

A local tool that turns your NVIDIA clips folder into a tagged, filterable,
per-game library. Runs on your machine — no account, no cloud.

Built in phases, in order. Each phase works before the next begins.

## Requirements

- [ffmpeg](https://ffmpeg.org/) on your PATH (used for thumbnails)
- Python 3.10+
- `pip install flask` (only needed from Phase 2 on)

## Phases

### Phase 0 — thumbnail proof-of-concept
Grab a frame ~1s into an mp4 and save it as a jpg.

```
python phase0/thumbnail.py "path/to/clip.mp4" out.jpg
```

### Phase 1 — scan and structure
Scan the NVIDIA folder, list each game (subfolder) and clip (video file) with
filename, path, length, date, and size. Stray files in the root are listed, not
crashed on.

```
python phase1/scan.py            # defaults to ~/Videos/NVIDIA
python phase1/scan.py "C:\path\to\NVIDIA"
```

Writes `phase1/scan_output.json`.

### Phase 2 — local server + dashboard
A tiny Flask server with a tab per game and a thumbnail grid below. Thumbnails
are generated with ffmpeg on first request and cached to `phase2/thumbnails/`.

```
python phase2/app.py             # defaults to ~/Videos/NVIDIA
```

Then open http://127.0.0.1:5000

## Roadmap

- Phase 3 — tagging + storage (SQLite; tags survive a restart)
- Phase 4 — filter + export (copy selected clips to a new folder, never move)

See [BACKLOG.md](BACKLOG.md) for what is intentionally out of scope for v1.
>>>>>>> 5a6ea52 (Add project scaffolding (README, BACKLOG, .gitignore, launch config))
