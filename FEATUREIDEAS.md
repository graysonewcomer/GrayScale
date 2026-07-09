# Feature Ideas

Big, unspecced features — the parking lot. These need their own spec before
any build. Small fixes and polish live in **Backlog** instead.

## From the original PRFAQ parking lot

1. ~~**In-app trim**~~ — shipped July 2026, and then some: the editor does
   trim, split, delete, undo/redo, with ffmpeg MP4 export. Natural
   follow-ups now that the EDL schema has typed tracks: text overlays,
   audio track control, transitions, zoom/pan effects, multi-track.
2. **Auto-metadata via filename parsing** — pull date/time and any hints
   straight out of the NVIDIA filename to prefill fields.
3. **OCR-based hero / map detection** — read the killcam or scoreboard
   frame to auto-suggest tags (e.g. hero, map) per clip.
4. **ML classifier** — trained on the user's own accumulated tags, to
   suggest tags for new clips as they come in.

## Arcade (Guess the Clip shipped July 2026 — possible follow-ups)

- **More arcade games** — the sidebar section and panel pattern generalize:
  e.g. "older or newer?" (two clips, pick the earlier one), a tag-guessing
  mode once tag coverage grows, or a daily seeded round.
- **Guess-the-clip variants** — difficulty settings (5s window, one replay
  only, mute-only "silent mode"), scoring for *closest* month instead of
  exact, or excluding a game you've clearly memorized.
- **Arcade stats** — rounds played, accuracy per game, average points;
  could live in localStorage like best streak, or graduate to SQLite.

## Other ideas noticed during the build

- **Tag list / manager per game** — a panel or cloud showing every tag
  used in the current game (with counts). Click a tag to filter the grid;
  a natural home for renaming a tag everywhere at once. The app is built
  around tagging but gives no overview of the tags you've actually used.
- **Stable clip identity** — key tags by a content hash instead of file
  path, so moving the NVIDIA folder doesn't de-link tags.
- **Hide non-game folders** — an explicit "hide folder" control rather
  than the current implicit "folders with 0 clips are hidden."
