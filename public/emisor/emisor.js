// Lado "emisor": captura cámara/micrófono local y los transmite a varios receptores vía WebRTC.
// Se abre un RTCPeerConnection por receptor; la señalización de cada uno vive en
// rooms/{roomId}/viewers/{viewerId}/{offer,answer,callerCandidates,calleeCandidates}.
// Los metadatos de la sala viven aparte en roomsMeta/{roomId}; el chat en roomChat/{roomId}/messages;
// el evento de señal en roomEvents/{roomId}/latest.
// Flujo en tres fases: Setup -> Start Preview (cámara local, nadie puede unirse todavía) ->
// Open Frequency (en vivo: el panel de configuración se convierte en un drawer, aparece la franja
// en vivo y el chat se ancla junto al video).
const localVideo = document.getElementById('localVideo');
const localScreenVideo = document.getElementById('localScreenVideo');
const statusEl = document.getElementById('status');
const previewFrame = document.getElementById('previewFrame');
const cameraOffPlaceholder = document.getElementById('cameraOffPlaceholder');
const broadcastLayout = document.getElementById('broadcastLayout');

const setupForm = document.getElementById('setupForm');
const setupCard = document.getElementById('setupCard');
const roomIdInput = document.getElementById('roomIdInput');
const regenerateRoomBtn = document.getElementById('regenerateRoomBtn');
const titleInput = document.getElementById('titleInput');
const categorySelect = document.getElementById('categorySelect');
const hostNameInput = document.getElementById('hostNameInput');
const descriptionInput = document.getElementById('descriptionInput');
const tagsInput = document.getElementById('tagsInput');
const detailFields = [titleInput, categorySelect, hostNameInput, descriptionInput, tagsInput];
const roomLockFields = [roomIdInput, regenerateRoomBtn];
const saveDetailsBtn = document.getElementById('saveDetailsBtn');
const drawerCloseBtn = document.getElementById('drawerCloseBtn');
const drawerBackdrop = document.getElementById('drawerBackdrop');

const mediaToggles = document.getElementById('mediaToggles');
const micToggleBtn = document.getElementById('micToggleBtn');
const cameraToggleBtn = document.getElementById('cameraToggleBtn');
const screenToggleBtn = document.getElementById('screenToggleBtn');
const anomalyBtn = document.getElementById('anomalyBtn');
const reactionLayer = document.getElementById('reactionLayer');
let releaseReactions = () => {}; // libera el listener de reacciones al terminar la transmisión

const startPreviewBtn = document.getElementById('startPreviewBtn');
const openFrequencyBtn = document.getElementById('openFrequencyBtn');
const cancelPreviewBtn = document.getElementById('cancelPreviewBtn');

const roomWarning = document.getElementById('roomWarning');
const newFrequencyBtn = document.getElementById('newFrequencyBtn');

const liveStrip = document.getElementById('liveStrip');
const liveStripCode = document.getElementById('liveStripCode');
const liveStripViewers = document.getElementById('liveStripViewers');
const editDetailsBtn = document.getElementById('editDetailsBtn');
const shareBtn = document.getElementById('shareBtn');
const endTransmissionBtn = document.getElementById('endTransmissionBtn');
const liveShareRow = document.getElementById('liveShareRow');
const shareLink = document.getElementById('shareLink');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const localhostNote = document.getElementById('localhostNote');
const chatCard = document.getElementById('chatCard');

let previewRequest = 0;
let opening = false;
let ending = false;
let localStream = null; // Stream de cámara/micrófono local (se captura una sola vez, en el preview)
let screenStream = null; // Stream de la pantalla compartida; null mientras no se comparte
// Stream "vacío" que solo da identidad (msid) al video de pantalla de cada conexión.
const screenOutStream = new MediaStream();
let viewersRef = null; // Referencia a Firebase con todos los receptores (rooms/{roomId}/viewers)
let metaRef = null; // Referencia a roomsMeta/{roomId}, solo mientras se está en vivo
let roomId = null; // Sala actual, fijada al abrir la frecuencia (no al iniciar el preview)
let ROOM_PATH = null;
const peers = new Map(); // viewerId -> { pc, base, pending } (una conexión por receptor)

