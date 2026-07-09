"""Tag storage: a small local SQLite file.

Clips are keyed by absolute file path. Known risk: moving the NVIDIA folder
de-links tags. Acceptable for v1 (see BACKLOG.md).

Tag colors: each distinct tag (case-insensitive) gets a random pastel hex,
minted the first time the tag is seen and persisted so "cat" is the same
color everywhere, forever.
"""
import colorsys
import random
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "tags.db"


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS clip_tags (
                clip_path TEXT PRIMARY KEY,
                tags      TEXT NOT NULL DEFAULT ''
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS tag_colors (
                tag   TEXT PRIMARY KEY,
                color TEXT NOT NULL
            )
            """
        )


def normalize_tags(raw: str) -> list[str]:
    """Split a comma-separated string into clean, de-duplicated tags."""
    seen: dict[str, str] = {}
    for part in raw.split(","):
        tag = part.strip()
        if tag and tag.lower() not in seen:
            seen[tag.lower()] = tag
    return list(seen.values())


def _split_stored(value: str) -> list[str]:
    return [t for t in value.split(",") if t]


def get_all_tags() -> dict[str, list[str]]:
    with _connect() as conn:
        rows = conn.execute("SELECT clip_path, tags FROM clip_tags").fetchall()
    return {row["clip_path"]: _split_stored(row["tags"]) for row in rows}


def set_tags(clip_path: str, raw: str) -> list[str]:
    tags = normalize_tags(raw)
    joined = ",".join(tags)
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO clip_tags (clip_path, tags) VALUES (?, ?)
            ON CONFLICT(clip_path) DO UPDATE SET tags = excluded.tags
            """,
            (clip_path, joined),
        )
    return tags


def rename_path(old_path: str, new_path: str) -> None:
    """Re-key a clip's tags after its file is renamed on disk."""
    with _connect() as conn:
        conn.execute(
            "UPDATE clip_tags SET clip_path = ? WHERE clip_path = ?",
            (new_path, old_path),
        )


def _random_pastel() -> str:
    """A random hex in pastel territory: any hue, soft saturation, light."""
    hue = random.random()
    sat = random.uniform(0.45, 0.70)
    light = random.uniform(0.78, 0.86)
    r, g, b = colorsys.hls_to_rgb(hue, light, sat)
    return "#{:02x}{:02x}{:02x}".format(int(r * 255), int(g * 255), int(b * 255))


def ensure_tag_colors(tags) -> dict[str, str]:
    """Return {lowercased tag: pastel hex} for the given tags, minting and
    persisting a color for any tag seen for the first time."""
    keys = {t.lower() for t in tags}
    with _connect() as conn:
        rows = conn.execute("SELECT tag, color FROM tag_colors").fetchall()
        colors = {row["tag"]: row["color"] for row in rows}
        for key in sorted(keys - colors.keys()):
            colors[key] = _random_pastel()
            conn.execute(
                "INSERT INTO tag_colors (tag, color) VALUES (?, ?)",
                (key, colors[key]),
            )
    return {k: colors[k] for k in keys}
