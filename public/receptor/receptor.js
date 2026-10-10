// Lado "receptor": se registra en rooms/{roomId}/viewers/{viewerId} y reproduce el stream del emisor.
// Cada receptor tiene su propio nodo de señalización, así que pueden conectarse varios a la vez.
const roomId = getRoomIdFromUrl();
const ROOM_PATH = roomPath(roomId);

const remoteVideo = document.getElementById('remoteVideo');
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const statusEl = document.getElementById('status');

let pc = null; // RTCPeerConnection activa
let base = null; // Referencia a Firebase de este receptor (rooms/{roomId}/viewers/{viewerId})
let wantConnected = false; // true mientras el usuario quiere estar conectado
let session = 0; // Identifica la sesión actual para ignorar eventos de sesiones viejas
let hostActive = false;
let hostWasActive = false;
let retryCount = 0;
let pendingCandidates = []; // ICE candidates del emisor recibidos antes de la oferta

function setStatus(text) {
  statusEl.textContent = text;
}

// Se registra con un id propio y espera la oferta que el emisor le prepare.
async function join() {
  const mySession = ++session;
  const myPc = new RTCPeerConnection(RTC_CONFIG);
  const myBase = db.ref(ROOM_PATH).child('viewers').child(db.ref().push().key);
  pc = myPc;
  base = myBase;
  pendingCandidates = [];
  let answered = false;

  setStatus(hostActive ? 'Connecting to the live signal…' : 'Waiting for the host. You can leave at any time.');

  // Al llegar el stream remoto, lo asigna al elemento de video.
  myPc.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
    setStatus('Receiving transmission.');
  };

  myPc.onconnectionstatechange = () => {
    if (mySession !== session) return;
    setStatus(myPc.connectionState === 'disconnected' ? 'Signal interrupted. Checking the connection…' : 'Connection state: ' + myPc.connectionState);
    document.querySelector('.room-state').classList.toggle('is-receiving', myPc.connectionState === 'connected');
    if (myPc.connectionState === 'connected') retryCount = 0;
    if (myPc.connectionState === 'failed') rejoin();
  };

  // Cada ICE candidate propio se publica en Firebase para que el emisor lo use.
  myPc.onicecandidate = (event) => {
    if (event.candidate) {
      myBase.child('calleeCandidates').push(event.candidate.toJSON());
    }
  };

  // Espera la oferta del emisor, genera la respuesta (answer) y la publica.
  myBase.child('offer').on('value', async (snapshot) => {
    const offer = snapshot.val();
    if (!offer || answered || mySession !== session) return;
    answered = true;

    await myPc.setRemoteDescription(new RTCSessionDescription(offer));
    pendingCandidates.splice(0).forEach((c) => myPc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}));

    const answer = await myPc.createAnswer();
    await myPc.setLocalDescription(answer);
    await myBase.child('answer').set({ type: answer.type, sdp: answer.sdp });

    setStatus('Response sent. Connecting to the broadcaster...');
  });

  // Escucha los ICE candidates que publica el emisor (los guarda hasta tener la oferta).
  myBase.child('callerCandidates').on('child_added', (snapshot) => {
    const candidate = snapshot.val();
    if (!candidate || mySession !== session) return;
    if (myPc.remoteDescription) {
      myPc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
    } else {
      pendingCandidates.push(candidate);
    }
  });

  // "Toca la puerta": al crearse el nodo, el emisor abre una conexión para este receptor.
  // Si el receptor cierra la pestaña, Firebase borra el nodo y el emisor cierra su conexión.
  await myBase.onDisconnect().remove();
  if (mySession !== session) return; // se desconectó mientras se registraba
  await myBase.child('joinedAt').set(firebase.database.ServerValue.TIMESTAMP);
  if (mySession !== session) {
    myBase.remove();
    return;
  }

  // Si el nodo desaparece (emisor detenido/desconectado), se vuelve a unir y espera.
  myBase.child('joinedAt').on('value', (snapshot) => {
    if (!snapshot.exists() && mySession === session && wantConnected) rejoin();
  });
}

// Libera la conexión y el nodo de este receptor.
function teardown() {
  session++; // invalida los callbacks de la sesión anterior

  if (base) {
    base.child('offer').off();
    base.child('callerCandidates').off();
    base.child('joinedAt').off();
    base.onDisconnect().cancel();
    base.remove();
    base = null;
  }

  if (pc) {
    pc.close();
    pc = null;
  }

  remoteVideo.srcObject = null;
  document.querySelector('.room-state').classList.remove('is-receiving');
}

function rejoin() {
  teardown();
  if (++retryCount > 3) { disconnect(); setStatus('Connection interrupted. Select Join to retry.'); return; }
  if (!wantConnected) return;
  setStatus('Signal not found. Waiting for a broadcast...');
  const mySession = session;
  setTimeout(() => {
    if (wantConnected && mySession === session) join().catch(() => { disconnect(); setStatus('Could not reconnect. Select Join to retry.'); });
  }, 1000);
}

function connect() {
  retryCount = 0;
  connectBtn.disabled = true;
  wantConnected = true;
  join().catch(() => { disconnect(); setStatus('Could not join. Check your connection and retry.'); });
  disconnectBtn.disabled = false;
}

function disconnect() {
  disconnectBtn.disabled = true;
  wantConnected = false;
  teardown();
  setStatus('Disconnected.');
  connectBtn.disabled = false;
}

connectBtn.addEventListener('click', connect);
disconnectBtn.addEventListener('click', async () => {
  if (wantConnected) {
    const ok = await confirmAction({
      title: 'Leave the Investigation?',
      body: "You'll stop receiving this transmission and your spot in the room will be released.",
      confirmLabel: 'Leave',
    });
    if (!ok) return;
  }
  disconnect();
});