function setStatus(text, isError) {
  statusEl.textContent = text;
  statusEl.classList.toggle('is-error', !!isError);
}

function updateStatus() {
  const connected = [...peers.values()].filter((p) => p.pc.connectionState === 'connected').length;
  setStatus(`Broadcasting to ${connected} viewer(s). Waiting for more connections...`);
  liveStripViewers.textContent = connected + (connected === 1 ? ' viewer' : ' viewers');
  if (metaRef) metaRef.child('viewerCount').set(connected).catch(() => {});
}

// Agrega un ICE candidate del receptor; si aún no hay answer, lo guarda para después.
function addCandidate(peer, candidate) {
  if (!peer.pc.remoteDescription) {
    peer.pending.push(candidate);
    return;
  }
  peer.pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
}

// Crea la conexión dedicada a un receptor y le envía la oferta.
async function addViewer(id) {
  if (!localStream || peers.has(id)) return;

  const base = viewersRef.child(id);
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const peer = { pc, base, pending: [] };
  peers.set(id, peer);

  // Todos los receptores comparten las mismas pistas (la cámara se captura una vez).
  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  // La pantalla viaja en un segundo video, creado desde la oferta inicial (siempre el último
  // m-line de video: el receptor lo reconoce por su posición). Se activa y se apaga con
  // replaceTrack, así no hace falta renegociar WebRTC al empezar o parar de compartir.
  const screenTransceiver = pc.addTransceiver('video', { direction: 'sendonly', streams: [screenOutStream] });
  peer.screenSender = screenTransceiver.sender;
  if (screenStream) peer.screenSender.replaceTrack(screenStream.getVideoTracks()[0]).catch(() => {});

  // Canal de datos para avisar al receptor del estado de la escena (pantalla / cámara encendidas).
  peer.channel = pc.createDataChannel('layout');
  peer.channel.onopen = () => sendLayoutState([peer]);

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      base.child('callerCandidates').push(event.candidate.toJSON());
    }
  };

  pc.onconnectionstatechange = () => {
    // Si la conexión falla, se borra el nodo: el receptor lo detecta y se vuelve a unir.
    if (pc.connectionState === 'failed') base.remove();
    updateStatus();
  };

  // Limpia restos de una sesión anterior de este mismo receptor.
  await Promise.all(
    ['offer', 'answer', 'callerCandidates', 'calleeCandidates'].map((key) => base.child(key).remove())
  );
  if (peers.get(id) !== peer) return; // el receptor se fue mientras se limpiaba

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await base.child('offer').set({ type: offer.type, sdp: offer.sdp });

  // Espera la respuesta (answer) de ESTE receptor.
  base.child('answer').on('value', async (snapshot) => {
    const answer = snapshot.val();
    if (answer && !pc.remoteDescription) {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      peer.pending.splice(0).forEach((c) => addCandidate(peer, c));
    }
  });

  // Escucha los ICE candidates de ESTE receptor.
  base.child('calleeCandidates').on('child_added', (snapshot) => {
    const candidate = snapshot.val();
    if (candidate) addCandidate(peer, candidate);
  });
}

// Cierra solo la conexión de un receptor que se fue.
function removeViewer(id) {
  const peer = peers.get(id);
  if (!peer) return;
  peers.delete(id);
  peer.base.child('answer').off();
  peer.base.child('calleeCandidates').off();
  peer.pc.close();
  updateStatus();
}

// Mensajes legibles para los errores más comunes de getUserMedia.
function describeMediaError(err) {
  const messages = {
    NotAllowedError: 'Permission denied. Enable camera and microphone access for this site and try again.',
    NotFoundError: 'No camera or microphone was found on this device.',
    NotReadableError: 'Your camera or microphone is already in use by another application.',
    OverconstrainedError: "Your camera doesn't support the requested configuration.",
  };
  return messages[err.name] || ('Could not access camera or microphone: ' + err.message);
}

// Limpia el código de sala escrito a mano y confirma que sea válido.
function readRoomId() {
  const cleaned = slugify(roomIdInput.value);
  if (!isValidRoomId(cleaned)) return null;
  roomIdInput.value = cleaned;
  return cleaned;
}

