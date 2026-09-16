-- ============================================================================
-- Dart League - initiële databaseopzet
-- supabase/migrations/20260101000000_initial_schema.sql
--
-- Uitvoeren via de Supabase SQL Editor, of met de Supabase CLI:
--   supabase db push
--
-- Opbouw van dit bestand:
--   1. Extensies
--   2. Helper-functies (rolcontrole)
--   3. Tabellen
--   4. Indexen
--   5. Triggers (automatisch profiel + statistieken bij registratie)
--   6. Row Level Security (RLS)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Extensies
-- ----------------------------------------------------------------------------
create extension if not exists "pgcrypto";


-- ----------------------------------------------------------------------------
-- 2. Helper-functies
-- ----------------------------------------------------------------------------

-- Centrale rolcontrole. We gebruiken security definer zodat de functie de
-- profiles-tabel mag lezen zonder dat RLS-policies op profiles opnieuw deze
-- functie aanroepen (dat zou oneindige recursie geven).
create or replace function public.is_organizer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'organizer'
  );
$$;

comment on function public.is_organizer() is
  'True als de ingelogde gebruiker de rol organizer heeft. Gebruikt in RLS-policies.';


-- ----------------------------------------------------------------------------
-- 3. Tabellen
-- ----------------------------------------------------------------------------

-- profiles ---------------------------------------------------------------
-- Eén rij per Supabase Auth-gebruiker. De id is tegelijk de foreign key
-- naar auth.users, zodat we nooit uit de pas kunnen lopen.
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  display_name text        not null,
  email        text        not null,
  avatar_url   text,
  role         text        not null default 'player'
                 check (role in ('player', 'organizer')),
  created_at   timestamptz not null default now()
);

comment on table public.profiles is 'Spelersprofielen, 1-op-1 gekoppeld aan auth.users.';


-- leagues ----------------------------------------------------------------
create table if not exists public.leagues (
  id           uuid primary key default gen_random_uuid(),
  name         text        not null,
  season       text,
  game_type    text        not null default '501'
                 check (game_type in ('501', '301')),
  match_format text        not null default 'best_of_legs'
                 check (match_format in ('best_of_legs')),
  status       text        not null default 'draft'
                 check (status in ('draft', 'active', 'finished')),
  created_by   uuid        not null references public.profiles (id)
                 on delete restrict default auth.uid(),
  created_at   timestamptz not null default now()
);


-- league_players ---------------------------------------------------------
create table if not exists public.league_players (
  id        uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  player_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  unique (league_id, player_id)
);


-- league_matches ---------------------------------------------------------
create table if not exists public.league_matches (
  id            uuid primary key default gen_random_uuid(),
  league_id     uuid not null references public.leagues (id) on delete cascade,
  player_a_id   uuid not null references public.profiles (id) on delete restrict,
  player_b_id   uuid not null references public.profiles (id) on delete restrict,
  scheduled_at  timestamptz,
  status        text not null default 'scheduled'
                  check (status in ('scheduled', 'in_progress',
                                    'pending_confirmation', 'confirmed',
                                    'cancelled')),
  player_a_legs int  not null default 0 check (player_a_legs >= 0),
  player_b_legs int  not null default 0 check (player_b_legs >= 0),
  winner_id     uuid references public.profiles (id) on delete set null,
  confirmed_at  timestamptz,
  created_at    timestamptz not null default now(),

  -- Een speler kan niet tegen zichzelf spelen.
  constraint league_match_distinct_players
    check (player_a_id <> player_b_id),

  -- De winnaar moet één van beide deelnemers zijn.
  constraint league_match_valid_winner
    check (winner_id is null
           or winner_id = player_a_id
           or winner_id = player_b_id)
);


-- tournaments ------------------------------------------------------------
create table if not exists public.tournaments (
  id              uuid primary key default gen_random_uuid(),
  name            text        not null,
  description     text,
  tournament_type text        not null default 'knockout'
                    check (tournament_type in ('knockout', 'groups',
                                               'groups_and_knockout')),
  game_type       text        not null default '501'
                    check (game_type in ('501', '301')),
  match_format    text        not null default 'best_of_legs'
                    check (match_format in ('best_of_legs')),
  status          text        not null default 'draft'
                    check (status in ('draft', 'active', 'finished')),
  start_at        timestamptz,
  created_by      uuid        not null references public.profiles (id)
                    on delete restrict default auth.uid(),
  created_at      timestamptz not null default now()
);


