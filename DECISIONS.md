# Decisions

One-liners on things we ruled out (or committed to) and why. Newest at top.

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
