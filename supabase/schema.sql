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
--   7. Uitslagen: doorgeven, bevestigen en afkeuren
--   8. Divisies binnen een league
--   9. Spelersgegevens voor de initiële indeling
--  10. Prijsclaim-systeem voor divisiewinnaars (LWPrints)
--  11. Startdatum/-tijd van een league, automatische activering en
--      wedstrijdmoment voorstellen/accepteren
--  12. Divisiehistorie, één-actieve-league-regel, en meldingen bij
--      indeling/promotie/degradatie
--  13. Per-wedstrijd beschikbaarheid en deadline, automatische herinnering/
--      verval, en organizer-only verlenging
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
-- 'scheduled': gepland, wacht op het startmoment (start_at) - dan pas
-- worden wedstrijden aangemaakt en gaat de speeldeadline lopen (zie
-- sectie 11, activate_league).
create table if not exists public.leagues (
  id           uuid primary key default gen_random_uuid(),
  name         text        not null,
  season       text,
  description  text,
  game_type    text        not null default '501'
                 check (game_type in ('501', '301')),
  match_format text        not null default 'best_of_legs'
                 check (match_format in ('best_of_legs')),
  status       text        not null default 'draft'
                 check (status in ('draft', 'scheduled', 'active', 'finished')),
  -- Aantal legs dat een wedstrijd in deze league telt. Er wordt altijd het
  -- volledige aantal gespeeld (niet eerder gestopt bij een meerderheid),
  -- zodat een gelijkspel (bv. 5-5 bij 10) mogelijk is.
  legs_per_match int      not null default 10 check (legs_per_match > 0),
  -- Aantal divisies (1-4), exact startmoment (UTC) en tijdzone voor
  -- weergave; zie sectie 11 voor de automatische start/wedstrijdgeneratie.
  division_count int         not null default 4 check (division_count between 1 and 4),
  start_at     timestamptz,
  timezone     text        not null default 'Europe/Amsterdam',
  end_at       timestamptz,
  match_deadline_days int  not null default 7 check (match_deadline_days > 0),
  created_by   uuid        not null references public.profiles (id)
                 on delete restrict default auth.uid(),
  created_at   timestamptz not null default now()
);

alter table public.leagues
  add column if not exists legs_per_match int not null default 10 check (legs_per_match > 0);

alter table public.leagues
  add column if not exists description text,
  add column if not exists division_count int not null default 4,
  add column if not exists start_at timestamptz,
  add column if not exists timezone text not null default 'Europe/Amsterdam',
  add column if not exists end_at timestamptz,
  add column if not exists match_deadline_days int not null default 7;

alter table public.leagues drop constraint if exists leagues_division_count_check;
alter table public.leagues
  add constraint leagues_division_count_check check (division_count between 1 and 4);

alter table public.leagues drop constraint if exists leagues_match_deadline_days_check;
alter table public.leagues
  add constraint leagues_match_deadline_days_check check (match_deadline_days > 0);

alter table public.leagues drop constraint if exists leagues_status_check;
alter table public.leagues
  add constraint leagues_status_check check (status in ('draft', 'scheduled', 'active', 'finished'));

-- legs_per_match mag alleen wijzigen zolang de league nog niet actief is
-- (anders komen lopende/bevestigde uitslagen niet meer overeen met de regel).
create or replace function public.protect_legs_per_match()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.legs_per_match is distinct from old.legs_per_match and old.status <> 'draft' then
    raise exception 'Het aantal legs kan niet meer gewijzigd worden nadat de league actief is.';
  end if;
  return new;
end;
$$;

drop trigger if exists on_leagues_protect_legs_per_match on public.leagues;
create trigger on_leagues_protect_legs_per_match
  before update on public.leagues
  for each row
  execute function public.protect_legs_per_match();


-- league_players ---------------------------------------------------------
create table if not exists public.league_players (
  id        uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  player_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  unique (league_id, player_id)
);