-- tournament_entries -----------------------------------------------------
create table if not exists public.tournament_entries (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  player_id     uuid not null references public.profiles (id) on delete cascade,
  seed          int,
  status        text not null default 'registered'
                  check (status in ('registered', 'confirmed', 'withdrawn')),
  created_at    timestamptz not null default now(),
  unique (tournament_id, player_id)
);


-- tournament_matches -----------------------------------------------------
create table if not exists public.tournament_matches (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  round_name    text,
  match_number  int,
  player_a_id   uuid references public.profiles (id) on delete set null,
  player_b_id   uuid references public.profiles (id) on delete set null,
  player_a_legs int  not null default 0 check (player_a_legs >= 0),
  player_b_legs int  not null default 0 check (player_b_legs >= 0),
  winner_id     uuid references public.profiles (id) on delete set null,
  status        text not null default 'scheduled'
                  check (status in ('scheduled', 'in_progress',
                                    'pending_confirmation', 'confirmed',
                                    'cancelled')),
  scheduled_at  timestamptz,
  created_at    timestamptz not null default now(),

  -- player_a/b mogen hier null zijn (nog niet bekend welke winnaar
  -- doorstroomt), maar als beide gevuld zijn moeten ze verschillen.
  constraint tournament_match_distinct_players
    check (player_a_id is null
           or player_b_id is null
           or player_a_id <> player_b_id)
);


-- matches ----------------------------------------------------------------
-- Algemene matchtabel voor toekomstige uitbreiding (live scoren). Verwijst
-- optioneel terug naar een league- of toernooiwedstrijd.
create table if not exists public.matches (
  id                  uuid primary key default gen_random_uuid(),
  match_type          text not null
                        check (match_type in ('league', 'tournament', 'friendly')),
  league_match_id     uuid references public.league_matches (id) on delete cascade,
  tournament_match_id uuid references public.tournament_matches (id) on delete cascade,
  player_a_id         uuid not null references public.profiles (id) on delete restrict,
  player_b_id         uuid not null references public.profiles (id) on delete restrict,
  game_type           text not null default '501',
  match_format        text not null default 'best_of_legs',
  status              text not null default 'scheduled'
                        check (status in ('scheduled', 'in_progress',
                                          'pending_confirmation', 'confirmed',
                                          'cancelled')),
  winner_id           uuid references public.profiles (id) on delete set null,
  started_at          timestamptz,
  finished_at         timestamptz,
  created_at          timestamptz not null default now(),

  -- Een match hoort bij hoogstens één bron.
  constraint match_single_source
    check (num_nonnulls(league_match_id, tournament_match_id) <= 1)
);


-- match_legs -------------------------------------------------------------
create table if not exists public.match_legs (
  id             uuid primary key default gen_random_uuid(),
  match_id       uuid not null references public.matches (id) on delete cascade,
  leg_number     int  not null check (leg_number > 0),
  player_a_score int  not null default 0,
  player_b_score int  not null default 0,
  winner_id      uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (match_id, leg_number)
);


-- match_turns ------------------------------------------------------------
-- Eén rij per beurt (3 darts). Basis voor gemiddeldes en 180-tellingen.
create table if not exists public.match_turns (
  id           uuid primary key default gen_random_uuid(),
  leg_id       uuid not null references public.match_legs (id) on delete cascade,
  player_id    uuid not null references public.profiles (id) on delete cascade,
  turn_number  int  not null check (turn_number > 0),
  score_before int  not null,
  score_scored int  not null check (score_scored between 0 and 180),
  score_after  int  not null,
  is_bust      boolean not null default false,
  darts_thrown int  not null default 3 check (darts_thrown between 1 and 3),
  created_at   timestamptz not null default now(),
  unique (leg_id, player_id, turn_number)
);


