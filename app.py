"""GrayScale: local dashboard for your NVIDIA clips.

- tab per game, cached ffmpeg thumbnail grid
- freeform tags per clip, stored in SQLite (survive a restart)
- filter the grid by tag, within the active game tab
- multi-select clips and "Export Set": copies the selection into a new folder
  you name. COPY, never move — originals are never touched.

Usage: python app.py [path-to-NVIDIA-folder]   (defaults to ~/Videos/NVIDIA)
Then open http://127.0.0.1:5000
"""
import hashlib
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, abort, jsonify, render_template, request, send_file

import db

VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".avi", ".webm"}
DEFAULT_ROOT = Path.home() / "Videos" / "NVIDIA"
CACHE_DIR = Path(__file__).parent / "thumbnails"
EXPORTS_ROOT = Path.home() / "Videos" / "GrayScale Exports"
THUMB_SECONDS = 1.0

app = Flask(__name__)

CLIP_INDEX: dict[str, Path] = {}
GAMES: list[dict] = []
ROOT: Path = DEFAULT_ROOT


def clip_id_for(path: Path) -> str:
    return hashlib.sha1(str(path).encode("utf-8")).hexdigest()[:16]


def build_index(root: Path) -> None:
    CLIP_INDEX.clear()
    GAMES.clear()
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
                    "path": str(f),
                    "filename": f.name,
                    "size_mb": round(stat.st_size / (1024 * 1024), 1),
                    "date": datetime.fromtimestamp(
                        stat.st_mtime, tz=timezone.utc
                    ).strftime("%Y-%m-%d"),
                })
        if clips:
            GAMES.append({"name": entry.name, "clip_count": len(clips), "clips": clips})


def games_with_tags() -> list[dict]:
    tag_map = db.get_all_tags()
    result = []
    for game in GAMES:
        clips = [dict(clip, tags=tag_map.get(clip["path"], [])) for clip in game["clips"]]
        result.append({**game, "clips": clips})
    return result


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


def safe_folder_name(raw: str) -> str:
    """Keep only safe characters, blocking path traversal / drive letters."""
    return "".join(c for c in raw if c.isalnum() or c in " _-").strip()


@app.route("/")
def index():
    return render_template("index.html", games=games_with_tags(), root=str(ROOT))


@app.route("/thumbnail/<clip_id>")
def thumbnail(clip_id: str):
    thumb = ensure_thumbnail(clip_id)
    if thumb is None:
        abort(404)
    return send_file(thumb, mimetype="image/jpeg")


@app.route("/api/tags", methods=["POST"])
def save_tags():
    data = request.get_json(silent=True) or {}
    clip_id = data.get("clip_id")
    raw = data.get("tags", "")
    video_path = CLIP_INDEX.get(clip_id)
    if video_path is None:
        abort(404)
    tags = db.set_tags(str(video_path), raw)
    return jsonify({"tags": tags})


@app.route("/api/export", methods=["POST"])
def export():
    data = request.get_json(silent=True) or {}
    clip_ids = data.get("clip_ids", [])
    folder_name = safe_folder_name(data.get("folder_name", ""))

    if not clip_ids:
        return jsonify({"error": "No clips selected."}), 400
    if not folder_name:
        return jsonify({"error": "Invalid or empty folder name."}), 400

    dest = EXPORTS_ROOT / folder_name
    dest.mkdir(parents=True, exist_ok=True)

    copied, skipped = [], []
    for cid in clip_ids:
        src = CLIP_INDEX.get(cid)
        if src is None or not src.exists():
            skipped.append(cid)
            continue
        # Copy, never move. Originals are never touched.
        shutil.copy2(src, dest / src.name)
        copied.append(src.name)

    return jsonify({
        "folder": str(dest),
        "copied": copied,
        "copied_count": len(copied),
        "skipped_count": len(skipped),
    })


if __name__ == "__main__":
    if len(sys.argv) > 1:
        ROOT = Path(sys.argv[1])
    if not ROOT.is_dir():
        print(f"Not a folder: {ROOT}")
        sys.exit(1)
    db.init_db()
    build_index(ROOT)
    port = int(os.environ.get("PORT", 5000))
    print(f"Serving clips from: {ROOT}")
    print(f"Exports go to:      {EXPORTS_ROOT}")
    print(f"Open http://127.0.0.1:{port}")
    app.run(host="127.0.0.1", port=port, debug=False)
