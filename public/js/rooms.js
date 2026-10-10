// Resuelve y valida el id de sala (?room=...) que comparten emisor y receptor.
// Sin un id en la URL, todo cae en "main" para no romper /emisor y /receptor actuales.
const DEFAULT_ROOM_ID = 'main';
const ROOM_ID_PATTERN = /^[a-z0-9-]{3,40}$/i;

function isValidRoomId(id) {
  return typeof id === 'string' && ROOM_ID_PATTERN.test(id);
}

function getRoomIdFromUrl() {
  const raw = new URLSearchParams(location.search).get('room');
  return isValidRoomId(raw) ? raw : DEFAULT_ROOM_ID;
}

// true solo si la URL trae un ?room= explícito y válido (no cuando cae al "main" por defecto).
// La usa el emisor para no asignar "main" como punto de partida de una transmisión nueva.
function hasExplicitRoomParam() {
  return isValidRoomId(new URLSearchParams(location.search).get('room'));
}

function roomPath(roomId) {
  return 'rooms/' + roomId;
}

// Limpia texto libre (ej. el título de la transmisión) para usarlo como id de sala.
function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quita acentos
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

// Sugiere un id de sala temático, corto y fácil de compartir.
function generateRoomId() {
  const words = ['field', 'echo', 'signal', 'archive', 'anomaly', 'station'];
  const word = words[Math.floor(Math.random() * words.length)];
  const suffix = Array.from(crypto.getRandomValues(new Uint8Array(5)), n => n.toString(16).padStart(2, '0')).join('');
  return word + '-' + suffix;
}
