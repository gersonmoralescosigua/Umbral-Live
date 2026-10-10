// Room chat is independent of SDP/ICE. Every mount owns and releases its listeners.
const CHAT_REACTIONS = [
  { symbol: '◎', label: 'Anomaly spotted' }, { symbol: '⌁', label: 'Signal received' },
  { symbol: '?', label: 'Another explanation?' }, { symbol: '✦', label: 'Noted as evidence' }
];
const CHAT_CHAR_LIMIT = 200;
const CHAT_HISTORY_LIMIT = 50;
let releaseChat = () => {};
function destroyChat() { releaseChat(); releaseChat = () => {}; }
function initChat(roomId) {
  destroyChat();
  const log = document.getElementById('chatLog');
  const form = document.getElementById('chatForm');
  const input = document.getElementById('chatInput');
  const reactions = document.getElementById('reactionRow');
  const pill = document.getElementById('chatNewPill');
  if (!log || !form || !input) return;
  log.replaceChildren(); reactions.replaceChildren();
  if (pill) pill.hidden = true;
  input.maxLength = CHAT_CHAR_LIMIT;
  const feedback = document.createElement('p'); feedback.className = 'chat-feedback'; feedback.setAttribute('role','status');
  form.after(feedback);
  const empty = document.createElement('div'); empty.className = 'chat-log__empty';
  const heading = document.createElement('span'); heading.textContent = 'THE CHANNEL IS QUIET';
  const hint = document.createElement('span'); hint.textContent = 'Leave the first observation.';
  empty.append(heading, hint); log.append(empty);
  const ref = db.ref('roomChat').child(roomId).child('messages');
  const query = ref.limitToLast(CHAT_HISTORY_LIMIT);
  const nodes = new Map();
  let mounted = true, sending = false;
  let senderId;
  try {
    senderId = sessionStorage.getItem('umbral.chatSender');
    if (!senderId) { senderId = crypto.randomUUID(); sessionStorage.setItem('umbral.chatSender', senderId); }
  } catch (err) { senderId = crypto.randomUUID(); }
  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 65;
  const bottom = () => { log.scrollTop = log.scrollHeight; if (pill) pill.hidden = true; };
  const onScroll = () => { if (pill && nearBottom()) pill.hidden = true; };
  function render(snapshot) {
    const m = snapshot.val();
    if (!mounted || !m || typeof m.text !== 'string' || typeof m.alias !== 'string' || nodes.has(snapshot.key)) return;
    const pinned = nearBottom(); empty.remove();
    const mine = m.senderId ? m.senderId === senderId : m.alias === getAlias();
    const item = document.createElement('div');
    item.className = 'chat-group ' + (mine ? 'is-mine' : 'is-theirs');
    const head = document.createElement('div'); head.className = 'chat-group__head';
    const alias = document.createElement('span'); alias.className = 'chat-group__alias'; alias.textContent = m.alias.slice(0,24);
    const time = document.createElement('time'); time.className = 'chat-group__time';
    const stamp = typeof m.timestamp === 'number' ? m.timestamp : Date.now();
    time.dateTime = new Date(stamp).toISOString(); time.textContent = new Date(stamp).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    head.append(alias,time); item.append(head);
    const bubble = document.createElement('div');
    if (m.type === 'reaction') {
      bubble.className = 'chat-reaction-card' + (mine ? ' is-mine' : '');
      const curated = CHAT_REACTIONS.find(r => r.symbol === m.text);
      const symbol = document.createElement('span'); symbol.className = 'chat-reaction-card__symbol'; symbol.textContent = m.text.slice(0,12);
      const label = document.createElement('span'); label.className = 'chat-reaction-card__meta'; label.textContent = curated ? curated.label : 'Field reaction';
      bubble.append(symbol,label);
    } else { bubble.className = 'chat-bubble'; bubble.textContent = m.text.slice(0,CHAT_CHAR_LIMIT); }
    item.append(bubble); log.append(item); nodes.set(snapshot.key,item);
    if (pinned) bottom(); else if (pill) pill.hidden = false;
  }
  function remove(snapshot) {
    const node = nodes.get(snapshot.key);
    if (!node) return;
    const pinned = nearBottom(); const oldHeight = log.scrollHeight;
    node.remove(); nodes.delete(snapshot.key);
    if (pinned) bottom(); else log.scrollTop = Math.max(0, log.scrollTop - (oldHeight - log.scrollHeight));
    if (!nodes.size) log.append(empty);
  }
  function error() { if (mounted) feedback.textContent = 'Chat is unavailable. Check your connection or database access.'; }
  async function send(text, type) {
    if (sending || !mounted) return false;
    if (!getAlias()) { ensureAlias(); return false; }
    sending = true; feedback.textContent = 'Sending…';
    const buttons = [...form.querySelectorAll('button'), ...reactions.querySelectorAll('button')];
    buttons.forEach(b => b.disabled = true);
    try {
      await ref.push({alias:getAlias(), senderId, text:text.slice(0,CHAT_CHAR_LIMIT), type, timestamp:firebase.database.ServerValue.TIMESTAMP});
      if (mounted) feedback.textContent = '';
      return true;
    } catch (err) { error(); return false; }
    finally { sending = false; buttons.forEach(b => b.disabled = false); }
  }
  async function submit(event) {
    event.preventDefault(); const text = input.value.trim(); if (!text) return;
    if (await send(text,'text') && mounted && input.value.trim() === text) input.value = '';
  }
  CHAT_REACTIONS.forEach(r => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'reaction-btn'; b.textContent = r.symbol;
    b.title = r.label; b.setAttribute('aria-label',r.label); b.onclick = () => send(r.symbol,'reaction'); reactions.append(b);
  });
  form.addEventListener('submit',submit); log.addEventListener('scroll',onScroll); if (pill) pill.addEventListener('click',bottom);
  query.on('child_added',render,error); query.on('child_removed',remove,error);
  releaseChat = () => {
    mounted = false; query.off('child_added',render); query.off('child_removed',remove);
    form.removeEventListener('submit',submit); log.removeEventListener('scroll',onScroll);
    if (pill) pill.removeEventListener('click',bottom);
    reactions.replaceChildren(); log.replaceChildren(); feedback.remove();
  };
  return destroyChat;
}
