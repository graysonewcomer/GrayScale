// GrayScale dashboard behavior: game tabs, tag filter, multi-select + export,
// hover previews, the player modal, and chip-based tagging.
const navItems = document.querySelectorAll('.nav-item');
const panels = document.querySelectorAll('.game-panel');
const searchInput = document.querySelector('.search');
const filterInput = document.querySelector('.filter');
const selCount = document.querySelector('.sel-count');
const exportBtn = document.querySelector('.export');
const statusEl = document.querySelector('.status');
const selected = new Set();

function activePanel() { return document.querySelector('.game-panel.active'); }

function applyFilter() {
  const panel = activePanel();
  if (!panel) return;
  const qName = searchInput.value.trim().toLowerCase();
  const qTag = filterInput.value.trim().toLowerCase();
  panel.querySelectorAll('.card').forEach(card => {
    const nameOk = !qName || (card.dataset.name || '').includes(qName);
    const tags = card.dataset.tags || '';
    const tagOk = !qTag || tags.split(',').some(t => t.includes(qTag));
    card.classList.toggle('hidden', !(nameOk && tagOk));
  });
}

function refreshSelCount() {
  selCount.textContent = selected.size + ' selected';
  selCount.classList.toggle('has-sel', selected.size > 0);
  exportBtn.disabled = selected.size === 0;
}

// Sidebar navigation — clears selection + filter for the new game
navItems.forEach(item => {
  item.addEventListener('click', () => {
    navItems.forEach(n => n.classList.remove('active'));
    panels.forEach(p => p.classList.remove('active'));
    item.classList.add('active');
    document.getElementById(item.dataset.target).classList.add('active');
    selected.clear();
    document.querySelectorAll('.card.selected').forEach(c => c.classList.remove('selected'));
    statusEl.textContent = '';
    applyFilter();
    refreshSelCount();
  });
});

searchInput.addEventListener('input', applyFilter);
filterInput.addEventListener('input', applyFilter);

// Multi-select: click the thumbnail to toggle selection
document.querySelectorAll('.thumb-wrap').forEach(wrap => {
  wrap.addEventListener('click', () => {
    const card = wrap.closest('.card');
    const id = card.dataset.clip;
    if (selected.has(id)) { selected.delete(id); card.classList.remove('selected'); }
    else { selected.add(id); card.classList.add('selected'); }
    refreshSelCount();
  });
});

// Hover-to-preview: muted, looping inline playback after a short delay.
// One preview video at a time; created on hover, torn down on leave.
document.querySelectorAll('.thumb-wrap').forEach(wrap => {
  let timer = null;
  let vid = null;

  const teardown = () => {
    clearTimeout(timer);
    timer = null;
    if (vid) { vid.pause(); vid.removeAttribute('src'); vid.load(); vid.remove(); vid = null; }
  };

  wrap.addEventListener('mouseenter', () => {
    const id = wrap.closest('.card').dataset.clip;
    timer = setTimeout(() => {
      vid = document.createElement('video');
      vid.className = 'preview-video';
      vid.muted = true;
      vid.loop = true;
      vid.playsInline = true;
      vid.preload = 'auto';
      vid.src = '/video/' + id;
      vid.addEventListener('playing', () => vid && vid.classList.add('ready'), { once: true });
      wrap.appendChild(vid);
      vid.play().catch(() => {});
    }, 350);
  });

  wrap.addEventListener('mouseleave', teardown);
});

// In-app player modal
const player = document.getElementById('player');
const playerVideo = document.getElementById('player-video');
const playerTitle = document.getElementById('player-title');
const playerSub = document.getElementById('player-sub');
const playerChips = document.getElementById('player-chips');
const playerPrev = document.getElementById('player-prev');
const playerNext = document.getElementById('player-next');
const playerClose = document.querySelector('.player-close');
let playlist = [];   // cards currently playable via prev/next
let playIndex = -1;

