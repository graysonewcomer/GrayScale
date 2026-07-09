// GrayScale Arcade — "Guess the Clip". Deal a random ten-second window from
// a random clip anywhere in the library; the player names the game and pins
// the month + year. The answer key (id / game / date / filename) is embedded
// by the template as window.ARCADE.
//
// Scoring per round: game +1, year +1, exact month +2 on top (max 4).
// Streak counts consecutive rounds with the game right; best streak
// persists in localStorage.
(function () {
  const DATA = window.ARCADE || [];
  const panel = document.getElementById('arcade-panel');
  if (!panel || !DATA.length) return;

  const SNIPPET = 10; // seconds shown before the guess
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                  'August', 'September', 'October', 'November', 'December'];

  const video = document.getElementById('arc-video');
  const cover = document.getElementById('arc-cover');
  const startBtn = document.getElementById('arc-start');
  const replayBtn = document.getElementById('arc-replay');
  const unmuteBtn = document.getElementById('arc-unmute');
  const progressFill = document.getElementById('arc-progress');
  const guessBox = document.getElementById('arc-guess');
  const gamesBox = document.getElementById('arc-games');
  const monthSel = document.getElementById('arc-month');
  const yearSel = document.getElementById('arc-year');
  const submitBtn = document.getElementById('arc-submit');
  const revealBox = document.getElementById('arc-reveal');
  const scoreEl = document.getElementById('arc-score');
  const streakEl = document.getElementById('arc-streak');
  const bestEl = document.getElementById('arc-best');

  const gameNames = [...new Set(DATA.map(c => c.game))];
  const clipYears = DATA.map(c => +c.date.slice(0, 4));
  const minYear = Math.min(...clipYears);
  const maxYear = Math.max(...clipYears);

  let clip = null;         // the round's answer
  let snipStart = 0;
  let snipEnd = 0;
  let phase = 'idle';      // idle | guessing | revealed
  let raf = 0;
  let pickedGame = null;
  let score = 0;
  let streak = 0;
  let best = +localStorage.getItem('grayscale-arcade-best') || 0;
  const recent = [];       // last few clip ids, so rounds don't repeat back-to-back

  bestEl.textContent = best;

  // ---- one-time controls setup ----
  function option(sel, value, label, placeholder) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    if (placeholder) { o.disabled = true; o.selected = true; }
    sel.appendChild(o);
  }
  option(monthSel, '', 'month…', true);
  MONTHS.forEach((m, i) => option(monthSel, i + 1, m));
  option(yearSel, '', 'year…', true);
  for (let y = minYear; y <= maxYear; y++) option(yearSel, y, y);

  gameNames.forEach(name => {
    const btn = document.createElement('button');
    btn.className = 'guess-game';
    btn.type = 'button';
    btn.textContent = name;
    btn.addEventListener('click', () => {
      pickedGame = name;
      gamesBox.querySelectorAll('.guess-game').forEach(b =>
        b.classList.toggle('picked', b === btn));
      refreshSubmit();
    });
    gamesBox.appendChild(btn);
  });

  function refreshSubmit() {
    submitBtn.disabled =
      phase !== 'guessing' || !pickedGame || !monthSel.value || !yearSel.value;
  }
  monthSel.addEventListener('change', refreshSubmit);
  yearSel.addEventListener('change', refreshSubmit);

  // ---- round lifecycle ----
  function pickClip() {
    let c;
    do { c = DATA[Math.floor(Math.random() * DATA.length)]; }
    while (recent.includes(c.id));
    recent.push(c.id);
    if (recent.length > Math.min(8, DATA.length - 1)) recent.shift();
    return c;
  }

  function startRound() {
    clip = pickClip();
    phase = 'guessing';
    pickedGame = null;
    cover.hidden = true;
    revealBox.hidden = true;
    guessBox.hidden = false;
    replayBtn.hidden = true;
    unmuteBtn.hidden = true;
    progressFill.style.width = '0%';
    gamesBox.querySelectorAll('.guess-game').forEach(b => b.classList.remove('picked'));
    monthSel.value = '';
    yearSel.value = '';
    refreshSubmit();

    cancelAnimationFrame(raf);
    video.classList.remove('ready');
    video.classList.add('no-touch');   // no scrubbing until the reveal
    video.controls = false;
    video.muted = false;
    // Drop any stale once-listeners from a round abandoned mid-load
    // (hammering "Next clip" must not stack handlers).
    video.removeEventListener('loadedmetadata', onMetadata);
    video.removeEventListener('seeked', onSeeked);
    video.src = '/video/' + clip.id;
    video.addEventListener('loadedmetadata', onMetadata, { once: true });
    video.load();
  }

  function onSeeked() {
    video.classList.add('ready');
    playSnippet();
  }

  function onMetadata() {
    const dur = video.duration;
    if (isFinite(dur) && dur > SNIPPET + 1) {
      snipStart = Math.random() * (dur - SNIPPET - 0.5);
      snipEnd = snipStart + SNIPPET;
    } else {
      snipStart = 0;
      snipEnd = isFinite(dur) ? dur : SNIPPET;
    }
    if (Math.abs(video.currentTime - snipStart) < 0.05) {
      onSeeked();
    } else {
      video.addEventListener('seeked', onSeeked, { once: true });
      video.currentTime = snipStart;
    }
  }

  function playSnippet() {
    // Sound needs a recent user gesture; if the browser balks, fall back to
    // muted playback and offer an unmute pill.
    video.play().catch(() => {
      video.muted = true;
      unmuteBtn.hidden = false;
      video.play().catch(() => {});
    });
    cancelAnimationFrame(raf);
    const span = Math.max(0.1, snipEnd - snipStart);
    const tick = () => {
      if (phase !== 'guessing') return;  // the reveal frees the tape
      const frac = Math.min(1, (video.currentTime - snipStart) / span);
      progressFill.style.width = (frac * 100).toFixed(1) + '%';
      if (video.currentTime >= snipEnd || video.ended) {
        video.pause();
        replayBtn.hidden = false;
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  // ---- grading + reveal ----
  const esc = s => s.replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtMonth = (y, m) => MONTHS[m - 1] + ' ' + y;

  const VERDICTS = [
    'Blunder. The board resets.',
    '♙ A pawn’s progress.',
    '♘ Solid development.',
    '♖ Strong play.',
    '♛ Brilliant — a queen’s round.',
  ];

  function submit() {
    if (submitBtn.disabled) return;
    phase = 'revealed';
    cancelAnimationFrame(raf);
    progressFill.style.width = '0%';

    const [ay, am] = clip.date.split('-').map(Number);
    const gm = +monthSel.value;
    const gy = +yearSel.value;
    const gameRight = pickedGame === clip.game;
    const yearRight = gy === ay;
    const monthRight = yearRight && gm === am;
    const pts = (gameRight ? 1 : 0) + (yearRight ? 1 : 0) + (monthRight ? 2 : 0);

    score += pts;
    streak = gameRight ? streak + 1 : 0;
    if (streak > best) {
      best = streak;
      localStorage.setItem('grayscale-arcade-best', best);
    }
    scoreEl.textContent = score;
    streakEl.textContent = streak;
    bestEl.textContent = best;

    const mark = ok => ok
      ? '<span class="verdict-mark ok">✓</span>'
      : '<span class="verdict-mark no">✗</span>';
    const dateMark = monthRight ? mark(true)
      : yearRight ? '<span class="verdict-mark half">½</span>'
      : mark(false);

    revealBox.innerHTML = `
      <div class="reveal-verdict">+${pts} point${pts === 1 ? '' : 's'} — ${VERDICTS[pts]}</div>
      <div class="reveal-row">${mark(gameRight)}<span>It was <strong>${esc(clip.game)}</strong>${gameRight ? '' : ' — you said ' + esc(pickedGame)}.</span></div>
      <div class="reveal-row">${dateMark}<span>Recorded <strong>${fmtMonth(ay, am)}</strong>${monthRight ? '' : ' — you said ' + fmtMonth(gy, gm)}${!monthRight && yearRight ? ' (year’s right)' : ''}.</span></div>
      <div class="reveal-clip">${esc(clip.filename)} · ${clip.date}</div>
      <button class="export arc-primary" id="arc-next">Next clip</button>
    `;
    guessBox.hidden = true;
    replayBtn.hidden = true;
    revealBox.hidden = false;
    // Free the tape: full controls so the whole clip can be watched.
    video.controls = true;
    video.classList.remove('no-touch');
  }

  // ---- wiring ----
  startBtn.addEventListener('click', startRound);
  submitBtn.addEventListener('click', submit);
  replayBtn.addEventListener('click', () => {
    replayBtn.hidden = true;
    video.currentTime = snipStart;
    playSnippet();
  });
  unmuteBtn.addEventListener('click', () => {
    video.muted = false;
    unmuteBtn.hidden = true;
  });
  revealBox.addEventListener('click', e => {
    if (e.target.id === 'arc-next') startRound();
  });

  // Leaving the arcade tab pauses whatever is playing.
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      if (item.dataset.target !== 'arcade-panel' && !video.paused) video.pause();
    });
  });
})();
