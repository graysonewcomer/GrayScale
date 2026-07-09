"""GrayScale: local dashboard for your NVIDIA clips.

- tab per game, cached ffmpeg thumbnail grid
- freeform tags per clip, stored in SQLite (survive a restart)
- filter the grid by tag, within the active game tab
- multi-select clips and "Export Set": copies the selection into a new folder
  you name. COPY, never move — export never touches originals.
- rename a clip in-app (pencil icon): the one deliberate write to originals,
  always within the same folder, extension preserved.

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

import markdown
from flask import Flask, abort, jsonify, render_template, request, send_file

import db

VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".avi", ".webm"}
VIDEO_MIMETYPES = {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".mkv": "video/x-matroska",
    ".avi": "video/x-msvideo",
    ".webm": "video/webm",
}
DEFAULT_ROOT = Path.home() / "Videos" / "NVIDIA"
PROJECT_ROOT = Path(__file__).parent
CACHE_DIR = PROJECT_ROOT / "thumbnails"
EXPORTS_ROOT = Path.home() / "Videos" / "GrayScale Exports"
THUMB_SECONDS = 1.0

# Read-only status page: a fixed set of project markdown files rendered in the
# browser. New file = one entry here; nothing else is per-file. `slug` is the
# URL segment; a listed-but-absent file is expected and shows "not found yet".
STATUS_FILES = [
    {"slug": "state", "file": "STATE.md", "label": "State"},
    {"slug": "backlog", "file": "BACKLOG.md", "label": "Backlog"},
    {"slug": "ideas", "file": "FEATUREIDEAS.md", "label": "Feature Ideas"},
    {"slug": "decisions", "file": "DECISIONS.md", "label": "Decisions"},
]

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


def safe_stem(raw: str) -> str:
    """Sanitize a new filename stem: strip characters Windows forbids and
    anything that could traverse paths; trailing dots/spaces are invalid."""
    forbidden = set('<>:"/\\|?*')
    cleaned = "".join(c for c in raw if c not in forbidden and ord(c) >= 32)
    return cleaned.strip().rstrip(". ")


@app.route("/")
def index():
    games = games_with_tags()
    all_tags = {t for game in games for clip in game["clips"] for t in clip["tags"]}
    colors = db.ensure_tag_colors(all_tags)
    return render_template("index.html", games=games, root=str(ROOT), colors=colors)


def render_status(entry: dict):
    """Render one status file to the status template. Missing file is fine —
    it's expected (e.g. DECISIONS.md before it exists), so we never 500."""
    path = PROJECT_ROOT / entry["file"]
    if path.exists():
        content = markdown.markdown(
            path.read_text(encoding="utf-8"),
            extensions=["fenced_code", "tables"],
        )
    else:
        content = (
            f'<p class="notfound"><code>{entry["file"]}</code> '
            "doesn’t exist yet.</p>"
        )
    return render_template(
        "status.html", files=STATUS_FILES, active=entry["slug"],
        label=entry["label"], content=content,
    )


@app.route("/status")
def status():
    return render_status(STATUS_FILES[0])  # STATE.md by default


@app.route("/status/<slug>")
def status_file(slug: str):
    entry = next((f for f in STATUS_FILES if f["slug"] == slug), None)
    if entry is None:
        abort(404)
    return render_status(entry)


@app.route("/thumbnail/<clip_id>")
def thumbnail(clip_id: str):
    thumb = ensure_thumbnail(clip_id)
    if thumb is None:
        abort(404)
    return send_file(thumb, mimetype="image/jpeg")


@app.route("/video/<clip_id>")
def video(clip_id: str):
    """Stream the original clip. conditional=True gives HTTP range support,
    which the browser needs for seeking. Read-only — originals are untouched."""
    video_path = CLIP_INDEX.get(clip_id)
    if video_path is None or not video_path.exists():
        abort(404)
    mimetype = VIDEO_MIMETYPES.get(video_path.suffix.lower(), "video/mp4")
    return send_file(video_path, mimetype=mimetype, conditional=True)


@app.route("/api/tags", methods=["POST"])
def save_tags():
    data = request.get_json(silent=True) or {}
    clip_id = data.get("clip_id")
    raw = data.get("tags", "")
    video_path = CLIP_INDEX.get(clip_id)
    if video_path is None:
        abort(404)
    tags = db.set_tags(str(video_path), raw)
    return jsonify({"tags": tags, "colors": db.ensure_tag_colors(tags)})


@app.route("/api/rename", methods=["POST"])
def rename():
    """Rename a clip on disk (stem only; the extension is preserved).
    The clip id is a hash of the path, so a rename mints a new id — the
    tag row and cached thumbnail are migrated and the new id is returned."""
    data = request.get_json(silent=True) or {}
    clip_id = data.get("clip_id")
    stem = safe_stem(data.get("name", ""))

    src = CLIP_INDEX.get(clip_id)
    if src is None or not src.exists():
        abort(404)
    if not stem:
        return jsonify({"error": "Invalid or empty name."}), 400

    dest = src.with_name(stem + src.suffix)
    if dest == src:
        return jsonify({"id": clip_id, "filename": src.name})
    if dest.exists():
        return jsonify({"error": "A clip with that name already exists."}), 400

    src.rename(dest)
    db.rename_path(str(src), str(dest))

    new_id = clip_id_for(dest)
    old_thumb = CACHE_DIR / f"{clip_id}.jpg"
    if old_thumb.exists():
        old_thumb.rename(CACHE_DIR / f"{new_id}.jpg")

    del CLIP_INDEX[clip_id]
    CLIP_INDEX[new_id] = dest
    for game in GAMES:
        for clip in game["clips"]:
            if clip["id"] == clip_id:
                clip.update(id=new_id, path=str(dest), filename=dest.name)

    return jsonify({"id": new_id, "filename": dest.name})


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
