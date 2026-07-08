# Feature Ideas

Big, unspecced features — the parking lot. These need their own spec before
any build. Small fixes and polish live in **Backlog** instead.

## From the original PRFAQ parking lot

1. **In-app trim** — cut a clip down to the good moment before export.
   (Basic playback now exists; trimming does not.)
2. **Auto-metadata via filename parsing** — pull date/time and any hints
   straight out of the NVIDIA filename to prefill fields.
3. **OCR-based hero / map detection** — read the killcam or scoreboard
   frame to auto-suggest tags (e.g. hero, map) per clip.
4. **ML classifier** — trained on the user's own accumulated tags, to
   suggest tags for new clips as they come in.

## Other ideas noticed during the build

- **Tag list / manager per game** — a panel or cloud showing every tag
  used in the current game (with counts). Click a tag to filter the grid;
  a natural home for renaming a tag everywhere at once. The app is built
  around tagging but gives no overview of the tags you've actually used.
- **Stable clip identity** — key tags by a content hash instead of file
  path, so moving the NVIDIA folder doesn't de-link tags.
- **Hide non-game folders** — an explicit "hide folder" control rather
  than the current implicit "folders with 0 clips are hidden."
