"""Phase 3 storage: tags kept in a small local SQLite file.

Clips are keyed by absolute file path. Known risk: moving the NVIDIA folder
de-links tags. Acceptable for v1 (see BACKLOG.md).
"""
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