function setToggleState(button, isOff, offLabel, onLabel) {
  button.querySelector('.icon-on').hidden = isOff;
  button.querySelector('.icon-off').hidden = !isOff;
  button.querySelector('.toggle-btn__label').textContent = isOff ? offLabel : onLabel;
  button.classList.toggle('is-off', isOff);
  button.setAttribute('aria-pressed', String(isOff));
}

// Controles reales: cambian MediaStreamTrack.enabled del stream ya capturado, sin renegociar WebRTC.
function toggleMic() {
  const track = localStream && localStream.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  setToggleState(micToggleBtn, !track.enabled, 'Mic Off', 'Mic');
}

function toggleCamera() {
  const track = localStream && localStream.getVideoTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  setToggleState(cameraToggleBtn, !track.enabled, 'Camera Off', 'Camera');
  renderStage();
  sendLayoutState();
}

// Activa (track) o apaga (null) el video de pantalla de todas las conexiones, sin renegociar WebRTC.
function setScreenTrack(track) {
  peers.forEach(({ screenSender }) => {
    if (screenSender) screenSender.replaceTrack(track).catch(() => {});
  });
}

function cameraIsOn() {
  const camera = localStream && localStream.getVideoTracks()[0];
  return !!(camera && camera.enabled);
}

// Estado de la escena que ven los receptores: ¿hay pantalla? ¿hay cámara?
function sendLayoutState(targets = [...peers.values()]) {
  const message = JSON.stringify({ type: 'layout', screen: !!screenStream, camera: cameraIsOn() });
  targets.forEach((peer) => {
    if (peer.channel && peer.channel.readyState === 'open') peer.channel.send(message);
  });
}

// Preview del emisor: misma escena que verán los receptores (pantalla grande + cámara en cuadrito).
function renderStage() {
  applyStageLayout({
    cameraEl: localVideo, screenEl: localScreenVideo, offEl: cameraOffPlaceholder,
    sharing: !!screenStream, cameraOn: cameraIsOn(), swapped: false,
  });
}

// Compartir pantalla: cámara y pantalla salen a la vez. El micrófono sigue siendo el audio.
async function startScreenShare() {
  if (screenStream || !localStream) return;
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: false });
  } catch (err) {
    const cancelled = err.name === 'NotAllowedError';
    setStatus(cancelled ? 'Screen sharing was cancelled.' : 'Could not share your screen: ' + err.message, !cancelled);
    return;
  }
  if (!localStream) { stream.getTracks().forEach((track) => track.stop()); return; } // se canceló el preview mientras elegía
  const track = stream.getVideoTracks()[0];
  track.contentHint = 'detail'; // prioriza nitidez del texto sobre fluidez
  track.addEventListener('ended', stopScreenShare); // botón nativo "Dejar de compartir" del navegador
  screenStream = stream;
  setScreenTrack(track);
  localScreenVideo.srcObject = stream;
  renderStage();
  sendLayoutState();
  setToggleState(screenToggleBtn, true, 'Stop Sharing', 'Share Screen');
  setStatus('Sharing your screen. Viewers see it live.');
}

function stopScreenShare() {
  if (!screenStream) return;
  const stream = screenStream;
  screenStream = null;
  sendLayoutState(); // primero se avisa a los receptores, luego se corta el video
  setScreenTrack(null);
  stream.getTracks().forEach((track) => track.stop());
  localScreenVideo.srcObject = null;
  renderStage();
  setToggleState(screenToggleBtn, false, 'Stop Sharing', 'Share Screen');
  setStatus('Screen sharing stopped.');
}

function toggleScreenShare() {
  if (screenStream) stopScreenShare(); else startScreenShare();
}

