// GrayScale editor — non-destructive trim/split editing over one clip.
//
// The project (an edit decision list) comes from /api/project/<id>: a video
// track whose segments are [start, end) windows into the source file. The
// timeline shown is the *edited* result: segments laid end to end. Playback
// reuses the range-streamed /video/<id> element and hops the video across
// segment boundaries; nothing is ever decoded in JS.
//
// Timeline time ("tl") vs source time: tl t falls inside segment i once the
// summed lengths of segments 0..i-1 are subtracted; the remainder offsets
// into that segment's source window.
(function () {
  const overlay = document.getElementById('editor');
  if (!overlay) return;

  const video = document.getElementById('ed-video');
  const titleEl = document.getElementById('ed-title');
  const titleInput = document.getElementById('ed-title-input');
  const saveStateEl = document.getElementById('ed-savestate');
  const undoBtn = document.getElementById('ed-undo');
  const redoBtn = document.getElementById('ed-redo');
  const exportBtn = document.getElementById('ed-export');
  const closeBtn = document.getElementById('ed-close');
  const playBtn = document.getElementById('ed-play');
  const timeEl = document.getElementById('ed-time');
  const splitBtn = document.getElementById('ed-split');
  const deleteBtn = document.getElementById('ed-delete');
  const tlInner = document.getElementById('ed-tl');
  const rulerEl = document.getElementById('ed-ruler');
  const trackEl = document.getElementById('ed-track');
  const playheadEl = document.getElementById('ed-playhead');

  let clipId = null;
  let cardEl = null;      // the dashboard card this editor was opened from
  let project = null;
  let playhead = 0;        // timeline seconds
  let activeIdx = 0;       // segment currently feeding the <video>
  let selectedId = null;   // selected segment id, or null
  let raf = 0;
  const undoStack = [];    // JSON snapshots of the timeline
  const redoStack = [];
  let saveTimer = null;

  const MIN_SEG = 0.1;     // matches the server's MIN_SEGMENT_SECONDS
  const newSegId = () => 'seg-' + Math.random().toString(36).slice(2, 10);

  const segs = () => project.timeline.tracks[0].segments;
  const segLen = s => s.end - s.start;
  const tlDuration = () => segs().reduce((a, s) => a + segLen(s), 0);

  // Timeline offset where segment i begins.
  function offsetOf(i) {
    let acc = 0;
    for (let k = 0; k < i; k++) acc += segLen(segs()[k]);
    return acc;
  }

  // Map timeline time -> { i: segment index, src: source time }.
  function locate(t) {
    const list = segs();
    let acc = 0;
    for (let i = 0; i < list.length; i++) {
      const len = segLen(list[i]);
      if (t < acc + len || i === list.length - 1) {
        return { i, src: Math.min(list[i].end, list[i].start + Math.max(0, t - acc)) };
      }
      acc += len;
    }
    return { i: 0, src: list[0].start };
  }

  function fmt(t) {
    t = Math.max(0, t);
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  }

  // ---- rendering ----
  function renderRuler() {
    const total = tlDuration();
    const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const step = steps.find(s => total / s <= 12) || 600;
    rulerEl.innerHTML = '';
    for (let t = 0; t <= total + 0.001; t += step) {
      const tick = document.createElement('div');
      tick.className = 'tl-tick';
      tick.style.left = (t / total * 100) + '%';
      tick.textContent = fmt(t);
      rulerEl.appendChild(tick);
    }
  }

  function renderTrack() {
    const total = tlDuration();
    const trackW = trackEl.clientWidth || 1000;
    trackEl.innerHTML = '';
    segs().forEach((seg, i) => {
      const el = document.createElement('div');
      el.className = 'tl-seg' + (seg.id === selectedId ? ' sel' : '');
      el.dataset.seg = seg.id;
      el.style.left = (offsetOf(i) / total * 100) + '%';
      el.style.width = (segLen(seg) / total * 100) + '%';
      // Thumbnail strip: frames sampled across the segment's source window,
      // snapped to whole seconds so the /edit-thumb cache is reused as the
      // segment is trimmed. Lazy imgs = generated on demand, in parallel.
      const segPx = segLen(seg) / total * trackW;
      const count = Math.max(1, Math.round(segPx / 90));
      const thumbs = document.createElement('div');
      thumbs.className = 'tl-thumbs';
      for (let k = 0; k < count; k++) {
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.draggable = false;
        img.alt = '';
        const srcT = seg.start + (k + 0.5) / count * segLen(seg);
        const sec = Math.min(Math.floor(project.source.duration), Math.floor(srcT));
        img.src = '/edit-thumb/' + clipId + '/' + sec;
        thumbs.appendChild(img);
      }
      el.appendChild(thumbs);
      const label = document.createElement('span');
      label.className = 'tl-seg-label';
      label.textContent = fmt(segLen(seg));
      el.appendChild(label);
      ['l', 'r'].forEach(side => {
        const h = document.createElement('div');
        h.className = 'tl-handle tl-handle-' + side;
        h.dataset.side = side;
        el.appendChild(h);
      });
      trackEl.appendChild(el);
    });
  }

  function renderChrome() {
    playheadEl.style.left = (playhead / tlDuration() * 100) + '%';
    timeEl.textContent = fmt(playhead) + ' / ' + fmt(tlDuration());
    playBtn.innerHTML = video.paused ? '&#9654;' : '&#10073;&#10073;';
  }

  function render() {
    renderRuler();
    renderTrack();
    renderChrome();
  }

  // ---- transport ----
  function seekTl(t) {
    playhead = Math.max(0, Math.min(tlDuration(), t));
    const { i, src } = locate(playhead);
    activeIdx = i;
    // No src while a render is applying — position updates, seeking waits.
    if (video.currentSrc && Math.abs(video.currentTime - src) > 0.04) {
      video.currentTime = src;
    }
    renderChrome();
  }

  function tick() {
    const list = segs();
    const seg = list[activeIdx];
    if (!video.paused && seg) {
      if (video.currentTime >= seg.end - 0.03 || video.ended) {
        if (activeIdx < list.length - 1) {
          activeIdx += 1;
          video.currentTime = list[activeIdx].start;
        } else {
          video.pause();
          playhead = tlDuration();
        }
      } else {
        playhead = offsetOf(activeIdx) +
          Math.max(0, video.currentTime - seg.start);
      }
      renderChrome();
    }
    raf = requestAnimationFrame(tick);
  }

  function togglePlay() {
    if (video.paused) {
      if (playhead >= tlDuration() - 0.05) seekTl(0);  // replay from the top
      video.play().catch(() => {});
    } else {
      video.pause();
    }
    renderChrome();
  }

  // ---- scrubbing: drag anywhere on the ruler or track ----
  let scrubbing = false;
  let wasPlaying = false;

  function scrubTo(clientX) {
    const rect = tlInner.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    seekTl(frac * tlDuration());
  }

  tlInner.addEventListener('pointerdown', e => {
    scrubbing = true;
    wasPlaying = !video.paused;
    video.pause();
    tlInner.setPointerCapture(e.pointerId);
    scrubTo(e.clientX);
  });
  tlInner.addEventListener('pointermove', e => {
    if (scrubbing) scrubTo(e.clientX);
  });
  tlInner.addEventListener('pointerup', e => {
    if (!scrubbing) return;
    scrubbing = false;
    // Pointer capture retargets the event to tlInner, so hit-test manually.
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const segEl = under && under.closest('.tl-seg');
    selectedId = segEl ? segEl.dataset.seg : null;
    renderTrack();
    refreshTools();
    if (wasPlaying) video.play().catch(() => {});
  });

  function refreshTools() {
    deleteBtn.disabled = !selectedId || segs().length <= 1;
    undoBtn.disabled = undoStack.length === 0;
    redoBtn.disabled = redoStack.length === 0;
  }

  // ---- history + autosave ----
  // Undo/redo is a snapshot stack: the timeline JSON is tiny, so whole
  // copies beat command objects for robustness.
  const snapshot = () => JSON.stringify(project.timeline);

  function pushUndo(snap) {
    undoStack.push(snap);
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
  }

  function afterEdit() {
    seekTl(playhead);  // clamps and re-locates the active segment
    render();
    refreshTools();
    scheduleSave();
  }

  function applySnapshot(snap) {
    project.timeline = JSON.parse(snap);
    if (!segs().some(s => s.id === selectedId)) selectedId = null;
    afterEdit();
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    applySnapshot(undoStack.pop());
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    applySnapshot(redoStack.pop());
  }

  function scheduleSave() {
    saveStateEl.className = 'editor-savestate';
    saveStateEl.textContent = 'Unsaved changes…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 800);
  }

  async function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!project) return;
    const id = clipId;
    const body = JSON.stringify({ timeline: project.timeline });
    try {
      const res = await fetch('/api/project/' + id, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'save failed');
      if (id !== clipId) return;  // editor moved on while we were in flight
      saveStateEl.className = 'editor-savestate saved';
      saveStateEl.textContent = 'Saved';
    } catch (err) {
      if (id !== clipId) return;
      saveStateEl.className = 'editor-savestate error';
      saveStateEl.textContent = 'Save failed: ' + err.message;
    }
  }

  // ---- editing operations ----
  function splitAtPlayhead() {
    if (!project) return;
    const { i, src } = locate(playhead);
    const seg = segs()[i];
    if (src - seg.start < MIN_SEG || seg.end - src < MIN_SEG) return;
    pushUndo(snapshot());
    const right = { id: newSegId(), start: src, end: seg.end };
    seg.end = src;
    segs().splice(i + 1, 0, right);
    selectedId = right.id;  // ready to delete the tail in one keystroke
    afterEdit();
  }

  function deleteSelected() {
    const list = segs();
    if (!selectedId || list.length <= 1) return;
    const i = list.findIndex(s => s.id === selectedId);
    if (i < 0) return;
    pushUndo(snapshot());
    list.splice(i, 1);
    selectedId = null;
    afterEdit();
  }

  // ---- trim: drag a segment's edge; source window shrinks or grows ----
  trackEl.addEventListener('pointerdown', e => {
    const handle = e.target.closest('.tl-handle');
    if (!handle || !project) return;
    e.stopPropagation();  // not a scrub
    e.preventDefault();
    const segEl = handle.closest('.tl-seg');
    const segId = segEl.dataset.seg;
    const seg = segs().find(s => s.id === segId);
    const side = handle.dataset.side;
    const preDrag = snapshot();
    // The whole layout is frozen at drag start (iPhone-style): the other
    // segments hold still, the dragged segment truncates in place with the
    // checkerboard showing through, and the timeline only rescales to fill
    // once the handle is released.
    const total0 = tlDuration();
    const offset0 = offsetOf(segs().indexOf(seg));
    const pxPerSec = tlInner.getBoundingClientRect().width / total0;
    const x0 = e.clientX;
    const start0 = seg.start;
    const end0 = seg.end;
    video.pause();
    selectedId = segId;
    trackEl.querySelectorAll('.tl-seg.sel').forEach(s => s.classList.remove('sel'));
    segEl.classList.add('sel');
    refreshTools();

    // Mask the thumbnails instead of squishing them: freeze the strip at
    // its pixel width, anchored to the edge that isn't moving, and let the
    // segment's overflow:hidden do the cropping.
    const labelEl = segEl.querySelector('.tl-seg-label');
    const thumbsEl = segEl.querySelector('.tl-thumbs');
    if (thumbsEl) {
      thumbsEl.style.width = segEl.getBoundingClientRect().width + 'px';
      if (side === 'l') {
        thumbsEl.style.left = 'auto';
        thumbsEl.style.right = '0';
      }
    }

    const onMove = ev => {
      const dt = (ev.clientX - x0) / pxPerSec;
      if (side === 'l') {
        seg.start = Math.min(Math.max(0, start0 + dt), seg.end - MIN_SEG);
        segEl.style.left = ((offset0 + (seg.start - start0)) / total0 * 100) + '%';
      } else {
        seg.end = Math.max(Math.min(project.source.duration, end0 + dt), seg.start + MIN_SEG);
      }
      segEl.style.width = (segLen(seg) / total0 * 100) + '%';
      labelEl.textContent = fmt(segLen(seg));
      // Playhead rides the dragged edge; the preview shows that exact frame.
      const edgeTl = side === 'l'
        ? offset0 + (seg.start - start0)
        : offset0 + segLen(seg);
      playheadEl.style.left = (edgeTl / total0 * 100) + '%';
      timeEl.textContent = fmt(edgeTl) + ' / ' + fmt(tlDuration());
      video.currentTime = side === 'l' ? seg.start : seg.end;
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      // Land the playhead on the trimmed edge, then rescale to fill.
      playhead = offsetOf(segs().indexOf(seg)) + (side === 'l' ? 0 : segLen(seg));
      if (snapshot() !== preDrag) {
        pushUndo(preDrag);
        afterEdit();
      } else {
        renderTrack();  // rebuilds the strip, clearing the mask overrides
        refreshTools();
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });

  // ---- rename: edit the clip's name from the editor title ----
  // Renaming mints a new clip id server-side (the id is a hash of the path),
  // so we adopt the returned id, re-point the preview stream, and re-key the
  // dashboard card — the same outcome as the pencil rename, without leaving.
  const stemOf = name => {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(0, dot) : name;
  };

  function openTitleEdit() {
    if (!project || exporting) return;
    titleInput.value = stemOf(titleEl.textContent);
    titleEl.hidden = true;
    titleInput.hidden = false;
    titleInput.focus();
    titleInput.select();
  }

  function closeTitleEdit() {
    titleInput.hidden = true;
    titleEl.hidden = false;
  }

  let renaming = false;
  async function commitTitleEdit() {
    if (renaming) return;
    const stem = titleInput.value.trim();
    if (!stem || stem === stemOf(titleEl.textContent)) { closeTitleEdit(); return; }
    renaming = true;
    const fromId = clipId;
    try {
      const res = await fetch('/api/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clip_id: fromId, name: stem }),
      });
      const data = await res.json();
      if (!res.ok) {
        saveStateEl.className = 'editor-savestate error';
        saveStateEl.textContent = data.error || 'Rename failed.';
        return;
      }
      if (fromId !== clipId) return;  // editor moved to another clip mid-flight
      clipId = data.id;
      titleEl.textContent = data.filename;
      titleEl.title = data.filename;
      // The server migrated the project + edit-thumbs to the new id and
      // dropped the old id from its index; re-point the preview so range
      // requests don't 404, and rebuild the strip against the new id.
      const srcT = video.currentTime;
      const wasPlaying = !video.paused;
      video.src = '/video/' + clipId;
      video.addEventListener('loadedmetadata', function once() {
        video.removeEventListener('loadedmetadata', once);
        if (Number.isFinite(srcT)) video.currentTime = srcT;
        if (wasPlaying) video.play().catch(() => {});
      });
      renderTrack();
      // Keep the dashboard card behind the editor consistent.
      if (cardEl && window.GrayScale) window.GrayScale.applyRename(cardEl, data);
      saveStateEl.className = 'editor-savestate saved';
      saveStateEl.textContent = 'Renamed';
    } catch (err) {
      saveStateEl.className = 'editor-savestate error';
      saveStateEl.textContent = 'Rename failed: ' + err.message;
    } finally {
      renaming = false;
      closeTitleEdit();
    }
  }

  titleEl.addEventListener('click', openTitleEdit);
  titleInput.addEventListener('keydown', e => {
    e.stopPropagation();  // don't reach the editor's global shortcut handler
    if (e.key === 'Enter') { e.preventDefault(); commitTitleEdit(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeTitleEdit(); }
  });
  titleInput.addEventListener('blur', () => { if (!titleInput.hidden) commitTitleEdit(); });

  // ---- volume: slider + mute, persisted like the theme preference ----
  const muteBtn = document.getElementById('ed-mute');
  const volSlider = document.getElementById('ed-volume');
  const VOL_KEY = 'grayscale-editor-volume';
  const MUTE_KEY = 'grayscale-editor-muted';

  const ICON_ON = '<svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
  const ICON_OFF = '<svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/></svg>';

  function refreshVolumeUI() {
    const silent = video.muted || video.volume === 0;
    muteBtn.innerHTML = silent ? ICON_OFF : ICON_ON;
    muteBtn.title = (video.muted ? 'Unmute' : 'Mute') + ' (M)';
    volSlider.value = Math.round(video.volume * 100);
    volSlider.classList.toggle('muted', silent);
  }

  video.volume = (localStorage.getItem(VOL_KEY) ?? 100) / 100;
  video.muted = localStorage.getItem(MUTE_KEY) === '1';
  refreshVolumeUI();

  volSlider.addEventListener('input', () => {
    video.volume = volSlider.value / 100;
    if (video.volume > 0) video.muted = false;  // dragging the slider unmutes
    localStorage.setItem(VOL_KEY, volSlider.value);
    localStorage.setItem(MUTE_KEY, video.muted ? '1' : '0');
  });

  function toggleMute() {
    video.muted = !video.muted;
    localStorage.setItem(MUTE_KEY, video.muted ? '1' : '0');
  }
  muteBtn.addEventListener('click', toggleMute);
  video.addEventListener('volumechange', refreshVolumeUI);

  // ---- export: render the timeline to a new MP4 server-side ----
  const exportBar = document.getElementById('ed-exportbar');
  const exportFill = document.getElementById('ed-progress-fill');
  const exportStatus = document.getElementById('ed-export-status');
  let exporting = false;

  async function startExport() {
    if (exporting || !project) return;
    // The one destructive action in the app: say exactly what will happen.
    const kept = segs().length;
    const ok = confirm(
      'Replace "' + titleEl.textContent + '" with your edited cut?\n\n' +
      'Kept: ' + kept + ' segment' + (kept === 1 ? '' : 's') + ', ' +
      fmt(tlDuration()) + ' of ' + fmt(project.source.duration) + '. ' +
      'Everything outside your segments is discarded for good.');
    if (!ok) return;
    if (saveTimer) await saveNow();  // sync pending edits to disk first
    exporting = true;
    exportBtn.disabled = true;
    exportBar.hidden = false;
    exportFill.style.width = '0%';
    exportStatus.className = 'ed-export-status';
    exportStatus.textContent = 'Starting render…';
    // Release the preview's open stream so the final file swap can't be
    // blocked by our own connection to the clip.
    cancelAnimationFrame(raf);
    video.pause();
    video.removeAttribute('src');
    video.load();
    try {
      const res = await fetch('/api/render/' + clipId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeline: project.timeline }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'could not start the export');
      poll(data.job_id);
    } catch (err) {
      exportDone(false, 'Export failed: ' + err.message);
    }
  }

  function exportDone(ok, message) {
    exporting = false;
    exportBtn.disabled = false;
    exportFill.style.width = ok ? '100%' : '0%';
    exportStatus.className = 'ed-export-status ' + (ok ? 'ok' : 'error');
    exportStatus.textContent = message;
    exportStatus.title = message;  // full detail survives the ellipsis
    // On failure the original is untouched; bring the preview back to life.
    if (!ok && clipId && overlay.classList.contains('open')) {
      video.src = '/video/' + clipId;
      seekTl(playhead);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    }
  }

  // The job runs server-side, so it survives the editor being closed;
  // polling just keeps narrating to whoever is watching.
  async function poll(jobId) {
    try {
      const res = await fetch('/api/render-status/' + jobId);
      if (!res.ok) throw new Error('lost track of the export job');
      const job = await res.json();
      if (job.state === 'running') {
        exportFill.style.width = (job.progress * 100).toFixed(1) + '%';
        exportStatus.textContent = 'Rendering… ' + Math.round(job.progress * 100) + '%';
        setTimeout(() => poll(jobId), 600);
      } else if (job.state === 'done') {
        exportDone(true, 'Clip replaced (' + job.size_mb + ' MB).');
        // The clip, its metadata, and thumbnail all changed — but a full
        // reload throws us back to the first game tab. Instead, patch the
        // affected card in place and close the editor, keeping the tab and
        // scroll position on the clip we just edited.
        if (cardEl && window.GrayScale) window.GrayScale.applyReplace(cardEl, job);
        setTimeout(close, 1200);  // let the "Clip replaced" note land, then exit
      } else {
        exportDone(false, 'Export failed: ' + (job.error || 'unknown error'));
      }
    } catch (err) {
      exportDone(false, 'Export failed: ' + err.message);
    }
  }

  exportBtn.addEventListener('click', startExport);

  // ---- open / close ----
  async function open(card) {
    clipId = card.dataset.clip;
    cardEl = card;
    closeTitleEdit();
    titleEl.textContent = card.querySelector('.name').textContent;
    titleEl.title = titleEl.textContent;
    saveStateEl.className = 'editor-savestate';
    saveStateEl.textContent = '';
    selectedId = null;
    playhead = 0;
    activeIdx = 0;
    undoStack.length = 0;
    redoStack.length = 0;
    if (!exporting) {   // a still-running job keeps its progress visible
      exportBar.hidden = true;
      exportStatus.textContent = '';
    }
    exportBtn.disabled = exporting;

    overlay.classList.add('open');
    const res = await fetch('/api/project/' + clipId);
    if (!res.ok) {
      saveStateEl.textContent = 'Could not load project.';
      return;
    }
    project = await res.json();
    video.src = '/video/' + clipId;
    render();
    refreshTools();
    seekTl(0);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  }

  function close() {
    if (saveTimer) saveNow();  // flush a pending autosave before leaving
    closeTitleEdit();
    overlay.classList.remove('open');
    cancelAnimationFrame(raf);
    video.pause();
    video.removeAttribute('src');
    video.load();
    project = null;
    clipId = null;
    cardEl = null;
  }

  document.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', () => open(btn.closest('.card')));
  });
  closeBtn.addEventListener('click', close);
  playBtn.addEventListener('click', togglePlay);
  splitBtn.addEventListener('click', splitAtPlayhead);
  deleteBtn.addEventListener('click', deleteSelected);
  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);
  video.addEventListener('click', togglePlay);
  video.addEventListener('play', renderChrome);
  video.addEventListener('pause', renderChrome);

  document.addEventListener('keydown', e => {
    if (!overlay.classList.contains('open')) return;
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === 'Escape') close();
    else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo(); }
    else if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey) splitAtPlayhead();
    else if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey) toggleMute();
    else if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
  });
})();
