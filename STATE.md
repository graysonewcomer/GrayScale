# State

Current snapshot of where GrayScale is. Updated at the end of each session.

## Phase

All four v1 phases are done and working:

- **Phase 0** — ffmpeg thumbnail generation ✅
- **Phase 1** — folder scan / game + clip index ✅
- **Phase 2** — Flask server + dashboard (thumbnail grid, tabs) ✅
- **Phase 3** — tagging + SQLite storage ✅
- **Phase 4** — filter by tag + multi-select export (copy only) ✅

## Post-v1 additions

- **In-app playback** — hover-to-preview + a large modal player with
  prev/next and range-based streaming. ✅
- **Tagging UX** — chips with an `×` to remove, `+ tag` reveal input
  (no more double display). ✅
- **Status page** — this page: renders project `.md` files in-app. ✅
- **Monochrome redesign** — chess-inspired black & white theme (silver
  accents, serif brand type, checkerboard motifs). CSS/JS split out of the
  templates into `static/style.css`, `static/theme.js`, `static/app.js`;
  both pages now share one stylesheet. ✅
- **Pastel tag colors** — every tag gets a random pastel hex, minted once
  and persisted in SQLite (`tag_colors`), so the same tag matches
  everywhere. ✅
- **Search by name** — a second topbar input, combined (AND) with the tag
  filter. ✅
- **Rename in-app** — pencil icon on card hover; renames the file on disk
  (stem only), migrating the tag row and cached thumbnail to the new id. ✅
- **Arcade: Guess the Clip** — first game tab. Deals a random ten-second
  window from a random clip; you name the game and pin the month + year.
  Chess-flavored scoring (game +1, year +1, exact month +2), streak +
  persisted best streak, full clip unlocked after the reveal. All
  client-side (`static/arcade.js`) on top of the existing `/video/`
  streaming — no new endpoints, no new dependencies. ✅
- **Non-destructive clip editor** — scissors icon on each card opens a
  full-screen editor: single video track, draggable playhead, trim handles,
  split at playhead, delete segment, undo/redo, autosave. Edits are an edit
  decision list stored as JSON in `projects/<clip_id>.json` (gitignored user
  data, like `tags.db`) — nothing touches the file while editing. Timeline
  shows lazy per-second thumbnails (`/edit-thumb/…`, cached under
  `thumbnails/edit/`). **Apply Edit** renders the cut via ffmpeg in a
  background thread (fast-seek `-ss/-t` inputs + concat filter, so multi-GB
  sources are never fully decoded), with a polled progress bar, then
  **replaces the clip in place** — confirmed first, staged through a temp
  file + ffprobe sanity check + atomic swap, recorded date preserved, all
  caches re-keyed. Backend is `editor.py` (a Flask blueprint), frontend
  `static/editor.js`. Renames migrate the project file and thumb cache like
  tags do. ✅
- **Editor polish (July 2026)** — theme-aware haloed crosshair cursor
  (black-on-light / white-on-dark), always-visible gold trim brackets,
  iPhone-style trim drags (timeline holds its scale, segment truncates in
  place, rescales on release), and a persisted volume slider + mute (M) in
  the transport. ✅
- **Rename inside the editor (July 2026)** — the editor title is now
  click-to-edit (Enter/blur commit, Esc cancel), reusing the same
  `/api/rename` endpoint as the card pencil. On success it adopts the new
  clip id, re-points the preview stream + thumb strip, and re-keys the
  dashboard card behind it (via a shared `window.GrayScale.applyRename`
  helper in `app.js`), so you can name the cut before Apply Edit instead of
  waiting for the post-render reload. ✅
- **Apply Edit no longer navigates away (July 2026)** — the post-render poll
  used to `window.location.reload()`, which always re-activated the first
  game tab and dumped you off the clip you edited. It now patches the card in
  place through a shared `window.GrayScale.applyReplace` helper (re-key id,
  rewrite size, cache-bust thumbnail) and closes the editor, so the tab and
  scroll position are preserved. ✅

## Next step

- Remaining small UI fixes are parked in **Backlog** (next up:
  click-a-chip-to-filter — even nicer now that chips are colored).
- The Arcade section is built to take more games — see the new ideas in
  **Feature Ideas**.