-- league_matches ---------------------------------------------------------
-- Naast de legscore en de winnaar houden we ook een aantal optionele
-- wedstrijdgegevens bij (gemiddelde, 180's, hoogste finish) die de
-- rapporterende speler zelf invult, plus wie de uitslag heeft doorgegeven
-- (reported_by) zodat de tegenstander - en niet de doorgever zelf - hem
-- moet bevestigen.
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
  player_a_average           numeric(5,2),
  player_b_average           numeric(5,2),
  player_a_180s              int not null default 0 check (player_a_180s >= 0),
  player_b_180s              int not null default 0 check (player_b_180s >= 0),
  player_a_highest_checkout  int not null default 0 check (player_a_highest_checkout >= 0),
  player_b_highest_checkout  int not null default 0 check (player_b_highest_checkout >= 0),
  winner_id     uuid references public.profiles (id) on delete set null,
  reported_by   uuid references public.profiles (id) on delete set null,
  reported_at   timestamptz,
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

-- Kolommen ook toevoegen als de tabel al bestond vóór deze wijziging.
alter table public.league_matches
  add column if not exists player_a_average numeric(5,2),
  add column if not exists player_b_average numeric(5,2),
  add column if not exists player_a_180s int not null default 0,
  add column if not exists player_b_180s int not null default 0,
  add column if not exists player_a_highest_checkout int not null default 0,
  add column if not exists player_b_highest_checkout int not null default 0,
  add column if not exists reported_by uuid references public.profiles (id) on delete set null,
  add column if not exists reported_at timestamptz;

alter table public.league_matches
  drop constraint if exists league_matches_player_a_180s_check,
  add constraint league_matches_player_a_180s_check check (player_a_180s >= 0);
alter table public.league_matches
  drop constraint if exists league_matches_player_b_180s_check,
  add constraint league_matches_player_b_180s_check check (player_b_180s >= 0);
alter table public.league_matches
  drop constraint if exists league_matches_player_a_highest_checkout_check,
  add constraint league_matches_player_a_highest_checkout_check check (player_a_highest_checkout >= 0);
alter table public.league_matches
  drop constraint if exists league_matches_player_b_highest_checkout_check,
  add constraint league_matches_player_b_highest_checkout_check check (player_b_highest_checkout >= 0);


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
-- Geaggregeerde statistieken per speler. Wordt bijgewerkt zodra een
-- league-wedstrijd bevestigd wordt (zie confirm_league_match_result
-- verderop in dit bestand).
create table if not exists public.player_statistics (
  id                  uuid primary key default gen_random_uuid(),
  player_id           uuid not null unique references public.profiles (id)
                        on delete cascade,
  matches_played      int  not null default 0,
  matches_won         int  not null default 0,
  matches_lost        int  not null default 0,
  legs_played         int  not null default 0,
  legs_won            int  not null default 0,
  draws               int  not null default 0,
  average_score       numeric(5,2) not null default 0,
  -- Hoe vaak er daadwerkelijk een gemiddelde is meegegeven bij een
  -- bevestigde wedstrijd (het gemiddelde-veld bij het doorgeven van een
  -- uitslag is optioneel). matches_played loopt bij élke wedstrijd op, dus
  -- die alleen zegt niets over hoe betrouwbaar average_score is - deze
  -- teller wel.
  average_sample_count int not null default 0,
  checkout_percentage numeric(5,2) not null default 0,
  highest_checkout    int  not null default 0,
  count_180           int  not null default 0,
  updated_at          timestamptz not null default now()
);

alter table public.player_statistics
  add column if not exists draws int not null default 0,
  add column if not exists average_sample_count int not null default 0;


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

-- Concept- en geplande (nog niet gestarte) leagues mogen verwijderd worden;
-- actieve en afgeronde leagues niet, vanwege lopende/historische gegevens
-- (standen, divisiewinnaars, promotie/degradatie, wedstrijdgegevens). Dit
-- geldt server-side, ongeacht wat de frontend toont - de policy hierboven
-- staat delete al toe voor organisatoren, deze trigger voegt de
-- statusbeperking daarbovenop toe. Gekoppelde divisies, spelerskoppelingen,
-- wedstrijden en meldingen verdwijnen automatisch mee (on delete cascade op
-- die tabellen); spelersaccounts (profiles) worden nooit aangeraakt.
create or replace function public.protect_league_deletion()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status not in ('draft', 'scheduled') then
    raise exception 'Een % league kan niet verwijderd worden.', old.status;
  end if;
  return old;
end;
$$;

drop trigger if exists on_leagues_protect_deletion on public.leagues;
create trigger on_leagues_protect_deletion
  before delete on public.leagues
  for each row
  execute function public.protect_league_deletion();


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

-- Aanmaken en verwijderen: alleen organisator.
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

-- Rechtstreeks bijwerken (herplannen, annuleren, ...) is voorbehouden aan de
-- organisator. Spelers geven een uitslag door, bevestigen of keuren hem af
-- via de security-definer functies hieronder, die precies bepalen wie wat
-- mag: dat kan niet betrouwbaar met een rijgebonden RLS-policy alleen,
-- omdat we willen uitsluiten dat een speler zijn eigen uitslag bevestigt.
drop policy if exists "league_matches_update_participant_or_organizer" on public.league_matches;
drop policy if exists "league_matches_update_organizer" on public.league_matches;
create policy "league_matches_update_organizer"
  on public.league_matches for update
  to authenticated
  using (public.is_organizer())
  with check (public.is_organizer());


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
-- Statistieken zijn leesbaar voor alle ingelogde gebruikers (ranglijsten).
-- Rechtstreeks schrijven mag alleen de organisator; voor spelers gebeurt dit
-- uitsluitend via confirm_league_match_result (security definer) hieronder.
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
-- 7. Uitslagen: doorgeven, bevestigen en afkeuren
-- ----------------------------------------------------------------------------
-- Spelers vullen de uitslag van hun eigen wedstrijd zelf in
-- (report_league_match_result). Dat zet de wedstrijd op
-- 'pending_confirmation'. De tegenstander controleert de ingevulde
-- gegevens en bevestigt (confirm_league_match_result, telt mee voor de
-- statistieken) of keurt af (reject_league_match_result, terug naar
-- 'scheduled' zodat de uitslag opnieuw ingevuld kan worden). De organisator
-- kan in beide gevallen ook zelf ingrijpen, als back-up voor het geval een
-- tegenstander niet reageert.

-- Interne helper: telt één wedstrijdresultaat mee in player_statistics.
-- Niet rechtstreeks aanroepbaar door de client (zie revoke onderaan) - de
-- Supabase-standaardrechten kennen EXECUTE anders alsnog toe aan anon en
-- authenticated, dus revoke from public alleen is niet genoeg.
drop function if exists public.apply_match_stats(uuid, int, int, boolean, numeric, int, int);

create or replace function public.apply_match_stats(
  p_player_id uuid,
  p_legs_won int,
  p_legs_lost int,
  p_outcome text, -- 'win' | 'draw' | 'loss'
  p_average numeric,
  p_count_180 int,
  p_highest_checkout int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.player_statistics%rowtype;
begin
  if p_outcome not in ('win', 'draw', 'loss') then
    raise exception 'Ongeldige uitslag: %.', p_outcome;
  end if;

  select * into s from public.player_statistics where player_id = p_player_id for update;
  if s.id is null then
    insert into public.player_statistics (player_id) values (p_player_id)
    returning * into s;
  end if;

  update public.player_statistics set
    matches_played       = s.matches_played + 1,
    matches_won          = s.matches_won + case when p_outcome = 'win' then 1 else 0 end,
    matches_lost         = s.matches_lost + case when p_outcome = 'loss' then 1 else 0 end,
    draws                = s.draws + case when p_outcome = 'draw' then 1 else 0 end,
    legs_played          = s.legs_played + p_legs_won + p_legs_lost,
    legs_won             = s.legs_won + p_legs_won,
    -- Weegt mee op average_sample_count (hoe vaak er ECHT een gemiddelde
    -- werd opgegeven), niet op matches_played (dat ook ophoogt wanneer het
    -- veld leeg werd gelaten) - anders zou een leeg gelaten gemiddelde het
    -- bestaande gemiddelde ten onrechte verdunnen.
    average_score        = case when p_average is null then s.average_score
                            else round(((s.average_score * s.average_sample_count) + p_average)
                                        / (s.average_sample_count + 1), 2) end,
    average_sample_count = s.average_sample_count + case when p_average is null then 0 else 1 end,
    highest_checkout     = greatest(s.highest_checkout, coalesce(p_highest_checkout, 0)),
    count_180            = s.count_180 + coalesce(p_count_180, 0),
    updated_at           = now()
  where player_id = p_player_id;
end;
$$;

revoke execute on function public.apply_match_stats(uuid, int, int, text, numeric, int, int) from public, anon, authenticated;


-- Uitslag doorgeven. Alleen door één van de twee spelers, alleen zolang de
-- wedstrijd nog open staat. Onthoudt wie hem invulde (reported_by), zodat
-- diezelfde speler hem niet ook kan bevestigen. Er wordt altijd het
-- volledige aantal legs van de league gespeeld (legs_per_match), dus een
-- gelijkspel is mogelijk (winner_id is dan null).
create or replace function public.report_league_match_result(
  p_match_id uuid,
  p_winner_id uuid,
  p_player_a_legs int,
  p_player_b_legs int,
  p_player_a_average numeric,
  p_player_b_average numeric,
  p_player_a_180s int,
  p_player_b_180s int,
  p_player_a_highest_checkout int,
  p_player_b_highest_checkout int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.league_matches%rowtype;
  v_legs_per_match int;
begin
  -- auth.uid() is NULL voor een niet-ingelogde aanroeper. Zonder deze check
  -- levert `auth.uid() <> m.player_a_id` verderop NULL op (niet true/false),
  -- en `if NULL then ...` telt in plpgsql als false - waardoor de
  -- guard-clause niet zou afgaan en een anonieme aanroeper de controle kon
  -- omzeilen.
  if auth.uid() is null then
    raise exception 'Je moet ingelogd zijn.';
  end if;

  select * into m from public.league_matches where id = p_match_id for update;

  if m.id is null then
    raise exception 'Wedstrijd niet gevonden.';
  end if;

  if auth.uid() <> m.player_a_id and auth.uid() <> m.player_b_id and not public.is_organizer() then
    raise exception 'Alleen de spelers van deze wedstrijd kunnen de uitslag doorgeven.';
  end if;

  if m.status not in ('scheduled', 'in_progress') then
    raise exception 'Deze wedstrijd staat niet meer open voor het invullen van een uitslag.';
  end if;

  select legs_per_match into v_legs_per_match from public.leagues where id = m.league_id;

  if p_player_a_legs + p_player_b_legs <> v_legs_per_match then
    raise exception 'Samen moeten de legs precies % zijn.', v_legs_per_match;
  end if;

  if p_player_a_legs = p_player_b_legs then
    if p_winner_id is not null then
      raise exception 'Bij een gelijkspel mag er geen winnaar opgegeven worden.';
    end if;
  else
    if p_winner_id is null or (p_winner_id <> m.player_a_id and p_winner_id <> m.player_b_id) then
      raise exception 'De winnaar moet één van beide spelers zijn.';
    end if;
    if (p_player_a_legs > p_player_b_legs and p_winner_id <> m.player_a_id)
       or (p_player_b_legs > p_player_a_legs and p_winner_id <> m.player_b_id) then
      raise exception 'De gekozen winnaar komt niet overeen met de legscore.';
    end if;
  end if;

  update public.league_matches set
    winner_id                  = p_winner_id,
    player_a_legs               = p_player_a_legs,
    player_b_legs               = p_player_b_legs,
    player_a_average            = p_player_a_average,
    player_b_average            = p_player_b_average,
    player_a_180s               = coalesce(p_player_a_180s, 0),
    player_b_180s               = coalesce(p_player_b_180s, 0),
    player_a_highest_checkout   = coalesce(p_player_a_highest_checkout, 0),
    player_b_highest_checkout   = coalesce(p_player_b_highest_checkout, 0),
    status                       = 'pending_confirmation',
    reported_by                  = auth.uid(),
    reported_at                  = now()
  where id = p_match_id;
end;
$$;

grant execute on function public.report_league_match_result(
  uuid, uuid, int, int, numeric, numeric, int, int, int, int
) to authenticated;


-- Uitslag bevestigen: alleen de tegenstander van wie de uitslag invulde, of
-- de organisator. Werkt bij bevestiging ook meteen player_statistics bij.
create or replace function public.confirm_league_match_result(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.league_matches%rowtype;
  is_opponent boolean;
  v_a_outcome text;
  v_b_outcome text;
begin
  -- Zie de toelichting in report_league_match_result: zonder deze check
  -- kan een niet-ingelogde aanroeper de is_opponent-berekening hieronder
  -- omzeilen doordat die met een NULL auth.uid() ook NULL oplevert.
  if auth.uid() is null then
    raise exception 'Je moet ingelogd zijn.';
  end if;

  select * into m from public.league_matches where id = p_match_id for update;

  if m.id is null then
    raise exception 'Wedstrijd niet gevonden.';
  end if;

  if m.status <> 'pending_confirmation' then
    raise exception 'Deze wedstrijd wacht niet op bevestiging.';
  end if;

  is_opponent := (auth.uid() = m.player_a_id or auth.uid() = m.player_b_id)
                 and auth.uid() <> m.reported_by;

  if not (is_opponent or public.is_organizer()) then
    raise exception 'Alleen de tegenstander of de organisator kan deze uitslag bevestigen.';
  end if;

  update public.league_matches
    set status = 'confirmed', confirmed_at = now()
    where id = p_match_id;

  if m.winner_id is null then
    v_a_outcome := 'draw';
    v_b_outcome := 'draw';
  elsif m.winner_id = m.player_a_id then
    v_a_outcome := 'win';
    v_b_outcome := 'loss';
  else
    v_a_outcome := 'loss';
    v_b_outcome := 'win';
  end if;

  perform public.apply_match_stats(
    m.player_a_id, m.player_a_legs, m.player_b_legs,
    v_a_outcome, m.player_a_average, m.player_a_180s, m.player_a_highest_checkout
  );
  perform public.apply_match_stats(
    m.player_b_id, m.player_b_legs, m.player_a_legs,
    v_b_outcome, m.player_b_average, m.player_b_180s, m.player_b_highest_checkout
  );
end;
$$;

grant execute on function public.confirm_league_match_result(uuid) to authenticated;


-- Uitslag afkeuren: alleen de tegenstander van wie de uitslag invulde, of de
-- organisator. Zet de wedstrijd terug naar 'scheduled' zodat hij opnieuw
-- ingevuld kan worden.
create or replace function public.reject_league_match_result(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.league_matches%rowtype;
  is_opponent boolean;
begin
  if auth.uid() is null then
    raise exception 'Je moet ingelogd zijn.';
  end if;

  select * into m from public.league_matches where id = p_match_id for update;

  if m.id is null then
    raise exception 'Wedstrijd niet gevonden.';
  end if;

  if m.status <> 'pending_confirmation' then
    raise exception 'Deze wedstrijd wacht niet op bevestiging.';
  end if;

  is_opponent := (auth.uid() = m.player_a_id or auth.uid() = m.player_b_id)
                 and auth.uid() <> m.reported_by;

  if not (is_opponent or public.is_organizer()) then
    raise exception 'Alleen de tegenstander of de organisator kan deze uitslag afkeuren.';
  end if;

  update public.league_matches set
    status                     = 'scheduled',
    winner_id                  = null,
    player_a_legs               = 0,
    player_b_legs               = 0,
    player_a_average            = null,
    player_b_average            = null,
    player_a_180s               = 0,
    player_b_180s               = 0,
    player_a_highest_checkout   = 0,
    player_b_highest_checkout   = 0,
    reported_by                  = null,
    reported_at                  = null
  where id = p_match_id;
end;
$$;

grant execute on function public.reject_league_match_result(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 8. Divisies binnen een league
-- ----------------------------------------------------------------------------
-- Spelers worden ingedeeld in een divisie binnen een league: vaste
-- gemiddelde-drempels (1e divisie 70+, 2e 60+, 3e 50+, 4e <50), max 12
-- spelers per divisie, min. 4 om te kunnen starten. "Automatisch indelen"
-- (auto_assign_divisions) doet de allereerste indeling op gemiddelde, zolang
-- de league nog niet actief is. "Promotie/degradatie" (apply_promotion_
-- relegation) is het doorlopende mechanisme: elk seizoen 2 op / 2 neer
-- tussen aangrenzende divisies, op basis van punten uit gespeelde
-- wedstrijden (zie league_standings voor de rangschikking).

create table if not exists public.league_divisions (
  id         uuid primary key default gen_random_uuid(),
  league_id  uuid not null references public.leagues (id) on delete cascade,
  name       text not null,
  rank       int  not null check (rank between 1 and 4),
  -- Gemiddelde-drempels voor "Automatisch indelen". null = geen ondergrens
  -- (4e divisie) resp. geen bovengrens (1e divisie).
  min_average numeric(5,2),
  max_average numeric(5,2),
  created_at timestamptz not null default now(),
  unique (league_id, rank)
);

alter table public.league_divisions
  add column if not exists min_average numeric(5,2),
  add column if not exists max_average numeric(5,2);

alter table public.league_divisions drop constraint if exists league_divisions_rank_check;
alter table public.league_divisions add constraint league_divisions_rank_check check (rank between 1 and 4);

create index if not exists idx_league_divisions_league on public.league_divisions (league_id);

alter table public.league_divisions enable row level security;

drop policy if exists "league_divisions_select_authenticated" on public.league_divisions;
create policy "league_divisions_select_authenticated"
  on public.league_divisions for select
  to authenticated
  using (true);

drop policy if exists "league_divisions_write_organizer" on public.league_divisions;
create policy "league_divisions_write_organizer"
  on public.league_divisions for all
  to authenticated
  using (public.is_organizer())
  with check (public.is_organizer());


-- Spelers krijgen een (optionele) divisie binnen de league waar ze lid van zijn.
alter table public.league_players
  add column if not exists division_id uuid references public.league_divisions (id) on delete set null;

create index if not exists idx_league_players_division on public.league_players (division_id);

-- Wedstrijden kunnen aan een divisie gekoppeld worden (optioneel, voor
-- leagues die geen divisies gebruiken).
alter table public.league_matches
  add column if not exists division_id uuid references public.league_divisions (id) on delete set null;

create index if not exists idx_league_matches_division on public.league_matches (division_id);


-- Maximaal 12 spelers per divisie. Kan niet met een CHECK-constraint (die
-- kan geen rijen tellen), dus een trigger.
create or replace function public.enforce_division_capacity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_count int;
begin
  if new.division_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.division_id is not distinct from new.division_id then
    return new;
  end if;

  select count(*) into v_count
    from public.league_players
    where division_id = new.division_id
      and id <> new.id;

  if v_count >= 12 then
    raise exception 'Deze divisie zit al vol (maximaal 12 spelers).';
  end if;

  return new;
end;
$$;

drop trigger if exists on_league_players_division_capacity on public.league_players;
create trigger on_league_players_division_capacity
  before insert or update of division_id on public.league_players
  for each row
  execute function public.enforce_division_capacity();


-- Minimaal 4 spelers in een divisie voordat er een wedstrijd in gepland mag
-- worden.
create or replace function public.enforce_division_min_players()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_count int;
begin
  if new.division_id is null then
    return new;
  end if;

  select count(*) into v_count
    from public.league_players
    where division_id = new.division_id;

  if v_count < 4 then
    raise exception 'Deze divisie heeft nog geen 4 spelers; er kunnen nog geen wedstrijden gepland worden.';
  end if;

  return new;
end;
$$;

drop trigger if exists on_league_matches_division_min_players on public.league_matches;
create trigger on_league_matches_division_min_players
  before insert on public.league_matches
  for each row
  execute function public.enforce_division_min_players();


-- Geeft bevestigde wedstrijden van een league terug, ook aan spelers die er
-- zelf niet in speelden - nodig om een standenlijst te tonen die voor
-- iedereen in de league zichtbaar is (de gewone select-policy op
-- league_matches laat een speler alleen zijn eigen wedstrijden zien). Vereist
-- wel inloggen, net als de rest van de app: dit is geen publiek endpoint.
-- (Wordt niet meer gebruikt door league_standings hieronder, die doet de
-- aggregatie zelf server-side, maar blijft bestaan voor eventueel ander
-- gebruik.)
create or replace function public.league_confirmed_matches(p_league_id uuid)
returns setof public.league_matches
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Je moet ingelogd zijn.';
  end if;

  return query
    select *
    from public.league_matches
    where league_id = p_league_id
      and status = 'confirmed';
end;
$$;

grant execute on function public.league_confirmed_matches(uuid) to authenticated;


-- Automatisch indelen op gemiddelde, met leagues.division_count (1-4)
-- divisies (zie sectie 11). Vaste drempels van hoog naar laag (70/60/50);
-- bij minder dan 4 divisies worden de eerste (division_count - 1) drempels
-- gebruikt en vangt de laatste divisie altijd de rest op (geen ondergrens).
-- Max 12 per divisie; wie boven de 12 valt zakt door naar de eerstvolgende
-- lagere divisie. Alleen zolang de league nog op 'draft' staat. Maximaal
-- division_count x 12 spelers te verwerken - anders kan de max-12-regel
-- niet gegarandeerd worden en wordt er niets uitgevoerd.
--
-- Het gebruikte gemiddelde is player_statistics.average_score zodra dat
-- betrouwbaar genoeg is (average_sample_count >= 5), anders het zelf
-- opgegeven player_onboarding.reported_average. Ontbreekt beide (zou niet
-- moeten voorkomen nu onboarding verplicht is), dan telt 0 en komt de
-- speler in de laatste divisie terecht, gemarkeerd als low_confidence in
-- het resultaat.
--
-- Logt elke daadwerkelijke wijziging (niet bij herhaald draaien op dezelfde
-- indeling) naar league_division_history en stuurt de speler een melding
-- (zie sectie 12).
create or replace function public.auto_assign_divisions(p_league_id uuid)
returns table(
  player_id uuid,
  display_name text,
  division_name text,
  effective_average numeric,
  low_confidence boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_count int;
  v_total int;
  v_league_name text;
  v_season text;
  v_div_ids uuid[];
  v_min_avgs numeric[];
  v_counts int[];
  v_thresholds numeric[] := array[70, 60, 50];
  v_name text;
  rec record;
  v_target_rank int;
  i int;
begin
  if auth.uid() is null then
    raise exception 'Je moet ingelogd zijn.';
  end if;
  if not public.is_organizer() then
    raise exception 'Alleen de organisator kan automatisch indelen.';
  end if;

  select status, division_count, name, season into v_status, v_count, v_league_name, v_season
    from public.leagues where id = p_league_id;
  if v_status is null then
    raise exception 'League niet gevonden.';
  end if;
  if v_status <> 'draft' then
    raise exception 'Automatisch indelen kan alleen zolang de league nog niet actief is.';
  end if;

  select count(*) into v_total from public.league_players where league_id = p_league_id;
  if v_total = 0 then
    raise exception 'Er zijn nog geen spelers in deze league.';
  end if;
  if v_total > v_count * 12 then
    raise exception 'Te veel spelers voor % divisie(s) van elk maximaal 12 (% spelers, max %).', v_count, v_total, v_count * 12;
  end if;

  v_counts := array_fill(0, array[v_count]);

  -- Zorg dat precies v_count divisies met de juiste drempels bestaan (naam
  -- blijft ongemoeid als de organisator die al had aangepast).
  for i in 1..v_count loop
    v_name := i || 'e divisie';
    insert into public.league_divisions (league_id, name, rank, min_average, max_average)
    values (
      p_league_id, v_name, i,
      case when i < v_count then v_thresholds[i] else null end,
      case when i > 1 then v_thresholds[i - 1] else null end
    )
    on conflict (league_id, rank) do update
      set min_average = excluded.min_average,
          max_average = excluded.max_average;
  end loop;

  -- Overtollige divisies van een eerder hoger ingesteld aantal opruimen,
  -- maar alleen als ze leeg zijn.
  delete from public.league_divisions ld
  where ld.league_id = p_league_id
    and ld.rank > v_count
    and not exists (select 1 from public.league_players lp where lp.division_id = ld.id);

  select array_agg(id order by rank), array_agg(min_average order by rank)
    into v_div_ids, v_min_avgs
    from public.league_divisions
    where league_id = p_league_id and rank between 1 and v_count;

  for rec in
    select
      lp.player_id as p_id,
      p.display_name as p_name,
      lp.division_id as old_division_id,
      coalesce(
        case when ps.average_sample_count >= 5 then ps.average_score end,
        po.reported_average,
        0
      ) as eff_avg,
      (po.player_id is null) as no_onboarding
    from public.league_players lp
    join public.profiles p on p.id = lp.player_id
    left join public.player_statistics ps on ps.player_id = lp.player_id
    left join public.player_onboarding po on po.player_id = lp.player_id
    where lp.league_id = p_league_id
    order by
      coalesce(case when ps.average_sample_count >= 5 then ps.average_score end, po.reported_average, 0) desc,
      po.reported_average desc nulls last,
      p.display_name
  loop
    -- Natuurlijke divisie o.b.v. drempel.
    v_target_rank := 1;
    while v_target_rank < v_count and v_min_avgs[v_target_rank] is not null and rec.eff_avg < v_min_avgs[v_target_rank] loop
      v_target_rank := v_target_rank + 1;
    end loop;

    -- Doorval als die divisie al vol zit (max 12).
    while v_counts[v_target_rank] >= 12 and v_target_rank < v_count loop
      v_target_rank := v_target_rank + 1;
    end loop;

    update public.league_players lp
      set division_id = v_div_ids[v_target_rank]
      where lp.league_id = p_league_id and lp.player_id = rec.p_id;

    v_counts[v_target_rank] := v_counts[v_target_rank] + 1;

    if rec.old_division_id is distinct from v_div_ids[v_target_rank] then
      insert into public.league_division_history
        (player_id, league_id, league_name, season, division_id, division_name, division_rank, reason)
      values
        (rec.p_id, p_league_id, v_league_name, v_season, v_div_ids[v_target_rank], v_target_rank || 'e divisie', v_target_rank, 'initial');

      insert into public.notifications (player_id, type, title, body, league_id)
      values (
        rec.p_id, 'division_assigned',
        'Je bent ingedeeld!',
        'Je speelt in ' || (v_target_rank || 'e divisie') || ' van ' || v_league_name || '. Bekijk je divisie en tegenstanders.',
        p_league_id
      );
    end if;

    player_id := rec.p_id;
    display_name := rec.p_name;
    division_name := v_target_rank || 'e divisie';
    effective_average := rec.eff_avg;
    low_confidence := rec.no_onboarding;
    return next;
  end loop;
end;
$$;

grant execute on function public.auto_assign_divisions(uuid) to authenticated;


-- Volledige standenlijst per divisie: punten (2 win / 1 gelijk / 0
-- verlies), dan legsaldo, dan het effectieve gemiddelde als tiebreaker (kan
-- de PRIVATE player_onboarding.reported_average zijn - die geven we dus
-- nooit als display_average terug, alleen het altijd-publieke
-- player_statistics.average_score, zodat de sortering wél de private
-- waarde mag gebruiken zonder hem aan andere spelers te tonen).
create or replace function public.league_standings(p_league_id uuid)
returns table(
  division_id uuid,
  division_name text,
  division_rank int,
  player_id uuid,
  display_name text,
  played bigint,
  wins bigint,
  draws bigint,
  losses bigint,
  legs_for bigint,
  legs_against bigint,
  points bigint,
  display_average numeric,
  position_in_division bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Je moet ingelogd zijn.';
  end if;

  return query
  with results as (
    select
      lp.division_id,
      lp.player_id,
      case when m.winner_id = lp.player_id then 1 else 0 end as win,
      case when m.winner_id is null then 1 else 0 end as draw,
      case when m.winner_id is not null and m.winner_id <> lp.player_id then 1 else 0 end as loss,
      case when m.player_a_id = lp.player_id then m.player_a_legs
           when m.player_b_id = lp.player_id then m.player_b_legs else 0 end as lw,
      case when m.player_a_id = lp.player_id then m.player_b_legs
           when m.player_b_id = lp.player_id then m.player_a_legs else 0 end as ll
    from public.league_players lp
    join public.league_matches m
      on m.league_id = lp.league_id
     and m.status = 'confirmed'
     and (m.player_a_id = lp.player_id or m.player_b_id = lp.player_id)
    where lp.league_id = p_league_id
  ),
  agg as (
    select
      lp.division_id,
      lp.player_id,
      coalesce(sum(r.win), 0)  as wins,
      coalesce(sum(r.draw), 0) as draws,
      coalesce(sum(r.loss), 0) as losses,
      coalesce(count(r.player_id), 0) as played,
      coalesce(sum(r.lw), 0)   as legs_for,
      coalesce(sum(r.ll), 0)   as legs_against,
      coalesce(sum(r.win), 0) * 2 + coalesce(sum(r.draw), 0) as points,
      coalesce(
        case when ps.average_sample_count >= 5 then ps.average_score end,
        po.reported_average, 0
      ) as sort_avg,
      coalesce(ps.average_score, 0) as pub_avg
    from public.league_players lp
    left join results r on r.player_id = lp.player_id and r.division_id is not distinct from lp.division_id
    left join public.player_statistics ps on ps.player_id = lp.player_id
    left join public.player_onboarding po on po.player_id = lp.player_id
    where lp.league_id = p_league_id
    group by lp.division_id, lp.player_id, ps.average_sample_count, ps.average_score, po.reported_average
  )
  select
    a.division_id,
    d.name,
    d.rank,
    a.player_id,
    p.display_name,
    a.played, a.wins, a.draws, a.losses,
    a.legs_for, a.legs_against, a.points,
    a.pub_avg,
    row_number() over (
      partition by a.division_id
      order by a.points desc, (a.legs_for - a.legs_against) desc, a.sort_avg desc, a.player_id
    )
  from agg a
  join public.profiles p on p.id = a.player_id
  left join public.league_divisions d on d.id = a.division_id
  order by d.rank nulls last, 14;
end;
$$;

grant execute on function public.league_standings(uuid) to authenticated;


-- Promotie/degradatie: 2 op / 2 neer tussen aangrenzende divisies, op basis
-- van dezelfde rangschikking als league_standings. Divisie 1 kent geen
-- promotie (niets erboven), divisie 4 geen degradatie (niets eronder). Bij
-- minder dan 4 spelers in een divisie wordt het aantal dat verschuift
-- verlaagd naar min(2, aantal // 2), zodat "beste 2" en "onderste 2"
-- elkaar nooit overlappen. Vervangt de oudere promote_division_winners
-- (die geen degradatie kende). Logt elke verschuiving naar
-- league_division_history en stuurt de speler een melding (zie sectie 12).
drop function if exists public.promote_division_winners(uuid);

create or replace function public.apply_promotion_relegation(p_league_id uuid)
returns table(
  player_id uuid,
  display_name text,
  movement text,
  from_division text,
  to_division text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  v_div record;
  v_move_count int;
  v_league_name text;
  v_season text;
begin
  if auth.uid() is null then
    raise exception 'Je moet ingelogd zijn.';
  end if;
  if not public.is_organizer() then
    raise exception 'Alleen de organisator kan promotie/degradatie toepassen.';
  end if;

  select name, season into v_league_name, v_season from public.leagues where id = p_league_id;
  if v_league_name is null then
    raise exception 'League niet gevonden.';
  end if;

  -- Bevroren rangschikking: beide passes (promotie en degradatie) gebruiken
  -- dezelfde momentopname, zodat een verschuiving in de ene divisiegrens de
  -- berekening van een andere grens niet beïnvloedt.
  create temporary table tmp_pr_standings on commit drop as
  select s.*, count(*) over (partition by s.division_id) as division_size
  from public.league_standings(p_league_id) s
  where s.division_id is not null;

  -- Promotie: beste N van elke divisie (behalve rank 1) naar rank - 1.
  for v_div in
    select distinct division_id, division_rank, division_size from tmp_pr_standings where division_rank > 1
  loop
    v_move_count := least(2, v_div.division_size / 2);
    if v_move_count > 0 then
      for rec in
        select ts.player_id as p_id, p.display_name as p_name,
               d_from.name as from_name, d_to.id as to_id, d_to.name as to_name, d_to.rank as to_rank
        from tmp_pr_standings ts
        join public.profiles p on p.id = ts.player_id
        join public.league_divisions d_from on d_from.id = ts.division_id
        join public.league_divisions d_to
          on d_to.league_id = d_from.league_id and d_to.rank = d_from.rank - 1
        where ts.division_id = v_div.division_id
          and ts.position_in_division <= v_move_count
      loop
        update public.league_players lp
          set division_id = rec.to_id
          where lp.league_id = p_league_id and lp.player_id = rec.p_id;

        insert into public.league_division_history
          (player_id, league_id, league_name, season, division_id, division_name, division_rank, reason)
        values
          (rec.p_id, p_league_id, v_league_name, v_season, rec.to_id, rec.to_name, rec.to_rank, 'promotion');

        insert into public.notifications (player_id, type, title, body, league_id)
        values (
          rec.p_id, 'division_promoted',
          'Gefeliciteerd! Je bent gepromoveerd.',
          'Je speelt vanaf nu in ' || rec.to_name || ' van ' || v_league_name || '.',
          p_league_id
        );

        player_id := rec.p_id;
        display_name := rec.p_name;
        movement := 'promotie';
        from_division := rec.from_name;
        to_division := rec.to_name;
        return next;
      end loop;
    end if;
  end loop;

  -- Degradatie: onderste N van elke divisie (behalve rank 4) naar rank + 1.
  for v_div in
    select distinct division_id, division_rank, division_size from tmp_pr_standings where division_rank < 4
  loop
    v_move_count := least(2, v_div.division_size / 2);
    if v_move_count > 0 then
      for rec in
        select ts.player_id as p_id, p.display_name as p_name,
               d_from.name as from_name, d_to.id as to_id, d_to.name as to_name, d_to.rank as to_rank
        from tmp_pr_standings ts
        join public.profiles p on p.id = ts.player_id
        join public.league_divisions d_from on d_from.id = ts.division_id
        join public.league_divisions d_to
          on d_to.league_id = d_from.league_id and d_to.rank = d_from.rank + 1
        where ts.division_id = v_div.division_id
          and ts.position_in_division > (v_div.division_size - v_move_count)
      loop
        update public.league_players lp
          set division_id = rec.to_id
          where lp.league_id = p_league_id and lp.player_id = rec.p_id;

        insert into public.league_division_history
          (player_id, league_id, league_name, season, division_id, division_name, division_rank, reason)
        values
          (rec.p_id, p_league_id, v_league_name, v_season, rec.to_id, rec.to_name, rec.to_rank, 'relegation');

        insert into public.notifications (player_id, type, title, body, league_id)
        values (
          rec.p_id, 'division_relegated',
          'Divisiewijziging',
          'Je speelt vanaf nu in ' || rec.to_name || ' van ' || v_league_name || '.',
          p_league_id
        );

        player_id := rec.p_id;
        display_name := rec.p_name;
        movement := 'degradatie';
        from_division := rec.from_name;
        to_division := rec.to_name;
        return next;
      end loop;
    end if;
  end loop;
end;
$$;

grant execute on function public.apply_promotion_relegation(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 9. Spelersgegevens voor de initiële indeling
-- ----------------------------------------------------------------------------
-- Na het aanmaken van een account vult een speler eenmalig voornaam,
-- achternaam, platform (Scolia/DartCounter), nickname op dat platform en
-- zijn zelf opgegeven 3-darts gemiddelde in. Dit is bedoeld voor de
-- organisator om spelers voor het eerst in een divisie in te delen, en is
-- daarom - anders dan profiles - NIET zichtbaar voor andere spelers.

create table if not exists public.player_onboarding (
  player_id         uuid primary key references public.profiles (id) on delete cascade,
  first_name        text not null,
  last_name         text not null,
  platform          text not null check (platform in ('scolia', 'dartcounter')),
  platform_nickname text not null,
  reported_average  numeric(5,2) not null check (reported_average >= 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.player_onboarding is
  'Eenmalig ingevulde spelersgegevens (voor-/achternaam, platform, nickname, zelf opgegeven gemiddelde). Alleen zichtbaar voor de speler zelf en de organisator; gebruikt voor de initiële divisie-indeling.';

alter table public.player_onboarding enable row level security;

drop policy if exists "player_onboarding_select_own_or_organizer" on public.player_onboarding;
create policy "player_onboarding_select_own_or_organizer"
  on public.player_onboarding for select
  to authenticated
  using (player_id = auth.uid() or public.is_organizer());

drop policy if exists "player_onboarding_insert_own" on public.player_onboarding;
create policy "player_onboarding_insert_own"
  on public.player_onboarding for insert
  to authenticated
  with check (player_id = auth.uid());

drop policy if exists "player_onboarding_update_own_or_organizer" on public.player_onboarding;
create policy "player_onboarding_update_own_or_organizer"
  on public.player_onboarding for update
  to authenticated
  using (player_id = auth.uid() or public.is_organizer())
  with check (player_id = auth.uid() or public.is_organizer());

-- updated_at automatisch bijwerken bij elke wijziging.
create or replace function public.touch_player_onboarding_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists on_player_onboarding_update on public.player_onboarding;
create trigger on_player_onboarding_update
  before update on public.player_onboarding
  for each row
  execute function public.touch_player_onboarding_updated_at();


-- ----------------------------------------------------------------------------
-- 10. Prijsclaim-systeem voor divisiewinnaars (LWPrints)
-- ----------------------------------------------------------------------------
-- Aan het einde van een afgeronde league (status 'finished') bepaalt de
-- organisator de winnaar (positie 1, alleen divisies waarin gespeeld is) van
-- elke divisie via determine_division_winners(). Dat is een permanente,
-- "bevroren" historie (naam/rank/league/season worden gekopieerd) die niet
-- verandert door latere promotie/degradatie. Elke winnaar krijgt meteen een
-- prize_claims-rij (status 'available') en een prize_notifications-rij.
--
-- De winnaar claimt zijn prijs via start_prize_claim() (available ->
-- claim_started, bij het openen van het formulier) en submit_prize_claim()
-- (vult/corrigeert zijn gegevens in, zet naar 'claimed'). Bewerken kan tot
-- de organisator de claim bevestigt (confirmed); daarna alleen nog de
-- organisator zelf, via update_prize_claim_status() of een rechtstreekse
-- update. Elke statuswijziging wordt gelogd in prize_status_history.
--
-- prize_claims heeft bewust geen insert/update-policy voor de speler zelf:
-- alle speler-mutaties lopen via de functies hierboven, die precies bepalen
-- welke velden een winnaar mag zetten (nooit status of admin_notes). Net als
-- player_onboarding is dit NIET zichtbaar voor andere spelers, in
-- tegenstelling tot profiles.

create table if not exists public.division_winners (
  id            uuid primary key default gen_random_uuid(),
  league_id     uuid not null references public.leagues (id) on delete cascade,
  division_id   uuid references public.league_divisions (id) on delete set null,
  division_name text not null,
  division_rank int  not null,
  league_name   text not null,
  season        text,
  player_id     uuid not null references public.profiles (id) on delete restrict,
  decided_at    timestamptz not null default now(),
  created_by    uuid references public.profiles (id) on delete set null,
  unique (league_id, division_rank)
);

create index if not exists idx_division_winners_player on public.division_winners (player_id);

alter table public.division_winners enable row level security;

drop policy if exists "division_winners_select_authenticated" on public.division_winners;
create policy "division_winners_select_authenticated"
  on public.division_winners for select
  to authenticated
  using (true);

drop policy if exists "division_winners_write_organizer" on public.division_winners;
create policy "division_winners_write_organizer"
  on public.division_winners for all
  to authenticated
  using (public.is_organizer())
  with check (public.is_organizer());


create table if not exists public.prize_claims (
  id                            uuid primary key default gen_random_uuid(),
  division_winner_id            uuid not null unique references public.division_winners (id) on delete cascade,
  player_id                     uuid not null references public.profiles (id) on delete cascade,
  status                        text not null default 'available' check (status in (
                                  'available', 'claim_started', 'claimed', 'reviewing',
                                  'contact_pending', 'confirmed', 'in_production',
                                  'ready', 'delivered', 'cancelled'
                                )),
  full_name                     text,
  email                         text,
  phone                         text,
  garment                       text check (garment in ('tshirt', 'hoodie', 'polo')),
  size                          text check (size in ('xs', 's', 'm', 'l', 'xl', 'xxl', 'xxxl')),
  color                         text,
  design_notes                  text,
  comments                      text,
  consent_share_with_lwprints   boolean not null default false,
  consent_given_at              timestamptz,
  admin_notes                   text,
  submitted_at                  timestamptz,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

create index if not exists idx_prize_claims_player on public.prize_claims (player_id);

alter table public.prize_claims enable row level security;

drop policy if exists "prize_claims_select_own_or_organizer" on public.prize_claims;
create policy "prize_claims_select_own_or_organizer"
  on public.prize_claims for select
  to authenticated
  using (player_id = auth.uid() or public.is_organizer());

drop policy if exists "prize_claims_write_organizer" on public.prize_claims;
create policy "prize_claims_write_organizer"
  on public.prize_claims for all
  to authenticated
  using (public.is_organizer())
  with check (public.is_organizer());

create or replace function public.touch_prize_claims_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists on_prize_claims_update on public.prize_claims;
create trigger on_prize_claims_update
  before update on public.prize_claims
  for each row
  execute function public.touch_prize_claims_updated_at();


-- In-app melding voor de winnaar. email_sent_at blijft voorlopig altijd
-- leeg (geen e-mailprovider aangesloten); zo kan dat later zonder
-- schemawijziging aangesloten worden.
create table if not exists public.prize_notifications (
  id              uuid primary key default gen_random_uuid(),
  player_id       uuid not null references public.profiles (id) on delete cascade,
  prize_claim_id  uuid not null references public.prize_claims (id) on delete cascade,
  title           text not null,
  body            text not null,
  email_sent_at   timestamptz,
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists idx_prize_notifications_player on public.prize_notifications (player_id);

alter table public.prize_notifications enable row level security;

drop policy if exists "prize_notifications_select_own_or_organizer" on public.prize_notifications;
create policy "prize_notifications_select_own_or_organizer"
  on public.prize_notifications for select
  to authenticated
  using (player_id = auth.uid() or public.is_organizer());

drop policy if exists "prize_notifications_update_own" on public.prize_notifications;
create policy "prize_notifications_update_own"
  on public.prize_notifications for update
  to authenticated
  using (player_id = auth.uid())
  with check (player_id = auth.uid());


-- Audit-log van statuswijzigingen. Alleen zichtbaar voor de organisator; de
-- winnaar ziet alleen de huidige status op zijn eigen pagina.
create table if not exists public.prize_status_history (
  id              uuid primary key default gen_random_uuid(),
  prize_claim_id  uuid not null references public.prize_claims (id) on delete cascade,
  old_status      text,
  new_status      text not null,
  note            text,
  changed_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists idx_prize_status_history_claim on public.prize_status_history (prize_claim_id);

alter table public.prize_status_history enable row level security;

drop policy if exists "prize_status_history_select_organizer" on public.prize_status_history;
create policy "prize_status_history_select_organizer"
  on public.prize_status_history for select
  to authenticated
  using (public.is_organizer());


create or replace function public.determine_division_winners(p_league_id uuid)
returns table(
  won_player_id uuid,
  won_display_name text,
  won_division_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_league_name text;
  v_season text;
  rec record;
  v_new_id uuid;
  v_claim_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Je moet ingelogd zijn.';
  end if;
  if not public.is_organizer() then
    raise exception 'Alleen de organisator kan divisiewinnaars bepalen.';
  end if;

  select status, name, season into v_status, v_league_name, v_season
    from public.leagues where id = p_league_id;
  if v_status is null then
    raise exception 'League niet gevonden.';
  end if;
  if v_status <> 'finished' then
    raise exception 'Divisiewinnaars kunnen pas bepaald worden als de league is afgerond.';
  end if;

  for rec in
    select
      s.player_id as pid, s.display_name as pname, s.division_id as did,
      s.division_name as dname, s.division_rank as drank
    from public.league_standings(p_league_id) s
    where s.position_in_division = 1
      and s.division_id is not null
      and s.played > 0
  loop
    v_new_id := null;

    insert into public.division_winners (
      league_id, division_id, division_name, division_rank,
      league_name, season, player_id, created_by
    ) values (
      p_league_id, rec.did, rec.dname, rec.drank,
      v_league_name, v_season, rec.pid, auth.uid()
    )
    on conflict (league_id, division_rank) do nothing
    returning id into v_new_id;

    if v_new_id is not null then
      insert into public.prize_claims (division_winner_id, player_id, full_name, email)
      values (
        v_new_id, rec.pid, rec.pname,
        (select email from public.profiles where id = rec.pid)
      )
      returning id into v_claim_id;

      insert into public.prize_notifications (player_id, prize_claim_id, title, body)
      values (
        rec.pid, v_claim_id,
        'Gefeliciteerd! Je hebt ' || rec.dname || ' gewonnen',
        'Je bent winnaar geworden van ' || rec.dname || '. Je hebt een gepersonaliseerd ' ||
        'kledingstuk gewonnen, beschikbaar gesteld door LWPrints.'
      );

      won_player_id := rec.pid;
      won_display_name := rec.pname;
      won_division_name := rec.dname;
      return next;
    end if;
  end loop;
end;
$$;

grant execute on function public.determine_division_winners(uuid) to authenticated;


-- De winnaar klikt "Prijs claimen": zet available -> claim_started, zodat
-- de organisator ziet dat het formulier geopend is. Idempotent (no-op als
-- de status al verder is).
create or replace function public.start_prize_claim(p_division_winner_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_winner_player_id uuid;
  v_claim public.prize_claims%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Je moet ingelogd zijn.';
  end if;

  select player_id into v_winner_player_id
    from public.division_winners where id = p_division_winner_id;
  if v_winner_player_id is null or v_winner_player_id <> auth.uid() then
    raise exception 'Dit is niet jouw prijs.';
  end if;

  select * into v_claim from public.prize_claims
    where division_winner_id = p_division_winner_id for update;
  if v_claim.id is null then
    raise exception 'Claim niet gevonden.';
  end if;

  if v_claim.status = 'available' then
    update public.prize_claims set status = 'claim_started' where id = v_claim.id;
    insert into public.prize_status_history (prize_claim_id, old_status, new_status, changed_by)
    values (v_claim.id, 'available', 'claim_started', auth.uid());
  end if;
end;
$$;

grant execute on function public.start_prize_claim(uuid) to authenticated;


-- De winnaar dient (of corrigeert) zijn claim in. Alleen de velden die een
-- winnaar mag zetten; status/admin_notes zijn hier bewust niet aanraakbaar.
-- Bewerken kan zolang de organisator de claim nog niet bevestigd heeft
-- (confirmed/in_production/ready/delivered/cancelled = op slot).
create or replace function public.submit_prize_claim(
  p_division_winner_id uuid,
  p_full_name text,
  p_email text,
  p_phone text,
  p_garment text,
  p_size text,
  p_color text,
  p_design_notes text,
  p_comments text,
  p_consent boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_winner_player_id uuid;
  v_claim public.prize_claims%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Je moet ingelogd zijn.';
  end if;

  select player_id into v_winner_player_id
    from public.division_winners where id = p_division_winner_id;
  if v_winner_player_id is null then
    raise exception 'Prijs niet gevonden.';
  end if;
  if v_winner_player_id <> auth.uid() then
    raise exception 'Dit is niet jouw prijs.';
  end if;

  select * into v_claim from public.prize_claims
    where division_winner_id = p_division_winner_id for update;
  if v_claim.id is null then
    raise exception 'Claim niet gevonden.';
  end if;

  if v_claim.status in ('confirmed', 'in_production', 'ready', 'delivered', 'cancelled') then
    raise exception 'Deze prijs staat niet meer open om te wijzigen. Neem contact op met de organisator.';
  end if;

  if p_full_name is null or trim(p_full_name) = '' then
    raise exception 'Vul je naam in.';
  end if;
  if p_email is null or p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Vul een geldig e-mailadres in.';
  end if;
  if p_garment is not null and p_garment not in ('tshirt', 'hoodie', 'polo') then
    raise exception 'Ongeldige keuze voor kledingstuk.';
  end if;
  if p_size is not null and p_size not in ('xs', 's', 'm', 'l', 'xl', 'xxl', 'xxxl') then
    raise exception 'Ongeldige maat.';
  end if;
  if not p_consent then
    raise exception 'Je moet akkoord gaan met het delen van je gegevens met LWPrints om te kunnen claimen.';
  end if;

  update public.prize_claims set
    status                       = case when v_claim.status in ('available', 'claim_started')
                                    then 'claimed' else v_claim.status end,
    full_name                    = p_full_name,
    email                        = p_email,
    phone                        = p_phone,
    garment                      = p_garment,
    size                         = p_size,
    color                        = p_color,
    design_notes                 = p_design_notes,
    comments                     = p_comments,
    consent_share_with_lwprints  = p_consent,
    consent_given_at             = case when v_claim.consent_share_with_lwprints
                                    then v_claim.consent_given_at else now() end,
    submitted_at                 = now()
  where id = v_claim.id;

  if v_claim.status in ('available', 'claim_started') then
    insert into public.prize_status_history (prize_claim_id, old_status, new_status, changed_by)
    values (v_claim.id, v_claim.status, 'claimed', auth.uid());
  end if;
end;
$$;

grant execute on function public.submit_prize_claim(
  uuid, text, text, text, text, text, text, text, text, boolean
) to authenticated;


-- Organisator wijzigt de status (incl. "markeer als uitgereikt" = delivered)
-- en legt dat vast in prize_status_history.
create or replace function public.update_prize_claim_status(
  p_claim_id uuid,
  p_new_status text,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_status text;
begin
  if auth.uid() is null then
    raise exception 'Je moet ingelogd zijn.';
  end if;
  if not public.is_organizer() then
    raise exception 'Alleen de organisator kan de status wijzigen.';
  end if;
  if p_new_status not in (
    'available', 'claim_started', 'claimed', 'reviewing', 'contact_pending',
    'confirmed', 'in_production', 'ready', 'delivered', 'cancelled'
  ) then
    raise exception 'Ongeldige status: %.', p_new_status;
  end if;

  select status into v_old_status from public.prize_claims where id = p_claim_id for update;
  if v_old_status is null then
    raise exception 'Claim niet gevonden.';
  end if;

  update public.prize_claims set status = p_new_status where id = p_claim_id;

  insert into public.prize_status_history (prize_claim_id, old_status, new_status, note, changed_by)
  values (p_claim_id, v_old_status, p_new_status, p_note, auth.uid());
end;
$$;

grant execute on function public.update_prize_claim_status(uuid, text, text) to authenticated;


-- ============================================================================
-- 11. Startdatum/-tijd van een league, automatische activering en wedstrijd-
--     generatie, en het voorstellen/accepteren van een wedstrijdmoment.
--     (leagues.description/division_count/start_at/timezone/end_at/
--     match_deadline_days en het status-check hierboven bij de leagues-
--     tabel horen ook bij deze sectie, evenals de bijgewerkte
--     auto_assign_divisions hierboven.)
-- ============================================================================

-- Wedstrijddeadline: uiterlijke speeldatum (start_at + match_deadline_days).
alter table public.league_matches
  add column if not exists deadline_at timestamptz;

-- Voorkomt dubbele wedstrijden tussen hetzelfde paar in dezelfde divisie bij
-- herhaald genereren (idempotent), ongeacht wie player_a/player_b is.
create unique index if not exists idx_league_matches_unique_division_pair
  on public.league_matches (league_id, division_id, least(player_a_id, player_b_id), greatest(player_a_id, player_b_id))
  where division_id is not null;


-- Startdatum/-tijd, tijdzone en aantal divisies liggen vast zodra de league
-- actief is (of afgerond): dan zijn er al wedstrijden op gebaseerd. Inplannen
-- ("scheduled") vereist een startmoment in de toekomst en dat de leden nog
-- niet al in een andere geplande/actieve league zitten (zie sectie 12, de
-- één-actieve-league-regel). Het aantal divisies verlagen mag niet als er
-- nog spelers in de divisies zitten die daarmee zouden vervallen.
create or replace function public.protect_league_schedule_fields()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_occupied boolean;
  v_conflict_name text;
begin
  if old.status in ('active', 'finished') then
    if new.start_at is distinct from old.start_at
       or new.timezone is distinct from old.timezone
       or new.division_count is distinct from old.division_count then
      raise exception 'Startdatum, tijdzone en aantal divisies kunnen niet meer gewijzigd worden nadat de league actief is.';
    end if;
  end if;

  if new.status = 'scheduled' and (new.start_at is null or new.start_at <= now()) then
    raise exception 'Stel een startdatum en -tijd in de toekomst in om de league te plannen.';
  end if;

  if new.status = 'scheduled' and old.status <> 'scheduled' then
    select p.display_name into v_conflict_name
      from public.league_players lp
      join public.profiles p on p.id = lp.player_id
      join public.league_players lp2 on lp2.player_id = lp.player_id and lp2.league_id <> new.id
      join public.leagues l2 on l2.id = lp2.league_id and l2.status in ('scheduled', 'active')
      where lp.league_id = new.id
      limit 1;
    if v_conflict_name is not null then
      raise exception 'Speler % zit al in een andere geplande of actieve league; los dit eerst op voordat je deze league plant.', v_conflict_name;
    end if;
  end if;

  if new.division_count < old.division_count then
    select exists (
      select 1
      from public.league_players lp
      join public.league_divisions ld on ld.id = lp.division_id
      where lp.league_id = new.id
        and ld.rank > new.division_count
    ) into v_occupied;
    if v_occupied then
      raise exception 'Er zitten nog spelers in een divisie die zou vervallen; verplaats hen eerst naar een lagere divisie.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists on_leagues_protect_schedule_fields on public.leagues;
create trigger on_leagues_protect_schedule_fields
  before update on public.leagues
  for each row
  execute function public.protect_league_schedule_fields();


-- Generieke meldingen (los van de bestaande prize_notifications).
create table if not exists public.notifications (
  id              uuid primary key default gen_random_uuid(),
  player_id       uuid not null references public.profiles (id) on delete cascade,
  type            text not null,
  title           text not null,
  body            text,
  league_id       uuid references public.leagues (id) on delete cascade,
  league_match_id uuid references public.league_matches (id) on delete cascade,
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists idx_notifications_player on public.notifications (player_id);

alter table public.notifications enable row level security;

drop policy if exists "notifications_select_own_or_organizer" on public.notifications;
create policy "notifications_select_own_or_organizer"
  on public.notifications for select
  to authenticated
  using (player_id = auth.uid() or public.is_organizer());

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own"
  on public.notifications for update
  to authenticated
  using (player_id = auth.uid())
  with check (player_id = auth.uid());

-- Let op: bewust geen insert-policy - meldingen ontstaan uitsluitend via de
-- security-definer functies hieronder.


-- Voorstellen van een wedstrijdmoment (propose/accept/counter/dispute).
create table if not exists public.match_schedule_proposals (
  id              uuid primary key default gen_random_uuid(),
  league_match_id uuid not null unique references public.league_matches (id) on delete cascade,
  proposed_by     uuid not null references public.profiles (id) on delete cascade,
  proposed_at     timestamptz not null,
  status          text not null default 'pending'
                    check (status in ('pending', 'accepted', 'countered', 'disputed')),
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.match_schedule_proposals enable row level security;

drop policy if exists "match_schedule_proposals_select_participants" on public.match_schedule_proposals;
create policy "match_schedule_proposals_select_participants"
  on public.match_schedule_proposals for select
  to authenticated
  using (
    exists (
      select 1 from public.league_matches m
      where m.id = match_schedule_proposals.league_match_id
        and (m.player_a_id = auth.uid() or m.player_b_id = auth.uid())
    )
    or public.is_organizer()
  );

-- Let op: bewust geen insert/update-policy - uitsluitend via de
-- security-definer functies hieronder, die bepalen wie wat mag.

create or replace function public.touch_match_schedule_proposals_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_match_schedule_proposals_touch on public.match_schedule_proposals;
create trigger on_match_schedule_proposals_touch
  before update on public.match_schedule_proposals
  for each row
  execute function public.touch_match_schedule_proposals_updated_at();


-- Round-robin binnen elke divisie van minimaal 4 spelers. Elke wedstrijd
-- krijgt zijn eigen available_at (moment waarop deze specifieke wedstrijd
-- beschikbaar werd) en deadline_at = available_at + match_deadline_days -
-- zie sectie 13: dit hangt nooit af van een andere wedstrijd. Vandaag
-- ontstaan alle wedstrijden van een divisie nog gelijktijdig (bij het
-- starten van de league), dus available_at = league.start_at voor
-- iedereen; zodra wedstrijden per ronde vrijgegeven worden, wordt dit per
-- aanroep ingevuld met het eigen moment van die ronde. Intern (geen grant
-- naar authenticated/anon): wordt alleen aangeroepen door activate_league
-- hieronder.
create or replace function public.generate_league_matches(p_league_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_league record;
  v_available timestamptz;
  v_deadline timestamptz;
  v_count int := 0;
  rec record;
begin
  select * into v_league from public.leagues where id = p_league_id;
  if v_league is null then
    raise exception 'League niet gevonden.';
  end if;
  if v_league.start_at is null then
    raise exception 'League heeft nog geen startmoment.';
  end if;

  v_available := v_league.start_at;
  v_deadline := v_available + make_interval(days => v_league.match_deadline_days);

  for rec in
    select a.player_id as a_id, b.player_id as b_id, a.division_id as div_id
    from public.league_players a
    join public.league_players b
      on b.league_id = a.league_id
     and b.division_id = a.division_id
     and b.player_id > a.player_id
    where a.league_id = p_league_id
      and a.division_id is not null
      and (select count(*) from public.league_players lp where lp.division_id = a.division_id) >= 4
  loop
    insert into public.league_matches
      (league_id, division_id, player_a_id, player_b_id, scheduled_at, available_at, deadline_at, status)
    values
      (p_league_id, rec.div_id, rec.a_id, rec.b_id, v_available, v_available, v_deadline, 'scheduled')
    on conflict (league_id, division_id, least(player_a_id, player_b_id), greatest(player_a_id, player_b_id))
      where division_id is not null
      do nothing;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.generate_league_matches(uuid) from public, anon, authenticated;


-- Zet de league op 'active' zodra het startmoment is bereikt, genereert dan
-- de wedstrijden en stuurt iedere speler een melding. Idempotent: de
-- voorwaardelijke UPDATE ... RETURNING slaagt maar één keer, dus een tweede
-- aanroep (cron of opportunistisch vanuit de app) doet niets.
create or replace function public.activate_league(p_league_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_match_count int;
begin
  update public.leagues
    set status = 'active'
    where id = p_league_id
      and status = 'scheduled'
      and start_at is not null
      and start_at <= now()
    returning id into v_id;

  if v_id is null then
    return false;
  end if;

  v_match_count := public.generate_league_matches(p_league_id);

  insert into public.notifications (player_id, type, title, body, league_id)
  select lp.player_id, 'league_started',
         'De league is gestart: ' || l.name,
         'Bekijk je wedstrijden - speel ze binnen ' || l.match_deadline_days || ' dagen.',
         l.id
  from public.league_players lp
  join public.leagues l on l.id = lp.league_id
  where lp.league_id = p_league_id;

  return true;
end;
$$;

revoke execute on function public.activate_league(uuid) from public, anon, authenticated;


-- Cron-doel: activeert alle leagues waarvan het startmoment voorbij is. Nooit
-- direct aanroepbaar door gebruikers.
create or replace function public.activate_due_leagues()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  rec record;
begin
  for rec in
    select id from public.leagues
    where status = 'scheduled' and start_at is not null and start_at <= now()
  loop
    if public.activate_league(rec.id) then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.activate_due_leagues() from public, anon, authenticated;


-- Veilige, door de app aanroepbare wrapper: activeert één specifieke league
-- als (en alleen als) die al voorbij zijn startmoment is. Gebruikt zodat een
-- speler die op het exacte moment inlogt niet tot een cron-tik hoeft te
-- wachten (max. 1 minuut vertraging).
create or replace function public.activate_league_if_due(p_league_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Je moet ingelogd zijn.';
  end if;
  return public.activate_league(p_league_id);
end;
$$;

grant execute on function public.activate_league_if_due(uuid) to authenticated;


-- Wedstrijdmoment voorstellen / accepteren / tegenvoorstel / probleem.
create or replace function public.propose_match_schedule(p_match_id uuid, p_proposed_at timestamptz, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  v_opponent uuid;
begin
  if auth.uid() is null then
    raise exception 'Je moet ingelogd zijn.';
  end if;

  select * into m from public.league_matches where id = p_match_id;
  if m is null then
    raise exception 'Wedstrijd niet gevonden.';
  end if;
  if auth.uid() <> m.player_a_id and auth.uid() <> m.player_b_id then
    raise exception 'Alleen de deelnemers kunnen een moment voorstellen.';
  end if;
  if m.status not in ('scheduled', 'in_progress') then
    raise exception 'Deze wedstrijd staat niet meer open om te plannen.';
  end if;
  if p_proposed_at <= now() then
    raise exception 'Kies een moment in de toekomst.';
  end if;
  if m.deadline_at is not null and p_proposed_at > m.deadline_at then
    raise exception 'Het voorgestelde moment ligt na de deadline van deze wedstrijd.';
  end if;

  v_opponent := case when auth.uid() = m.player_a_id then m.player_b_id else m.player_a_id end;

  insert into public.match_schedule_proposals (league_match_id, proposed_by, proposed_at, status, note)
  values (p_match_id, auth.uid(), p_proposed_at, 'pending', p_note)
  on conflict (league_match_id) do update
    set proposed_by = excluded.proposed_by,
        proposed_at = excluded.proposed_at,
        status = 'pending',
        note = excluded.note,
        updated_at = now();

  insert into public.notifications (player_id, type, title, body, league_match_id)
  values (
    v_opponent, 'match_schedule_proposed',
    'Nieuw voorstel voor jullie wedstrijd',
    'Reageer: accepteer, doe een tegenvoorstel of meld een probleem.',
    p_match_id
  );
end;
$$;

grant execute on function public.propose_match_schedule(uuid, timestamptz, text) to authenticated;


create or replace function public.respond_match_schedule(
  p_match_id uuid,
  p_action text,
  p_proposed_at timestamptz default null,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  prop record;
  v_other uuid;
begin
  if auth.uid() is null then
    raise exception 'Je moet ingelogd zijn.';
  end if;
  if p_action not in ('accept', 'counter', 'dispute') then
    raise exception 'Ongeldige actie.';
  end if;

  select * into m from public.league_matches where id = p_match_id;
  if m is null then
    raise exception 'Wedstrijd niet gevonden.';
  end if;
  if auth.uid() <> m.player_a_id and auth.uid() <> m.player_b_id then
    raise exception 'Alleen de deelnemers kunnen reageren.';
  end if;

  select * into prop from public.match_schedule_proposals where league_match_id = p_match_id for update;
  if prop is null then
    raise exception 'Er is nog geen voorstel voor deze wedstrijd.';
  end if;
  if prop.proposed_by = auth.uid() then
    raise exception 'Je kunt niet op je eigen voorstel reageren.';
  end if;

  v_other := prop.proposed_by;

  if p_action = 'accept' then
    update public.match_schedule_proposals
      set status = 'accepted'
      where league_match_id = p_match_id;
    update public.league_matches
      set scheduled_at = prop.proposed_at
      where id = p_match_id;
    insert into public.notifications (player_id, type, title, body, league_match_id)
    values (v_other, 'match_schedule_accepted', 'Voorstel geaccepteerd',
            'Jullie wedstrijd staat gepland.', p_match_id);

  elsif p_action = 'counter' then
    if p_proposed_at is null then
      raise exception 'Geef een tegenvoorstel-moment op.';
    end if;
    if p_proposed_at <= now() then
      raise exception 'Kies een moment in de toekomst.';
    end if;
    if m.deadline_at is not null and p_proposed_at > m.deadline_at then
      raise exception 'Het voorgestelde moment ligt na de deadline van deze wedstrijd.';
    end if;
    update public.match_schedule_proposals
      set proposed_by = auth.uid(), proposed_at = p_proposed_at,
          status = 'countered', note = p_note
      where league_match_id = p_match_id;
    insert into public.notifications (player_id, type, title, body, league_match_id)
    values (v_other, 'match_schedule_countered', 'Tegenvoorstel ontvangen',
            'Reageer op het nieuwe voorgestelde moment.', p_match_id);

  else
    update public.match_schedule_proposals
      set status = 'disputed', note = coalesce(p_note, prop.note)
      where league_match_id = p_match_id;
    insert into public.notifications (player_id, type, title, body, league_match_id)
    values (v_other, 'match_schedule_disputed', 'Probleem gemeld',
            coalesce(p_note, 'Er is een probleem gemeld met het voorgestelde moment.'), p_match_id);
  end if;
end;
$$;

grant execute on function public.respond_match_schedule(uuid, text, timestamptz, text) to authenticated;


-- pg_cron: elke minuut controleren op leagues die moeten starten. Idempotent
-- (cron.schedule met een bestaande jobnaam werkt bij als upsert).
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

select cron.schedule(
  'activate_due_leagues',
  '* * * * *',
  $cron$select public.activate_due_leagues();$cron$
);


-- ============================================================================
-- 12. Divisiehistorie, één-actieve-league-regel, en meldingen bij
--     indeling/promotie/degradatie.
--     (De relevante wijzigingen aan protect_league_schedule_fields(),
--     auto_assign_divisions() en apply_promotion_relegation() staan
--     hierboven, direct bij hun oorspronkelijke definitie.)
-- ============================================================================

-- Permanente historie van divisie-indelingen (nooit overschreven, ook niet
-- door latere promotie/degradatie of een nieuwe automatische indeling).
create table if not exists public.league_division_history (
  id             uuid primary key default gen_random_uuid(),
  player_id      uuid not null references public.profiles (id) on delete cascade,
  league_id      uuid not null references public.leagues (id) on delete cascade,
  league_name    text not null,
  season         text,
  division_id    uuid references public.league_divisions (id) on delete set null,
  division_name  text not null,
  division_rank  int,
  reason         text not null check (reason in ('initial', 'promotion', 'relegation', 'correction')),
  effective_at   timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

create index if not exists idx_league_division_history_player on public.league_division_history (player_id);
create index if not exists idx_league_division_history_league on public.league_division_history (league_id);

alter table public.league_division_history enable row level security;

drop policy if exists "league_division_history_select_own_or_organizer" on public.league_division_history;
create policy "league_division_history_select_own_or_organizer"
  on public.league_division_history for select
  to authenticated
  using (player_id = auth.uid() or public.is_organizer());

-- Let op: bewust geen insert/update-policy - uitsluitend geschreven door
-- auto_assign_divisions() en apply_promotion_relegation() (beide security
-- definer), zodat de historie nooit door een cliënt aangepast kan worden.


-- Eén speler mag maar in één geplande/actieve league tegelijk zitten. Geldt
-- bewust NIET voor 'draft'-leagues (een organisator mag een speler best in
-- meerdere concept-leagues overwegen voordat hij kiest), en niet voor
-- 'finished' (die tellen niet meer mee als lopende verplichting). Werkt
-- samen met de check in protect_league_schedule_fields() hierboven, die
-- dezelfde regel afdwingt op het moment dat een league zelf naar
-- 'scheduled' gaat.
create or replace function public.enforce_single_active_league()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_status text;
  v_conflict_name text;
begin
  select status into v_status from public.leagues where id = new.league_id;
  if v_status is null or v_status not in ('scheduled', 'active') then
    return new;
  end if;

  select l.name into v_conflict_name
    from public.league_players lp
    join public.leagues l on l.id = lp.league_id
    where lp.player_id = new.player_id
      and lp.league_id <> new.league_id
      and l.status in ('scheduled', 'active')
    limit 1;

  if v_conflict_name is not null then
    raise exception 'Deze speler zit al in een geplande of actieve league (%) en kan niet ook in deze league zitten.', v_conflict_name;
  end if;

  return new;
end;
$$;

drop trigger if exists on_league_players_single_active_league on public.league_players;
create trigger on_league_players_single_active_league
  before insert or update of league_id on public.league_players
  for each row
  execute function public.enforce_single_active_league();


-- ============================================================================
-- 13. Per-wedstrijd beschikbaarheid en deadline, automatische herinnering/
--     verval, en organizer-only verlenging.
--     (generate_league_matches hierboven schrijft nu ook available_at weg.)
-- ============================================================================

-- available_at: het moment waarop DEZE wedstrijd beschikbaar werd (ligt vast
-- vanaf aanmaken, verandert nooit - ook niet als spelers via propose/respond
-- een ander scheduled_at afspreken). deadline_at bestond al (sectie 11).
alter table public.league_matches
  add column if not exists available_at timestamptz,
  add column if not exists reminder_sent_at timestamptz,
  add column if not exists deadline_expired_at timestamptz;

update public.league_matches
  set available_at = scheduled_at
  where available_at is null and scheduled_at is not null;

comment on column public.league_matches.available_at is 'Moment waarop deze specifieke wedstrijd beschikbaar werd; ligt vast na aanmaken.';
comment on column public.league_matches.deadline_expired_at is 'Gezet zodra deze wedstrijd na de deadline nog niet gespeeld was (voor idempotente meldingen).';
comment on column public.league_matches.reminder_sent_at is 'Gezet zodra de "deadline nadert"-herinnering voor deze wedstrijd is verstuurd.';


-- Geldt voor ELK schrijfpad (ook een rechtstreekse update door de
-- organisator), niet alleen voor extend_match_deadline() hieronder -
-- vergelijkbaar met protect_league_schedule_fields voor leagues.
create or replace function public.protect_match_schedule_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.available_at is not null and new.available_at is distinct from old.available_at then
    raise exception 'Het beschikbaarheidsmoment van een wedstrijd kan niet meer gewijzigd worden.';
  end if;
  if new.deadline_at is distinct from old.deadline_at
     and old.deadline_at is not null
     and new.deadline_at < old.deadline_at then
    raise exception 'De deadline van een wedstrijd kan alleen verlengd worden, niet verkort.';
  end if;
  return new;
end;
$$;

drop trigger if exists on_league_matches_protect_schedule on public.league_matches;
create trigger on_league_matches_protect_schedule
  before update on public.league_matches
  for each row
  execute function public.protect_match_schedule_fields();


-- Organizer-only: een deadline verlengen. Zet deadline_expired_at terug op
-- null zodat een inmiddels "verlopen" wedstrijd weer normaal meetelt als de
-- nieuwe deadline nog in de toekomst ligt.
create or replace function public.extend_match_deadline(p_match_id uuid, p_new_deadline timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Je moet ingelogd zijn.';
  end if;
  if not public.is_organizer() then
    raise exception 'Alleen de organisator kan een deadline verlengen.';
  end if;

  select deadline_at into v_current from public.league_matches where id = p_match_id;
  if v_current is null then
    raise exception 'Wedstrijd niet gevonden.';
  end if;
  if p_new_deadline <= v_current then
    raise exception 'De nieuwe deadline moet na de huidige deadline liggen.';
  end if;

  update public.league_matches
    set deadline_at = p_new_deadline, deadline_expired_at = null
    where id = p_match_id;
end;
$$;

grant execute on function public.extend_match_deadline(uuid, timestamptz) to authenticated;


-- Automatische "deadline nadert"-herinnering (24 uur van tevoren) en
-- "deadline verstreken"-melding, allebei eenmalig per wedstrijd (via
-- reminder_sent_at/deadline_expired_at). Sluit expliciet 'confirmed' en
-- 'cancelled' uit, zodat een voltooide of geannuleerde wedstrijd nooit
-- alsnog als verlopen gemarkeerd wordt. Nooit rechtstreeks aanroepbaar door
-- gebruikers; draait via pg_cron.
create or replace function public.process_match_deadlines()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  with due as (
    select id, deadline_at, player_a_id, player_b_id
    from public.league_matches
    where status not in ('confirmed', 'cancelled')
      and deadline_at is not null
      and reminder_sent_at is null
      and deadline_at > now()
      and deadline_at <= now() + interval '24 hours'
  )
  insert into public.notifications (player_id, type, title, body, league_match_id)
  select player_a_id, 'match_deadline_reminder', 'Deadline nadert',
         'Je hebt nog tot ' || to_char(deadline_at, 'DD Mon YYYY HH24:MI') || ' om deze wedstrijd te spelen.', id
  from due
  union all
  select player_b_id, 'match_deadline_reminder', 'Deadline nadert',
         'Je hebt nog tot ' || to_char(deadline_at, 'DD Mon YYYY HH24:MI') || ' om deze wedstrijd te spelen.', id
  from due;

  update public.league_matches
    set reminder_sent_at = now()
    where status not in ('confirmed', 'cancelled')
      and deadline_at is not null
      and reminder_sent_at is null
      and deadline_at > now()
      and deadline_at <= now() + interval '24 hours';

  with due as (
    select id, player_a_id, player_b_id
    from public.league_matches
    where status not in ('confirmed', 'cancelled')
      and deadline_at is not null
      and deadline_expired_at is null
      and deadline_at <= now()
  )
  insert into public.notifications (player_id, type, title, body, league_match_id)
  select player_a_id, 'match_deadline_expired', 'Deadline verstreken',
         'De deadline voor deze wedstrijd is verstreken zonder dat hij gespeeld is. Neem contact op met je tegenstander of de organisator.', id
  from due
  union all
  select player_b_id, 'match_deadline_expired', 'Deadline verstreken',
         'De deadline voor deze wedstrijd is verstreken zonder dat hij gespeeld is. Neem contact op met je tegenstander of de organisator.', id
  from due;

  update public.league_matches
    set deadline_expired_at = now()
    where status not in ('confirmed', 'cancelled')
      and deadline_at is not null
      and deadline_expired_at is null
      and deadline_at <= now();
end;
$$;

revoke execute on function public.process_match_deadlines() from public, anon, authenticated;

select cron.schedule(
  'process_match_deadlines',
  '*/5 * * * *',
  $cron$select public.process_match_deadlines();$cron$
);


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
-- 1. Trigger op match_turns die average_score, checkout_percentage,
--    highest_checkout en count_180 herberekent (nodig voor live scoren).
-- 2. Storage-bucket `avatars` met policies:
--      insert/update: bucket_id = 'avatars'
--        and (storage.foldername(name))[1] = auth.uid()::text
--      select: publiek leesbaar
-- 3. Hetzelfde doorgeven/bevestigen/afkeuren-patroon toepassen op
--    tournament_matches zodra toernooien live gespeeld worden.
-- 4. Divisies ook voor tournament_matches / tournament_entries, als
--    toernooien ook in niveaus gespeeld gaan worden.