async function startPreview() {
  if (localStream || !setupForm.reportValidity()) return;
  if (!readRoomId()) {
    setStatus('Frequency code must be 3–40 letters, numbers or hyphens.', true);
    return;
  }
  const request = ++previewRequest;
  startPreviewBtn.disabled = true;
  startPreviewBtn.classList.add('is-loading');
  cancelPreviewBtn.hidden = false;
  setStatus('Allow camera and microphone access in your browser, or cancel.');
  try {
    if (!navigator.mediaDevices) throw { name: 'NotAllowedError', message: 'A secure connection is required.' };
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    if (request !== previewRequest) { stream.getTracks().forEach(track => track.stop()); return; }
    localStream = stream;
  } catch (err) {
    if (request !== previewRequest) return;
    setStatus(describeMediaError(err), true);
    cancelPreviewBtn.hidden = true;
    startPreviewBtn.disabled = false;
    startPreviewBtn.classList.remove('is-loading');
    return;
  }
  startPreviewBtn.classList.remove('is-loading');
  localVideo.srcObject = localStream;
  previewFrame.classList.add('has-media');
  setToggleState(micToggleBtn, false, 'Mic Off', 'Mic');
  setToggleState(cameraToggleBtn, false, 'Camera Off', 'Camera');
  renderStage();
  micToggleBtn.onclick = toggleMic;
  cameraToggleBtn.onclick = toggleCamera;
  // getDisplayMedia no existe en la mayoría de navegadores móviles: ahí el botón no se muestra.
  screenToggleBtn.hidden = !(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
  setToggleState(screenToggleBtn, false, 'Stop Sharing', 'Share Screen');
  screenToggleBtn.onclick = toggleScreenShare;
  mediaToggles.hidden = false;
  startPreviewBtn.hidden = true;
  openFrequencyBtn.hidden = false;
  openFrequencyBtn.disabled = false;
  cancelPreviewBtn.hidden = false;
  setStatus("Preview ready. Viewers can't see this yet.");
}

// Preview ready -> en vivo: valida disponibilidad de la sala y recién ahí escribe en Firebase.
async function openFrequency() {
  if (opening || !localStream || metaRef || !setupForm.reportValidity()) return;
  const chosenRoomId = readRoomId();
  if (!chosenRoomId) {
    setStatus('Frequency code must be 3–40 letters, numbers or hyphens.', true);
    return;
  }
  opening = true;
  openFrequencyBtn.disabled = true;
  cancelPreviewBtn.disabled = true;
  roomLockFields.forEach(field => { field.disabled = true; });
  openFrequencyBtn.classList.add('is-loading');
  roomWarning.hidden = true;
  let nextMeta = null;
  let nextViewers = null;
  try {
    const activeSnap = await db.ref('roomsMeta').child(chosenRoomId).child('active').once('value');
    if (activeSnap.val() === true) {
      roomWarning.hidden = false;
      setStatus('This frequency already has a host. Choose a new code.', true);
      return;
    }
    roomId = chosenRoomId;
    ROOM_PATH = roomPath(roomId);
    nextMeta = db.ref('roomsMeta').child(roomId);
    nextViewers = db.ref(ROOM_PATH).child('viewers');
    // Register disconnect cleanup before publishing the room as active.
    await nextMeta.child('active').onDisconnect().set(false);
    await nextViewers.onDisconnect().remove();
    const tags = tagsInput.value.split(',').map(t => t.trim()).filter(Boolean).slice(0, 5);
    await nextMeta.set({
      title: titleInput.value.trim(), category: categorySelect.value,
      description: descriptionInput.value.trim(), tags,
      hostName: hostNameInput.value.trim() || getAlias() || 'Anonymous',
      active: true, viewerCount: 0, createdAt: firebase.database.ServerValue.TIMESTAMP,
    });
    metaRef = nextMeta;
    viewersRef = nextViewers;
    history.replaceState(null, '', '/emisor?room=' + encodeURIComponent(roomId));
    viewersRef.on('child_added', snapshot => {
      addViewer(snapshot.key).catch(() => {
        removeViewer(snapshot.key);
        setStatus('A viewer could not connect. They can leave and retry.', true);
      });
    });
    viewersRef.on('child_removed', snapshot => removeViewer(snapshot.key));
    openFrequencyBtn.hidden = true;
    cancelPreviewBtn.hidden = true;
    anomalyBtn.hidden = false;
    broadcastLayout.dataset.live = 'true';
    setupCard.classList.add('is-drawer');
    setupCard.inert = true;
    drawerCloseBtn.hidden = false;
    saveDetailsBtn.hidden = false;
    liveStrip.hidden = false;
    liveStripCode.textContent = roomId;
    liveStripViewers.textContent = '0 viewers';
    shareLink.value = location.origin + '/receptor?room=' + encodeURIComponent(roomId);
    liveShareRow.hidden = false;
    localhostNote.hidden = !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    chatCard.hidden = false;
    initChat(roomId);
    releaseReactions();
    releaseReactions = listenForReactions(roomId, reactionLayer);
    window.addEventListener('beforeunload', handleBeforeUnload);
    setStatus('Broadcasting. Waiting for the first viewer.');
  } catch (err) {
    if (nextViewers) { nextViewers.off(); nextViewers.onDisconnect().cancel().catch(() => {}); }
    if (nextMeta) {
      nextMeta.update({ active: false, viewerCount: 0 }).catch(() => {});
    }
    metaRef = null; viewersRef = null; roomId = null;
    setStatus('Could not open this frequency. Check your connection and database access, then retry.', true);
  } finally {
    opening = false;
    openFrequencyBtn.disabled = false;
    cancelPreviewBtn.disabled = false;
    roomLockFields.forEach(field => { field.disabled = !!metaRef; });
    openFrequencyBtn.classList.remove('is-loading');
  }
}

// Cancela el preview sin haber salido al aire (no toca Firebase: todavía no se escribió nada).
function stopPreviewOnly() {
  if (opening) return;
  previewRequest++;
  startPreviewBtn.classList.remove('is-loading');
  previewFrame.classList.remove('has-media');
  stopScreenShare();
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }
  localVideo.srcObject = null;
  mediaToggles.hidden = true;
  cameraOffPlaceholder.hidden = true;
  roomWarning.hidden = true;
  startPreviewBtn.hidden = false;
  startPreviewBtn.disabled = false;
  openFrequencyBtn.hidden = true;
  openFrequencyBtn.disabled = false;
  cancelPreviewBtn.hidden = true;
  setStatus('Fill in the form, then start your preview.');
}

