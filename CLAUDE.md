# Contexto del proyecto — Umbral Live

> Este archivo existe para que cualquier sesión de Claude Code que trabaje en este repo
> (incluyendo una corrida en otra computadora) tenga, de entrada, el contexto completo de
> qué es este proyecto, de dónde viene, qué reglas respetar y qué no romper — sin tener que
> re-descubrirlo leyendo archivo por archivo. Lo escribió la sesión que hizo todo el trabajo
> descrito abajo; si algo de esto ya no coincide con el código real, confía en el código y
> actualiza este archivo, no al revés.

## Qué es esto, en una frase

Plataforma de streaming 1 emisor → varios receptores sobre **WebRTC P2P real**, con **Firebase
Realtime Database** como servidor de señalización y como base de datos ligera para salas, chat
y eventos en vivo. Sin framework, sin build step: HTML/CSS/JS puro servido por un Express mínimo
en local, y por **Firebase Hosting** en producción.

- 🔗 En vivo: https://webrtctest-2a35f.web.app
- 🖥️ Local: `npm install && npm start` → http://localhost:3000
- 📄 `README.md` (no se sube a este repo por decisión del dueño del proyecto — ver abajo) tiene
  el detalle de cumplimiento contra el enunciado/rúbrica académica de este proyecto, si hace falta.

## Reglas que no deben romperse al seguir trabajando aquí

Estas son restricciones explícitas y repetidas del dueño del proyecto a lo largo de varias
sesiones. No son sugerencias:

- **No framework, no build step.** JS plano, sin React/Vue/bundler/transpiler. Todo se sirve tal cual.
- **No tocar la lógica central de WebRTC sin necesidad.** Las funciones `addViewer` / `removeViewer`
  / `addCandidate` (en `public/emisor/emisor.js`) y `join` / `teardown` / `rejoin` (en
  `public/receptor/receptor.js`) son el núcleo que ya funcionaba antes de todo el trabajo de
  rediseño — se han mantenido intactas a propósito en cada pase. Si hay que tocarlas, que sea
  quirúrgico y con una razón clara.
- **No eliminar las rutas `/emisor` ni `/receptor`**, ni romper que `?room=` ausente caiga en
  `main` por compatibilidad.
- **No agregar backend propio, Cloud Functions, autenticación ni TURN de pago** — queda fuera de
  alcance a propósito (ver limitaciones).
- **No subir imágenes/archivos en el chat sin que te lo pidan explícitamente** — requeriría
  Firebase Storage, reglas y moderación; se decidió dejarlo fuera.
- **Todo texto que escribe un usuario (título, descripción, alias, mensajes de chat) se renderiza
  con `.textContent`, nunca interpolado en `innerHTML`.** Es la regla de seguridad que se ha
  mantenido en cada archivo nuevo. Revísala antes de agregar cualquier render de datos de Firebase.
- **No subir `README.md` a este repositorio.** El dueño del proyecto ya tiene su propio README ahí
  y pidió explícitamente no pisarlo. Si necesitas documentación extensa para otro propósito
  (como este mismo archivo), usa otro nombre.
- **Este archivo (`CLAUDE.md`) sí se sube** — es justamente el mecanismo para que otra sesión
  se ponga al día.

## De dónde viene el proyecto

Antes de que empezara el trabajo descrito abajo, el proyecto ya tenía resuelto lo esencial:
Express sirviendo estático con rutas `/emisor` y `/receptor`, WebRTC vanilla con una
`RTCPeerConnection` por receptor (ya soportaba varios espectadores), y Firebase Realtime Database
usada **únicamente** para señalización (`offer`/`answer`/ICE) en una sala fija `rooms/main`. Sin
identidad visual, sin chat, sin metadatos de sala, sin despliegue, sin reglas de seguridad.

## Qué se construyó encima, en orden

1. **Salas dinámicas** — `rooms/main` fijo → id de sala desde `?room=`, `main` solo como
   respaldo de compatibilidad. Cada sala aislada en Firebase.
2. **Primera identidad visual** ("Umbral Live") — paleta, tipografía, rediseño de las 3 páginas,
   `roomsMeta` (metadatos de sala), portada con salas activas, "Guardar" sala vía `localStorage`.
3. **Dirección de arte "Signal Archive" + identidad de usuario + chat real** — paleta más fría y
   deliberada, alias de visitante (`localStorage`), chat compartido real (`roomChat`, independiente
   de la señalización), controles reales de mic/cámara (`MediaStreamTrack.enabled`), salas únicas
   por defecto (ya no `main` para transmisiones nuevas), aviso de sala ya activa.
4. **Arquitectura de información + sala de control del emisor** — Discover/Active Signals/Archive
   (transmisiones terminadas, nunca se borran, solo cambian `active`)/Saved Signals en la portada;
   el panel del emisor pasa de formulario permanente a sala de control en vivo (franja de estado,
   drawer para editar detalles, chat anclado al video). Chat rediseñado (agrupación de mensajes,
   tarjetas de reacción con remitente/hora, auto-scroll inteligente). **Anomaly Pulse**
   (`roomEvents`): evento visual único disparado por el anfitrión, visible para todos en vivo.
5. **Pulido, accesibilidad, ilustración propia del hero** (`public/assets/listening-station.svg`),
   `observatory.css` como capa de refinamiento sobre el sistema base, confirmaciones antes de
   acciones irreversibles, aviso `beforeunload` mientras se transmite.
6. **Auditoría y corrección de errores** — se detectó y corrigió que la navegación de la portada
   había perdido el enlace a `/emisor`, y que dos salas de prueba habían quedado activas sin cerrar.
