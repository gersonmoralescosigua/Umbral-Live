// Home page: one shared roomsMeta subscription feeds the hero, Discover, Active Signals,
// Archive (ended broadcasts — roomsMeta entries are never deleted, only active flips) and
// Saved Signals (cross-referenced against the real per-room localStorage bookmarks).
const hero = document.getElementById('hero');
const heroContent = document.getElementById('heroContent');
const discoverGrid = document.getElementById('discoverGrid');
const frequencyList = document.getElementById('frequencyList');
const frequencyCount = document.getElementById('frequencyCount');
const emptyState = document.getElementById('emptyState');
const archiveList = document.getElementById('archiveList');
const archiveEmpty = document.getElementById('archiveEmpty');
const savedList = document.getElementById('savedList');
const savedEmpty = document.getElementById('savedEmpty');

const rooms = new Map(); // roomId -> meta (active and ended both live here)
let activeCategory = '';

const CATEGORY_INFO = [
  { name: 'Sightings', desc: 'Eyewitness accounts, live or recent.' },
  { name: 'Legends', desc: 'Stories passed down, still unresolved.' },
  { name: 'Case Files', desc: 'Structured investigations with evidence.' },
  { name: 'Historical Mysteries', desc: 'Events the record never explained.' },
  { name: 'Cosmic Phenomena', desc: 'Signals, lights, and things overhead.' },
  { name: "Skeptic's Table", desc: 'Where claims get pressure-tested.' },
];

function activeRooms() {
  return [...rooms.entries()].filter(([, m]) => m && m.active);
}
function endedRooms() {
  return [...rooms.entries()]
    .filter(([, m]) => m && !m.active)
    .sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0))
    .slice(0, 20);
}
function timeAgo(ts) {
  if (!ts) return '';
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + 'h ago';
  return Math.floor(hours / 24) + 'd ago';
}

function getSavedRoomIds() {
  const ids = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.indexOf('umbral.saved.') === 0 && localStorage.getItem(key) === '1') {
        ids.push(key.slice('umbral.saved.'.length));
      }
    }
  } catch (err) { /* localStorage inaccesible: Saved queda vacío, no rompe el resto de la página */ }
  return ids;
}
function setSaved(roomId, saved) {
  try { localStorage.setItem('umbral.saved.' + roomId, saved ? '1' : '0'); } catch (err) {}
}

// Fila compartida por Active Signals, Archive y Saved — misma forma visual, distinto estado.
function buildSignalRow(roomId, meta, opts) {
  opts = opts || {};
  const row = document.createElement('a');
  row.href = '/receptor?room=' + encodeURIComponent(roomId);
  row.className = 'frequency-row' + (opts.ended ? ' is-ended' : '');
  row.dataset.category = meta.category || '';
  row.innerHTML = `
    ${opts.ended
      ? '<span class="badge badge--offline frequency-row__status">Ended</span>'
      : '<span class="frequency-row__dot" aria-hidden="true"></span>'}
    <span class="frequency-row__code text-mono"></span>
    <span class="frequency-row__title"></span>
    <span class="badge badge--category frequency-row__category"></span>
    <span class="frequency-row__viewers text-mono"></span>
    ${opts.removable ? '<button type="button" class="frequency-row__remove" aria-label="Remove from saved">✕</button>' : ''}`;
  // Título, categoría y alias vienen de lo que escribió el emisor: siempre por textContent.
  row.querySelector('.frequency-row__code').textContent = roomId;
  row.querySelector('.frequency-row__title').textContent = meta.title || 'Untitled transmission';
  row.querySelector('.frequency-row__category').textContent = meta.category || 'Uncategorized';
  row.querySelector('.frequency-row__viewers').textContent = opts.ended
    ? (meta.endedAt ? 'ended ' + timeAgo(meta.endedAt) : 'offline')
    : (meta.viewerCount || 0) + ' watching';
  if (opts.removable) {
    row.querySelector('.frequency-row__remove').addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      setSaved(roomId, false);
      renderSaved();
    });
  }
  return row;
}

