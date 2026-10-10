/* Integration checks against the real app. No mock Firebase or mock PeerConnection.
   This page is served only by tests/serve.cjs. Test media is explicitly synthetic. */
const results = document.getElementById('results');
const frames = document.getElementById('frames');
const rooms = [];
const mediaCleanup = [];
let audioContext;
let windows = [];
let suiteRunning = false;
const log = line => { results.textContent += '\n' + line; };
const assert = (condition, message) => { if (!condition) throw new Error(message); log('PASS · ' + message); };
async function until(check, label, timeout = 25000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error('Timed out: ' + label);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
async function page(label, route) {
  const pane = document.createElement('section'); pane.className = 'pane';
  const title = document.createElement('h2'); title.textContent = label;
  const frame = document.createElement('iframe'); frame.title = label;
  pane.append(title, frame); frames.append(pane);
  const loaded = new Promise(resolve => frame.onload = resolve);
  frame.src = route;
  await loaded;
  const win = frame.contentWindow; windows.push(win);
  await until(() => win.document.getElementById('bootScreen').hidden, 'page boot');
  return win;
}
const click = (win, id) => win.document.getElementById(id).click();
const text = (win, id) => win.document.getElementById(id).textContent;
function syntheticCamera(win, label, color) {
  Object.defineProperty(win.navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
    const canvas = win.document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
    const ctx = canvas.getContext('2d');
    function draw() {
      ctx.fillStyle = color; ctx.fillRect(0,0,640,360);
      ctx.fillStyle = '#eee8d7'; ctx.font = '24px monospace';
      ctx.fillText('SYNTHETIC TEST / ' + label, 28, 80);
      ctx.font = '18px monospace'; ctx.fillText(new Date().toISOString(), 28, 125);
      ctx.fillStyle = '#d7bc7b'; ctx.fillRect(28 + ((Date.now()/15)%550), 200, 14, 70);
    }
    draw();
    const timer = setInterval(draw, 100);
    const stream = canvas.captureStream(10);
    const tone = audioContext.createOscillator(); const gain = audioContext.createGain();
    const output = audioContext.createMediaStreamDestination();
    gain.gain.value = 0; tone.connect(gain); gain.connect(output); tone.start();
    stream.addTrack(output.stream.getAudioTracks()[0]);
    mediaCleanup.push(() => { clearInterval(timer); tone.stop(); stream.getTracks().forEach(t => t.stop()); });
    return stream;
  }});
}
async function startHost(win, title) {
  win.document.getElementById('titleInput').value = title;
  win.document.getElementById('categorySelect').value = 'Sightings';
  click(win, 'startPreviewBtn');
  await until(() => !win.document.getElementById('openFrequencyBtn').hidden, 'preview');
  click(win, 'openFrequencyBtn');
  await until(() => win.document.getElementById('broadcastLayout').dataset.live === 'true', 'go live');
}
async function send(win, value) {
  const input = win.document.getElementById('chatInput'); input.value = value;
  win.document.getElementById('chatForm').dispatchEvent(new win.Event('submit', {bubbles:true,cancelable:true}));
  await until(() => input.value === '', 'message delivery');
}
async function cleanup() {
  for (const win of windows) {
    try {
      if (win.document.getElementById('broadcastLayout')?.dataset.live === 'true') await win.endTransmission();
      if (win.document.getElementById('remoteVideo')) win.disconnect();
      win.destroyChat?.();
    } catch (error) { log('Cleanup note: ' + error.message); }
  }
  // Only this run's generated QA identifiers, never user-created rooms.
  const db = windows[0]?.eval('db');
  if (db) for (const room of rooms) {
    for (const tree of ['rooms', 'roomsMeta', 'roomChat', 'roomEvents']) await db.ref(tree).child(room).remove();
  }
  mediaCleanup.splice(0).forEach(stop => stop());
  if (audioContext) await audioContext.close();
  log('QA rooms cleaned up.');
}
document.getElementById('cleanup').onclick = cleanup;
document.getElementById('run').onclick = async () => {
  if (suiteRunning) return;
  suiteRunning = true;
  document.getElementById('run').disabled = true;
  results.textContent = 'Running real Firebase + WebRTC checks with synthetic tracks…';
  localStorage.setItem('umbral.alias', 'QA investigator');
  audioContext = new AudioContext(); await audioContext.resume();
  const run = Date.now().toString(36);
  rooms.push('qa-a-' + run, 'qa-b-' + run);
  try {
    const hostA = await page('Host A · generated test media', '/emisor?room=' + rooms[0]);
    syntheticCamera(hostA, 'ROOM A', '#254245');
    await startHost(hostA, 'QA / Room A');
    assert(hostA.document.getElementById('setupCard').inert, 'Setup form is inaccessible while live; details drawer required');
    assert(hostA.document.getElementById('shareLink').value === location.origin + '/receptor?room=' + rooms[0], 'Room URL uses current origin');
    const viewer1 = await page('Viewer A1', '/receptor?room=' + rooms[0]);
    const viewer2 = await page('Viewer A2', '/receptor?room=' + rooms[0]);
    click(viewer1, 'connectBtn'); click(viewer2, 'connectBtn');
    await until(() => text(hostA,'liveStripViewers').startsWith('2 '), 'two connected viewers');
    assert(viewer1.document.getElementById('remoteVideo').videoWidth > 0 && viewer2.document.getElementById('remoteVideo').videoWidth > 0, 'Two receivers decode real WebRTC video');
    click(hostA, 'micToggleBtn');
    assert(hostA.document.getElementById('localVideo').srcObject.getAudioTracks()[0].enabled === false, 'Mic toggle disables the actual audio track');
    click(hostA, 'micToggleBtn'); click(hostA, 'cameraToggleBtn');
    assert(hostA.document.getElementById('localVideo').srcObject.getVideoTracks()[0].enabled === false, 'Camera toggle disables the actual video track');
    click(hostA, 'cameraToggleBtn');
    const hostB = await page('Host B · generated test media', '/emisor?room=' + rooms[1]);
    syntheticCamera(hostB, 'ROOM B', '#513e35'); await startHost(hostB, 'QA / Room B');
    const viewerB = await page('Viewer B', '/receptor?room=' + rooms[1]); click(viewerB,'connectBtn');
    await until(() => text(hostB,'liveStripViewers').startsWith('1 '), 'second room connected');
    assert(text(hostA,'liveStripViewers').startsWith('2 '), 'Room B connection does not affect Room A viewers');
    await send(hostA, 'QA observation from host');
    await until(() => text(viewer1,'chatLog').includes('QA observation from host') && text(viewer2,'chatLog').includes('QA observation from host'), 'host chat to both viewers');
    assert(!text(viewerB,'chatLog').includes('QA observation from host'), 'Chat is isolated across rooms');
    await send(viewer1, '<img src=x onerror=alert(1)> literal QA');
    await until(() => text(hostA,'chatLog').includes('<img src=x'), 'viewer chat to host');
    assert(!hostA.document.getElementById('chatLog').querySelector('img'), 'User text renders literally, not as markup');
    viewer2.document.querySelector('#reactionRow button').click();
    await until(() => !!hostA.document.querySelector('.chat-reaction-card'), 'reaction delivery');
    const reactionGroup = hostA.document.querySelector('.chat-reaction-card').parentElement;
    assert(!!reactionGroup.querySelector('time') && !!reactionGroup.querySelector('.chat-group__alias'), 'Reactions carry alias and time');
    click(hostA,'anomalyBtn');
    await until(() => viewer1.document.getElementById('playerFrame').classList.contains('is-anomaly') && viewer2.document.getElementById('playerFrame').classList.contains('is-anomaly'), 'signal pulse to both viewers');
    assert(!viewerB.document.getElementById('playerFrame').classList.contains('is-anomaly'), 'Signal events stay in their room');
    assert(hostA.document.getElementById('anomalyBtn').disabled, 'Signal event cooldown disables repeat send');
    click(hostA,'endTransmissionBtn');
    await until(() => !hostA.document.getElementById('confirmModal').hidden, 'end confirmation');
    click(hostA,'confirmModalCancel');
    assert(hostA.document.getElementById('broadcastLayout').dataset.live === 'true', 'Cancel preserves the live broadcast');
    click(hostA,'endTransmissionBtn'); click(hostA,'confirmModalConfirm');
    await until(() => text(viewer1,'status').includes('ended') && text(viewer2,'status').includes('ended'), 'viewers see ended state');
    assert(hostA.document.getElementById('localVideo').srcObject === null, 'End releases local media and resets preview');
    await startHost(hostA, 'QA / Room A restart');
    await send(hostA,'QA restart single delivery');
    await until(() => text(viewer1,'chatLog').includes('QA restart single delivery'), 'restart delivery');
    assert([...viewer1.document.querySelectorAll('.chat-bubble')].filter(n => n.textContent === 'QA restart single delivery').length === 1, 'Restart does not duplicate chat listeners or sends');
    log('ALL INTEGRATION CHECKS PASSED. Synthetic media only; physical camera and cross-network NAT remain manual tests.');
  } catch (error) { log('FAIL · ' + error.message); }
  finally { document.getElementById('cleanup').disabled = false; }
};
