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
-- Niet rechtstreeks aanroepbaar door de client (zie grants onderaan).
create or replace function public.apply_match_stats(
  p_player_id uuid,
  p_legs_won int,
  p_legs_lost int,
  p_won boolean,
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
  select * into s from public.player_statistics where player_id = p_player_id for update;
  if s.id is null then
    insert into public.player_statistics (player_id) values (p_player_id)
    returning * into s;
  end if;

  update public.player_statistics set
    matches_played   = s.matches_played + 1,
    matches_won      = s.matches_won + case when p_won then 1 else 0 end,
    matches_lost     = s.matches_lost + case when p_won then 0 else 1 end,
    legs_played      = s.legs_played + p_legs_won + p_legs_lost,
    legs_won         = s.legs_won + p_legs_won,
    average_score    = case when p_average is null then s.average_score
                        else round(((s.average_score * s.matches_played) + p_average)
                                    / (s.matches_played + 1), 2) end,
    highest_checkout = greatest(s.highest_checkout, coalesce(p_highest_checkout, 0)),
    count_180        = s.count_180 + coalesce(p_count_180, 0),
    updated_at       = now()
  where player_id = p_player_id;
end;
$$;

revoke execute on function public.apply_match_stats(uuid, int, int, boolean, numeric, int, int) from public;


-- Uitslag doorgeven. Alleen door één van de twee spelers, alleen zolang de
-- wedstrijd nog open staat. Onthoudt wie hem invulde (reported_by), zodat
-- diezelfde speler hem niet ook kan bevestigen.
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

  if p_winner_id <> m.player_a_id and p_winner_id <> m.player_b_id then
    raise exception 'De winnaar moet één van beide spelers zijn.';
  end if;

  if p_player_a_legs = p_player_b_legs then
    raise exception 'Een wedstrijd kan niet gelijk eindigen.';
  end if;

  if (p_player_a_legs > p_player_b_legs and p_winner_id <> m.player_a_id)
     or (p_player_b_legs > p_player_a_legs and p_winner_id <> m.player_b_id) then
    raise exception 'De gekozen winnaar komt niet overeen met de legscore.';
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

  perform public.apply_match_stats(
    m.player_a_id, m.player_a_legs, m.player_b_legs,
    m.winner_id = m.player_a_id, m.player_a_average, m.player_a_180s, m.player_a_highest_checkout
  );
  perform public.apply_match_stats(
    m.player_b_id, m.player_b_legs, m.player_a_legs,
    m.winner_id = m.player_b_id, m.player_b_average, m.player_b_180s, m.player_b_highest_checkout
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
-- Spelers worden ingedeeld in een divisie binnen een league (bijv. 1e, 2e,
-- 3e divisie; rank 1 = hoogste niveau). Wedstrijden kunnen aan een divisie
-- gekoppeld worden. De organisator kan de winnaar van elke divisie laten
-- promoveren naar de divisie één niveau hoger.

create table if not exists public.league_divisions (
  id         uuid primary key default gen_random_uuid(),
  league_id  uuid not null references public.leagues (id) on delete cascade,
  name       text not null,
  rank       int  not null check (rank >= 1),
  created_at timestamptz not null default now(),
  unique (league_id, rank)
);

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


-- Geeft bevestigde wedstrijden van een league terug, ook aan spelers die er
-- zelf niet in speelden - nodig om een standenlijst te tonen die voor
-- iedereen in de league zichtbaar is (de gewone select-policy op
-- league_matches laat een speler alleen zijn eigen wedstrijden zien). Vereist
-- wel inloggen, net als de rest van de app: dit is geen publiek endpoint.
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


-- Promoveert, voor elke divisie in de league (behalve de hoogste), de
-- speler met de meeste punten (op basis van bevestigde wedstrijden) naar de
-- divisie één niveau hoger. Alleen de organisator mag dit aanroepen. Geeft
-- de lijst gepromoveerde spelers terug zodat de app dat kan tonen.
create or replace function public.promote_division_winners(p_league_id uuid)
returns table(player_id uuid, display_name text, from_division text, to_division text)
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
begin
  if auth.uid() is null then
    raise exception 'Je moet ingelogd zijn.';
  end if;

  if not public.is_organizer() then
    raise exception 'Alleen de organisator kan winnaars promoveren.';
  end if;

  for rec in
    with results as (
      select
        lp.division_id,
        lp.player_id,
        case when m.winner_id = lp.player_id then 1 else 0 end as win,
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
        and lp.division_id is not null
    ),
    agg as (
      select
        division_id,
        player_id,
        sum(win)     as wins,
        sum(lw)      as legs_won,
        sum(ll)      as legs_lost,
        sum(win) * 2 as points
      from results
      group by division_id, player_id
    ),
    ranked as (
      select
        a.*,
        row_number() over (
          partition by division_id
          order by points desc, (legs_won - legs_lost) desc, player_id
        ) as rnk
      from agg a
    )
    select
      r.player_id,
      p.display_name,
      d_from.name as from_division,
      d_to.name   as to_division,
      d_to.id     as to_division_id
    from ranked r
    join public.profiles p on p.id = r.player_id
    join public.league_divisions d_from on d_from.id = r.division_id
    join public.league_divisions d_to
      on d_to.league_id = d_from.league_id and d_to.rank = d_from.rank - 1
    where r.rnk = 1
  loop
    update public.league_players
      set division_id = rec.to_division_id
      where league_id = p_league_id and player_id = rec.player_id;

    player_id := rec.player_id;
    display_name := rec.display_name;
    from_division := rec.from_division;
    to_division := rec.to_division;
    return next;
  end loop;
end;
$$;

grant execute on function public.promote_division_winners(uuid) to authenticated;


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
