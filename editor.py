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
import os
import shutil
import subprocess
import threading
import time
import uuid
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

from flask import Blueprint, abort, jsonify, request, send_file

import db

bp = Blueprint("editor", __name__)

PROJECT_ROOT = Path(__file__).parent
PROJECTS_DIR = PROJECT_ROOT / "projects"
EDIT_THUMBS_DIR = PROJECT_ROOT / "thumbnails" / "edit"
MIN_SEGMENT_SECONDS = 0.1

# Shared state handed over by app.py at startup (dict/list are mutated in
# place on rename, so holding the references keeps us current).
_clip_index: dict[str, Path] = {}
_games: list[dict] = []
_cache_dir: Path | None = None
_id_for = None


def init(clip_index: dict[str, Path], games: list[dict],
         cache_dir: Path, id_for) -> None:
    global _clip_index, _games, _cache_dir, _id_for
    _clip_index = clip_index
    _games = games
    _cache_dir = cache_dir
    _id_for = id_for


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
    """Re-key a project (and its thumbnail cache) after a clip rename."""
    old_thumbs = EDIT_THUMBS_DIR / old_id
    if old_thumbs.is_dir():
        new_thumbs = EDIT_THUMBS_DIR / new_id
        if new_thumbs.exists():
            shutil.rmtree(old_thumbs)
        else:
            old_thumbs.rename(new_thumbs)
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


