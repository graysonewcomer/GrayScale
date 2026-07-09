# Backlog

Small fixes, polish, and refinements. Bigger unspecced features live in
`FEATUREIDEAS.md`; things ruled out live in `DECISIONS.md`.

## Polish / small fixes
- Click a tag chip (on a card or in the player) to filter the grid by that
  tag, instead of retyping it in the filter box.

## Explicitly out of scope for v1
- Trimming / editing clips
- Auto-detection of highlights
- Any ML
- Cloud / sync
- Mobile
- Moving originals (export always **copies**, never moves). Renaming was
  originally out of scope too, but shipped July 2026 as an explicit
  user-initiated action (pencil icon) — still same-folder, extension
  preserved.

## Noticed during the build
- Empty game folders (no clips) and non-game folders (`Java-runtime-delta`,
  `Unreal Crash Report Client`, etc.) — the dashboard currently hides folders
  with 0 clips. Consider an explicit "hide folder" control instead of implicit
  hiding.
- Tags are keyed by file path. Moving the NVIDIA folder de-links tags.
  Acceptable for v1; revisit with a content hash or stable id if it bites.
- The scan logic lives inside the app (`build_index`). If a standalone CLI
  listing is ever wanted again, factor it into a shared module with a small
  entry point rather than duplicating.