-- player_statistics ------------------------------------------------------
-- Geaggregeerde statistieken per speler. Wordt bijgewerkt na het bevestigen
-- van een wedstrijd (zie TODO onderaan dit bestand).
create table if not exists public.player_statistics (
  id                  uuid primary key default gen_random_uuid(),
  player_id           uuid not null unique references public.profiles (id)
                        on delete cascade,
  matches_played      int  not null default 0,
  matches_won         int  not null default 0,
  matches_lost        int  not null default 0,
  legs_played         int  not null default 0,
  legs_won            int  not null default 0,
  average_score       numeric(5,2) not null default 0,
  checkout_percentage numeric(5,2) not null default 0,
  highest_checkout    int  not null default 0,
  count_180           int  not null default 0,
  updated_at          timestamptz not null default now()
);


-- ----------------------------------------------------------------------------
-- 4. Indexen
-- ----------------------------------------------------------------------------
create index if not exists idx_league_players_league   on public.league_players (league_id);
create index if not exists idx_league_players_player   on public.league_players (player_id);
create index if not exists idx_league_matches_league   on public.league_matches (league_id);
create index if not exists idx_league_matches_player_a on public.league_matches (player_a_id);
create index if not exists idx_league_matches_player_b on public.league_matches (player_b_id);
create index if not exists idx_league_matches_status   on public.league_matches (status);
create index if not exists idx_tournament_entries_t    on public.tournament_entries (tournament_id);
create index if not exists idx_tournament_matches_t    on public.tournament_matches (tournament_id);
create index if not exists idx_match_legs_match        on public.match_legs (match_id);
create index if not exists idx_match_turns_leg         on public.match_turns (leg_id);


-- ----------------------------------------------------------------------------
-- 5. Triggers
-- ----------------------------------------------------------------------------