function loadClip(card) {
  const id = card.dataset.clip;
  playerVideo.src = '/video/' + id;
  playerVideo.play().catch(() => {});
  playerTitle.textContent = card.querySelector('.name').textContent;
  playerSub.textContent = card.querySelector('.sub').textContent;
  playerChips.innerHTML = '';
  card.querySelectorAll('.chip').forEach(chip => {
    const span = document.createElement('span');
    span.className = 'chip';
    span.textContent = chip.dataset.tag;  // read-only: no × in the player
    const tc = chip.style.getPropertyValue('--tc');
    if (tc) span.style.setProperty('--tc', tc);
    playerChips.appendChild(span);
  });
  playerPrev.disabled = playIndex <= 0;
  playerNext.disabled = playIndex >= playlist.length - 1;
}

function openPlayer(card) {
  // Playlist = visible clips in the active panel, in DOM order.
  const panel = activePanel();
  playlist = [...panel.querySelectorAll('.card')].filter(c => !c.classList.contains('hidden'));
  playIndex = playlist.indexOf(card);
  player.classList.add('open');
  loadClip(card);
}

function closePlayer() {
  player.classList.remove('open');
  playerVideo.pause();
  playerVideo.removeAttribute('src');
  playerVideo.load();
}

function step(delta) {
  const next = playIndex + delta;
  if (next < 0 || next >= playlist.length) return;
  playIndex = next;
  loadClip(playlist[playIndex]);
}

document.querySelectorAll('.play-btn').forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();  // don't toggle selection
    openPlayer(btn.closest('.card'));
  });
});

playerPrev.addEventListener('click', () => step(-1));
playerNext.addEventListener('click', () => step(1));
playerClose.addEventListener('click', closePlayer);
player.addEventListener('click', e => { if (e.target === player) closePlayer(); });

document.addEventListener('keydown', e => {
  if (!player.classList.contains('open')) return;
  if (e.key === 'Escape') closePlayer();
  else if (e.key === 'ArrowLeft') step(-1);
  else if (e.key === 'ArrowRight') step(1);
});

// Export Set — copies selected clips into a new folder you name
exportBtn.addEventListener('click', async () => {
  if (selected.size === 0) return;
  const name = prompt('Name the export folder:');
  if (!name) return;
  statusEl.style.color = 'var(--muted)';
  statusEl.textContent = 'Copying…';
  const res = await fetch('/api/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clip_ids: [...selected], folder_name: name }),
  });
  const data = await res.json();
  if (!res.ok) {
    statusEl.style.color = 'var(--danger)';
    statusEl.textContent = data.error || 'Export failed.';
    return;
  }
  statusEl.style.color = 'var(--green)';
  statusEl.textContent = `Copied ${data.copied_count} clip(s) → ${data.folder}`;
});

// Tagging: chips + a "+ tag" reveal input. Add appends, × removes.
// The client always sends the full desired tag set; the server replaces.
function chipsEl(id) { return document.getElementById('chips-' + id); }
function tagInputEl(id) { return document.querySelector('.tag-input[data-clip="' + id + '"]'); }
function currentTags(id) {
  return [...chipsEl(id).querySelectorAll('.chip')].map(c => c.dataset.tag);
}

function renderChips(id, tags, colors) {
  const chips = chipsEl(id);
  chips.innerHTML = '';
  tags.forEach(t => {
    const span = document.createElement('span');
    span.className = 'chip';
    span.dataset.tag = t;
    const tc = colors && colors[t.toLowerCase()];
    if (tc) span.style.setProperty('--tc', tc);
    span.appendChild(document.createTextNode(t));
    const x = document.createElement('button');
    x.className = 'chip-x';
    x.type = 'button';
    x.title = 'Remove tag';
    x.setAttribute('aria-label', 'Remove tag');
    x.textContent = '×';
    span.appendChild(x);
    chips.appendChild(span);
  });
  const add = document.createElement('button');
  add.className = 'add-tag';
  add.type = 'button';
  add.dataset.clip = id;
  add.textContent = '+ tag';
  chips.appendChild(add);
  chips.closest('.card').dataset.tags = tags.join(',').toLowerCase();
}

