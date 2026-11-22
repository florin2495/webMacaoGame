-- Macao multiplayer - Supabase schema (initial)
-- Every object is prefixed with macao_ because the Supabase project is shared by all the hub
-- mini-games. Keep the prefix on anything new: tables, constraints, indexes.
-- Run this whole file once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- Idempotent: re-running it drops nothing.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- macao_rooms: one row per room. The running deal (stock, discard pile, hands, pending draw /
-- skip, chosen suit) lives in `deal` as JSON and is only ever read by the server; clients get a
-- filtered view. `rules` = the house rules chosen by the host in the lobby (JSON, validated and
-- filled with defaults by the server). `version` is bumped on every change (optimistic concurrency).
-- ---------------------------------------------------------------------------
create table if not exists public.macao_rooms (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique check (code ~ '^[A-Z2-9]{6}$'),
  name             text not null check (char_length(name) between 1 and 40),
  password_hash    text,                                   -- scrypt hash, null = no password
  rules            jsonb not null default '{}'::jsonb,     -- house rules (see src/lib/rules.ts)
  status           text not null default 'lobby' check (status in ('lobby', 'playing', 'finished')),
  round            integer not null default 1 check (round >= 1),
  host_player_id   uuid,
  deal             jsonb,                                  -- current / last deal, server-only
  result           jsonb,                                  -- outcome of the last deal
  version          integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_activity_at timestamptz not null default now()      -- idle rooms are deleted (see CLAUDE.md)
);
create index if not exists macao_rooms_status_activity_idx on public.macao_rooms (status, last_activity_at);

-- ---------------------------------------------------------------------------
-- macao_players: members of a room (2-6 players + up to 16 spectators). Identity = random token
-- kept by the browser, only its SHA-256 hash is stored. `wins` = rounds won in this room,
-- `score` = running penalty points (cards left in hand at the end of each round).
-- ---------------------------------------------------------------------------
create table if not exists public.macao_players (
  id                uuid primary key default gen_random_uuid(),
  room_id           uuid not null references public.macao_rooms (id) on delete cascade,
  nickname          text not null check (char_length(nickname) between 1 and 12),
  token_hash        text not null unique,
  is_host           boolean not null default false,
  ready             boolean not null default false,
  wins              integer not null default 0 check (wins >= 0),
  score             integer not null default 0,
  joined_at         timestamptz not null default now(),
  kick_requested_at timestamptz,                           -- pending host kick during a game (null = none)
  last_seen_at      timestamptz not null default now(),    -- presence: "disconnected" after 301 s
  device_hash       text,                                  -- sha256 of the browser's device id (rejoin the same seat)
  seat              integer not null default 0,            -- play order, the host can reorder it
  role              text not null default 'player' check (role in ('player', 'spectator')),
  queued_at         timestamptz                            -- spectator waiting for a seat next round
);
create unique index if not exists macao_players_room_nickname_uq on public.macao_players (room_id, lower(nickname));
create index if not exists macao_players_room_idx on public.macao_players (room_id);
create index if not exists macao_players_room_role_seat_idx on public.macao_players (room_id, role, seat);
create index if not exists macao_players_room_seen_idx on public.macao_players (room_id, last_seen_at);

do $$ begin
  alter table public.macao_rooms
    add constraint macao_rooms_host_fk foreign key (host_player_id) references public.macao_players (id) on delete set null;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Security: RLS on, NO policies -> anon / authenticated can read or write nothing.
-- Only the service role (Next.js Route Handlers) touches these tables.
-- ---------------------------------------------------------------------------
alter table public.macao_rooms   enable row level security;
alter table public.macao_players enable row level security;

revoke all on public.macao_rooms, public.macao_players from anon, authenticated;
