// Reacciones flotantes sobre el video (como en las plataformas de streaming).
// Viven en roomReactions/{roomId}/{id} = { type, ts }, separado del chat y de la señalización
// WebRTC. Son un pulso en vivo: quien reacciona borra su nodo a los pocos segundos y nadie
// recibe reacciones viejas al entrar. Compartido por receptor.js (envía + muestra) y
// emisor.js (solo muestra). Los iconos son SVG propios con los colores del tema; el tipo que
// llega de Firebase solo se usa como clave de VIDEO_REACTIONS, nunca se renderiza como texto.

const SVG_NS = 'http://www.w3.org/2000/svg';
const REACTION_COOLDOWN_MS = 180; // mínimo entre dos envíos del mismo usuario (anti-spam del lado cliente)
const REACTION_MAX_ON_SCREEN = 40; // tope de iconos simultáneos sobre el video
const REACTION_MAX_AGE_MS = 4000; // reacciones más viejas que esto se ignoran al cargar
const REACTION_TTL_MS = 5000; // el remitente borra su reacción pasado este tiempo

const STROKE = { fill: 'none', stroke: 'currentColor', 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };

const VIDEO_REACTIONS = [
  { id: 'heart', label: 'Love it', tone: 'signal', shapes: [
    ['path', { d: 'M12 21C7 17 3 13.6 3 9.2 3 6.4 5.1 4.5 7.5 4.5c1.8 0 3.4 1 4.5 2.6 1.1-1.6 2.7-2.6 4.5-2.6 2.4 0 4.5 1.9 4.5 4.7C21 13.6 17 17 12 21z' }],
  ] },
  { id: 'spark', label: 'Brilliant', tone: 'signal', shapes: [
    ['path', { d: 'M12 2c.6 5.2 4.8 9.4 10 10-5.2.6-9.4 4.8-10 10-.6-5.2-4.8-9.4-10-10 5.2-.6 9.4-4.8 10-10z' }],
  ] },
  { id: 'ring', label: 'Anomaly spotted', tone: 'data', shapes: [
    ['circle', { cx: 12, cy: 12, r: 9, ...STROKE }],
    ['circle', { cx: 12, cy: 12, r: 3.5 }],
  ] },
  { id: 'wave', label: 'Signal received', tone: 'data', shapes: [
    ['path', { d: 'M2 13l4-5 4 8 4-10 4 7 4-4', ...STROKE }],
  ] },
  { id: 'question', label: 'Another explanation?', tone: 'paper', shapes: [
    ['path', { d: 'M9 9.2a3 3 0 1 1 4.6 2.5c-1 .7-1.6 1.2-1.6 2.5', ...STROKE }],
    ['circle', { cx: 12, cy: 18.3, r: 1.3 }],
  ] },
];
// Map (no objeto) para que un "type" como "__proto__" nunca resuelva a nada.
const REACTION_BY_ID = new Map(VIDEO_REACTIONS.map((def) => [def.id, def]));

// Claves de las reacciones que este navegador mandó: ya se mostraron al instante, no se repiten.
const ownReactionKeys = new Set();

function buildReactionIcon(def) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  def.shapes.forEach(([tag, attrs]) => {
    const el = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([name, value]) => el.setAttribute(name, value));
    svg.append(el);
  });
  return svg;
}

// Dibuja un icono que sube por el video con un vaivén aleatorio y se desvanece.
function spawnFloatingReaction(layer, def) {
  if (!layer || !def) return;
  while (layer.childElementCount >= REACTION_MAX_ON_SCREEN) layer.firstElementChild.remove();

  const duration = 2600 + Math.random() * 1200;
  const item = document.createElement('span');
  item.className = 'reaction-float is-tone-' + def.tone;
  item.style.setProperty('--size', Math.round(26 + Math.random() * 14) + 'px');
  item.style.setProperty('--right', Math.round(14 + Math.random() * Math.min(110, layer.clientWidth * 0.2)) + 'px');
  item.style.setProperty('--dx', Math.round(-45 + Math.random() * 90) + 'px');
  item.style.setProperty('--rot', Math.round(-28 + Math.random() * 56) + 'deg');
  item.style.setProperty('--rise', Math.round(Math.max(140, layer.clientHeight * (0.6 + Math.random() * 0.25))) + 'px');
  item.style.setProperty('--dur', Math.round(duration) + 'ms');
  item.append(buildReactionIcon(def));
  layer.append(item);

  // Con "reduce motion" la animación se desactiva: el temporizador garantiza que igual se limpie.
  setTimeout(() => item.remove(), duration + 150);
}

// Arma los botones para reaccionar. Cada clic muestra el icono al instante y lo publica.
function initReactionBar(roomId, barEl, layerEl) {
  if (!barEl) return;
  barEl.replaceChildren();
  const ref = db.ref('roomReactions').child(roomId);
  let lastSent = 0;
  let warned = false;

  VIDEO_REACTIONS.forEach((def) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'reaction-bar__btn is-tone-' + def.tone;
    btn.title = def.label;
    btn.setAttribute('aria-label', def.label);
    btn.append(buildReactionIcon(def));

    btn.addEventListener('click', () => {
      const now = Date.now();
      if (now - lastSent < REACTION_COOLDOWN_MS) return;
      lastSent = now;

      spawnFloatingReaction(layerEl, def);

      const node = ref.push();
      ownReactionKeys.add(node.key);
      node.onDisconnect().remove(); // si cierra la pestaña antes de tiempo, Firebase la borra
      node.set({ type: def.id, ts: firebase.database.ServerValue.TIMESTAMP }).catch(() => {
        ownReactionKeys.delete(node.key);
        if (!warned) { warned = true; notifyUser('Reactions are unavailable right now.'); }
      });
      setTimeout(() => {
        node.remove().catch(() => {});
        node.onDisconnect().cancel().catch(() => {});
        ownReactionKeys.delete(node.key);
      }, REACTION_TTL_MS);
    });

    barEl.append(btn);
  });
}

// Muestra las reacciones de los demás. Devuelve la función que libera los listeners.
function listenForReactions(roomId, layerEl) {
  if (!layerEl) return () => {};
  const query = db.ref('roomReactions').child(roomId).limitToLast(20);
  const offsetRef = db.ref('.info/serverTimeOffset');
  let offset = 0; // diferencia entre el reloj de este equipo y el de Firebase

  const onOffset = (snapshot) => { offset = snapshot.val() || 0; };
  const onAdded = (snapshot) => {
    if (ownReactionKeys.has(snapshot.key)) return;
    const data = snapshot.val();
    if (!data || typeof data.ts !== 'number') return;
    if (Date.now() + offset - data.ts > REACTION_MAX_AGE_MS) return; // historial, no un pulso en vivo
    spawnFloatingReaction(layerEl, REACTION_BY_ID.get(data.type));
  };

  offsetRef.on('value', onOffset);
  query.on('child_added', onAdded, () => {});
  return () => {
    offsetRef.off('value', onOffset);
    query.off('child_added', onAdded);
    layerEl.replaceChildren();
  };
}
