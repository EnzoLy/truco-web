-- Salas de truco: una fila por sala con todo el estado en `data` (jsonb).
-- `version` es el bloqueo optimista: cada guardado exige la version que leyo.
create table if not exists public.rooms (
  code text primary key check (code ~ '^[A-Za-z0-9]{3,8}$'),
  version integer not null default 1,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists rooms_updated_at_idx on public.rooms (updated_at);

-- RLS activado y sin politicas: la clave publishable/anon no puede leer ni escribir
-- (los tokens de los jugadores viven en `data`). El servidor usa la secret key.
alter table public.rooms enable row level security;
revoke all on public.rooms from anon, authenticated;
