// Utilidades de interfaz compartidas entre emisor, receptor y la página de inicio.

// Comparte una URL con el share sheet nativo si existe; si no, la copia al portapapeles.
let noticeTimer;
function notifyUser(message) {
  let notice = document.getElementById('appNotice');
  if (!notice) {
    notice = document.createElement('div');
    notice.id = 'appNotice'; notice.className = 'toast'; notice.setAttribute('role', 'status');
    document.body.appendChild(notice);
  }
  notice.textContent = message; notice.hidden = false;
  clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { notice.hidden = true; }, 3500);
}
async function copyRoomLink(url, buttonEl) {
  if (buttonEl) buttonEl.disabled = true;
  try {
    await navigator.clipboard.writeText(url);
    notifyUser('Room link copied.');
    return true;
  } catch (err) {
    notifyUser('Could not copy automatically. Select the room URL and copy it manually.');
    return false;
  } finally { if (buttonEl) buttonEl.disabled = false; }
}
async function shareOrCopy(url, buttonEl) {
  if (navigator.share) {
    try { await navigator.share({ title: 'Umbral Live', url }); return true; }
    catch (err) { if (err.name === 'AbortError') return false; }
  }
  return copyRoomLink(url, buttonEl);
}

// App-owned links share the same confirmation as the Leave / End buttons.
function guardRoomNavigation(isActive, leave, host) {
  document.addEventListener('click', async (event) => {
    const link = event.target.closest('a[href]');
    if (!link || !isActive() || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || link.target === '_blank') return;
    const next = new URL(link.href, location.href);
    if (next.origin === location.origin && next.pathname === location.pathname && next.search === location.search) return;
    event.preventDefault();
    const ok = await confirmAction({ title: host ? 'End this transmission and leave?' : 'Leave the investigation?', body: host ? 'Your viewers will lose the live signal.' : 'Your video connection will close. You can return at any time.', confirmLabel: host ? 'End and leave' : 'Leave', danger: host });
    if (ok) { await leave(); location.href = next.href; }
  });
}

// Primera letra de un nombre, para usar como avatar simple cuando no hay imagen.
function initialFor(name) {
  const trimmed = (name || '').trim();
  return trimmed ? trimmed[0].toUpperCase() : '?';
}

// Modal de confirmación reutilizable. Resuelve true/false; si la página no trae #confirmModal
// (no todas lo necesitan) no bloquea la acción. Mismo patrón de backdrop/Escape que el popover de perfil.
function confirmAction({ title, body, confirmLabel, danger }) {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirmModal');
    if (!modal) { resolve(window.confirm(title + '\n' + body)); return; }
    if (!modal.hidden) { resolve(false); return; }
    const previousFocus = document.activeElement;

    document.getElementById('confirmModalTitle').textContent = title;
    document.getElementById('confirmModalBody').textContent = body;
    const confirmBtn = document.getElementById('confirmModalConfirm');
    const cancelBtn = document.getElementById('confirmModalCancel');
    confirmBtn.textContent = confirmLabel || 'Confirm';
    confirmBtn.className = 'btn btn--sm' + (danger ? ' btn--danger' : '');

    function cleanup(result) {
      modal.hidden = true;
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      modal.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
      if (previousFocus && previousFocus.isConnected) previousFocus.focus();
      resolve(result);
    }
    function onConfirm() { cleanup(true); }
    function onCancel() { cleanup(false); }
    function onBackdrop(event) { if (event.target === modal) cleanup(false); }
    function onKey(event) {
      if (event.key === 'Escape') cleanup(false);
      if (event.key === 'Tab') {
        event.preventDefault();
        (document.activeElement === cancelBtn ? confirmBtn : cancelBtn).focus();
      }
    }

    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    modal.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);
    modal.hidden = false;
    cancelBtn.focus();
  });
}
