"""Phase 1: scan the NVIDIA clips folder and print/save what's there.

Usage: python scan.py [path-to-NVIDIA-folder]
Defaults to C:\\Users\\<you>\\Videos\\NVIDIA
"""
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".avi", ".webm"}

DEFAULT_ROOT = Path.home() / "Videos" / "NVIDIA"


def get_duration_seconds(video_path: Path) -> float | None:
    cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(video_path),
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return round(float(result.stdout.strip()), 2)
    except (subprocess.CalledProcessError, ValueError):
        return None


def scan_clip(video_path: Path) -> dict:
    stat = video_path.stat()
    return {
        "filename": video_path.name,
        "path": str(video_path),
        "length_seconds": get_duration_seconds(video_path),
        "date": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
        "size_bytes": stat.st_size,
    }


def scan_root(root: Path) -> dict:
    games = []
    stray_entries = []

    for entry in sorted(root.iterdir()):
        if entry.is_dir():
            clips = []
            for f in sorted(entry.iterdir()):
                if f.is_file() and f.suffix.lower() in VIDEO_EXTENSIONS:
                    clips.append(scan_clip(f))
            games.append({
                "name": entry.name,
                "path": str(entry),
                "clip_count": len(clips),
                "clips": clips,
            })
        else:
            # A file sitting directly in the NVIDIA root, not inside a game folder.
            stray_entries.append({
                "name": entry.name,
                "path": str(entry),
            })

    return {"root": str(root), "games": games, "stray_entries": stray_entries}


def print_summary(data: dict) -> None:
    print(f"Scanned: {data['root']}\n")
    for game in data["games"]:
        flag = "" if game["clip_count"] > 0 else "  (no video files found)"
        print(f"  {game['name']}: {game['clip_count']} clip(s){flag}")
    if data["stray_entries"]:
        print("\n  Stray entries (not a game folder):")
        for entry in data["stray_entries"]:
            print(f"    {entry['name']}")
    total_clips = sum(g["clip_count"] for g in data["games"])
    print(f"\nTotal: {len(data['games'])} folders, {total_clips} clips")


if __name__ == "__main__":
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_ROOT

    if not root.is_dir():
        print(f"Not a folder: {root}")
        sys.exit(1)

    data = scan_root(root)
    print_summary(data)

    out_path = Path(__file__).parent / "scan_output.json"
    out_path.write_text(json.dumps(data, indent=2))
    print(f"\nFull output saved to {out_path}")