7. **Despliegue** (no pedido por el enunciado original, se agregó por iniciativa propia) —
   **Firebase Hosting** para los estáticos y **reglas de seguridad** para la Realtime Database
   (antes no existía ninguna — la base estaba completamente abierta).
8. Hubo también un arnés de pruebas de integración (`tests/`, cámara sintética vía `<canvas>`,
   WebRTC + Firebase reales) que **se eliminó deliberadamente del repo**: funcionaba bien, pero el
   dueño del proyecto decidió no incluir código que no escribió y no podría explicar en una
   revisión académica. Si se reconstruye, que sea con ese mismo criterio en mente.

## Arquitectura

```
EMISOR ◄──── señalización (offer/answer/ICE) vía Firebase ────► RECEPTOR
   │                                                                │
   └──────────── video/audio P2P real (RTCPeerConnection) ─────────┘

Firebase Realtime Database:
  roomsMeta/{roomId}          metadatos livianos (lo que lee la portada, nunca la señalización)
  rooms/{roomId}/viewers/{id} señalización pura (offer, answer, callerCandidates, calleeCandidates)
  roomChat/{roomId}/messages  chat + reacciones, independiente de lo anterior
  roomEvents/{roomId}/latest  último "Anomaly Pulse" (un solo nodo que se sobrescribe)

Estático (public/) → Firebase Hosting en producción, Express (server.js) solo en local.
```

`roomsMeta` está separado de `rooms/{id}/viewers` a propósito: RTDB no tiene proyección de
campos, así que si estuvieran juntos, la portada tendría que descargar también las ofertas SDP y
candidatos ICE de cada espectador solo para mostrar un título.

## Mapa de archivos

```
server.js                      Express: estático + /emisor + /receptor — SOLO para npm start local
firebase.json / .firebaserc    Config de Firebase Hosting + reglas de base de datos
database.rules.json            Reglas de seguridad de la Realtime Database

public/
  index.html                   Portada
  emisor/{index.html,emisor.js}      Panel del emisor (setup → preview → sala de control en vivo)
  receptor/{index.html,receptor.js}  Vista del receptor
  css/
    theme.css                  Sistema compartido: paleta, tipografía, nav, botones, chat, modales
    home.css / emisor.css / receptor.css   Estilos específicos de cada página
    observatory.css            Capa de pulido visual adicional (hero ilustrado, nav, detalles)
  js/
    firebase-config.js         Credenciales del proyecto + ICE servers (STUN) — no es secreto
    rooms.js                   Resolver/generar/validar id de sala
    identity.js                 Alias del visitante (gate de primera vez + popover)
    ui.js                       Compartir/copiar enlace, modal de confirmación reutilizable
    chat.js                     Chat compartido: agrupación, reacciones, auto-scroll
    signal-event.js             Anomaly Pulse: disparar y reproducir
    home.js                     Lógica de la portada (lee roomsMeta en tiempo real)
    boot.js                     Pantalla de arranque breve
  assets/listening-station.svg Ilustración propia del hero
```

## Decisiones de diseño a respetar

- Paleta de 4 roles únicamente (fondo, texto narrativo, un acento cálido para "en vivo/acción",
  un acento frío para metadatos). No agregar colores sueltos fuera de ese sistema.
- Dos voces tipográficas: serif editorial (Fraunces) para narrativa, monoespaciada
  (JetBrains Mono) para códigos de sala/horas/contadores. Es el recurso que más distingue el
  proyecto de una plantilla genérica — mantenerlo.
- Motivos visuales geométricos (barrido de radar, líneas de escaneo, viñetas), no orgánicos
  (nada de humo/niebla/siluetas en CSS puro) — se evitan a propósito porque sin ilustración real
  tienden a verse a medio terminar.
- Botón primario único: **"Open a Frequency"**, consistente en navbar/hero/estados vacíos. No
  reintroducir etiquetas distintas para la misma acción.
- "Follow" se eliminó por no tener comportamiento real (sin backend de notificaciones). "Save"
  se mantiene porque sí persiste de verdad en `localStorage`. No reintroducir Follow salvo que
  tenga una función real.

## Estado actual

- Desplegado y verificado en https://webrtctest-2a35f.web.app (Hosting + reglas de base de datos).
- Reglas de la base de datos: validan forma/tamaño de los campos de texto más visibles
  (`roomsMeta`, `roomChat`), no restringen identidad (no hay auth). Ver `database.rules.json`.
- Repo conectado a `github.com/gersonmoralescosigua/Umbral-Live`, rama `main`.
- `README.md` existe localmente pero no está en este repo (decisión explícita, ver reglas arriba).

## Limitaciones conocidas (no son bugs, son alcance decidido)

- Sin autenticación real: quien tenga el código de una sala puede transmitir en ella o escribir
  directamente contra el SDK de Firebase.
- Sin servidor TURN (solo STUN público) — puede fallar en redes muy restrictivas.
- El enfriamiento de Anomaly Pulse es del lado del cliente, no una barrera de seguridad real.
- Pensado para pocos espectadores por sala (demo P2P, no para audiencias masivas).

## Cómo seguir trabajando

```bash
npm install && npm start                     # local, http://localhost:3000
npx firebase-tools deploy                    # hosting + reglas, requiere login previo
npx firebase-tools deploy --only hosting
npx firebase-tools deploy --only database
```
No hay suite de pruebas automatizadas en este repo (ver punto 8 de la historia arriba). Verificar
manualmente: emisor + receptor en la misma sala, dos receptores, dos salas distintas sin
mezclarse, mic/cámara on-off, terminar transmisión, enlace compartido, y 375px de ancho como
mínimo responsive.