function renderHero() {
  const top = activeRooms().sort((a, b) => (b[1].viewerCount || 0) - (a[1].viewerCount || 0))[0];
  hero.classList.toggle('has-signal', !!top);
  hero.classList.toggle('no-signal', !top);

  if (!top) {
    heroContent.innerHTML = `
      <div class="hero__status"><span class="hero__status-dot"></span><span>Searching for a signal</span></div>
      <p class="hero__eyebrow">Umbral Live</p>
      <h1>Some signals deserve a second listen.</h1>
      <p class="hero__sub">A light across the water. A voice in the static. Join a live investigation at the edge of what we know. Bring your evidence. Bring your doubt.</p>
      <div class="hero__actions">
        <a class="btn" href="/emisor">Open a Frequency</a>
        <a class="btn btn--ghost" href="#archive">Browse the Archive</a>
      </div>
      <p class="hero__teaser text-mono text-dim" id="heroTeaser"></p>`;
    const lastEnded = endedRooms()[0];
    const teaserEl = heroContent.querySelector('#heroTeaser');
    if (lastEnded) {
      teaserEl.textContent = 'Last signal: ' + (lastEnded[1].title || 'Untitled transmission') + ' — ' + timeAgo(lastEnded[1].createdAt);
    } else {
      teaserEl.remove();
    }
    return;
  }

  const [topId, topMeta] = top;
  heroContent.innerHTML = `
    <div class="hero__status"><span class="hero__status-dot"></span><span>Signal locked</span></div>
    <span class="badge badge--live">Live</span>
    <p class="hero__eyebrow"></p>
    <h1></h1>
    <p class="hero__sub"></p>
    <div class="hero__actions">
      <a class="btn" id="heroJoin">Join the Investigation</a>
      <a class="btn btn--ghost" href="#active">See all active signals</a>
    </div>
    <span class="hero__meta text-mono"></span>`;
  heroContent.querySelector('.hero__eyebrow').textContent = (topMeta.category || 'Umbral Live') + ' · hosted by ' + (topMeta.hostName || 'Anonymous');
  heroContent.querySelector('h1').textContent = topMeta.title || 'Untitled transmission';
  heroContent.querySelector('.hero__sub').textContent = topMeta.description || '';
  heroContent.querySelector('#heroJoin').href = '/receptor?room=' + encodeURIComponent(topId);
  heroContent.querySelector('.hero__meta').textContent = (topMeta.viewerCount || 0) + ' watching · ' + topId;
}

function renderDiscover() {
  const counts = {};
  activeRooms().forEach(([, m]) => { counts[m.category] = (counts[m.category] || 0) + 1; });
  discoverGrid.innerHTML = '';
  CATEGORY_INFO.forEach((cat, index) => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.dataset.index = '0' + (index + 1);
    tile.setAttribute('aria-pressed', String(activeCategory === cat.name));
    tile.className = 'discover-tile' + (activeCategory === cat.name ? ' is-active' : '');
    tile.innerHTML = `
      <p class="discover-tile__name"></p>
      <p class="discover-tile__desc"></p>
      <p class="discover-tile__count"></p>`;
    tile.querySelector('.discover-tile__name').textContent = cat.name;
    tile.querySelector('.discover-tile__desc').textContent = cat.desc;
    const n = counts[cat.name] || 0;
    tile.querySelector('.discover-tile__count').textContent = n + (n === 1 ? ' active signal' : ' active signals');
    tile.addEventListener('click', () => {
      activeCategory = activeCategory === cat.name ? '' : cat.name;
      render();
      const target = document.getElementById('active');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    discoverGrid.appendChild(tile);
  });
}

function renderSaved() {
  const ids = getSavedRoomIds();
  savedList.innerHTML = '';
  let shown = 0;
  ids.forEach((id) => {
    const meta = rooms.get(id);
    if (!meta) return;
    savedList.appendChild(buildSignalRow(id, meta, { ended: !meta.active, removable: true }));
    shown++;
  });
  savedEmpty.hidden = shown > 0;
  savedList.hidden = shown === 0;
}

function render() {
  renderHero();
  renderDiscover();

  const active = activeRooms();
  const visibleActive = active.filter(([, m]) => !activeCategory || m.category === activeCategory);
  frequencyList.innerHTML = '';
  visibleActive.forEach(([id, m]) => frequencyList.appendChild(buildSignalRow(id, m, {})));
  emptyState.hidden = visibleActive.length > 0;
  frequencyList.hidden = visibleActive.length === 0;
  frequencyCount.textContent = active.length ? active.length + ' open' : '';

  const ended = endedRooms();
  archiveList.innerHTML = '';
  ended.forEach(([id, m]) => archiveList.appendChild(buildSignalRow(id, m, { ended: true })));
  archiveEmpty.hidden = ended.length > 0;
  archiveList.hidden = ended.length === 0;

  renderSaved();
}

const roomsMetaRef = db.ref('roomsMeta');
roomsMetaRef.on('child_added', (snapshot) => { rooms.set(snapshot.key, snapshot.val()); render(); });
roomsMetaRef.on('child_changed', (snapshot) => { rooms.set(snapshot.key, snapshot.val()); render(); });
roomsMetaRef.on('child_removed', (snapshot) => { rooms.delete(snapshot.key); render(); });

window.addEventListener('storage', renderSaved);
render(); // initial (empty) render while Firebase data arrives
