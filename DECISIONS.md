# Decisions

One-liners on things we ruled out (or committed to) and why. Newest at top.

- **Apply Edit overwrites the original clip (July 2026)** — requested
  reversal of the editor's export-to-copy behavior: once you hit Apply, the
  clip in the app *is* the edited cut — no side-copies accumulating. Staged
  for safety: render to a temp file → ffprobe sanity check → atomic replace,
  behind a confirm dialog that states exactly what is kept and discarded.
  The recorded date (mtime) is preserved; project + thumbnail caches are
  reset. Editing stays fully non-destructive *until* Apply. Export Set
  (copy-only) is unchanged.
- **Editing is an EDL, not a video operation** — the editor stores segments
  (source in/out windows) as JSON in `projects/`; nothing reads or writes
  video until you apply the edit.
- **Project schema carries `version` + typed tracks** — segments live in
  `tracks[]` with a `kind` field so audio / text / overlay tracks (and
  per-segment effects or transitions) can be added later without breaking
  saved projects. Only `kind: "video"` is accepted today.
- **Export re-encodes (x264 CRF 18) instead of stream-copying** —
  frame-accurate cuts beat keyframe-snapped `-c copy` cuts; each segment is
  a fast-seeking `-ss/-t` input so multi-GB files are never fully decoded.
- **Tag colors are random-per-tag and stored, not hash-derived** — a
  `tag_colors` SQLite table beats hashing the tag name to a hue: colors
  stay stable even if the palette generator changes later.
- **Rename is the one allowed write to originals** — user-initiated via
  the pencil icon only; same folder, extension preserved. Export remains
  copy-only.
- **Kept the vanilla HTML/JS + Flask stack; no React** — the app is a
  server-rendered grid with a handful of interactions; React would add a
  build step and dependency tree to solve state problems we don't have.
- **Status page renders a fixed file list, not arbitrary files** — safer
  and simpler; new files are one array entry in `STATUS_FILES`.
- **Markdown via the `markdown` library, not hand-rolled** — don't write
  a parser.
- **Tags key off absolute file path** — accepted for v1; moving the
  NVIDIA folder de-links tags. Revisit with a content hash (see
  Feature Ideas) if it bites.
- **Export always copies, never moves** — originals are never touched.
  This is a hard rule, not a preference.
- **Manual tagging over auto-detection for v1** — ships now instead of
  stalling on ML.
