# Truco Web

Truco argentino en el navegador: 1 contra 1 contra un bot que aprende de tu estilo, o con amigos en salas
(duelo, dupla o trío). Sin build ni framework: JS plano y un servidor Node sin dependencias.

- `/` — menú de inicio (modos de juego y ajustes en `/#ajustes`) · `/bot` — mesa contra el bot ·
  `/sala` — salas con amigos (`/sala?modo=duel|trio|dupla` para elegir modo, `/sala?sala=CODIGO` para entrar) · `/cartas` — estilo de naipes.

## Correr en local

```bash
node serve.js            # http://localhost:3000  (node serve.js [puerto] [host])
npm test
```

Las salas quedan en memoria. Para usar Supabase como en producción, copiá `.env.example` a `.env`,
completalo y corré `node --env-file=.env serve.js`.

## Cómo funcionan las salas

El servidor es la autoridad: cada jugador recibe solo la vista de su asiento (sus cartas, nunca las ajenas).
Los clientes consultan `GET /api/rooms/:code/state` cada ~1 s. Como en Vercel no hay un proceso que
mantenga relojes, las esperas (jugada de un bot, pausa entre manos) se guardan en la sala como `due` y
cada pedido avanza las que ya vencieron (`server/rooms.js`). El estado se guarda con `version` como
bloqueo optimista; el store es intercambiable (`server/store-memory.js`, `server/store-supabase.js`).

## Deploy (Vercel + Supabase)

1. En Supabase, correr `supabase/migrations/001_rooms.sql` en el SQL Editor (crea `rooms` con RLS y sin políticas).
2. En Vercel, cargar `SUPABASE_URL` y `SUPABASE_SECRET_KEY` (la `sb_secret_...`, solo servidor).
3. `vercel --prod`. `vercel.json` activa las URLs sin `.html` y manda `/api/*` a `api/index.js`.
