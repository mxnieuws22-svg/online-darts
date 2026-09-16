# Dart League — webapp

Losse HTML, CSS en JavaScript met Supabase als backend. Geen bouwstap,
geen dependencies, geen Node nodig. Je zet de bestanden op GitHub en
Vercel serveert ze.

```
index.html          Alle opmaak en styling
js/config.js        Je Supabase-sleutels (deze vul je zelf in)
js/app.js           Alle logica: schermen, router, database-aanroepen
supabase/schema.sql De databasemigratie
vercel.json         Vercel-instellingen
```

---

## 1. Supabase klaarzetten

1. Open je Supabase-project → **SQL Editor** → **New query**.
2. Plak de volledige inhoud van `supabase/schema.sql` en klik **Run**.
   Je krijgt "Success. No rows returned" — dat is goed.
3. Ga naar **Storage** → **New bucket**, naam `avatars`, zet **Public** aan.
4. Terug naar de SQL Editor en run deze drie policies, anders kan niemand
   een profielfoto uploaden:

```sql
create policy "avatars_public_read"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "avatars_own_write"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_own_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
```

---

## 2. Je sleutels invullen

Ga naar **Project Settings → API** en kopieer twee waarden:

- **Project URL** → in `js/config.js` bij `SUPABASE_URL`
- **anon public** key → in `js/config.js` bij `SUPABASE_ANON_KEY`

Die anon key hoort publiek te zijn; hij staat in elke browser die je site
opent. Je beveiliging zit in de Row Level Security-regels van de database.
Zet hier nooit je `service_role` key neer.

---

## 3. Lokaal bekijken

Je kunt `index.html` niet zomaar dubbelklikken — browsers blokkeren dan de
verbinding met Supabase. Je hebt een lokale server nodig. In VS Code is de
makkelijkste weg de extensie **Live Server**: rechtsklik op `index.html` →
*Open with Live Server*.

Heb je Python: `python -m http.server 8000` in deze map, dan
`http://localhost:8000`.

Zet in Supabase onder **Authentication → URL Configuration** je lokale
adres (bijv. `http://localhost:5500`) bij de Redirect URLs, anders werkt
de wachtwoord-resetlink lokaal niet.

---

## 4. Online zetten via Vercel

1. Maak een nieuwe repository op GitHub en push deze map erheen.
2. Ga naar vercel.com → **Add New** → **Project** → kies je repository.
3. Bij Framework Preset kies je **Other**. Laat build- en outputvelden
   leeg — er valt niets te bouwen.
4. Klik **Deploy**. Na ongeveer een halve minuut heb je een URL.
5. Ga in Supabase naar **Authentication → URL Configuration**. Zet je
   Vercel-URL bij **Site URL** en voeg hem toe aan **Redirect URLs** met
   `/**` erachter, bijvoorbeeld `https://jouwapp.vercel.app/**`.

Elke volgende `git push` gaat vanzelf live.

---

## 5. Jezelf organisator maken

Registreer eerst een account via de site. Draai daarna in de SQL Editor:

```sql
update public.profiles
set role = 'organizer'
where email = 'jouw@email.nl';
```

Ververs de pagina — je ziet nu **Beheer** in het menu. Vanaf dat moment
kun je andere spelers vanuit de app een rol geven.

---

## Wat de app kan

**Spelers:** registreren en inloggen, wachtwoord resetten, profiel met foto
en naam aanpassen, eigen wedstrijden zien, uitslag doorgeven, leagues en
toernooien bekijken, eigen statistieken.

**Organisatoren:** dashboard met tellingen, leagues aanmaken en van status
wisselen, toernooien aanmaken, wedstrijden inplannen, doorgegeven uitslagen
bevestigen, spelers zoeken en rollen toekennen.

## Wat er nog niet is

- **Statistieken worden niet automatisch bijgewerkt.** De cijfers in
  `player_statistics` blijven op nul tot je de berekening toevoegt. Zie de
  TODO's onderaan `supabase/schema.sql` voor de functie die dit hoort te
  doen bij het bevestigen van een wedstrijd.
- **Geen standen of klassement** per league.
- **Geen toernooibrackets.** De tabellen `tournament_entries` en
  `tournament_matches` staan klaar, maar er is nog geen scherm dat een
  schema genereert of toont.
- **Geen live scoren.** De tabellen `matches`, `match_legs` en
  `match_turns` zijn aangemaakt voor later.
- **Spelers toevoegen aan een league** kan nog niet via de app; de tabel
  `league_players` wordt nog niet gevuld.
- **Geen realtime updates.** Je ziet wijzigingen na het verversen.
- Het instellingenscherm is leeg.

## Als iets niet werkt

**"Nog even instellen"** — `js/config.js` is niet ingevuld.

**"Je profiel ontbreekt"** — de SQL-migratie is niet gedraaid, of niet
volledig. Draai `supabase/schema.sql` opnieuw.

**Bevestigingsmail komt niet aan** — Supabase's ingebouwde mailserver
knijpt af op een paar berichten per uur. Voor tests kun je in
**Authentication → Sign In / Providers** de e-mailbevestiging uitzetten.
Voor echt gebruik koppel je eigen SMTP (Resend en Brevo hebben gratis
tiers die ruim volstaan voor een dartclub).

**Wachtwoord vergeten werkt niet** — je live-URL staat niet bij de
Redirect URLs in Supabase.