@bp.route("/edit-thumb/<clip_id>/<int:second>")
def edit_thumb(clip_id: str, second: int):
    """One small cached frame at an integer second, for the timeline strip.
    Each frame is an independent request, so the strip fills in lazily and
    concurrently without ever holding video data in memory."""
    video_path = _clip_index.get(clip_id)
    if video_path is None or not video_path.exists():
        abort(404)
    thumb_dir = EDIT_THUMBS_DIR / clip_id
    thumb_dir.mkdir(parents=True, exist_ok=True)
    thumb = thumb_dir / f"{second}.jpg"
    if not thumb.exists():
        tmp = thumb_dir / f"{second}.{uuid.uuid4().hex[:8]}.tmp.jpg"
        cmd = [
            "ffmpeg", "-y",
            "-ss", str(second),
            "-i", str(video_path),
            "-frames:v", "1",
            "-update", "1",
            "-vf", "scale=160:-1",
            "-q:v", "5",
            str(tmp),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0 or not tmp.exists():
            tmp.unlink(missing_ok=True)
            abort(404)
        tmp.replace(thumb)  # atomic: concurrent requests can't collide
    return send_file(thumb, mimetype="image/jpeg")


# ---- apply: render the EDL with ffmpeg, then REPLACE the original ----
# This is the one destructive editor action, and it is deliberately staged:
# ffmpeg renders to a temp file next to the original, the temp is probed for
# sanity, and only then is the original atomically swapped out. A failed or
# killed render can never damage the clip. Each segment becomes a
# fast-seeking (-ss before -i) input on the *same* file, so ffmpeg never
# decodes more than the kept ranges; the concat filter joins and re-encodes
# them for frame-accurate cuts.
_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()


def _set_job(job_id: str, **fields) -> None:
    with _jobs_lock:
        _jobs[job_id].update(fields)


def _render_cmd(src: Path, segments: list[dict], has_audio: bool, out: Path) -> list[str]:
    cmd = ["ffmpeg", "-y"]
    for seg in segments:
        cmd += ["-ss", f"{seg['start']:.3f}", "-t", f"{seg['end'] - seg['start']:.3f}", "-i", str(src)]
    n = len(segments)
    if has_audio:
        pads = "".join(f"[{i}:v:0][{i}:a:0]" for i in range(n))
        filt = f"{pads}concat=n={n}:v=1:a=1[v][a]"
        maps = ["-map", "[v]", "-map", "[a]"]
    else:
        pads = "".join(f"[{i}:v:0]" for i in range(n))
        filt = f"{pads}concat=n={n}:v=1:a=0[v]"
        maps = ["-map", "[v]"]
    cmd += ["-filter_complex", filt, *maps,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
            "-pix_fmt", "yuv420p"]
    if has_audio:
        cmd += ["-c:a", "aac", "-b:a", "192k"]
    cmd += ["-movflags", "+faststart", "-progress", "pipe:1", "-nostats", str(out)]
    return cmd


def _finalize_replace(clip_id: str, src: Path, rendered: Path) -> dict:
    """Swap the rendered temp file in over the original, then re-key every
    cache that assumed the old content. Raises on any problem, in which
    case the original has not been touched."""
    info = probe_source(rendered)  # sanity: a broken render never lands
    if info["duration"] <= 0:
        raise RuntimeError("rendered file has no duration")

    target = src.with_suffix(".mp4")  # normally == src; .mkv etc. becomes .mp4
    stat = src.stat()
    # The clip may briefly be held open by a streaming response (the editor
    # preview, a hover preview); retry the swap a few times before giving up.
    for _ in range(10):
        try:
            os.replace(rendered, target)
            break
        except PermissionError:
            time.sleep(0.5)
    else:
        raise RuntimeError("clip is in use — close other players and retry")
    if target != src:
        src.unlink(missing_ok=True)
    # Keep the recorded date: sorting and the Arcade rely on mtime.
    os.utime(target, (stat.st_atime, stat.st_mtime))

    # The edit is baked into the file now — the project and every thumbnail
    # derived from the old content are stale.
    project_file(clip_id).unlink(missing_ok=True)
    shutil.rmtree(EDIT_THUMBS_DIR / clip_id, ignore_errors=True)
    (_cache_dir / f"{clip_id}.jpg").unlink(missing_ok=True)

    new_id = _id_for(target)
    if new_id != clip_id:  # only when the extension changed
        db.rename_path(str(src), str(target))
        _clip_index.pop(clip_id, None)
    _clip_index[new_id] = target
    size_mb = round(target.stat().st_size / (1024 * 1024), 1)
    for game in _games:
        for clip in game["clips"]:
            if clip["id"] == clip_id:
                clip.update(id=new_id, path=str(target),
                            filename=target.name, size_mb=size_mb)
    return {"replaced": True, "new_id": new_id,
            "filename": target.name, "size_mb": size_mb}


def _run_render(job_id: str, clip_id: str, src: Path, segments: list[dict],
                has_audio: bool, out: Path) -> None:
    total = sum(s["end"] - s["start"] for s in segments)
    tail: deque[str] = deque(maxlen=40)  # last log lines, for error reporting
    try:
        proc = subprocess.Popen(
            _render_cmd(src, segments, has_audio, out),
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, errors="replace",
        )
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            tail.append(line)
            # -progress emits out_time_us / out_time_ms; both are microseconds.
            if line.startswith(("out_time_us=", "out_time_ms=")):
                value = line.split("=", 1)[1]
                if value.isdigit() and total > 0:
                    frac = min(1.0, int(value) / 1e6 / total)
                    _set_job(job_id, progress=round(frac, 4))
        code = proc.wait()
        if code != 0 or not out.exists():
            detail = "; ".join(list(tail)[-4:]) or f"ffmpeg exited with {code}"
            _set_job(job_id, state="error", error=detail)
            out.unlink(missing_ok=True)  # never leave a broken half-file
            return
        extra = _finalize_replace(clip_id, src, out)
        _set_job(job_id, state="done", progress=1.0, **extra)
    except (OSError, RuntimeError) as exc:
        _set_job(job_id, state="error", error=str(exc))
        out.unlink(missing_ok=True)


@bp.route("/api/render/<clip_id>", methods=["POST"])
def start_render(clip_id: str):
    src = _clip_index.get(clip_id)
    if src is None or not src.exists():
        abort(404)
    data = request.get_json(silent=True) or {}
    project = load_project(clip_id)
    if project is not None:
        source = project["source"]
    else:
        try:
            source = _new_project(clip_id, src)["source"]
        except RuntimeError as exc:
            return jsonify({"error": str(exc)}), 500
    try:
        timeline = validated_timeline(data.get("timeline"), source["duration"])
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    segments = timeline["tracks"][0]["segments"]

    job_id = uuid.uuid4().hex[:12]
    # Render into the clip's own folder so the final swap is an atomic
    # same-volume rename, never a copy.
    out = src.with_name(f"{src.stem}.grayscale-{job_id}.tmp.mp4")
    with _jobs_lock:
        _jobs[job_id] = {"state": "running", "progress": 0.0, "error": None}
    threading.Thread(
        target=_run_render,
        args=(job_id, clip_id, src, segments, source["has_audio"], out),
        daemon=True,
    ).start()
    return jsonify({"job_id": job_id})


@bp.route("/api/render-status/<job_id>")
def render_status(job_id: str):
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is None:
            abort(404)
        return jsonify(dict(job))
