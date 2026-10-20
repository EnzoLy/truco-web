-- Modo arcade: una fila por jugador anonimo (un dispositivo) con su run actual y su record.
-- El token del jugador nunca se guarda: solo su sha256. `version` es el bloqueo optimista, como en rooms.
create table if not exists public.arcade_players (
  id uuid primary key,
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  version integer not null default 1,
  run jsonb,
  best_round integer not null default 0 check (best_round >= 0),
  runs_played integer not null default 0 check (runs_played >= 0),
  updated_at timestamptz not null default now()
);

create index if not exists arcade_players_updated_at_idx on public.arcade_players (updated_at);

-- RLS activado y sin politicas: la clave publishable/anon no puede leer ni escribir.
-- El servidor usa la secret key.
alter table public.arcade_players enable row level security;
revoke all on public.arcade_players from anon, authenticated;
