"""Non-destructive clip editor backend.

A project is one JSON file in projects/, named <clip_id>.json. It stores an
edit decision list: tracks of segments, each segment a [start, end) window
into the original file's timeline. The original video is never read into
memory and never modified — editing only rewrites this JSON.

Schema (version 1): tracks carry a `kind` so audio / text / overlay tracks
can be added later without breaking saved projects. Only `kind: "video"`
is accepted today.
"""
import json
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import Blueprint, abort, jsonify, request

bp = Blueprint("editor", __name__)

PROJECT_ROOT = Path(__file__).parent
PROJECTS_DIR = PROJECT_ROOT / "projects"
MIN_SEGMENT_SECONDS = 0.1

# Shared state handed over by app.py at startup (the dict is mutated in
# place on rescan/rename, so holding the reference keeps us current).
_clip_index: dict[str, Path] = {}
_exports_root: Path | None = None


def init(clip_index: dict[str, Path], exports_root: Path) -> None:
    global _clip_index, _exports_root
    _clip_index = clip_index
    _exports_root = exports_root


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def probe_source(path: Path) -> dict:
    """Duration + audio presence via ffprobe. Raises RuntimeError on failure."""
    cmd = [
        "ffprobe", "-v", "error", "-print_format", "json",
        "-show_format", "-show_streams", str(path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed for {path.name}")
    info = json.loads(result.stdout)
    try:
        duration = float(info["format"]["duration"])
    except (KeyError, ValueError):
        raise RuntimeError(f"no duration in ffprobe output for {path.name}")
    has_audio = any(s.get("codec_type") == "audio" for s in info.get("streams", []))
    return {"duration": round(duration, 3), "has_audio": has_audio}


def project_file(clip_id: str) -> Path:
    return PROJECTS_DIR / f"{clip_id}.json"


def _new_project(clip_id: str, path: Path) -> dict:
    info = probe_source(path)
    now = _now()
    return {
        "version": 1,
        "clip_id": clip_id,
        "source": {"path": str(path), **info},
        "created": now,
        "modified": now,
        "timeline": {
            "tracks": [{
                "id": "video-1",
                "kind": "video",
                "segments": [
                    {"id": "seg-1", "start": 0.0, "end": info["duration"]}
                ],
            }],
        },
    }


def validated_timeline(data, duration: float) -> dict:
    """Normalize a client-posted timeline; raise ValueError if malformed.
    Segments must lie inside the source and be at least MIN_SEGMENT long."""
    if not isinstance(data, dict) or not isinstance(data.get("tracks"), list):
        raise ValueError("timeline must be an object with a tracks list")
    if not data["tracks"]:
        raise ValueError("timeline needs at least one track")
    tracks = []
    for track in data["tracks"]:
        if not isinstance(track, dict) or track.get("kind") != "video":
            raise ValueError("only video tracks are supported")
        raw_segs = track.get("segments")
        if not isinstance(raw_segs, list) or not raw_segs:
            raise ValueError("a track needs at least one segment")
        segments = []
        for seg in raw_segs:
            try:
                start = round(float(seg["start"]), 3)
                end = round(float(seg["end"]), 3)
            except (TypeError, KeyError, ValueError):
                raise ValueError("segment start/end must be numbers")
            if not (0 <= start < end <= duration + 0.05):
                raise ValueError("segment outside the source clip")
            if end - start < MIN_SEGMENT_SECONDS:
                raise ValueError("segment too short")
            segments.append({
                "id": str(seg.get("id") or uuid.uuid4().hex[:8]),
                "start": start,
                "end": end,
            })
        tracks.append({
            "id": str(track.get("id") or "video-1"),
            "kind": "video",
            "segments": segments,
        })
    return {"tracks": tracks}


def _write_project(project: dict) -> None:
    """Atomic write: never leave a half-written project on disk."""
    PROJECTS_DIR.mkdir(exist_ok=True)
    target = project_file(project["clip_id"])
    tmp = target.with_suffix(f".{uuid.uuid4().hex[:8]}.tmp")
    tmp.write_text(json.dumps(project, indent=2), encoding="utf-8")
    tmp.replace(target)


def load_project(clip_id: str) -> dict | None:
    path = project_file(clip_id)
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def migrate_project(old_id: str, new_id: str, new_path: Path) -> None:
    """Re-key a project after its clip is renamed on disk."""
    project = load_project(old_id)
    if project is None:
        return
    project["clip_id"] = new_id
    project["source"]["path"] = str(new_path)
    _write_project(project)
    project_file(old_id).unlink(missing_ok=True)


@bp.route("/api/project/<clip_id>")
def get_project(clip_id: str):
    """Return the saved project, or a fresh single-segment default (not
    persisted — nothing is written until the first edit is saved)."""
    video_path = _clip_index.get(clip_id)
    if video_path is None or not video_path.exists():
        abort(404)
    project = load_project(clip_id)
    if project is None:
        try:
            project = _new_project(clip_id, video_path)
        except RuntimeError as exc:
            return jsonify({"error": str(exc)}), 500
    return jsonify(project)


@bp.route("/api/project/<clip_id>", methods=["POST"])
def save_project(clip_id: str):
    video_path = _clip_index.get(clip_id)
    if video_path is None or not video_path.exists():
        abort(404)
    data = request.get_json(silent=True) or {}
    existing = load_project(clip_id)
    if existing is not None:
        source, created = existing["source"], existing["created"]
    else:
        try:
            fresh = _new_project(clip_id, video_path)
        except RuntimeError as exc:
            return jsonify({"error": str(exc)}), 500
        source, created = fresh["source"], fresh["created"]
    try:
        timeline = validated_timeline(data.get("timeline"), source["duration"])
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    _write_project({
        "version": 1,
        "clip_id": clip_id,
        "source": source,
        "created": created,
        "modified": _now(),
        "timeline": timeline,
    })
    return jsonify({"ok": True})
