# Truco Web

Truco argentino en el navegador. Jugás contra un bot que aprende de tu estilo, en una run tipo *roguelike*
con amuletos, o con amigos en salas. Sin build ni framework: JS plano en el cliente y un servidor Node
sin dependencias.

## Modos de juego

| Ruta | Modo |
|------|------|
| `/` | Menú de inicio. Los ajustes están en `/#ajustes`. |
| `/bot` | 1 contra 1 contra el bot. El bot va aprendiendo cómo jugás y lo recuerda en tu navegador. |
| `/arcade` | Run infinita contra bots con personalidad. Ganás monedas y comprás amuletos en una tienda. Una derrota termina la run. Se juega solo (1 vs 1) o en dúo (`/arcade-duo`: vos y un compañero bot contra dos rivales). |
| `/sala` | Salas con amigos: duelo (1 vs 1), trío (3) o dupla (2 vs 2). Los lugares libres los ocupan bots. Se entra con `/sala?sala=CODIGO`, y una partida ya empezada se puede mirar en vivo. |
| `/cartas` | Estilo de los naipes. |

Todos los modos usan la misma mesa: planilla de palitos, paño, cartas que se tiran con arco, carteles de
canto y telón de fin de mano.

### Arcade

- Todas las partidas son a 30 puntos. Cada ronda tiene un rival distinto:
  - **Chamuyero**: miente seguido;
  - **Doña Prudencia**: solo canta con buena mano;
  - **Coleccionista**: llega con amuletos.
- Cada 4 rondas toca un jefe: el **Tahúr**, que ve tus cartas, o un Coleccionista cargado de amuletos.
- **Monedas:** se ganan por mano, por envido o flor ganados, más un premio por partida ganada. Al final de
  cada ronda cobrás interés: 1 moneda cada 5 ahorradas.
- **Tienda (la pulpería):** hasta 5 amuletos, de cinco tipos. Los precios salen de simular partidas bot contra bot
  y medir cuánto sube la chance de ganar cada amuleto:
  - puntaje;
  - economía;
  - cartas;
  - información (ver cartas del rival, saber su envido). La Bola de cristal muestra la mano del rival una de cada
    3 manos, no siempre;
  - mejoras de cartas, que duran **una sola partida**.
- **Flor:** no hay, salvo que tengas el amuleto Flor.
- **Guardado:** la run se guarda en el navegador y en Supabase con una identidad anónima por dispositivo
  (sin login). Al recargar seguís en la misma jugada.
- **Dúo:** el modo se elige al empezar la run, y cada modo tiene su propia run y su propio récord.
  - Jugás con un compañero bot que ve tus cartas, contra dos rivales con personalidades distintas.
  - Las monedas por mano y por envido las gana el equipo.
  - Tus amuletos son solo tuyos: lo extra cuenta cuando el punto fue tuyo (cantaste el truco, el envido se
    ganó con tus puntos o ganaste una baza de la mano). Espejito, Bola de cristal y Oído fino miran a los dos
    rivales.
  - El jefe es un Tahúr, que ve tus cartas y las de tu compañero, junto con un Coleccionista.

## Correr en local

```bash
node serve.js            # http://localhost:3000  (node serve.js [puerto] [host])
npm test                 # node:test, sin dependencias
```

Sin variables de entorno, las salas y las runs del arcade quedan en memoria. Para usar Supabase como en
producción, copiá `.env.example` a `.env`, completalo y corré `node --env-file=.env serve.js`.

## Estructura

```
index.html bot.html arcade.html arcade-duo.html sala.html cartas.html
js/
  engine.js        Reglas 1 vs 1 como funciones puras: step(state, player, action) -> { state, events }.
                   Acepta "mods" por jugador (amuletos del arcade).
  bot.js           Bot Monte Carlo que aprende del rival. Sus rasgos (traits) arman las personalidades.
  ui.js            Mesa del modo bot y del arcade solo (TrucoTable.mount).
  table-fx.js      Efectos de la mesa: cantos, chispas, polvo, telón de fin de mano.
  card-badges.js   Íconos de mejora en las cartas, con su tooltip.
  arcade.js        Lógica pura de la run (solo y dúo): rivales, economía, tienda, amuletos.
  arcade-store.js  Guardado de la run: primero local, después el servidor en segundo plano. Un lugar por modo.
  arcade-shell.js  HUD, tienda, selector de modo y pantallas del arcade, comunes a los dos modos.
  arcade-ui.js     Arcade solo: monta la mesa de ui.js.
  arcade-duo-ui.js Arcade dúo: monta la mesa de las salas sobre una sala local.
  room-engine.js   Reglas para 2, 3 y 4 jugadores, con flor. Acepta "mods" por asiento (amuletos del dúo).
  room-bot.js      Bot de las salas; juega para su equipo. Acepta rasgos (traits) para las personalidades.
  local-room.js    Sala que corre en el navegador (motor + bots), con los mismos tiempos que el servidor.
  sala-table.js    Mesa de las salas (rivales, bazas, acciones, señas). La usan las salas y el arcade dúo.
  sala.js          Cliente de las salas: lobby y red.
css/               mesa.css (base), sala.css y vida.css (mesa y animaciones), arcade.css
sounds/            Sonidos de cartas y fichas: packs de Kenney (kenney.nl), licencia CC0. js/sound.js
                   los carga al primer toque; si fallan, usa sonidos sintetizados.
server/            API, salas y arcade, con un store en memoria o en Supabase
api/index.js       Entrada de Vercel
supabase/migrations/
test/
```

## Cómo funciona

- **El motor no sabe de pantallas.**
  - `engine.js` y `room-engine.js` devuelven un estado nuevo y la lista de eventos de cada jugada.
  - La interfaz solo dibuja el estado y reacciona a los eventos con sonidos y animaciones.
  - `viewFor(state, player)` arma lo que cada jugador puede saber. El bot decide solo con esa vista, salvo
    el Tahúr, que hace trampa a propósito.
- **Salas: el servidor es la autoridad.**
  - Cada jugador recibe solo la vista de su asiento.
  - Los clientes consultan `GET /api/rooms/:code/state` cada ~1 s.
  - En Vercel no hay un proceso que mantenga relojes. Por eso las esperas (la jugada de un bot, la pausa
    entre manos) se guardan en la sala como `due`, y cada pedido avanza las que ya vencieron
    (`server/rooms.js`).
- **Arcade: el cliente es la autoridad.**
  - El servidor valida la forma de la run: listas blancas, rangos y tamaño máximo.
  - Guarda la run con un token anónimo, del que solo almacena el hash.
  - Rutas, todas POST: `/api/arcade/player`, `/api/arcade/run` y `/api/arcade/save`.
- **Concurrencia:** salas y runs se guardan con `version` como bloqueo optimista.
- **Límites:** hay rate limit por IP y chequeo de mismo origen.
- **Store intercambiable:** cada uno tiene un store en memoria y otro en Supabase.

## Deploy (Vercel + Supabase)

1. En Supabase, correr en el SQL Editor las migraciones en orden:
   - `supabase/migrations/001_rooms.sql` (salas);
   - `supabase/migrations/002_arcade.sql` (runs del arcade).

   Las dos tablas tienen RLS activo y ninguna política: solo el servidor las toca.
2. En Vercel, cargar `SUPABASE_URL` y `SUPABASE_SECRET_KEY`. Es la clave `sb_secret_...`, solo para el
   servidor: nunca en el navegador ni en git.
3. Correr `vercel --prod`. `vercel.json` activa las URLs sin `.html` y manda `/api/*` a `api/index.js`.
