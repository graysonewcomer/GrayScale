"""Phase 2: local server + basic dashboard.

Tabs across the top (one per game folder that has clips), a thumbnail grid
below for the selected game. Thumbnails are generated with ffmpeg on first
request and cached to disk so they aren't regenerated every load.

Usage: python app.py [path-to-NVIDIA-folder]
Then open http://127.0.0.1:5000
"""
import hashlib
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, abort, render_template, send_file

VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".avi", ".webm"}
DEFAULT_ROOT = Path.home() / "Videos" / "NVIDIA"
CACHE_DIR = Path(__file__).parent / "thumbnails"
THUMB_SECONDS = 1.0

app = Flask(__name__)

# Populated at startup: clip_id -> Path to the video file.
CLIP_INDEX: dict[str, Path] = {}
ROOT: Path = DEFAULT_ROOT


def clip_id_for(path: Path) -> str:
    return hashlib.sha1(str(path).encode("utf-8")).hexdigest()[:16]


def scan_games(root: Path) -> list[dict]:
    """Return games (folders) that contain at least one video clip."""
    games = []
    for entry in sorted(root.iterdir()):
        if not entry.is_dir():
            continue
        clips = []
        for f in sorted(entry.iterdir()):
            if f.is_file() and f.suffix.lower() in VIDEO_EXTENSIONS:
                cid = clip_id_for(f)
                CLIP_INDEX[cid] = f
                stat = f.stat()
                clips.append({
                    "id": cid,
                    "filename": f.name,
                    "size_mb": round(stat.st_size / (1024 * 1024), 1),
                    "date": datetime.fromtimestamp(
                        stat.st_mtime, tz=timezone.utc
                    ).strftime("%Y-%m-%d"),
                })
        if clips:
            games.append({"name": entry.name, "clip_count": len(clips), "clips": clips})
    return games


def ensure_thumbnail(clip_id: str) -> Path | None:
    video_path = CLIP_INDEX.get(clip_id)
    if video_path is None or not video_path.exists():
        return None

    CACHE_DIR.mkdir(exist_ok=True)
    thumb_path = CACHE_DIR / f"{clip_id}.jpg"
    if thumb_path.exists():
        return thumb_path

    cmd = [
        "ffmpeg", "-y",
        "-ss", str(THUMB_SECONDS),
        "-i", str(video_path),
        "-frames:v", "1",
        "-update", "1",
        "-vf", "scale=480:-1",
        "-q:v", "4",
        str(thumb_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0 or not thumb_path.exists():
        return None
    return thumb_path


@app.route("/")
def index():
    games = scan_games(ROOT)
    return render_template("index.html", games=games, root=str(ROOT))


@app.route("/thumbnail/<clip_id>")
def thumbnail(clip_id: str):
    thumb = ensure_thumbnail(clip_id)
    if thumb is None:
        abort(404)
    return send_file(thumb, mimetype="image/jpeg")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        ROOT = Path(sys.argv[1])
    if not ROOT.is_dir():
        print(f"Not a folder: {ROOT}")
        sys.exit(1)
    print(f"Serving clips from: {ROOT}")
    print("Open http://127.0.0.1:5000")
    app.run(host="127.0.0.1", port=5000, debug=False)
