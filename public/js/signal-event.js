// "Anomaly Pulse": el único evento en vivo del producto. Vive en roomEvents/{roomId}/latest,
// separado del chat y del signaling WebRTC — solo un nodo que se sobrescribe, nada que podar.
// Compartido por emisor.js (dispara + reproduce localmente) y receptor.js (escucha + reproduce).

function playAnomaly(frameEl) {
  if (!frameEl) return;
  const overlay = frameEl.querySelector('.anomaly-overlay');
  if (!overlay) return;
  // Reinicia la animación aunque ya esté corriendo (fuerza reflow entre quitar y poner la clase).
  frameEl.classList.remove('is-anomaly');
  overlay.classList.remove('is-active');
  void frameEl.offsetWidth;
  frameEl.classList.add('is-anomaly');
  overlay.classList.add('is-active');
  setTimeout(() => {
    frameEl.classList.remove('is-anomaly');
    overlay.classList.remove('is-active');
  }, 1900);
}

// Se queda escuchando todo el tiempo que la página esté abierta; ignora el primer snapshot
// para que alguien que entra tarde no vea reproducirse un evento viejo.
function listenForSignalEvents(roomId, frameEl) {
  let first = true;
  let lastPlayed = 0;
  db.ref('roomEvents').child(roomId).child('latest').on('value', (snapshot) => {
    if (first) { first = false; return; }
    const data = snapshot.val();
    if (data && data.type === 'anomaly' && Date.now() - lastPlayed >= 18000) { lastPlayed = Date.now(); playAnomaly(frameEl); }
  });
}