function handleBeforeUnload(event) {
  event.preventDefault();
  event.returnValue = '';
}

async function endTransmission() {
  if (ending) return;
  ending = true;
  endTransmissionBtn.disabled = true;
  destroyChat();
  releaseReactions();
  releaseReactions = () => {};
  window.removeEventListener('beforeunload', handleBeforeUnload);
  const oldViewers = viewersRef;
  const oldMeta = metaRef;
  if (oldViewers) oldViewers.off();
  metaRef = null;
  [...peers.keys()].forEach(removeViewer);
  stopScreenShare();
  if (localStream) localStream.getTracks().forEach(track => track.stop());
  localStream = null;
  localVideo.srcObject = null;
  previewFrame.classList.remove('has-media');
  // Stop media immediately. Keep server disconnect cleanup until explicit writes succeed.
  const cleanup = [];
  if (oldMeta) cleanup.push(oldMeta.update({ active: false, viewerCount: 0, endedAt: firebase.database.ServerValue.TIMESTAMP })
    .then(() => oldMeta.child('active').onDisconnect().cancel()));
  if (oldViewers) cleanup.push(oldViewers.remove().then(() => oldViewers.onDisconnect().cancel()));
  viewersRef = null; roomId = null;
  closeDrawer();
  setupCard.classList.remove('is-drawer'); setupCard.inert = false;
  broadcastLayout.dataset.live = 'false';
  roomLockFields.forEach(field => { field.disabled = false; });
  [mediaToggles, cameraOffPlaceholder, anomalyBtn, liveStrip, liveShareRow, localhostNote,
    saveDetailsBtn, chatCard, drawerCloseBtn, openFrequencyBtn, cancelPreviewBtn].forEach(el => { el.hidden = true; });
  startPreviewBtn.hidden = false;
  startPreviewBtn.disabled = false;
  openFrequencyBtn.disabled = false;
  setStatus('Transmission ended. Camera and microphone released.');
  ending = false;
  endTransmissionBtn.disabled = false;
  // Firebase may queue writes while offline; this must not freeze the local control room.
  Promise.all(cleanup).catch(() => notifyUser('Media stopped. Server cleanup could not be confirmed; check your connection.'));
}

