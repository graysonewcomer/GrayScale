"""Phase 0: prove ffmpeg can grab a thumbnail from a clip.

Usage: python thumbnail.py <input.mp4> [output.jpg]
"""
import subprocess
import sys
from pathlib import Path


def make_thumbnail(video_path: str, output_path: str, seek_seconds: float = 1.0) -> None:
    cmd = [
        "ffmpeg", "-y",
        "-ss", str(seek_seconds),
        "-i", video_path,
        "-frames:v", "1",
        "-update", "1",
        "-q:v", "2",
        output_path,
    ]
    subprocess.run(cmd, check=True)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python thumbnail.py <input.mp4> [output.jpg]")
        sys.exit(1)

    video_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else str(Path(video_path).with_suffix(".jpg").name)

    make_thumbnail(video_path, output_path)
    print(f"Thumbnail saved to {output_path}")