async function commitTags(id, tags) {
  const res = await fetch('/api/tags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clip_id: id, tags: tags.join(',') }),
  });
  if (!res.ok) return;
  const data = await res.json();  // server normalizes + de-dupes
  renderChips(id, data.tags, data.colors);
  applyFilter();
}

function addTags(id, raw) {
  const merged = currentTags(id).concat(raw.split(','));
  commitTags(id, merged.map(s => s.trim()).filter(Boolean));
}
function removeTag(id, tag) {
  commitTags(id, currentTags(id).filter(t => t !== tag));
}

// Delegated clicks: works for server-rendered and re-rendered chips alike.
document.querySelector('.content').addEventListener('click', e => {
  const x = e.target.closest('.chip-x');
  if (x) {
    const chip = x.closest('.chip');
    const id = chip.closest('.chips').id.replace('chips-', '');
    removeTag(id, chip.dataset.tag);
    return;
  }
  const add = e.target.closest('.add-tag');
  if (add) {
    const input = tagInputEl(add.dataset.clip);
    input.hidden = false;
    input.focus();
  }
});

document.querySelectorAll('.tag-input').forEach(input => {
  input.addEventListener('keydown', e => {
    // Read the id at event time: a rename re-keys the card's clip id.
    const id = input.dataset.clip;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (input.value.trim()) addTags(id, input.value);
      input.value = '';  // ready for the next tag; stays open
    } else if (e.key === 'Escape') {
      input.value = '';
      input.hidden = true;
    }
  });
  // Blur hides the box only when it's empty (a pending tag is kept visible).
  input.addEventListener('blur', () => { if (!input.value.trim()) input.hidden = true; });
});

// Rename in-app: pencil icon swaps the name for an input. The stem is
// edited; the extension is preserved server-side. Enter/blur commit, Esc
// cancels. A rename mints a new clip id, so every id hook is re-keyed.
document.querySelectorAll('.card').forEach(card => {
  const btn = card.querySelector('.rename-btn');
  if (!btn) return;
  const nameRow = card.querySelector('.name-row');
  const nameEl = card.querySelector('.name');
  const input = card.querySelector('.name-input');
  let busy = false;

  const stemOf = file => {
    const dot = file.lastIndexOf('.');
    return dot > 0 ? file.slice(0, dot) : file;
  };

  const open = () => {
    input.value = stemOf(nameEl.textContent);
    nameRow.hidden = true;
    input.hidden = false;
    input.focus();
    input.select();
  };

  const close = () => {
    input.hidden = true;
    nameRow.hidden = false;
  };

  const commit = async () => {
    if (busy) return;
    const stem = input.value.trim();
    if (!stem || stem === stemOf(nameEl.textContent)) { close(); return; }
    busy = true;
    try {
      const res = await fetch('/api/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clip_id: card.dataset.clip, name: stem }),
      });
      const data = await res.json();
      if (!res.ok) {
        statusEl.style.color = 'var(--danger)';
        statusEl.textContent = data.error || 'Rename failed.';
        return;
      }
      const oldId = card.dataset.clip;
      if (selected.has(oldId)) { selected.delete(oldId); selected.add(data.id); }
      card.dataset.clip = data.id;
      card.dataset.name = data.filename.toLowerCase();
      card.querySelector('.chips').id = 'chips-' + data.id;
      const addBtn = card.querySelector('.add-tag');
      if (addBtn) addBtn.dataset.clip = data.id;
      card.querySelector('.tag-input').dataset.clip = data.id;
      nameEl.textContent = data.filename;
      nameEl.title = data.filename;
      statusEl.style.color = 'var(--green)';
      statusEl.textContent = 'Renamed.';
      applyFilter();
    } finally {
      busy = false;
      close();
    }
  };

  btn.addEventListener('click', open);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') close();
  });
  input.addEventListener('blur', () => { if (!input.hidden) commit(); });
});
