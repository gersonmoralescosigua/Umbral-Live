// Alias de la sesión (localStorage): gate de primera visita + popover para cambiarlo después.
// No depende de Firebase ni de ninguna otra pieza — chat.js y emisor.js solo lo consumen.
const ALIAS_KEY = 'umbral.alias';
let memoryAlias = '';
let aliasGateBound = false;

function getAlias() {
  try {
    return localStorage.getItem(ALIAS_KEY) || memoryAlias;
  } catch (err) {
    return memoryAlias;
  }
}

function setAlias(value) {
  const trimmed = (value || '').trim().slice(0, 24);
  if (!trimmed) return false;
  memoryAlias = trimmed;
  try { localStorage.setItem(ALIAS_KEY, trimmed); } catch (err) {}
  document.dispatchEvent(new CustomEvent('umbral:alias-changed', { detail: trimmed }));
  return true;
}

function renderProfilePill() {
  const avatar = document.getElementById('profileAvatar');
  const name = document.getElementById('profileName');
  if (!avatar || !name) return;
  const alias = getAlias() || 'Guest';
  avatar.textContent = initialFor(alias);
  name.textContent = alias;
}

// Muestra el gate de identidad solo si todavía no hay alias guardado; si ya existe, no interrumpe.
function ensureAlias() {
  const gate = document.getElementById('identityGate');
  if (!gate) return;
  if (getAlias()) {
    renderProfilePill();
    return;
  }
  gate.classList.remove('is-hidden');
  gate.hidden = false;
  gate.setAttribute('role', 'dialog');
  gate.setAttribute('aria-modal', 'true');
  gate.setAttribute('aria-label', 'Choose your alias');
  const surfaces = [...document.querySelectorAll('header, main, footer')];
  surfaces.forEach(el => { el.inert = true; });
  const form = document.getElementById('identityForm');
  const input = document.getElementById('aliasInput');
  input.focus();
  if (aliasGateBound) return;
  aliasGateBound = true;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!setAlias(input.value)) return;
    surfaces.forEach(el => { el.inert = false; });
    gate.classList.add('is-hidden');
    document.getElementById('profilePill')?.focus();
    setTimeout(() => { gate.hidden = true; }, 450);
    renderProfilePill();
  });
  gate.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const submit = form.querySelector('button');
    if (event.shiftKey && document.activeElement === input) { event.preventDefault(); submit.focus(); }
    else if (!event.shiftKey && document.activeElement === submit) { event.preventDefault(); input.focus(); }
  });
}

document.addEventListener('umbral:alias-changed', renderProfilePill);

window.addEventListener('DOMContentLoaded', () => {
  renderProfilePill();

  const pill = document.getElementById('profilePill');
  const popover = document.getElementById('profilePopover');
  if (!pill || !popover) return;
  const editInput = document.getElementById('aliasEditInput');
  const saveBtn = document.getElementById('aliasSaveBtn');

  pill.addEventListener('click', () => {
    editInput.value = getAlias();
    popover.hidden = !popover.hidden;
    if (!popover.hidden) editInput.focus();
  });
  saveBtn.addEventListener('click', () => {
    if (setAlias(editInput.value)) popover.hidden = true;
  });
  editInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); saveBtn.click(); }
  });
  document.addEventListener('click', (event) => {
    if (popover.hidden) return;
    if (popover.contains(event.target) || pill.contains(event.target)) return;
    popover.hidden = true;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') popover.hidden = true;
  });
});
