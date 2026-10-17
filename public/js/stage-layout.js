// Reparto de la escena cuando hay cámara y pantalla a la vez (como en Zoom). Compartido por
// emisor.js (su preview) y receptor.js. Cámara y pantalla son dos <video> distintos que nunca
// cambian de stream: solo se reasignan clases (principal / cuadrito / oculto), así el audio de la
// cámara no se interrumpe al intercambiar.
//
//   sin pantalla compartida        -> cámara principal
//   compartiendo, cámara encendida -> pantalla principal + cámara en cuadrito (clic = intercambiar)
//   compartiendo, cámara apagada   -> pantalla principal, sin cuadrito
//
// Un <video> con display:none sigue reproduciendo su audio, por eso la cámara puede ocultarse sin
// perder el micrófono.
function applyStageLayout({ cameraEl, screenEl, offEl, sharing, cameraOn, swapped, controls }) {
  const swap = sharing && cameraOn && swapped;
  const mainEl = sharing && !swap ? screenEl : cameraEl;
  let pipEl = null;
  if (sharing) pipEl = swap ? screenEl : (cameraOn ? cameraEl : null);

  [cameraEl, screenEl].forEach((el) => {
    el.classList.toggle('is-pip', el === pipEl);
    el.classList.toggle('is-hidden', el !== mainEl && el !== pipEl);
    if (controls) el.controls = el === mainEl; // los controles nativos solo en el video principal
  });
  if (offEl) offEl.hidden = sharing || cameraOn; // "cámara apagada" solo cuando no hay nada más que ver
  return { swapped: swap };
}