// --- A partir de aquí: metadatos de sala, chat compartido y acciones. No toca pc/base/session. ---

const liveBadge = document.getElementById('liveBadge');
const offlineBadge = document.getElementById('offlineBadge');
const hostAvatarEl = document.getElementById('hostAvatar');
const streamTitleEl = document.getElementById('streamTitle');
const hostNameEl = document.getElementById('hostName');
const categoryBadgeEl = document.getElementById('categoryBadge');
const viewerCountEl = document.getElementById('viewerCount');
const descriptionEl = document.getElementById('description');
const tagListEl = document.getElementById('tagList');
const saveBtn = document.getElementById('saveBtn');
const shareBtn = document.getElementById('shareBtn');
const recommendedCard = document.getElementById('recommendedCard');
const recommendedList = document.getElementById('recommendedList');

function renderTags(tags) {
  tagListEl.innerHTML = '';
  (Array.isArray(tags) ? tags : []).forEach((tag) => {
    const span = document.createElement('span');
    span.className = 'tag';
    span.textContent = tag;
    tagListEl.appendChild(span);
  });
}

function renderMeta(meta) {
  const active = !!(meta && meta.active);
  hostActive = active;
  const state = document.querySelector('.room-state');
  state.querySelector('strong').textContent = active ? 'A signal is on the air.' : (meta ? 'The transmission has ended.' : 'Waiting for the host.');
  state.querySelector('span').textContent = active ? 'Join the investigation to tune in.' : 'The room discussion stays open.';
  if (hostWasActive && !active && wantConnected) { disconnect(); setStatus('The host ended this transmission. Chat remains open.'); }
  hostWasActive = active;
  const everLive = !!meta; // roomsMeta solo se crea la primera vez que el emisor sale al aire
  liveBadge.hidden = !active;
  offlineBadge.hidden = active;
  streamTitleEl.textContent = (meta && meta.title) || ('Frequency ' + roomId);
  hostNameEl.textContent = (meta && meta.hostName) || 'Anonymous';
  hostAvatarEl.textContent = initialFor(meta && meta.hostName);
  categoryBadgeEl.hidden = !(meta && meta.category);
  if (meta && meta.category) categoryBadgeEl.textContent = meta.category;
  viewerCountEl.textContent = active ? (((meta && meta.viewerCount) || 0) + ' watching') : '';
  descriptionEl.textContent = (meta && meta.description) ||
    (everLive ? 'This transmission has ended.' : "This frequency hasn't gone live yet.");
  renderTags((meta && meta.tags) || []);
}

db.ref('roomsMeta').child(roomId).on('value', (snapshot) => renderMeta(snapshot.val()));

// Save: marcador real por sala en localStorage (no solo un cambio de etiqueta en memoria).
const SAVE_KEY = 'umbral.saved.' + roomId;
function readSaved() {
  try { return localStorage.getItem(SAVE_KEY) === '1'; } catch (err) { return false; }
}
function renderSaveButton(saved) {
  saveBtn.classList.toggle('is-active', saved);
  saveBtn.setAttribute('aria-pressed', String(saved));
  saveBtn.querySelector('svg').style.fill = saved ? 'currentColor' : 'none';
  saveBtn.lastChild.textContent = saved ? ' Saved' : ' Save';
}
renderSaveButton(readSaved());
saveBtn.addEventListener('click', () => {
  const next = !readSaved();
  try { localStorage.setItem(SAVE_KEY, next ? '1' : '0'); } catch (err) {}
  renderSaveButton(next);
});

shareBtn.addEventListener('click', () => shareOrCopy(location.href, shareBtn));

// Lista de otras salas activas (misma forma de lectura que home.js, sin backend adicional).
function buildFrequencyRow(otherId, meta) {
  const row = document.createElement('a');
  row.href = '/receptor?room=' + encodeURIComponent(otherId);
  row.className = 'frequency-row';
  row.innerHTML = `
    <span class="frequency-row__dot" aria-hidden="true"></span>
    <span class="frequency-row__code text-mono"></span>
    <span class="frequency-row__title"></span>
    <span class="badge badge--category frequency-row__category"></span>
    <span class="frequency-row__viewers text-mono"></span>`;
  row.querySelector('.frequency-row__code').textContent = otherId;
  row.querySelector('.frequency-row__title').textContent = meta.title || 'Untitled transmission';
  row.querySelector('.frequency-row__category').textContent = meta.category || 'Uncategorized';
  row.querySelector('.frequency-row__viewers').textContent = (meta.viewerCount || 0) + ' watching';
  return row;
}

const otherRooms = new Map();
function renderRecommended() {
  const entries = [...otherRooms.entries()].filter(([id, meta]) => id !== roomId && meta && meta.active).slice(0, 5);
  recommendedCard.hidden = entries.length === 0;
  recommendedList.innerHTML = '';
  entries.forEach(([id, meta]) => recommendedList.appendChild(buildFrequencyRow(id, meta)));
}
const roomsMetaRef = db.ref('roomsMeta');
roomsMetaRef.on('child_added', (snapshot) => { otherRooms.set(snapshot.key, snapshot.val()); renderRecommended(); });
roomsMetaRef.on('child_changed', (snapshot) => { otherRooms.set(snapshot.key, snapshot.val()); renderRecommended(); });
roomsMetaRef.on('child_removed', (snapshot) => { otherRooms.delete(snapshot.key); renderRecommended(); });

initChat(roomId);
listenForSignalEvents(roomId, document.getElementById('playerFrame'));

guardRoomNavigation(() => wantConnected, disconnect, false);
