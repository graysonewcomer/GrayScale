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

## Next step

- Separate CSS out of the templates into a shared stylesheet, then do a
  design polish pass (the templates currently duplicate the theme tokens).
- Remaining small UI fixes are parked in **Backlog**.
