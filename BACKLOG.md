# Backlog

Ideas intentionally kept OUT of scope for v1 (per the build spec). Parked here
so they don't derail the phased build.

## Explicitly out of scope for v1
- Trimming / editing clips
- In-app video playback
- Auto-detection of highlights
- Any ML
- Cloud / sync
- Mobile
- Moving or renaming originals (export always **copies**, never moves)

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