function openDrawer() {
  setupCard.setAttribute('role', 'dialog');
  setupCard.setAttribute('aria-label', 'Edit transmission details');
  setupCard.inert = false;
  setupCard.classList.add('is-open');
  drawerBackdrop.hidden = false;
  requestAnimationFrame(() => { drawerBackdrop.classList.add('is-open'); titleInput.focus(); });
}
function closeDrawer() {
  setupCard.removeAttribute('role');
  if (broadcastLayout.dataset.live === 'true') { setupCard.inert = true; editDetailsBtn.focus(); }
  setupCard.classList.remove('is-open');
  drawerBackdrop.classList.remove('is-open');
  setTimeout(() => { if (!drawerBackdrop.classList.contains('is-open')) drawerBackdrop.hidden = true; }, 300);
}

function prefillHostName() {
  if (!hostNameInput.value.trim()) hostNameInput.value = getAlias();
}
document.addEventListener('umbral:alias-changed', prefillHostName);
window.addEventListener('DOMContentLoaded', prefillHostName);

// Nunca "main" por defecto en una transmisión nueva: solo se respeta si venía explícito en la URL.
roomIdInput.value = hasExplicitRoomParam() ? getRoomIdFromUrl() : generateRoomId();
regenerateRoomBtn.addEventListener('click', () => { roomIdInput.value = generateRoomId(); });
newFrequencyBtn.addEventListener('click', () => { roomIdInput.value = generateRoomId(); roomWarning.hidden = true; });
copyLinkBtn.addEventListener('click', () => copyRoomLink(shareLink.value, copyLinkBtn));

setupForm.addEventListener('submit', event => event.preventDefault());
startPreviewBtn.addEventListener('click', startPreview);
openFrequencyBtn.addEventListener('click', openFrequency);
cancelPreviewBtn.addEventListener('click', stopPreviewOnly);

endTransmissionBtn.addEventListener('click', async () => {
  const ok = await confirmAction({
    title: 'End Transmission?',
    body: 'Viewers will be disconnected and this frequency will close.',
    confirmLabel: 'End Transmission',
    danger: true,
  });
  if (ok) endTransmission();
});

editDetailsBtn.addEventListener('click', openDrawer);
drawerCloseBtn.addEventListener('click', closeDrawer);
drawerBackdrop.addEventListener('click', closeDrawer);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && setupCard.classList.contains('is-open')) closeDrawer();
});

shareBtn.addEventListener('click', () => shareOrCopy(shareLink.value, shareBtn));

saveDetailsBtn.addEventListener('click', async () => {
  if (!metaRef || !setupForm.reportValidity()) return;
  saveDetailsBtn.disabled = true;
  const tags = tagsInput.value.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 5);
  try {
  await metaRef.update({
    title: titleInput.value.trim() || 'Untitled transmission',
    category: categorySelect.value,
    description: descriptionInput.value.trim(),
    tags,
    hostName: hostNameInput.value.trim() || getAlias() || 'Anonymous',
  });
  } catch (err) { notifyUser('Details could not be saved. Please retry.'); return; }
  finally { saveDetailsBtn.disabled = false; }
  const original = saveDetailsBtn.textContent;
  saveDetailsBtn.textContent = 'Saved!';
  setTimeout(() => { saveDetailsBtn.textContent = original; }, 1500);
});

// "Anomaly Pulse": un único evento en vivo, con enfriamiento del lado del cliente (no es una
// barrera de seguridad real — cualquiera con acceso directo al SDK podría saltársela).
const ANOMALY_COOLDOWN_MS = 20000;
let anomalyReady = true;
anomalyBtn.addEventListener('click', async () => {
  if (!anomalyReady || !roomId || !metaRef) return;
  anomalyReady = false;
  anomalyBtn.disabled = true;
  const original = anomalyBtn.textContent;
  anomalyBtn.textContent = 'Cooling down…';
  try {
  await db.ref('roomEvents').child(roomId).child('latest').set({
    type: 'anomaly',
    alias: getAlias() || 'Host',
    firedAt: firebase.database.ServerValue.TIMESTAMP,
  });
  playAnomaly(previewFrame);
  } catch (err) { anomalyReady = true; anomalyBtn.disabled = false; anomalyBtn.textContent = original; notifyUser('Signal event was not delivered. Please retry.'); return; }
  setTimeout(() => {
    anomalyReady = true;
    anomalyBtn.disabled = false;
    anomalyBtn.textContent = original;
  }, ANOMALY_COOLDOWN_MS);
});

guardRoomNavigation(() => !!metaRef, endTransmission, true);