-- Maakt automatisch een profiel + lege statistiekenrij aan zodra er een
-- nieuwe auth-gebruiker wordt geregistreerd. De display_name komt uit de
-- metadata die de app meestuurt bij signUp().
--
-- Let op: de rol wordt hier HARD op 'player' gezet. Een gebruiker kan dus
-- nooit via de registratie zelf organizer worden, ook niet door metadata
-- mee te sturen.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    new.email,
    'player'
  )
  on conflict (id) do nothing;

  insert into public.player_statistics (player_id)
  values (new.id)
  on conflict (player_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();


-- Beschermt de rolkolom: alleen een organisator mag een rol wijzigen.
-- Een gewone speler die zijn eigen profiel bijwerkt, krijgt zijn oude rol
-- automatisch terug (in plaats van een harde fout), zodat het bijwerken van
-- naam/avatar gewoon blijft werken.
create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role and not public.is_organizer() then
    new.role := old.role;
  end if;

  -- id en created_at zijn onveranderlijk.
  new.id := old.id;
  new.created_at := old.created_at;

  return new;
end;
$$;

drop trigger if exists on_profile_update_protect_role on public.profiles;
create trigger on_profile_update_protect_role
  before update on public.profiles
  for each row
  execute function public.protect_profile_role();


-- ----------------------------------------------------------------------------
-- 6. Row Level Security
-- ----------------------------------------------------------------------------
alter table public.profiles           enable row level security;
alter table public.leagues            enable row level security;
alter table public.league_players     enable row level security;
alter table public.league_matches     enable row level security;
alter table public.tournaments        enable row level security;
alter table public.tournament_entries enable row level security;
alter table public.tournament_matches enable row level security;
alter table public.matches            enable row level security;
alter table public.match_legs         enable row level security;
alter table public.match_turns        enable row level security;
alter table public.player_statistics  enable row level security;


-- profiles ---------------------------------------------------------------
-- Iedere ingelogde speler mag alle profielen lezen: dat is nodig om
-- tegenstanders, deelnemerslijsten en ranglijsten te kunnen tonen.
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

-- Je mag alleen je eigen profiel bijwerken. De rolkolom is daarnaast
-- beschermd door de trigger hierboven.
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- De organisator mag elk profiel bijwerken (o.a. om een rol toe te kennen).
drop policy if exists "profiles_update_organizer" on public.profiles;
create policy "profiles_update_organizer"
  on public.profiles for update
  to authenticated
  using (public.is_organizer())
  with check (public.is_organizer());

-- Let op: er is bewust GEEN insert-policy. Profielen ontstaan uitsluitend
-- via de trigger op auth.users (die draait als security definer).


-- leagues ----------------------------------------------------------------
drop policy if exists "leagues_select_authenticated" on public.leagues;
create policy "leagues_select_authenticated"
  on public.leagues for select
  to authenticated
  using (true);

drop policy if exists "leagues_write_organizer" on public.leagues;
create policy "leagues_write_organizer"
  on public.leagues for all
  to authenticated
  using (public.is_organizer())
  with check (public.is_organizer());


-- league_players ---------------------------------------------------------
drop policy if exists "league_players_select_authenticated" on public.league_players;
create policy "league_players_select_authenticated"
  on public.league_players for select
  to authenticated
  using (true);

drop policy if exists "league_players_write_organizer" on public.league_players;
create policy "league_players_write_organizer"
  on public.league_players for all
  to authenticated
  using (public.is_organizer())
  with check (public.is_organizer());


-- league_matches ---------------------------------------------------------
-- Een speler ziet alleen wedstrijden waarin hij zelf speelt; de organisator
-- ziet alles.
drop policy if exists "league_matches_select_own_or_organizer" on public.league_matches;
create policy "league_matches_select_own_or_organizer"
  on public.league_matches for select
  to authenticated
  using (
    player_a_id = auth.uid()
    or player_b_id = auth.uid()
    or public.is_organizer()
  );

-- Aanmaken, verwijderen en definitief bevestigen: alleen organisator.
drop policy if exists "league_matches_insert_organizer" on public.league_matches;
create policy "league_matches_insert_organizer"
  on public.league_matches for insert
  to authenticated
  with check (public.is_organizer());

drop policy if exists "league_matches_delete_organizer" on public.league_matches;
create policy "league_matches_delete_organizer"
  on public.league_matches for delete
  to authenticated
  using (public.is_organizer());

-- Update: de organisator mag alles. Een deelnemende speler mag een uitslag
-- doorgeven, maar alleen zolang de wedstrijd nog niet bevestigd is.
--
-- LET OP: RLS werkt op rijniveau, niet op kolomniveau. Een speler kan met
-- deze policy dus technisch ook status naar 'confirmed' zetten. Wil je dat
-- strikt dichtzetten, laat spelers dan niet rechtstreeks updaten maar via
-- een security definer functie (bv. report_league_match_result). Zie TODO.
drop policy if exists "league_matches_update_participant_or_organizer" on public.league_matches;
create policy "league_matches_update_participant_or_organizer"
  on public.league_matches for update
  to authenticated
  using (
    public.is_organizer()
    or (
      (player_a_id = auth.uid() or player_b_id = auth.uid())
      and status in ('scheduled', 'in_progress', 'pending_confirmation')
    )
  )
  with check (
    public.is_organizer()
    or (player_a_id = auth.uid() or player_b_id = auth.uid())
  );


-- tournaments ------------------------------------------------------------
drop policy if exists "tournaments_select_authenticated" on public.tournaments;
create policy "tournaments_select_authenticated"
  on public.tournaments for select
  to authenticated
  using (true);

drop policy if exists "tournaments_write_organizer" on public.tournaments;
create policy "tournaments_write_organizer"
  on public.tournaments for all
  to authenticated
  using (public.is_organizer())
  with check (public.is_organizer());


-- tournament_entries -----------------------------------------------------
drop policy if exists "tournament_entries_select_authenticated" on public.tournament_entries;
create policy "tournament_entries_select_authenticated"
  on public.tournament_entries for select
  to authenticated
  using (true);

drop policy if exists "tournament_entries_write_organizer" on public.tournament_entries;
create policy "tournament_entries_write_organizer"
  on public.tournament_entries for all
  to authenticated
  using (public.is_organizer())
  with check (public.is_organizer());

-- TODO: wil je dat spelers zichzelf inschrijven voor een toernooi, voeg dan
-- een insert-policy toe met check (player_id = auth.uid()) en een
-- delete-policy voor het terugtrekken.


-- tournament_matches -----------------------------------------------------
-- Toernooiwedstrijden zijn openbaar leesbaar (bracket moet zichtbaar zijn
-- voor alle deelnemers).
drop policy if exists "tournament_matches_select_authenticated" on public.tournament_matches;
create policy "tournament_matches_select_authenticated"
  on public.tournament_matches for select
  to authenticated
  using (true);

drop policy if exists "tournament_matches_write_organizer" on public.tournament_matches;
create policy "tournament_matches_write_organizer"
  on public.tournament_matches for all
  to authenticated
  using (public.is_organizer())
  with check (public.is_organizer());


-- matches / match_legs / match_turns --------------------------------------
drop policy if exists "matches_select_own_or_organizer" on public.matches;
create policy "matches_select_own_or_organizer"
  on public.matches for select
  to authenticated
  using (
    player_a_id = auth.uid()
    or player_b_id = auth.uid()
    or public.is_organizer()
  );

drop policy if exists "matches_write_participant_or_organizer" on public.matches;
create policy "matches_write_participant_or_organizer"
  on public.matches for all
  to authenticated
  using (
    public.is_organizer()
    or player_a_id = auth.uid()
    or player_b_id = auth.uid()
  )
  with check (
    public.is_organizer()
    or player_a_id = auth.uid()
    or player_b_id = auth.uid()
  );

drop policy if exists "match_legs_access" on public.match_legs;
create policy "match_legs_access"
  on public.match_legs for all
  to authenticated
  using (
    public.is_organizer()
    or exists (
      select 1 from public.matches m
      where m.id = match_legs.match_id
        and (m.player_a_id = auth.uid() or m.player_b_id = auth.uid())
    )
  )
  with check (
    public.is_organizer()
    or exists (
      select 1 from public.matches m
      where m.id = match_legs.match_id
        and (m.player_a_id = auth.uid() or m.player_b_id = auth.uid())
    )
  );

drop policy if exists "match_turns_access" on public.match_turns;
create policy "match_turns_access"
  on public.match_turns for all
  to authenticated
  using (
    public.is_organizer()
    or exists (
      select 1
      from public.match_legs l
      join public.matches m on m.id = l.match_id
      where l.id = match_turns.leg_id
        and (m.player_a_id = auth.uid() or m.player_b_id = auth.uid())
    )
  )
  with check (
    public.is_organizer()
    or exists (
      select 1
      from public.match_legs l
      join public.matches m on m.id = l.match_id
      where l.id = match_turns.leg_id
        and (m.player_a_id = auth.uid() or m.player_b_id = auth.uid())
    )
  );


-- player_statistics ------------------------------------------------------
-- Statistieken zijn leesbaar voor alle ingelogde gebruikers (ranglijsten),
-- maar niemand mag ze rechtstreeks schrijven: dat gebeurt uitsluitend via
-- de trigger/functie die na een bevestigde wedstrijd draait.
drop policy if exists "player_statistics_select_authenticated" on public.player_statistics;
create policy "player_statistics_select_authenticated"
  on public.player_statistics for select
  to authenticated
  using (true);

drop policy if exists "player_statistics_write_organizer" on public.player_statistics;
create policy "player_statistics_write_organizer"
  on public.player_statistics for all
  to authenticated
  using (public.is_organizer())
  with check (public.is_organizer());


-- ----------------------------------------------------------------------------
-- Eerste organisator aanwijzen
-- ----------------------------------------------------------------------------
-- Registreer jezelf eerst normaal via de app. Voer daarna dit statement
-- handmatig uit in de SQL Editor (vervang het e-mailadres):
--
--   update public.profiles
--   set role = 'organizer'
--   where email = 'jouw@email.nl';
--
-- Daarna kun je vanuit de app andere spelers promoveren.


-- ----------------------------------------------------------------------------
-- TODO's voor een volgende migratie
-- ----------------------------------------------------------------------------
-- 1. Functie `confirm_league_match(match_id uuid)` (security definer) die de
--    status op 'confirmed' zet, confirmed_at vult en player_statistics
--    bijwerkt voor beide spelers. Alleen aanroepbaar door de organisator.
-- 2. Functie `report_league_match_result(...)` zodat spelers een uitslag
--    kunnen doorgeven zonder update-rechten op de hele rij (zie opmerking
--    bij league_matches_update_... hierboven).
-- 3. Trigger op match_turns die average_score, checkout_percentage,
--    highest_checkout en count_180 herberekent (nodig voor live scoren).
-- 4. View `league_standings` met de stand per league, berekend uit
--    bevestigde wedstrijden.
-- 5. Storage-bucket `avatars` met policies:
--      insert/update: bucket_id = 'avatars'
--        and (storage.foldername(name))[1] = auth.uid()::text
--      select: publiek leesbaar
