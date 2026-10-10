// Secuencia de arranque: barrido breve + "The signal is waking.", luego cede paso al gate de alias.
// Se acorta casi a cero si el usuario pidió prefers-reduced-motion.
window.addEventListener('DOMContentLoaded', () => {
  const boot = document.getElementById('bootScreen');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const delay = (reduceMotion || getAlias()) ? 100 : 1200;

  setTimeout(() => {
    if (boot) {
      boot.classList.add('is-hidden');
      setTimeout(() => { boot.hidden = true; }, 450);
    }
    if (typeof ensureAlias === 'function') ensureAlias();
  }, delay);
});
