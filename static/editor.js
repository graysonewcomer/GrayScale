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
  let project = null;
  let playhead = 0;        // timeline seconds
  let activeIdx = 0;       // segment currently feeding the <video>
  let selectedId = null;   // selected segment id, or null
  let raf = 0;

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
    trackEl.innerHTML = '';
    segs().forEach((seg, i) => {
      const el = document.createElement('div');
      el.className = 'tl-seg' + (seg.id === selectedId ? ' sel' : '');
      el.dataset.seg = seg.id;
      el.style.left = (offsetOf(i) / total * 100) + '%';
      el.style.width = (segLen(seg) / total * 100) + '%';
      const label = document.createElement('span');
      label.className = 'tl-seg-label';
      label.textContent = fmt(segLen(seg));
      el.appendChild(label);
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
    if (Math.abs(video.currentTime - src) > 0.04) video.currentTime = src;
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
    const segEl = e.target.closest('.tl-seg');
    selectedId = segEl ? segEl.dataset.seg : null;
    renderTrack();
    refreshTools();
    if (wasPlaying) video.play().catch(() => {});
  });

  function refreshTools() {
    deleteBtn.disabled = !selectedId || segs().length <= 1;
  }

  // ---- open / close ----
  async function open(card) {
    clipId = card.dataset.clip;
    titleEl.textContent = card.querySelector('.name').textContent;
    saveStateEl.textContent = '';
    selectedId = null;
    playhead = 0;
    activeIdx = 0;

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
    overlay.classList.remove('open');
    cancelAnimationFrame(raf);
    video.pause();
    video.removeAttribute('src');
    video.load();
    project = null;
    clipId = null;
  }

  document.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', () => open(btn.closest('.card')));
  });
  closeBtn.addEventListener('click', close);
  playBtn.addEventListener('click', togglePlay);
  video.addEventListener('click', togglePlay);
  video.addEventListener('play', renderChrome);
  video.addEventListener('pause', renderChrome);

  document.addEventListener('keydown', e => {
    if (!overlay.classList.contains('open')) return;
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === 'Escape') close();
    else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  });
})();
