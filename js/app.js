/* =========================================================================
   Dart League - webapp
   js/app.js

   Opbouw van dit bestand:
     1.  Supabase-client en globale state
     2.  Hulpfuncties (escapen, datums, toast, iconen)
     3.  Herbruikbare componenten (badge, avatar, kaarten, statusweergaven)
     4.  Data-laag (alle Supabase-queries bij elkaar)
     5.  Authenticatieschermen
     6.  Navigatie en router
     7.  Schermen
     8.  Start
   ========================================================================= */

/* -------------------------------------------------------------------------
   1. Supabase-client en globale state
   ------------------------------------------------------------------------- */

const cfg = window.APP_CONFIG || {};
let sb = null;

const state = {
  profile: null,     // profiel van de ingelogde gebruiker
  session: null,
  onboarding: null,  // ingevulde spelersgegevens (player_onboarding), of null als nog niet ingevuld
};

const app = document.getElementById("app");

const STATUS = {
  draft: { label: "Concept", color: "#6B7280" },
  active: { label: "Actief", color: "#2ECC71" },
  finished: { label: "Afgerond", color: "#9B7BD9" },
  scheduled: { label: "Gepland", color: "#4EA1F7" },
  in_progress: { label: "Bezig", color: "#F47B20" },
  pending_confirmation: { label: "Ter bevestiging", color: "#F5B942" },
  confirmed: { label: "Bevestigd", color: "#2ECC71" },
  cancelled: { label: "Geannuleerd", color: "#E74C3C" },
};

const TOURNAMENT_TYPES = {
  knockout: "Knock-out",
  groups: "Poules",
  groups_and_knockout: "Poules + knock-out",
};

const GARMENT_LABELS = { tshirt: "T-shirt", hoodie: "Hoodie", polo: "Polo" };
const SIZE_LABELS = { xs: "XS", s: "S", m: "M", l: "L", xl: "XL", xxl: "XXL", xxxl: "XXXL" };

// Statussen van een prijsclaim: label voor de winnaar (vriendelijk, geen
// interne termen) en voor de organisator (exacte statusnaam), plus kleur.
const PRIZE_STATUS = {
  available:         { label: "Beschikbaar",              color: "#4EA1F7" },
  claim_started:     { label: "Bezig met claimen",         color: "#4EA1F7" },
  claimed:           { label: "Aanvraag ingediend",        color: "#F5B942" },
  reviewing:         { label: "Wordt beoordeeld",          color: "#F5B942" },
  contact_pending:   { label: "Contact volgt nog",         color: "#F5B942" },
  confirmed:         { label: "Bevestigd",                 color: "#2ECC71" },
  in_production:     { label: "Wordt gemaakt",             color: "#9B7BD9" },
  ready:             { label: "Klaar om op te halen",      color: "#2ECC71" },
  delivered:         { label: "Uitgereikt",                color: "#2ECC71" },
  cancelled:         { label: "Geannuleerd",                color: "#6B7280" },
};

function prizeStatusBadge(status) {
  const s = PRIZE_STATUS[status] || { label: status, color: "#8A93AA" };
  return `<span class="badge" style="color:${s.color};border-color:${s.color}66;background:${s.color}22">${esc(s.label)}</span>`;
}

/* -------------------------------------------------------------------------
   2. Hulpfuncties
   ------------------------------------------------------------------------- */

// Alles wat uit de database komt gaat hier doorheen voor het in de DOM
// belandt. Zonder dit kan een speler met een < in zijn naam de pagina slopen.
function esc(v) {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtDate(iso, withTime = true) {
  if (!iso) return "";
  const d = new Date(iso);
  const opts = { day: "numeric", month: "short", year: "numeric" };
  if (withTime) { opts.hour = "2-digit"; opts.minute = "2-digit"; }
  return d.toLocaleDateString("nl-NL", opts);
}

// "Speel deze wedstrijd uiterlijk vóór 8 oktober 2026 om 19:00."
function fmtDeadlineSentence(iso) {
  const d = new Date(iso);
  const datePart = d.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
  const timePart = d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
  return `Speel deze wedstrijd uiterlijk vóór ${datePart} om ${timePart}.`;
}

// Resterende tijd tot een deadline, in mensentaal.
function remainingTimeText(iso) {
  const diffMs = new Date(iso) - new Date();
  if (diffMs <= 0) return "Verlopen";
  const days = Math.floor(diffMs / 86400000);
  if (days >= 1) return `Nog ${days} ${days === 1 ? "dag" : "dagen"}`;
  const hours = Math.floor(diffMs / 3600000);
  if (hours >= 1) return `Nog ${hours} uur`;
  return "Nog minder dan een uur";
}

// Zet een ISO-timestamp om naar de waarde die een <input type="datetime-local">
// verwacht (lokale tijd van de browser, geen "Z"/offset).
function fmtDatetimeLocal(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function initials(name) {
  const parts = String(name || "?").trim().split(/\s+/);
  const a = parts[0]?.[0] || "?";
  const b = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (a + b).toUpperCase();
}

function toast(msg) {
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// Vertaalt Supabase-foutmeldingen naar iets dat een dartspeler begrijpt.
function errText(error) {
  const m = String(error?.message || error || "");
  if (/Invalid login credentials/i.test(m)) return "E-mailadres of wachtwoord klopt niet.";
  if (/Email not confirmed/i.test(m)) return "Bevestig eerst je e-mailadres via de link in je mail.";
  if (/User already registered/i.test(m)) return "Er bestaat al een account met dit e-mailadres.";
  if (/Password should be at least/i.test(m)) return "Je wachtwoord moet minimaal 6 tekens zijn.";
  if (/rate limit|too many/i.test(m)) return "Te veel pogingen. Wacht even en probeer opnieuw.";
  if (/Failed to fetch|NetworkError/i.test(m)) return "Geen verbinding met de server. Controleer je internet.";
  return m || "Er ging iets mis.";
}

const icon = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>',
  league: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>',
  match: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5v14M20 5v14M4 12h16"/><circle cx="12" cy="12" r="2.5"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.5 3.1-5.5 7-5.5s7 2 7 5.5"/><path d="M17 8.5a3 3 0 0 0 0-1M17.5 14.5c2.6.5 4.5 2.3 4.5 5"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  trend: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>',
  trophy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6-5.3-3-5.3 3 1.1-6L3.4 9.4l6-.8z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4M6 12h9"/></svg>',
  empty: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5 5h14l2 8v6H3v-6z"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8h4l1.5-2h7L17 8h4v12H3z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 13 6 9z"/><path d="M10 19a2 2 0 0 0 4 0"/></svg>',
  chevronUp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 15l7-7 7 7"/></svg>',
  chevronDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9l7 7 7-7"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v12H8l-4 4z"/></svg>',
};

/* -------------------------------------------------------------------------
   3. Herbruikbare componenten
   ------------------------------------------------------------------------- */

function badge(status) {
  const s = STATUS[status] || { label: status, color: "#8A93AA" };
  return `<span class="badge" style="color:${s.color};border-color:${s.color}66;background:${s.color}22">${esc(s.label)}</span>`;
}

function avatar(profile, size = "") {
  const name = profile?.display_name || "?";
  const url = profile?.avatar_url;
  const inner = url
    ? `<img src="${esc(url)}" alt="">`
    : esc(initials(name));
  return `<div class="av ${size}" aria-hidden="true">${inner}</div>`;
}

function statCard({ label, value, ico = "trend", color = "#F47B20" }) {
  return `
    <div class="stat">
      <div class="ico" style="background:${color}26;color:${color}">${icon[ico]}</div>
      <div class="stat-value">${esc(value)}</div>
      <div class="stat-label">${esc(label)}</div>
    </div>`;
}

function loadingView() {
  return `<div class="state"><div class="spinner"></div></div>`;
}

function emptyView(title, sub = "", ico = "empty") {
  return `
    <div class="state">
      <div class="state-ico">${icon[ico]}</div>
      <div class="state-title">${esc(title)}</div>
      ${sub ? `<div class="state-sub">${esc(sub)}</div>` : ""}
    </div>`;
}

function errorView(error) {
  return `
    <div class="state">
      <div class="state-ico" style="color:#E74C3C">${icon.warn}</div>
      <div class="state-title">Dit lukte niet</div>
      <div class="state-sub">${esc(errText(error))}</div>
      <button class="btn ghost sm mt16" onclick="location.reload()">Opnieuw laden</button>
    </div>`;
}

// Vertaalt de ruwe wedstrijdstatus + beschikbaarheid/deadline/voorstel naar
// een van de spelersvriendelijke statussen. Puur berekend voor weergave -
// de onderliggende status-kolom (die rapporteren/bevestigen/statistieken
// aanstuurt) blijft ongewijzigd.
function matchDisplayStatus(m) {
  if (m.status === "cancelled") return { label: "Geannuleerd", color: "#E74C3C" };
  if (m.status === "confirmed") return { label: "Gespeeld", color: "#2ECC71" };
  if (m.deadline_at && new Date(m.deadline_at) < new Date()) {
    return { label: "Deadline verstreken", color: "#E74C3C" };
  }
  if (m.available_at && new Date(m.available_at) > new Date()) {
    return { label: "Nog niet gestart", color: "#6B7280" };
  }
  const p = m.schedule_proposal;
  if (p) {
    if (p.status === "accepted") return { label: "Afspraak bevestigd", color: "#2ECC71" };
    if (p.status === "pending" || p.status === "countered" || p.status === "disputed") {
      return { label: "Afspraak voorgesteld", color: "#F5B942" };
    }
  }
  return { label: "Beschikbaar", color: "#4EA1F7" };
}

function matchStatusBadge(m) {
  const s = matchDisplayStatus(m);
  return `<span class="badge" style="color:${s.color};border-color:${s.color}66;background:${s.color}22">${esc(s.label)}</span>`;
}

// Beschikbaarheids-/deadlinetekst onder een nog niet gespeelde wedstrijd.
function matchDeadlineLine(m, status) {
  if (status.label === "Deadline verstreken") {
    return `<div class="match-meta" style="margin-top:4px;color:#E74C3C">De deadline is verstreken.</div>`;
  }
  if (status.label === "Nog niet gestart" && m.available_at) {
    return `<div class="match-meta" style="margin-top:4px">Beschikbaar vanaf ${esc(fmtDate(m.available_at))}</div>`;
  }
  if (m.deadline_at) {
    return `
      <div class="match-meta" style="margin-top:4px">${esc(fmtDeadlineSentence(m.deadline_at))}</div>
      <div class="match-meta" style="margin-top:2px">${esc(remainingTimeText(m.deadline_at))}</div>`;
  }
  return "";
}

function matchCard(m) {
  const a = m.player_a, b = m.player_b;
  const played = m.player_a_legs > 0 || m.player_b_legs > 0;
  const isDraw = played && m.player_a_legs === m.player_b_legs;
  const aWin = m.winner_id && m.winner_id === m.player_a_id;
  const bWin = m.winner_id && m.winner_id === m.player_b_id;
  const status = matchDisplayStatus(m);
  return `
    <div class="card">
      <div class="match-top">
        <span class="match-league">${esc([m.league?.name, m.division?.name].filter(Boolean).join(" · "))}</span>
        ${matchStatusBadge(m)}
      </div>
      <div class="match-row">
        <div class="mp ${aWin ? "winner" : ""}">
          ${avatar(a, "sm")}<span class="mp-name">${esc(a?.display_name || "Speler A")}</span>
        </div>
        <span class="vs">VS</span>
        <div class="mp right ${bWin ? "winner" : ""}">
          ${avatar(b, "sm")}<span class="mp-name">${esc(b?.display_name || "Speler B")}</span>
        </div>
      </div>
      ${played ? `
        <div class="match-score">
          <span class="score ${aWin ? "win" : ""}">${m.player_a_legs}</span>
          <span class="score-sep">-</span>
          <span class="score ${bWin ? "win" : ""}">${m.player_b_legs}</span>
        </div>
        ${isDraw ? `<div class="center muted" style="font-size:12.5px;margin-top:4px">Gelijkspel</div>` : ""}` : ""}
      ${m.scheduled_at ? `<div class="match-meta">${icon.clock}<span>${esc(fmtDate(m.scheduled_at))}</span></div>` : ""}
      ${!played && m.status !== "cancelled" ? matchDeadlineLine(m, status) : ""}
    </div>`;
}

function leagueCard(l, clickable = true) {
  const meta = [
    l.season,
    `${l.game_type} · best of ${l.legs_per_match}`,
  ].filter(Boolean).join(" · ");
  const inner = `
      <div class="row">
        <div class="row-ico">${icon.league}</div>
        <div class="row-main">
          <div class="row-title">${esc(l.name)}</div>
          <div class="row-sub">${esc(meta)}</div>
        </div>
        ${badge(l.status)}
      </div>`;
  return clickable
    ? `<button class="card clickable" onclick="go('league/${esc(l.id)}')">${inner}</button>`
    : `<div class="card">${inner}</div>`;
}

function tournamentCard(t) {
  const meta = [
    TOURNAMENT_TYPES[t.tournament_type] || t.tournament_type,
    t.start_at ? fmtDate(t.start_at, false) : null,
  ].filter(Boolean).join(" · ");
  return `
    <div class="card">
      <div class="row">
        <div class="row-ico">${icon.target}</div>
        <div class="row-main">
          <div class="row-title">${esc(t.name)}</div>
          <div class="row-sub">${esc(meta)}</div>
        </div>
        ${badge(t.status)}
      </div>
    </div>`;
}

// Groepeert platte standenregels (zie db.standingsForLeague) per divisie,
// gesorteerd op divisieniveau en daarbinnen op punten/legssaldo.
// De rijen komen al gesorteerd terug van league_standings() (punten,
// legsaldo, gemiddelde als tiebreaker) - hier alleen groeperen per divisie,
// niet opnieuw sorteren.
function groupStandingsByDivision(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = r.divisionId || "none";
    if (!groups.has(key)) {
      groups.set(key, { name: r.divisionName || "Geen divisie", rank: r.divisionRank, rows: [] });
    }
    groups.get(key).rows.push(r);
  }
  const list = [...groups.values()];
  list.sort((a, b) => a.rank - b.rank);
  return list;
}

// Toont een divisie als kaart: naam, aantal spelers, en de ranglijst met
// punten, W-G-V, legsaldo en gemiddelde. `opts.meId` markeert de kaart en de
// rij van de ingelogde speler ("Jouw divisie"). `opts.divisionCount` bepaalt
// - samen met group.rank - of promotie/degradatie-pijltjes getoond worden;
// dit is altijd een voorspelling op basis van de huidige (mogelijk nog
// lopende) tussenstand, niet een definitief resultaat.
// Kleine stip-reeks voor de "vorm" van een speler: laatste (max 5) bevestigde
// resultaten, oudste eerst.
function formDots(form, compact = false) {
  const colorFor = { W: "#2ECC71", D: "#8A93AA", L: "#E74C3C" };
  const labelFor = { W: "Gewonnen", D: "Gelijk", L: "Verloren" };
  if (!form || !form.length) return compact ? `<span class="muted">&mdash;</span>` : "";
  return `<div style="display:flex;gap:3px;${compact ? "" : "margin-top:4px"}">
    ${form.map((f) => `<span style="width:7px;height:7px;border-radius:50%;background:${colorFor[f] || "#8A93AA"};display:inline-block" title="${labelFor[f] || f}"></span>`).join("")}
  </div>`;
}

// Volledige standentabel van een divisie: #, speler, punten, gespeeld,
// W/G/V, vorm, legs voor/tegen, saldo en gemiddelde - horizontaal
// scrollbaar op smalle schermen. Promotie-/degradatiezone en de eigen rij
// krijgen een subtiele achtergrondkleur; de koploper krijgt een kroontje.
function divisionStandingsCard(group, opts = {}) {
  const { meId, divisionCount } = opts;
  const isMyDivision = meId && group.rows.some((r) => r.player?.id === meId);
  const moveCount = Math.min(2, Math.floor(group.rows.length / 2));
  const canPromote = group.rank > 1;
  const canRelegate = divisionCount ? group.rank < divisionCount : false;

  return `
    <div class="card" style="${isMyDivision ? "border-color:#F47B20" : ""}">
      <div class="row" style="align-items:flex-start;margin-bottom:12px">
        <div class="row-main">
          <h2 style="margin:0">${esc(group.name)}</h2>
          <div class="muted" style="font-size:12.5px;margin-top:2px">${group.rows.length}/12 spelers</div>
        </div>
        ${isMyDivision ? `<span class="badge" style="color:#F47B20;border-color:#F47B2066;background:#F47B2022">Jouw divisie</span>` : ""}
      </div>
      ${group.rows.length ? `
      <div class="table-scroll">
        <table class="standings-table">
          <thead>
            <tr>
              <th>#</th><th>Speler</th><th>Ptn</th><th>Gesp.</th><th>W</th><th>G</th><th>V</th>
              <th>Vorm</th><th>Legs+</th><th>Legs-</th><th>Saldo</th><th>Gem.</th>
            </tr>
          </thead>
          <tbody>
            ${group.rows.map((r, i) => {
              const isMe = r.player?.id === meId;
              const promoting = canPromote && i < moveCount;
              const relegating = canRelegate && i >= group.rows.length - moveCount;
              const saldo = (r.legsFor ?? 0) - (r.legsAgainst ?? 0);
              const rowClass = [isMe && "me", promoting && "promo", relegating && "relegate"].filter(Boolean).join(" ");
              return `
                <tr class="${rowClass}">
                  <td>${i === 0 ? `<span style="display:inline-flex;width:13px;height:13px;color:#F47B20;vertical-align:-2px;margin-right:3px">${icon.trophy}</span>` : ""}${i + 1}</td>
                  <td class="player-cell">
                    ${avatar(r.player, "sm")}
                    <span>${esc(r.player?.display_name || "?")}${isMe ? ` <span class="muted" style="font-weight:400">(jij)</span>` : ""}</span>
                  </td>
                  <td style="font-weight:700">${r.points}</td>
                  <td>${r.played}</td>
                  <td>${r.wins}</td>
                  <td>${r.draws}</td>
                  <td>${r.losses}</td>
                  <td>${formDots(r.form, true)}</td>
                  <td>${r.legsFor}</td>
                  <td>${r.legsAgainst}</td>
                  <td>${saldo > 0 ? "+" + saldo : saldo}</td>
                  <td>${Number(r.displayAverage ?? 0).toFixed(1)}</td>
                </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>`
        : `<p class="muted" style="font-size:13.5px;margin:0">Nog geen spelers in deze divisie.</p>`}
    </div>`;
}

// Label/waarde-rij voor informatieve overzichten (bv. het planningblok).
// Anders dan .row-title (bedoeld voor één regel naast een avatar/icoon) mag
// het label hier meerdere woorden lang zijn zonder af te breken.
function infoRow(label, value) {
  return `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:5px 0">
      <span style="font-weight:600;font-size:15px">${esc(label)}</span>
      <span class="muted" style="text-align:right">${value}</span>
    </div>`;
}

function sectionHead(title, linkLabel, route) {
  return `
    <div class="section">
      <h2>${esc(title)}</h2>
      ${linkLabel ? `<button class="linkbtn" onclick="go('${route}')">${esc(linkLabel)}</button>` : ""}
    </div>`;
}

/* -------------------------------------------------------------------------
   4. Data-laag
   ------------------------------------------------------------------------- */

// match_schedule_proposals komt als array terug uit de embed (1-op-1 relatie
// vanuit league_matches gezien); hier plat naar een enkel object of null.
function flattenScheduleProposal(rows) {
  return (rows || []).map((m) => ({
    ...m,
    schedule_proposal: Array.isArray(m.schedule_proposal) ? (m.schedule_proposal[0] || null) : m.schedule_proposal,
  }));
}

const db = {
  async myProfile(userId) {
    const { data, error } = await sb
      .from("profiles")
      .select("*, player_statistics(*)")
      .eq("id", userId)
      .single();
    if (error) throw error;
    // player_statistics komt als array terug uit de join
    data.stats = Array.isArray(data.player_statistics)
      ? data.player_statistics[0] || null
      : data.player_statistics;
    return data;
  },

  async updateProfile(userId, fields) {
    const { error } = await sb.from("profiles").update(fields).eq("id", userId);
    if (error) throw error;
  },

  async players(search) {
    let q = sb.from("profiles").select("*, player_statistics(*)");
    if (search?.trim()) q = q.ilike("display_name", `%${search.trim()}%`);
    const { data, error } = await q.order("display_name");
    if (error) throw error;
    return (data || []).map((p) => ({
      ...p,
      stats: Array.isArray(p.player_statistics) ? p.player_statistics[0] : p.player_statistics,
    }));
  },

  async setRole(playerId, role) {
    const { error } = await sb.from("profiles").update({ role }).eq("id", playerId);
    if (error) throw error;
  },

  // Eenmalig ingevulde spelersgegevens (voor initiële divisie-indeling).
  // Alleen de speler zelf en de organisator mogen dit lezen.
  async myOnboarding(playerId) {
    const { data, error } = await sb
      .from("player_onboarding")
      .select("*")
      .eq("player_id", playerId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async saveOnboarding(playerId, fields) {
    const { error } = await sb.from("player_onboarding")
      .upsert({ player_id: playerId, ...fields }, { onConflict: "player_id" });
    if (error) throw error;
  },

  // Alle ingevulde spelersgegevens, voor de organisator (bijv. bij het
  // indelen van spelers in divisies).
  async allOnboarding() {
    const { data, error } = await sb.from("player_onboarding").select("*");
    if (error) throw error;
    return data || [];
  },

  async leagues(status) {
    let q = sb.from("leagues").select("*");
    if (status) q = q.eq("status", status);
    const { data, error } = await q.order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async league(id) {
    const { data, error } = await sb.from("leagues").select("*").eq("id", id).single();
    if (error) throw error;
    return data;
  },

  async createLeague(fields) {
    const { data, error } = await sb.from("leagues").insert(fields).select().single();
    if (error) throw error;
    return data;
  },

  async setLeagueStatus(id, status) {
    const { error } = await sb.from("leagues").update({ status }).eq("id", id);
    if (error) throw error;
  },

  // Verwijdert een league (alleen concept/gepland, zie protect_league_
  // deletion - actieve/afgeronde leagues worden server-side geweigerd).
  // Gekoppelde divisies, spelerskoppelingen, wedstrijden en meldingen
  // verdwijnen automatisch mee (cascade); spelersaccounts blijven bestaan.
  async deleteLeague(id) {
    const { error } = await sb.from("leagues").delete().eq("id", id);
    if (error) throw error;
  },

  // Planninggegevens van een league bijwerken (en eventueel meteen naar
  // 'scheduled' zetten). protect_league_schedule_fields bewaakt serverside
  // dat dit alleen mag zolang de league nog niet actief is.
  async updateLeagueSchedule(id, fields) {
    const { error } = await sb.from("leagues").update(fields).eq("id", id);
    if (error) throw error;
  },

  // Activeert de league als (en alleen als) het startmoment al voorbij is -
  // opportunistisch aangeroepen vanuit de UI zodat je niet op de cron-tik
  // (max. 1 minuut) hoeft te wachten.
  async activateLeagueIfDue(id) {
    const { data, error } = await sb.rpc("activate_league_if_due", { p_league_id: id });
    if (error) throw error;
    return data;
  },

  async divisionsForLeague(leagueId) {
    const { data, error } = await sb
      .from("league_divisions")
      .select("*")
      .eq("league_id", leagueId)
      .order("rank");
    if (error) throw error;
    return data || [];
  },

  async createDivision(fields) {
    const { error } = await sb.from("league_divisions").insert(fields);
    if (error) throw error;
  },

  async leagueMembers(leagueId) {
    const { data, error } = await sb
      .from("league_players")
      .select("*, player:player_id(*), division:division_id(*)")
      .eq("league_id", leagueId);
    if (error) throw error;
    return data || [];
  },

  // De geplande/actieve league waarin de ingelogde speler op dit moment zit
  // (er kan er maar één zijn, zie enforce_single_active_league). Geeft null
  // als de speler nergens is ingedeeld.
  async myLeagueMembership() {
    const { data, error } = await sb
      .from("league_players")
      .select("*, league:league_id(*), division:division_id(*)")
      .eq("player_id", state.profile.id)
      .in("league.status", ["scheduled", "active"]);
    if (error) throw error;
    const row = (data || []).find((r) => r.league);
    return row || null;
  },

  // Voegt een speler toe aan de league, of wijzigt zijn divisie als hij al
  // lid is (league_id + player_id is uniek).
  async assignPlayerToLeague(leagueId, playerId, divisionId) {
    const { error } = await sb.from("league_players")
      .upsert(
        { league_id: leagueId, player_id: playerId, division_id: divisionId },
        { onConflict: "league_id,player_id" }
      );
    if (error) throw error;
  },

  // Stand per divisie: punten (2 win / 1 gelijk / 0 verlies), legsaldo en
  // gemiddelde als tiebreaker. Draait volledig server-side (security-definer
  // functie), want de sortering mag intern het PRIVATE zelf-opgegeven
  // gemiddelde gebruiken (player_onboarding) zonder dat aan andere spelers
  // te tonen - de functie geeft daarom altijd het publieke
  // player_statistics-gemiddelde terug als display_average.
  async standingsForLeague(leagueId) {
    const { data, error } = await sb.rpc("league_standings", { p_league_id: leagueId });
    if (error) throw error;
    return (data || []).map((r) => ({
      divisionId: r.division_id,
      divisionName: r.division_name,
      divisionRank: r.division_rank ?? Infinity,
      player: { id: r.player_id, display_name: r.display_name },
      played: r.played,
      wins: r.wins,
      draws: r.draws,
      losses: r.losses,
      legsFor: r.legs_for,
      legsAgainst: r.legs_against,
      points: r.points,
      displayAverage: r.display_average,
      form: r.form || [],
    }));
  },

  // Eerste, volledige indeling op gemiddelde (1e divisie 70+, 2e 60+, 3e
  // 50+, 4e <50), max 12 per divisie. Alleen zolang de league nog niet
  // actief is.
  async autoAssignDivisions(leagueId) {
    const { data, error } = await sb.rpc("auto_assign_divisions", { p_league_id: leagueId });
    if (error) throw error;
    return data || [];
  },

  // Promotie/degradatie: 2 op / 2 neer tussen aangrenzende divisies, op
  // basis van de punten uit gespeelde wedstrijden.
  async applyPromotionRelegation(leagueId) {
    const { data, error } = await sb.rpc("apply_promotion_relegation", { p_league_id: leagueId });
    if (error) throw error;
    return data || [];
  },

  // ---- Prijsclaims (divisiewinnaars, LWPrints) -------------------------

  // Bepaalt (idempotent) de winnaars van een afgeronde league en maakt
  // meteen hun prijsclaim + melding aan.
  async determineDivisionWinners(leagueId) {
    const { data, error } = await sb.rpc("determine_division_winners", { p_league_id: leagueId });
    if (error) throw error;
    return data || [];
  },

  // Winnaars + hun claim voor een specifieke league (organisator, inline op
  // de league-pagina).
  async divisionWinnersForLeague(leagueId) {
    const { data, error } = await sb
      .from("division_winners")
      .select("*, claim:prize_claims(*), player:player_id(*)")
      .eq("league_id", leagueId)
      .order("division_rank");
    if (error) throw error;
    return (data || []).map((w) => ({ ...w, claim: Array.isArray(w.claim) ? w.claim[0] : w.claim }));
  },

  async prizeByDivisionWinner(id) {
    const { data, error } = await sb
      .from("division_winners")
      .select("*, claim:prize_claims(*)")
      .eq("id", id)
      .single();
    if (error) throw error;
    data.claim = Array.isArray(data.claim) ? data.claim[0] : data.claim;
    return data;
  },

  // Alle prijzen van de ingelogde speler ("Mijn prijzen").
  async myPrizes() {
    const { data, error } = await sb
      .from("division_winners")
      .select("*, claim:prize_claims(*)")
      .eq("player_id", state.profile.id)
      .order("decided_at", { ascending: false });
    if (error) throw error;
    return (data || []).map((w) => ({ ...w, claim: Array.isArray(w.claim) ? w.claim[0] : w.claim }));
  },

  // Nieuwste ongelezen prijsmelding, voor de banner op Home.
  async myPendingPrizeNotification() {
    const { data, error } = await sb
      .from("prize_notifications")
      .select("*, claim:prize_claim_id(id, division_winner_id)")
      .eq("player_id", state.profile.id)
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async markPrizeNotificationRead(id) {
    const { error } = await sb.from("prize_notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
  },

  // Nieuwste ongelezen generieke melding (league gestart, wedstrijdmoment
  // voorgesteld/geaccepteerd/betwist), voor de banner op Home.
  async myPendingNotification() {
    const { data, error } = await sb
      .from("notifications")
      .select("*")
      .eq("player_id", state.profile.id)
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async markNotificationRead(id) {
    const { error } = await sb.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
  },

  async proposeMatchSchedule(matchId, proposedAt, note) {
    const { error } = await sb.rpc("propose_match_schedule", {
      p_match_id: matchId, p_proposed_at: proposedAt, p_note: note,
    });
    if (error) throw error;
  },

  async respondMatchSchedule(matchId, action, proposedAt = null, note = null) {
    const { error } = await sb.rpc("respond_match_schedule", {
      p_match_id: matchId, p_action: action, p_proposed_at: proposedAt, p_note: note,
    });
    if (error) throw error;
  },

  async withdrawMatchSchedule(matchId) {
    const { error } = await sb.rpc("withdraw_match_schedule_proposal", { p_match_id: matchId });
    if (error) throw error;
  },

  async scheduleProposalHistory(matchId) {
    const { data, error } = await sb
      .from("match_schedule_proposal_history")
      .select("*, actor:actor_id(display_name)")
      .eq("league_match_id", matchId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async headToHead(otherPlayerId) {
    const { data, error } = await sb.rpc("head_to_head_matches", { p_other_player_id: otherPlayerId });
    if (error) throw error;
    return data || [];
  },

  async chatMessages(matchId) {
    const { data, error } = await sb
      .from("match_chat_messages")
      .select("*, sender:sender_id(display_name, avatar_url)")
      .eq("league_match_id", matchId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async sendChatMessage(matchId, body) {
    const { error } = await sb.rpc("send_match_chat_message", { p_match_id: matchId, p_body: body });
    if (error) throw error;
  },

  async markPrizeNotificationsReadForClaim(claimId) {
    const { error } = await sb.from("prize_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("prize_claim_id", claimId)
      .is("read_at", null);
    if (error) throw error;
  },

  async startPrizeClaim(divisionWinnerId) {
    const { error } = await sb.rpc("start_prize_claim", { p_division_winner_id: divisionWinnerId });
    if (error) throw error;
  },

  async submitPrizeClaim(divisionWinnerId, r) {
    const { error } = await sb.rpc("submit_prize_claim", {
      p_division_winner_id: divisionWinnerId,
      p_full_name: r.fullName,
      p_email: r.email,
      p_phone: r.phone,
      p_garment: r.garment,
      p_size: r.size,
      p_color: r.color,
      p_design_notes: r.designNotes,
      p_comments: r.comments,
      p_consent: r.consent,
    });
    if (error) throw error;
  },

  // Beheeroverzicht: alle divisiewinnaars + hun claim, over alle leagues.
  async allPrizeClaims() {
    const { data, error } = await sb
      .from("division_winners")
      .select("*, claim:prize_claims(*), player:player_id(*)")
      .order("decided_at", { ascending: false });
    if (error) throw error;
    return (data || []).map((w) => ({ ...w, claim: Array.isArray(w.claim) ? w.claim[0] : w.claim }));
  },

  async prizeClaimHistory(claimId) {
    const { data, error } = await sb
      .from("prize_status_history")
      .select("*, changed_by_profile:changed_by(display_name)")
      .eq("prize_claim_id", claimId)
      .order("created_at");
    if (error) throw error;
    return data || [];
  },

  async updatePrizeClaimStatus(claimId, status, note) {
    const { error } = await sb.rpc("update_prize_claim_status", {
      p_claim_id: claimId, p_new_status: status, p_note: note || null,
    });
    if (error) throw error;
  },

  async updatePrizeClaimFields(claimId, fields) {
    const { error } = await sb.from("prize_claims").update(fields).eq("id", claimId);
    if (error) throw error;
  },

  async tournaments() {
    const { data, error } = await sb
      .from("tournaments").select("*")
      .order("start_at", { ascending: true, nullsFirst: false });
    if (error) throw error;
    return data || [];
  },

  async createTournament(fields) {
    const { error } = await sb.from("tournaments").insert(fields);
    if (error) throw error;
  },

  async upcomingTournaments() {
    const { data, error } = await sb
      .from("tournaments").select("*")
      .gte("start_at", new Date().toISOString())
      .order("start_at").limit(3);
    if (error) throw error;
    return data || [];
  },

  // De join-syntax hieronder: player_a:player_a_id(*) betekent
  // "haal het profiel op waar player_a_id naar wijst en noem het player_a".
  async matchesForLeague(leagueId) {
    const { data, error } = await sb
      .from("league_matches")
      .select("*, player_a:player_a_id(*), player_b:player_b_id(*), league:league_id(name), division:division_id(name), schedule_proposal:match_schedule_proposals(*)")
      .eq("league_id", leagueId)
      .order("scheduled_at", { nullsFirst: false });
    if (error) throw error;
    return flattenScheduleProposal(data);
  },

  async myMatches(playerId) {
    const { data, error } = await sb
      .from("league_matches")
      .select("*, player_a:player_a_id(*), player_b:player_b_id(*), league:league_id(name), division:division_id(name), schedule_proposal:match_schedule_proposals(*)")
      .or(`player_a_id.eq.${playerId},player_b_id.eq.${playerId}`)
      .order("scheduled_at", { nullsFirst: false });
    if (error) throw error;
    return flattenScheduleProposal(data);
  },

  async allMatches(limit = 50) {
    const { data, error } = await sb
      .from("league_matches")
      .select("*, player_a:player_a_id(*), player_b:player_b_id(*), league:league_id(name), division:division_id(name), schedule_proposal:match_schedule_proposals(*)")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return flattenScheduleProposal(data);
  },

  async extendMatchDeadline(matchId, newDeadlineIso) {
    const { error } = await sb.rpc("extend_match_deadline", {
      p_match_id: matchId, p_new_deadline: newDeadlineIso,
    });
    if (error) throw error;
  },

  async recentResults(limit = 5) {
    const { data, error } = await sb
      .from("league_matches")
      .select("*, player_a:player_a_id(*), player_b:player_b_id(*), league:league_id(name)")
      .eq("status", "confirmed")
      .order("confirmed_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  },

  async createMatch(fields) {
    const { error } = await sb.from("league_matches").insert(fields);
    if (error) throw error;
  },

  async matchById(id) {
    const { data, error } = await sb
      .from("league_matches")
      .select("*, player_a:player_a_id(*), player_b:player_b_id(*), league:league_id(name, legs_per_match)")
      .eq("id", id)
      .single();
    if (error) throw error;
    return data;
  },

  // Uitslag doorgeven. Draait via een security-definer functie in de
  // database, die onthoudt wie hem invulde (reported_by) zodat diezelfde
  // speler hem niet ook kan bevestigen. Zet de status op
  // pending_confirmation; de tegenstander (of de organisator) bevestigt of
  // keurt af.
  async reportResult(matchId, r) {
    const { error } = await sb.rpc("report_league_match_result", {
      p_match_id: matchId,
      p_winner_id: r.winnerId,
      p_player_a_legs: r.aLegs,
      p_player_b_legs: r.bLegs,
      p_player_a_average: r.aAverage,
      p_player_b_average: r.bAverage,
      p_player_a_180s: r.a180s,
      p_player_b_180s: r.b180s,
      p_player_a_highest_checkout: r.aCheckout,
      p_player_b_highest_checkout: r.bCheckout,
    });
    if (error) throw error;
  },

  // Bevestigen telt de wedstrijd mee in player_statistics (in de database).
  async confirmMatch(matchId) {
    const { error } = await sb.rpc("confirm_league_match_result", { p_match_id: matchId });
    if (error) throw error;
  },

  // Afkeuren zet de wedstrijd terug naar 'scheduled' zodat de uitslag
  // opnieuw ingevuld kan worden.
  async rejectMatch(matchId) {
    const { error } = await sb.rpc("reject_league_match_result", { p_match_id: matchId });
    if (error) throw error;
  },

  // Tellingen voor het organisatordashboard. head+count haalt alleen het
  // aantal op, niet de rijen zelf.
  async counts() {
    const q = (table, build) => {
      let b = sb.from(table).select("*", { count: "exact", head: true });
      return build ? build(b) : b;
    };
    const [players, leagues, tournaments, open] = await Promise.all([
      q("profiles"),
      q("leagues", (b) => b.eq("status", "active")),
      q("tournaments", (b) => b.eq("status", "active")),
      q("league_matches", (b) => b.in("status", ["scheduled", "in_progress", "pending_confirmation"])),
    ]);
    return {
      players: players.count || 0,
      leagues: leagues.count || 0,
      tournaments: tournaments.count || 0,
      open: open.count || 0,
    };
  },

  async uploadAvatar(userId, file) {
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const path = `${userId}/avatar.${ext}`;
    const { error } = await sb.storage.from("avatars")
      .upload(path, file, { upsert: true });
    if (error) throw error;
    const { data } = sb.storage.from("avatars").getPublicUrl(path);
    // cache-buster, anders toont de browser de oude foto
    return `${data.publicUrl}?v=${Date.now()}`;
  },
};

/* -------------------------------------------------------------------------
   5. Authenticatieschermen
   ------------------------------------------------------------------------- */

function authShell(title, sub, body, alt = "") {
  return `
    <div class="auth-wrap">
      <div class="auth-box">
        <div class="auth-head">
          <img class="auth-mark" src="https://qspfphnailbelqmmzjbk.supabase.co/storage/v1/object/public/app-assets/favicon.png" alt="">
          <h1>${esc(title)}</h1>
          <p class="sub" style="margin-bottom:0">${esc(sub)}</p>
        </div>
        <div id="authError"></div>
        ${body}
        ${alt}
      </div>
    </div>`;
}

function showAuthError(msg) {
  const box = document.getElementById("authError");
  if (box) box.innerHTML = `<div class="alert bad">${esc(msg)}</div>`;
}

function busy(btn, on, label) {
  btn.disabled = on;
  btn.innerHTML = on ? `<span class="spinner inline"></span>` : esc(label);
}

function renderLanding() {
  const step = (num, title, text) => `
    <div class="landing-step">
      <div class="landing-step-num">${num}</div>
      <div>
        <h3>${esc(title)}</h3>
        <p>${esc(text)}</p>
      </div>
    </div>`;

  const feature = (num, title, text) => `
    <div class="landing-feature">
      <div class="landing-feature-num">${num}</div>
      <h3>${esc(title)}</h3>
      <p>${esc(text)}</p>
    </div>`;

  const tile = (color, label, value, who) => `
    <div class="landing-tile" style="--tile-c:${color}">
      <div class="landing-tile-label"><span class="dot"></span>${esc(label)}</div>
      <div class="landing-tile-value">${esc(value)}</div>
      <div class="landing-tile-who">${esc(who)}</div>
    </div>`;

  app.innerHTML = `
    <div class="landing">
      <div class="landing-nav">
        <div class="brand">
          <img class="landing-logo" src="https://qspfphnailbelqmmzjbk.supabase.co/storage/v1/object/public/app-assets/favicon.png" alt="Dart League">
          <span class="brand-name">Dart League</span>
        </div>
        <button class="btn ghost sm" onclick="renderLogin()">Inloggen</button>
      </div>

      <div class="landing-wrap">
        <div class="landing-hero-panel">
          <div class="landing-hero-ring" aria-hidden="true"></div>
          <div class="landing-hero-inner">
            <span class="landing-eyebrow">${icon.target}&nbsp;Voor elke darter</span>
            <h1 class="landing-wordmark">Dart League</h1>
            <p class="sub">Speel mee in leagues en toernooien, plan je wedstrijden en houd je scores en statistieken automatisch bij &mdash; allemaal op één plek.</p>
            <div class="landing-cta">
              <button class="btn" onclick="renderRegister()">Gratis account aanmaken</button>
              <button class="btn ghost" onclick="renderLogin()">Inloggen</button>
              <button class="btn ghost" onclick="document.getElementById('hoe-het-werkt').scrollIntoView({behavior:'smooth'})">Zo werkt het</button>
            </div>
            <p class="landing-hero-note">Gratis te gebruiken &middot; geen creditcard nodig</p>
          </div>
        </div>

        <div class="landing-notice">
          ${icon.shield}
          <span>Log in om de standen, wedstrijden en statistieken van je league te bekijken.</span>
        </div>

        <div class="landing-section">
          <h2>Zo ziet jouw stand eruit</h2>
          <p class="sub">Een voorbeeld &mdash; jouw eigen cijfers verschijnen zodra je meedoet.</p>
          <div class="landing-highlight">
            <div class="card" style="margin:0">
              <div class="match-top">
                <span class="match-league">Halve finale &middot; League Zuid</span>
              </div>
              <div class="match-row">
                <div class="mp winner">
                  ${avatar({ display_name: "Sanne" })}
                  <span class="mp-name">Sanne</span>
                </div>
                <span class="vs">VS</span>
                <div class="mp right">
                  ${avatar({ display_name: "Rick" })}
                  <span class="mp-name">Rick</span>
                </div>
              </div>
              <div class="match-score">
                <span class="score win">3</span>
                <span class="score-sep">&ndash;</span>
                <span class="score">1</span>
              </div>
            </div>
            <div class="landing-tile-grid">
              ${tile("#2ECC71", "Winratio", "68%", "Sanne")}
              ${tile("#4EA1F7", "Gemiddelde", "58.4", "Rick")}
              ${tile("#F5B942", "180's", "24", "Sanne")}
              ${tile("#9B7BD9", "Beste finish", "121", "Rick")}
            </div>
          </div>
        </div>

        <div class="landing-section" id="hoe-het-werkt">
          <h2>Zo werkt het</h2>
          <div class="landing-step-list">
            ${step("01", "Maak een account", "Binnen een minuut aangemeld, zonder gedoe.")}
            ${step("02", "Sluit je aan bij een league of toernooi", "De beheerder zet ze voor je klaar, jij doet mee.")}
            ${step("03", "Speel en volg je voortgang", "Standen, uitslagen en statistieken staan direct klaar.")}
          </div>
        </div>

        <div class="landing-section">
          <h2>Wat je krijgt</h2>
          <div class="landing-feature-grid">
            ${feature("01", "Automatische standen", "Elke afgeronde wedstrijd werkt de ranglijst meteen bij.")}
            ${feature("02", "Persoonlijke statistieken", "Gemiddelde, 180's, checkouts en winratio per speler.")}
            ${feature("03", "Organisatordashboard", "Leagues en toernooien beheren vanuit één overzicht.")}
            ${feature("04", "Overal te gebruiken", "Werkt in de browser, op telefoon, tablet en desktop.")}
          </div>
        </div>

        <div class="landing-final">
          <h2>Klaar om mee te doen?</h2>
          <p>Maak een gratis account aan en speel je eerste wedstrijd binnen een minuut.</p>
          <button class="btn" onclick="renderRegister()">Gratis account aanmaken</button>
        </div>
      </div>

      <div class="landing-foot">© ${new Date().getFullYear()} Dart League</div>
    </div>`;
}

function renderLogin() {
  app.innerHTML = authShell(
    "Dart League",
    "Log in om je wedstrijden te zien",
    `<form id="f" novalidate>
      <div class="field">
        <label for="email">E-mailadres</label>
        <input id="email" type="email" autocomplete="email" required>
      </div>
      <div class="field">
        <label for="pw">Wachtwoord</label>
        <input id="pw" type="password" autocomplete="current-password" required>
      </div>
      <button class="btn block" id="submit" type="submit">Inloggen</button>
      <div class="center mt16">
        <button class="linkbtn" type="button" onclick="renderForgot()">Wachtwoord vergeten?</button>
      </div>
    </form>`,
    `<div class="auth-alt">Nog geen account?
      <button class="linkbtn" onclick="renderRegister()">Maak er een aan</button>
    </div>`
  );

  document.getElementById("f").onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById("submit");
    const email = document.getElementById("email").value.trim();
    const pw = document.getElementById("pw").value;
    if (!email || !pw) return showAuthError("Vul je e-mailadres en wachtwoord in.");
    busy(btn, true);
    const { error } = await sb.auth.signInWithPassword({ email, password: pw });
    if (error) { busy(btn, false, "Inloggen"); showAuthError(errText(error)); }
    // Bij succes neemt onAuthStateChange het over.
  };
}

function renderRegister() {
  app.innerHTML = authShell(
    "Account aanmaken",
    "Je speelt binnen een minuut mee",
    `<form id="f" novalidate>
      <div class="field">
        <label for="name">Naam</label>
        <input id="name" type="text" autocomplete="name" required>
      </div>
      <div class="field">
        <label for="email">E-mailadres</label>
        <input id="email" type="email" autocomplete="email" required>
      </div>
      <div class="field">
        <label for="pw">Wachtwoord</label>
        <input id="pw" type="password" autocomplete="new-password" required>
        <div class="field-error" id="pwHint" style="color:var(--muted)">Minimaal 8 tekens</div>
      </div>
      <button class="btn block" id="submit" type="submit">Account aanmaken</button>
    </form>`,
    `<div class="auth-alt">Heb je al een account?
      <button class="linkbtn" onclick="renderLogin()">Inloggen</button>
    </div>`
  );

  document.getElementById("f").onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById("submit");
    const name = document.getElementById("name").value.trim();
    const email = document.getElementById("email").value.trim();
    const pw = document.getElementById("pw").value;

    if (!name) return showAuthError("Vul je naam in.");
    if (!email.includes("@")) return showAuthError("Vul een geldig e-mailadres in.");
    if (pw.length < 8) return showAuthError("Kies een wachtwoord van minimaal 8 tekens.");

    busy(btn, true);
    const { data, error } = await sb.auth.signUp({
      email,
      password: pw,
      options: { data: { display_name: name } },
    });
    if (error) { busy(btn, false, "Account aanmaken"); return showAuthError(errText(error)); }

    // Staat e-mailbevestiging aan, dan is er nog geen sessie.
    if (!data.session) {
      app.innerHTML = authShell(
        "Check je mail",
        `We stuurden een bevestigingslink naar ${email}`,
        `<button class="btn block" onclick="renderLogin()">Terug naar inloggen</button>`
      );
    }
  };
}

function renderForgot() {
  app.innerHTML = authShell(
    "Wachtwoord vergeten",
    "We sturen je een link om een nieuw wachtwoord te kiezen",
    `<form id="f" novalidate>
      <div class="field">
        <label for="email">E-mailadres</label>
        <input id="email" type="email" autocomplete="email" required>
      </div>
      <button class="btn block" id="submit" type="submit">Stuur de link</button>
    </form>`,
    `<div class="auth-alt"><button class="linkbtn" onclick="renderLogin()">Terug naar inloggen</button></div>`
  );

  document.getElementById("f").onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById("submit");
    const email = document.getElementById("email").value.trim();
    if (!email.includes("@")) return showAuthError("Vul een geldig e-mailadres in.");
    busy(btn, true);
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}${location.pathname}#/nieuw-wachtwoord`,
    });
    if (error) { busy(btn, false, "Stuur de link"); return showAuthError(errText(error)); }
    app.innerHTML = authShell(
      "Check je mail",
      `Als er een account is voor ${email}, ligt er nu een link in je inbox`,
      `<button class="btn block" onclick="renderLogin()">Terug naar inloggen</button>`
    );
  };
}

// Scherm waar de gebruiker landt na het klikken op de reset-link.
function renderNewPassword() {
  app.innerHTML = authShell(
    "Nieuw wachtwoord",
    "Kies een wachtwoord om mee in te loggen",
    `<form id="f" novalidate>
      <div class="field">
        <label for="pw">Nieuw wachtwoord</label>
        <input id="pw" type="password" autocomplete="new-password" required>
      </div>
      <button class="btn block" id="submit" type="submit">Wachtwoord opslaan</button>
    </form>`
  );

  document.getElementById("f").onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById("submit");
    const pw = document.getElementById("pw").value;
    if (pw.length < 8) return showAuthError("Kies een wachtwoord van minimaal 8 tekens.");
    busy(btn, true);
    const { error } = await sb.auth.updateUser({ password: pw });
    if (error) { busy(btn, false, "Wachtwoord opslaan"); return showAuthError(errText(error)); }
    location.hash = "#/";
    toast("Wachtwoord opgeslagen");
    boot();
  };
}

// Verplicht scherm direct na registratie/inloggen zolang er nog geen
// player_onboarding-rij is. Deze gegevens zijn alleen zichtbaar voor de
// speler zelf en de organisator, en worden gebruikt voor de initiële
// indeling in divisies.
function renderOnboarding() {
  app.innerHTML = authShell(
    "Jouw spelersgegevens",
    "Nodig voor de organisator om je in te delen",
    `<form id="f" novalidate>
      <div class="field">
        <label for="ob-first">Voornaam</label>
        <input id="ob-first" required autocomplete="given-name">
      </div>
      <div class="field">
        <label for="ob-last">Achternaam</label>
        <input id="ob-last" required autocomplete="family-name">
      </div>
      <div class="field">
        <label for="ob-platform">Platform</label>
        <select id="ob-platform" required>
          <option value="scolia">Scolia</option>
          <option value="dartcounter">DartCounter</option>
        </select>
      </div>
      <div class="field">
        <label for="ob-nick">Nickname (Scolia / DartCounter)</label>
        <input id="ob-nick" required>
      </div>
      <div class="field">
        <label for="ob-avg">Gemiddelde (3 darts)</label>
        <input id="ob-avg" type="number" step="0.01" min="0" max="180" placeholder="Bijv. 53.08" required>
        <div class="muted" style="font-size:12.5px;margin-top:6px">
          Enkel zichtbaar voor de beheerder, gebruikt voor de initiële indeling.
        </div>
      </div>
      <button class="btn block" id="submit" type="submit">Opslaan en verder</button>
    </form>`,
    `<div class="auth-alt"><button class="linkbtn" onclick="signOut()">Uitloggen</button></div>`
  );

  document.getElementById("f").onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById("submit");
    const firstName = document.getElementById("ob-first").value.trim();
    const lastName = document.getElementById("ob-last").value.trim();
    const platform = document.getElementById("ob-platform").value;
    const nickname = document.getElementById("ob-nick").value.trim();
    const average = document.getElementById("ob-avg").value;

    if (!firstName || !lastName) return showAuthError("Vul je voor- en achternaam in.");
    if (!nickname) return showAuthError("Vul je nickname in.");
    if (average === "" || isNaN(Number(average)) || Number(average) < 0) {
      return showAuthError("Vul een geldig gemiddelde in.");
    }

    busy(btn, true);
    try {
      await db.saveOnboarding(state.profile.id, {
        first_name: firstName,
        last_name: lastName,
        platform,
        platform_nickname: nickname,
        reported_average: Number(average),
      });
      state.onboarding = await db.myOnboarding(state.profile.id);
      router();
    } catch (err) {
      busy(btn, false, "Opslaan en verder");
      showAuthError(errText(err));
    }
  };
}

/* -------------------------------------------------------------------------
   6. Navigatie en router
   ------------------------------------------------------------------------- */

const NAV = [
  { route: "", label: "Home", ico: "home" },
  { route: "leagues", label: "Leagues", ico: "league" },
  { route: "toernooien", label: "Toernooien", ico: "target" },
  { route: "wedstrijden", label: "Wedstrijden", ico: "match" },
  { route: "statistieken", label: "Statistieken", ico: "chart" },
  { route: "profiel", label: "Profiel", ico: "user" },
];

function go(route) {
  location.hash = "#/" + route;
}

function currentRoute() {
  return (location.hash || "#/").replace(/^#\/?/, "");
}

function navActive(route, current) {
  if (route === "") return current === "";
  return current === route || current.startsWith(route + "/");
}

function renderShell() {
  const cur = currentRoute();
  const isOrg = state.profile?.role === "organizer";

  const links = NAV.map((n) => `
    <button class="navlink ${navActive(n.route, cur) ? "active" : ""}" onclick="go('${n.route}')">
      ${icon[n.ico]}<span>${esc(n.label)}</span>
    </button>`).join("");

  const orgLink = isOrg ? `
    <div style="margin-top:auto;padding-top:12px;border-top:1px solid var(--line)">
      <button class="navlink ${cur.startsWith("beheer") ? "active" : ""}" onclick="go('beheer')">
        ${icon.shield}<span>Beheer</span>
      </button>
    </div>` : "";

  const tabs = NAV.map((n) => `
    <button class="${navActive(n.route, cur) ? "active" : ""}" onclick="go('${n.route}')">
      ${icon[n.ico]}<span>${esc(n.label)}</span>
    </button>`).join("") + (isOrg ? `
    <button class="${cur.startsWith("beheer") ? "active" : ""}" onclick="go('beheer')">
      ${icon.shield}<span>Beheer</span>
    </button>` : "");

  app.innerHTML = `
    <div class="shell">
      <nav class="sidebar" aria-label="Hoofdmenu">
        <div class="brand"><img class="brand-mark" src="https://qspfphnailbelqmmzjbk.supabase.co/storage/v1/object/public/app-assets/favicon.png" alt=""><span class="brand-name">Dart League</span></div>
        ${links}
        ${orgLink}
      </nav>
      <main class="main"><div class="page" id="view">${loadingView()}</div></main>
    </div>
    <nav class="bottomnav" aria-label="Hoofdmenu">${tabs}</nav>`;
}

function setView(html) {
  const v = document.getElementById("view");
  if (v) v.innerHTML = html;
}

const ROUTES = {
  "": viewHome,
  "mijn-divisie": viewMyDivision,
  "leagues": viewLeagues,
  "toernooien": viewTournaments,
  "wedstrijden": viewMatches,
  "statistieken": viewStats,
  "profiel": viewProfile,
  "beheer": viewOrganizer,
  "beheer/spelers": viewManagePlayers,
  "beheer/leagues": viewManageLeagues,
  "beheer/toernooien": viewManageTournaments,
  "beheer/wedstrijden": viewManageMatches,
  "beheer/prijzen": viewManagePrizes,
  "beheer/instellingen": viewSettings,
};

async function router() {
  const route = currentRoute();

  if (route === "nieuw-wachtwoord") return renderNewPassword();
  if (!state.session) return renderLanding();
  if (!state.onboarding) return renderOnboarding();

  renderShell();

  try {
    if (route.startsWith("league/")) {
      return await viewLeagueDetail(route.split("/")[1]);
    }
    if (route.startsWith("mijn-divisie/")) {
      return await viewMyDivision(route.split("/")[1]);
    }
    if (route.startsWith("prijs/")) {
      return await viewPrizeDetail(route.split("/")[1]);
    }
    if (route.startsWith("beheer/prijs/")) {
      if (state.profile?.role !== "organizer") {
        return setView(emptyView("Alleen voor organisatoren", "Vraag de organisator om toegang."));
      }
      return await viewManagePrizeDetail(route.split("/")[2]);
    }
    const handler = ROUTES[route];
    if (!handler) {
      return setView(emptyView("Deze pagina bestaat niet", "Gebruik het menu om verder te gaan."));
    }
    if (route.startsWith("beheer") && state.profile?.role !== "organizer") {
      return setView(emptyView("Alleen voor organisatoren", "Vraag de organisator om toegang."));
    }
    await handler();
  } catch (error) {
    console.error(error);
    setView(errorView(error));
  }
}

/* -------------------------------------------------------------------------
   7. Schermen
   ------------------------------------------------------------------------- */

function openNotification(id, route) {
  db.markNotificationRead(id).catch(() => {});
  if (route) go(route); else router();
}

async function viewHome() {
  const me = state.profile;
  const firstName = (me?.display_name || "").split(" ")[0];
  const s = me?.stats;

  const [matches, leagues, tournaments, results, prizeNotification, notification, membership] = await Promise.all([
    db.myMatches(me.id),
    db.leagues("active"),
    db.upcomingTournaments(),
    db.recentResults(3),
    db.myPendingPrizeNotification(),
    db.myPendingNotification(),
    db.myLeagueMembership(),
  ]);

  const next = matches.find((m) => m.status === "scheduled" || m.status === "in_progress");
  const winPct = s && s.matches_played > 0
    ? Math.round((s.matches_won / s.matches_played) * 100) : 0;

  let myDivisionPosition = null;
  let myDivisionTotal = 0;
  if (membership) {
    const standings = await db.standingsForLeague(membership.league.id);
    const inMyDivision = standings.filter((r) => r.divisionId === membership.division?.id);
    myDivisionTotal = inMyDivision.length;
    const idx = inMyDivision.findIndex((r) => r.player.id === me.id);
    myDivisionPosition = idx >= 0 ? idx + 1 : null;
  }

  setView(`
    <h1>Hoi ${esc(firstName)}</h1>
    <p class="sub">${esc(new Date().toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" }))}</p>

    ${prizeNotification ? `
      <button class="card clickable" style="border-color:#F5B94266;background:#F5B94214;margin-bottom:16px"
        onclick="go('prijs/${esc(prizeNotification.claim.division_winner_id)}')">
        <div class="row">
          <div class="row-ico" style="background:#F5B94222;color:#F5B942">${icon.trophy}</div>
          <div class="row-main">
            <div class="row-title">${esc(prizeNotification.title)}</div>
            <div class="row-sub">Bekijk je prijs &rarr;</div>
          </div>
        </div>
      </button>` : ""}

    ${notification ? `
      <button class="card clickable" style="border-color:#4EA1F766;background:#4EA1F714;margin-bottom:16px"
        onclick="openNotification('${esc(notification.id)}', '${notification.league_id ? `league/${esc(notification.league_id)}` : (notification.league_match_id ? "wedstrijden" : "")}')">
        <div class="row">
          <div class="row-ico" style="background:#4EA1F722;color:#4EA1F7">${icon.bell}</div>
          <div class="row-main">
            <div class="row-title">${esc(notification.title)}</div>
            <div class="row-sub">${esc(notification.body || "")}</div>
          </div>
        </div>
      </button>` : ""}

    ${membership ? `
      <button class="card clickable" style="margin-bottom:16px" onclick="go('mijn-divisie')">
        <div class="row">
          <div class="row-ico">${icon.league}</div>
          <div class="row-main">
            <div class="row-title">Mijn competitie</div>
            <div class="row-sub">${esc(membership.league.name)} &middot; ${esc(membership.division?.name || "Nog niet ingedeeld")}</div>
          </div>
          ${myDivisionPosition ? `<div class="muted" style="font-size:13px;flex-shrink:0">Plaats ${myDivisionPosition} van ${myDivisionTotal}</div>` : ""}
        </div>
      </button>` : ""}

    <div class="grid" style="grid-template-columns:repeat(2,1fr)">
      ${statCard({ label: "Gemiddelde", value: (s?.average_score ?? 0).toFixed(1), ico: "trend" })}
      ${statCard({ label: "Gewonnen", value: winPct + "%", ico: "trophy", color: "#2ECC71" })}
    </div>

    ${sectionHead("Je volgende wedstrijd", "Alle wedstrijden", "wedstrijden")}
    ${next ? matchCard(next) : emptyView("Niets ingepland", "Zodra de organisator een wedstrijd voor je inplant, staat hij hier.", "match")}

    ${sectionHead("Actieve leagues", "Alle leagues", "leagues")}
    ${leagues.length ? leagues.slice(0, 3).map((l) => leagueCard(l)).join("") : emptyView("Geen actieve leagues", "", "league")}

    ${sectionHead("Aankomende toernooien", "Alle toernooien", "toernooien")}
    ${tournaments.length ? tournaments.map(tournamentCard).join("") : emptyView("Geen toernooien gepland", "", "target")}

    ${sectionHead("Laatste uitslagen")}
    ${results.length ? results.map(matchCard).join("") : emptyView("Nog geen uitslagen", "", "match")}
  `);
}

// "Mijn divisie": de league/divisie waarin de ingelogde speler op dit
// moment zit (er kan er maar één zijn, zie enforce_single_active_league),
// met alle divisies van die league als kaarten en de eigen divisie/rij
// gemarkeerd - dezelfde weergave als op de leaguepagina, hier alvast
// gefilterd naar "van mij".
// "Mijn divisie": league-info, de gefocuste wedstrijd (huidige wedstrijd +
// datum&tijd-kaart + onderlinge wedstrijden tegen die tegenstander), alle
// open wedstrijden van de speler in deze league (wisselbare focus), en de
// volledige stand. Een speler kan meerdere open wedstrijden tegelijk hebben
// (round-robin), dus focusMatchId (via de route mijn-divisie/:id) bepaalt
// welke wedstrijd bovenaan uitgelicht wordt - standaard de eerstvolgende
// deadline.
async function viewMyDivision(focusMatchId) {
  const membership = await db.myLeagueMembership();
  if (!membership) {
    return setView(`
      <h1>Mijn divisie</h1>
      ${emptyView("Nog niet ingedeeld", "Zodra de organisator je indeelt in een league, zie je hier je divisie.", "league")}
    `);
  }
  const league = membership.league;
  const me = state.profile;

  const [standings, allMyMatches] = await Promise.all([
    db.standingsForLeague(league.id),
    db.myMatches(me.id),
  ]);
  const leagueMatches = allMyMatches.filter((m) => m.league_id === league.id);
  const openMatches = leagueMatches
    .filter((m) => !["confirmed", "cancelled"].includes(m.status))
    .sort((a, b) => new Date(a.deadline_at || 0) - new Date(b.deadline_at || 0));

  let focusMatch = focusMatchId ? leagueMatches.find((m) => m.id === focusMatchId) : null;
  if (!focusMatch) focusMatch = openMatches[0] || leagueMatches[0] || null;

  let opponent = null;
  let headToHead = [];
  let proposalHistory = [];
  let chatMessages = [];
  if (focusMatch) {
    opponent = focusMatch.player_a_id === me.id ? focusMatch.player_b : focusMatch.player_a;
    [headToHead, proposalHistory, chatMessages] = await Promise.all([
      opponent ? db.headToHead(opponent.id) : Promise.resolve([]),
      db.scheduleProposalHistory(focusMatch.id),
      db.chatMessages(focusMatch.id),
    ]);
  }

  const groups = groupStandingsByDivision(standings);

  setView(`
    <h1>Jouw divisie</h1>
    <p class="sub">${esc(membership.division?.name || "")} &middot; ${esc(league.name)}${league.season ? " &middot; Seizoen: " + esc(league.season) : ""}</p>
    <button class="linkbtn mt8" style="margin-bottom:16px" onclick="go('league/${esc(league.id)}')">Bekijk de hele league &rarr;</button>

    ${focusMatch ? `
      ${sectionHead("Huidige wedstrijd")}
      ${matchCard(focusMatch)}
      ${!["confirmed", "cancelled"].includes(focusMatch.status) ? `
        <button class="btn ghost sm" style="margin:-4px 0 14px" onclick="${
          focusMatch.status === "pending_confirmation"
            ? `openConfirmDialog('${esc(focusMatch.id)}')`
            : `openResultDialog('${esc(focusMatch.id)}')`
        }">${focusMatch.status === "pending_confirmation" ? "Uitslag controleren" : "Uitslag doorgeven"}</button>` : ""}

      ${sectionHead("Datum & uur van deze wedstrijd")}
      ${scheduleCard(focusMatch, proposalHistory)}

      ${opponent ? `
        ${sectionHead("Chat")}
        ${chatCard(chatMessages, me.id, focusMatch.id)}

        ${sectionHead("Onderlinge wedstrijden")}
        ${headToHeadCard(headToHead, opponent, me.id)}
      ` : ""}
    ` : emptyView("Geen open wedstrijden", "Je hebt op dit moment geen wedstrijden om te spelen.", "match")}

    ${sectionHead("Wedstrijden deze week")}
    ${leagueMatches.length ? leagueMatches.map((m) => `
        ${matchCard(m)}
        ${focusMatch && m.id === focusMatch.id
          ? `<p class="muted" style="margin:-4px 0 14px;font-size:12.5px">Dit is je huidige wedstrijd hierboven.</p>`
          : `<button class="btn ghost sm" style="margin:-4px 0 14px" onclick="go('mijn-divisie/${esc(m.id)}')">Bekijk wedstrijd</button>`}
      `).join("")
      : emptyView("Geen wedstrijden", "", "match")}

    ${sectionHead("Stand")}
    ${groups.length ? groups.map((g) => divisionStandingsCard(g, { meId: me.id, divisionCount: league.division_count })).join("")
      : emptyView("Nog geen indeling", "", "league")}
  `);
  document.getElementById("chat-messages")?.scrollTo(0, 999999);
}

async function viewLeagues() {
  const leagues = await db.leagues();
  setView(`
    <h1>Leagues</h1>

    <details class="card info-card" style="margin-bottom:16px">
      <summary>
        <div class="row">
          <div class="row-ico">${icon.league}</div>
          <div class="row-main"><div class="row-title" style="white-space:normal">Hoe werkt de league?</div></div>
          <span class="muted toggle-label" style="font-size:13px;flex-shrink:0">Meer info &darr;</span>
        </div>
      </summary>
      <div class="muted" style="font-size:13.5px;line-height:1.6;margin-top:14px">
        <p>Een league bestaat uit maximaal 4 divisies. Spelers worden op basis van hun 3-dart gemiddelde ingedeeld in een divisie. Iedere divisie heeft maximaal 12 spelers.</p>
        <p>De wedstrijden worden automatisch ingedeeld. Iedere wedstrijd heeft vanaf het moment waarop deze beschikbaar wordt gesteld 7 dagen de tijd om gespeeld te worden. De deadline geldt afzonderlijk per wedstrijd.</p>
        <p>Aan het einde van een league-periode wordt de eindstand opgemaakt. De beste spelers kunnen promoveren naar een hogere divisie en de laagst geklasseerde spelers kunnen degraderen.</p>
        <p>De winnaar van iedere divisie ontvangt een kampioenstitel en een gepersonaliseerde prijs, beschikbaar gesteld door LWPrints. Dit kan bijvoorbeeld een bedrukt T-shirt, hoodie of polo zijn.</p>
      </div>
    </details>

    ${leagues.length ? leagues.map((l) => leagueCard(l)).join("")
      : emptyView("Nog geen leagues", "", "league")}
  `);
  const infoCard = document.querySelector(".info-card");
  infoCard?.addEventListener("toggle", () => {
    infoCard.querySelector(".toggle-label").innerHTML = infoCard.open ? "Minder info &uarr;" : "Meer info &darr;";
  });
}

// Tekst voor "eerstvolgende actie" op het beheerdersblok, bv. "Deze league
// start op 1 oktober 2026 om 19:00 uur."
function leagueNextActionText(league) {
  if (league.status === "draft") {
    return "Stel een startdatum en -tijd in en klik op 'Inplannen' om de league te plannen.";
  }
  if (league.status === "scheduled") {
    const d = new Date(league.start_at);
    const datePart = d.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: league.timezone });
    const timePart = d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: league.timezone });
    return `Deze league start op ${datePart} om ${timePart} uur.`;
  }
  if (league.status === "active") {
    return `De league is gestart. Spelers hebben ${league.match_deadline_days} dagen per wedstrijd om te spelen.`;
  }
  return "Deze league is afgerond.";
}

async function viewLeagueDetail(id) {
  const isOrg = state.profile?.role === "organizer";
  let league = await db.league(id);
  if (league.status === "scheduled" && await db.activateLeagueIfDue(id).catch(() => false)) {
    league = await db.league(id);
  }
  const [matches, standings, members] = await Promise.all([
    db.matchesForLeague(id), db.standingsForLeague(id), db.leagueMembers(id),
  ]);
  const winners = (isOrg && league.status === "finished") ? await db.divisionWinnersForLeague(id) : [];
  const groups = groupStandingsByDivision(standings);
  const canEditSchedule = isOrg && (league.status === "draft" || league.status === "scheduled");
  const perDivision = {};
  for (const m of members) {
    const key = m.division?.name || "Geen divisie";
    perDivision[key] = (perDivision[key] || 0) + 1;
  }
  const perDivisionText = Object.entries(perDivision).map(([name, n]) => `${esc(name)}: ${n}`).join(" · ") || "Nog geen spelers ingedeeld";

  setView(`
    <button class="linkbtn" onclick="go('leagues')" style="display:flex;align-items:center;gap:4px;margin-bottom:12px">
      <span style="width:16px;height:16px;display:inline-flex">${icon.back}</span> Leagues
    </button>
    <h1>${esc(league.name)}</h1>
    <p class="sub">${esc([league.season, `${league.game_type} · best of ${league.legs_per_match}`].filter(Boolean).join(" · "))}</p>
    <div style="margin-bottom:24px">${badge(league.status)}</div>

    ${isOrg ? `
      ${sectionHead("Planning")}
      <div class="card">
        ${infoRow("Status", badge(league.status))}
        ${infoRow("Aantal divisies", `${esc(league.division_count)} (max 12 spelers per divisie)`)}
        ${infoRow("Spelers per divisie", perDivisionText)}
        ${infoRow("Tijdzone", esc(league.timezone))}
        ${infoRow("Wedstrijden aangemaakt", matches.length)}
        <p class="muted" style="font-size:13px;margin:12px 0 0">${esc(leagueNextActionText(league))}</p>
      </div>
      ${canEditSchedule ? `
        <div class="card mt16">
          <div class="field"><label for="lp-desc">Beschrijving <span class="muted" style="font-weight:400">(optioneel)</span></label>
            <input id="lp-desc" value="${esc(league.description || "")}" placeholder="Bijv. Najaarscompetitie 2026"></div>
          <div class="field"><label for="lp-dc">Aantal divisies</label>
            <select id="lp-dc">
              ${[1, 2, 3, 4].map((n) => `<option value="${n}" ${league.division_count === n ? "selected" : ""}>${n}</option>`).join("")}
            </select>
          </div>
          <div class="field"><label for="lp-start">Startdatum en -tijd</label>
            <input id="lp-start" type="datetime-local" value="${league.start_at ? fmtDatetimeLocal(league.start_at) : ""}"></div>
          <div class="field"><label for="lp-end">Einddatum <span class="muted" style="font-weight:400">(optioneel)</span></label>
            <input id="lp-end" type="date" value="${league.end_at ? league.end_at.slice(0, 10) : ""}"></div>
          <div class="chips">
            <button class="chip" onclick="saveLeagueSchedule('${esc(id)}', false)">Opslaan</button>
            ${league.status === "draft" ? `
              <button class="chip" onclick="saveLeagueSchedule('${esc(id)}', true)">${icon.clock} Inplannen</button>` : ""}
          </div>
        </div>` : ""}
    ` : ""}

    ${sectionHead("Stand")}
    ${groups.length ? groups.map((g) => divisionStandingsCard(g, { meId: state.profile.id, divisionCount: league.division_count })).join("")
      : emptyView("Nog geen indeling", "Er zijn nog geen spelers ingedeeld in deze league.", "league")}

    ${isOrg ? `
      ${sectionHead("Divisies en spelers")}
      <div class="chips" style="margin-bottom:14px">
        ${league.status === "draft" ? `
          <button class="chip" onclick="autoAssignDivisions('${esc(id)}')">${icon.target} Automatisch indelen</button>` : ""}
        <button class="chip" onclick="openDivisionDialog('${esc(id)}')">${icon.plus} Nieuwe divisie</button>
        <button class="chip" onclick="openAssignPlayerDialog('${esc(id)}')">${icon.plus} Speler indelen</button>
        ${league.status === "finished" ? `
          <button class="chip" onclick="applyPromotionRelegation('${esc(id)}')">${icon.trophy} Promotie/degradatie toepassen</button>` : ""}
      </div>
      ${league.status === "draft" ? `
        <p class="muted" style="font-size:12.5px;margin:-6px 0 14px">
          Automatisch indelen: 1e divisie 70+ gemiddelde, 2e 60+, 3e 50+, 4e &lt;50 (max 12 per divisie).
        </p>` : ""}
    ` : ""}

    ${isOrg && league.status === "finished" ? `
      ${sectionHead("Divisiewinnaars & prijzen")}
      ${winners.length ? `
        <div class="card">
          ${winners.map((w, i) => `
            <div class="row" style="padding:7px 0;${i > 0 ? "border-top:1px solid var(--line)" : ""}">
              ${avatar(w.player, "sm")}
              <div class="row-main">
                <div class="row-title">${esc(w.player?.display_name || "?")}</div>
                <div class="row-sub">${esc(w.division_name)}</div>
              </div>
              ${w.claim ? prizeStatusBadge(w.claim.status) : ""}
            </div>`).join("")}
        </div>
        <button class="btn ghost sm mt8" onclick="go('beheer/prijzen')">Alle prijzen beheren</button>
      ` : `
        <button class="btn" onclick="determineDivisionWinners('${esc(id)}')">${icon.trophy} Bepaal divisiewinnaars</button>
        <p class="muted" style="font-size:12.5px;margin:8px 0 0">
          Elke divisiewinnaar krijgt automatisch een melding en kan zijn prijs claimen (beschikbaar gesteld door LWPrints).
        </p>
      `}
    ` : ""}

    ${sectionHead("Wedstrijden")}
    ${matches.length ? matches.map(matchCard).join("")
      : emptyView("Nog geen wedstrijden", "Er is nog niets ingepland voor deze league.", "match")}
  `);
}

async function saveLeagueSchedule(leagueId, schedule) {
  const start = document.querySelector("#lp-start").value;
  if (schedule && !start) {
    return toast("Stel eerst een startdatum en -tijd in om te kunnen plannen.");
  }
  const startAt = start ? new Date(start).toISOString() : null;
  if (schedule && startAt && new Date(startAt) <= new Date()) {
    return toast("Kies een startmoment in de toekomst.");
  }
  const end = document.querySelector("#lp-end").value;
  const fields = {
    description: document.querySelector("#lp-desc").value.trim() || null,
    division_count: Number(document.querySelector("#lp-dc").value),
    start_at: startAt,
    end_at: end ? new Date(end + "T23:59:59").toISOString() : null,
  };
  if (schedule) fields.status = "scheduled";
  try {
    await db.updateLeagueSchedule(leagueId, fields);
    toast(schedule ? "League ingepland." : "Gegevens opgeslagen.");
    router();
  } catch (e) { toast(errText(e)); }
}

async function determineDivisionWinners(leagueId) {
  try {
    const winners = await db.determineDivisionWinners(leagueId);
    toast(winners.length
      ? `${winners.length} divisiewinnaar(s) bepaald en op de hoogte gebracht.`
      : "Geen winnaars: in geen enkele divisie is nog een wedstrijd gespeeld.");
    router();
  } catch (e) { toast(errText(e)); }
}

// Winnaarspagina: wat je hebt gewonnen, de status van je claim, en de knop
// om te claimen. Voor iedereen die niet de winnaar zelf is, alleen de
// feestelijke, publieke info (geen contactgegevens - die geeft de database
// sowieso niet terug aan wie niet de winnaar of organisator is).
async function viewPrizeDetail(id) {
  const w = await db.prizeByDivisionWinner(id);
  const isMine = w.player_id === state.profile.id;
  const claim = w.claim;

  if (isMine && claim) {
    await db.markPrizeNotificationsReadForClaim(claim.id).catch(() => {});
  }

  const prizeBlurb = "De winnaar van elke divisie ontvangt een gepersonaliseerd bedrukt kledingstuk, " +
    "beschikbaar gesteld door LWPrints. Je kunt, in overleg en afhankelijk van de mogelijkheden en " +
    "beschikbaarheid, kiezen uit een bedrukt T-shirt, een hoodie of een polo.";

  const filledIn = claim && (claim.garment || claim.size || claim.full_name);
  const locked = claim && ["confirmed", "in_production", "ready", "delivered", "cancelled"].includes(claim.status);

  setView(`
    <button class="linkbtn" onclick="go('')" style="display:flex;align-items:center;gap:4px;margin-bottom:12px">
      <span style="width:16px;height:16px;display:inline-flex">${icon.back}</span> Home
    </button>

    <div class="card center" style="padding:28px 20px">
      <span style="width:40px;height:40px;color:var(--accent);display:inline-flex;margin:0 auto 12px">${icon.trophy}</span>
      <h1 style="font-size:22px">${esc(w.division_name)} gewonnen!</h1>
      <p class="sub" style="margin-bottom:4px">${esc(w.league_name)}${w.season ? " · " + esc(w.season) : ""}</p>
      <p class="muted" style="font-size:13px">Bepaald op ${esc(fmtDate(w.decided_at, false))}</p>
    </div>

    <div class="card mt16">
      <p style="margin:0">${esc(prizeBlurb)}</p>
    </div>

    ${isMine ? `
      <div class="section"><h2>Status van je claim</h2></div>
      <div class="card">
        <div class="row" style="margin-bottom:${filledIn ? "14px" : "0"}">
          <div class="row-main"><div class="row-title">Huidige status</div></div>
          ${claim ? prizeStatusBadge(claim.status) : ""}
        </div>
        ${filledIn ? `
          <div class="row-sub" style="line-height:1.7">
            ${claim.garment ? `Kledingstuk: <strong style="color:var(--white)">${esc(GARMENT_LABELS[claim.garment] || claim.garment)}</strong><br>` : ""}
            ${claim.size ? `Maat: <strong style="color:var(--white)">${esc(SIZE_LABELS[claim.size] || claim.size)}</strong><br>` : ""}
            ${claim.color ? `Kleur: <strong style="color:var(--white)">${esc(claim.color)}</strong><br>` : ""}
          </div>` : ""}
        ${!claim || claim.status === "available" ? `
          <button class="btn block mt16" onclick="openPrizeClaimDialog('${esc(id)}')">Prijs claimen</button>
        ` : locked ? `
          <p class="muted mt16" style="font-size:13px;margin-bottom:0">
            Je gegevens zijn bevestigd. Neem contact op met de organisator als er iets moet wijzigen.
          </p>
        ` : `
          <button class="btn ghost block mt16" onclick="openPrizeClaimDialog('${esc(id)}')">Gegevens wijzigen</button>
        `}
      </div>
    ` : `
      <p class="muted center mt16" style="font-size:13.5px">Gefeliciteerd aan ${esc(w.player?.display_name || "de winnaar")}!</p>
    `}
  `);
}

function openPrizeClaimDialog(divisionWinnerId) {
  const me = state.profile;
  db.prizeByDivisionWinner(divisionWinnerId).then((w) => {
    const c = w.claim || {};
    const garmentOpt = (val, lab) => `<option value="${val}" ${c.garment === val ? "selected" : ""}>${lab}</option>`;
    const sizeOpt = (val) => `<option value="${val}" ${c.size === val ? "selected" : ""}>${SIZE_LABELS[val]}</option>`;

    db.startPrizeClaim(divisionWinnerId).catch(() => {});

    openModal("Prijs claimen", `
      <p class="sub" style="margin-bottom:18px">
        De uiteindelijke prijskeuze gebeurt in overleg en is afhankelijk van de mogelijkheden en
        beschikbaarheid van LWPrints.
      </p>
      <div class="field"><label for="pcName">Naam</label>
        <input id="pcName" required value="${esc(c.full_name || me.display_name || "")}"></div>
      <div class="field"><label for="pcEmail">E-mailadres</label>
        <input id="pcEmail" type="email" required value="${esc(c.email || me.email || "")}"></div>
      <div class="field"><label for="pcPhone">Telefoonnummer <span class="muted" style="font-weight:400">(optioneel)</span></label>
        <input id="pcPhone" type="tel" value="${esc(c.phone || "")}"></div>
      <div class="field"><label for="pcGarment">Voorkeur kledingstuk</label>
        <select id="pcGarment" required>
          <option value="">Kies...</option>
          ${garmentOpt("tshirt", "T-shirt")}${garmentOpt("hoodie", "Hoodie")}${garmentOpt("polo", "Polo")}
        </select></div>
      <div class="field"><label for="pcSize">Kledingmaat</label>
        <select id="pcSize" required>
          <option value="">Kies...</option>
          ${["xs","s","m","l","xl","xxl","xxxl"].map(sizeOpt).join("")}
        </select></div>
      <div class="field"><label for="pcColor">Gewenste kleur <span class="muted" style="font-weight:400">(optioneel)</span></label>
        <input id="pcColor" value="${esc(c.color || "")}"></div>
      <div class="field"><label for="pcDesign">Gewenste bedrukking/ontwerp <span class="muted" style="font-weight:400">(optioneel)</span></label>
        <textarea id="pcDesign" rows="2">${esc(c.design_notes || "")}</textarea></div>
      <div class="field"><label for="pcComments">Opmerkingen <span class="muted" style="font-weight:400">(optioneel)</span></label>
        <textarea id="pcComments" rows="2">${esc(c.comments || "")}</textarea></div>
      <div class="field">
        <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer">
          <input type="checkbox" id="pcConsent" style="margin-top:3px" ${c.consent_share_with_lwprints ? "checked" : ""}>
          <span style="font-size:13.5px;color:var(--grey)">
            Ik ga akkoord dat mijn naam, e-mailadres en (indien opgegeven) telefoonnummer worden gedeeld met
            LWPrints, uitsluitend om mijn prijs te maken en te leveren.
          </span>
        </label>
      </div>`, async (bg) => {
      const fullName = bg.querySelector("#pcName").value.trim();
      const email = bg.querySelector("#pcEmail").value.trim();
      const garment = bg.querySelector("#pcGarment").value;
      const size = bg.querySelector("#pcSize").value;
      const consent = bg.querySelector("#pcConsent").checked;
      if (!fullName) throw new Error("Vul je naam in.");
      if (!email.includes("@")) throw new Error("Vul een geldig e-mailadres in.");
      if (!garment) throw new Error("Kies een voorkeur voor je kledingstuk.");
      if (!size) throw new Error("Kies je kledingmaat.");
      if (!consent) throw new Error("Je moet akkoord gaan met het delen van je gegevens met LWPrints.");
      await db.submitPrizeClaim(divisionWinnerId, {
        fullName, email,
        phone: bg.querySelector("#pcPhone").value.trim() || null,
        garment, size,
        color: bg.querySelector("#pcColor").value.trim() || null,
        designNotes: bg.querySelector("#pcDesign").value.trim() || null,
        comments: bg.querySelector("#pcComments").value.trim() || null,
        consent,
      });
      toast("Bedankt! Je aanvraag is ingediend.");
      router();
    }, "Aanvraag versturen");
  }).catch((e) => toast(errText(e)));
}

async function viewManagePrizes() {
  const winners = await db.allPrizeClaims();
  setView(`
    <h1>Prijzen</h1>
    <p class="sub">Divisiewinnaars en hun prijsclaim (LWPrints)</p>
    ${winners.length ? winners.map((w) => `
      <button class="card clickable" onclick="go('beheer/prijs/${esc(w.claim?.id)}')">
        <div class="row">
          ${avatar(w.player, "sm")}
          <div class="row-main">
            <div class="row-title">${esc(w.player?.display_name || "?")}</div>
            <div class="row-sub">${esc(w.division_name)} · ${esc(w.league_name)}${w.season ? " · " + esc(w.season) : ""}</div>
          </div>
          ${w.claim ? prizeStatusBadge(w.claim.status) : ""}
        </div>
      </button>
    `).join("") : emptyView("Nog geen divisiewinnaars", "Bepaal winnaars op een afgeronde league-pagina.", "trophy")}
  `);
}

async function viewManagePrizeDetail(claimId) {
  const winners = await db.allPrizeClaims();
  const w = winners.find((x) => x.claim?.id === claimId);
  if (!w) return setView(emptyView("Claim niet gevonden", "Ga terug naar Prijzen.", "warn"));
  const c = w.claim;
  const history = await db.prizeClaimHistory(claimId);

  const row = (label, value) => value ? `
    <div class="row" style="justify-content:space-between;padding:6px 0;border-top:1px solid var(--line)">
      <span class="row-sub">${esc(label)}</span>
      <span style="font-weight:600;text-align:right">${esc(value)}</span>
    </div>` : "";

  setView(`
    <button class="linkbtn" onclick="go('beheer/prijzen')" style="display:flex;align-items:center;gap:4px;margin-bottom:12px">
      <span style="width:16px;height:16px;display:inline-flex">${icon.back}</span> Prijzen
    </button>

    <div class="card center">
      ${avatar(w.player, "lg")}
      <div class="mt16" style="font-size:19px;font-weight:700">${esc(w.player?.display_name || "?")}</div>
      <div class="muted" style="font-size:14px">${esc(w.division_name)} · ${esc(w.league_name)}${w.season ? " · " + esc(w.season) : ""}</div>
      <div class="mt8">${prizeStatusBadge(c.status)}</div>
    </div>

    ${sectionHead("Status wijzigen")}
    <div class="card">
      <div class="field"><label for="pStatus">Nieuwe status</label>
        <select id="pStatus">
          ${Object.keys(PRIZE_STATUS).map((s) => `<option value="${s}" ${s === c.status ? "selected" : ""}>${esc(PRIZE_STATUS[s].label)} (${s})</option>`).join("")}
        </select>
      </div>
      <div class="field"><label for="pNote">Notitie <span class="muted" style="font-weight:400">(optioneel, komt in de historie)</span></label>
        <textarea id="pNote" rows="2" placeholder="Bijv. telefonisch contact gehad op ..."></textarea>
      </div>
      <button class="btn" onclick="submitStatusChange('${esc(claimId)}')">Status opslaan</button>
      ${c.status !== "delivered" ? `
        <button class="btn ghost" style="margin-left:8px" onclick="quickMarkDelivered('${esc(claimId)}')">Markeer als uitgereikt</button>` : ""}
    </div>

    ${sectionHead("Ingevulde gegevens")}
    <div class="card">
      ${row("Naam", c.full_name)}
      ${row("E-mail", c.email)}
      ${row("Telefoon", c.phone)}
      ${row("Kledingstuk", c.garment ? GARMENT_LABELS[c.garment] : null)}
      ${row("Maat", c.size ? SIZE_LABELS[c.size] : null)}
      ${row("Kleur", c.color)}
      ${row("Bedrukking/ontwerp", c.design_notes)}
      ${row("Opmerkingen van winnaar", c.comments)}
      ${row("Toestemming delen met LWPrints", c.consent_share_with_lwprints ? `Ja, gegeven op ${fmtDate(c.consent_given_at)}` : "Nee")}
      ${!c.full_name && !c.garment ? `<p class="muted" style="font-size:13.5px;margin:0">Nog niets ingevuld door de winnaar.</p>` : ""}
    </div>

    ${sectionHead("Beheerdersnotitie")}
    <div class="card">
      <textarea id="pAdminNotes" rows="3" placeholder="Interne notitie, bijv. contactpogingen">${esc(c.admin_notes || "")}</textarea>
      <button class="btn ghost sm mt8" onclick="saveAdminNotes('${esc(claimId)}')">Opslaan</button>
    </div>

    ${sectionHead("Historie")}
    <div class="card">
      ${history.length ? history.map((h, i) => `
        <div class="row-sub" style="padding:6px 0;${i > 0 ? "border-top:1px solid var(--line)" : ""}">
          ${esc(fmtDate(h.created_at))} &middot; ${esc(PRIZE_STATUS[h.old_status]?.label || h.old_status || "-")} &rarr; ${esc(PRIZE_STATUS[h.new_status]?.label || h.new_status)}
          ${h.changed_by_profile?.display_name ? ` door ${esc(h.changed_by_profile.display_name)}` : ""}
          ${h.note ? `<div style="margin-top:2px">${esc(h.note)}</div>` : ""}
        </div>`).join("")
        : `<p class="muted" style="font-size:13.5px;margin:0">Nog geen statuswijzigingen.</p>`}
    </div>
  `);
}

async function submitStatusChange(claimId) {
  const status = document.getElementById("pStatus").value;
  const note = document.getElementById("pNote").value.trim() || null;
  try {
    await db.updatePrizeClaimStatus(claimId, status, note);
    toast("Status bijgewerkt");
    viewManagePrizeDetail(claimId);
  } catch (e) { toast(errText(e)); }
}

async function quickMarkDelivered(claimId) {
  try {
    await db.updatePrizeClaimStatus(claimId, "delivered", "Gemarkeerd als uitgereikt");
    toast("Gemarkeerd als uitgereikt");
    viewManagePrizeDetail(claimId);
  } catch (e) { toast(errText(e)); }
}

async function saveAdminNotes(claimId) {
  const notes = document.getElementById("pAdminNotes").value;
  try {
    await db.updatePrizeClaimFields(claimId, { admin_notes: notes });
    toast("Notitie opgeslagen");
  } catch (e) { toast(errText(e)); }
}

function openDivisionDialog(leagueId) {
  openModal("Nieuwe divisie", `
    <div class="field"><label for="dn">Naam</label><input id="dn" required placeholder="Bijv. 1e divisie"></div>
    <div class="field"><label for="dr">Niveau <span class="muted" style="font-weight:400">(1 = hoogste)</span></label>
      <input id="dr" type="number" min="1" value="1" required></div>`,
    async (bg) => {
      const name = bg.querySelector("#dn").value.trim();
      const rank = parseInt(bg.querySelector("#dr").value, 10);
      if (!name) throw new Error("Vul een naam in.");
      if (isNaN(rank) || rank < 1) throw new Error("Kies een geldig niveau.");
      await db.createDivision({ league_id: leagueId, name, rank });
      toast("Divisie aangemaakt");
      router();
    }, "Divisie aanmaken");
}

async function openAssignPlayerDialog(leagueId) {
  const [players, divisions, onboardingList, members] = await Promise.all([
    db.players(), db.divisionsForLeague(leagueId), db.allOnboarding(), db.leagueMembers(leagueId),
  ]);
  if (!players.length) return toast("Er zijn nog geen spelers.");
  const onboardingByPlayer = Object.fromEntries(onboardingList.map((o) => [o.player_id, o]));
  const counts = {};
  for (const m of members) {
    if (m.division_id) counts[m.division_id] = (counts[m.division_id] || 0) + 1;
  }
  const opts = (list, val, lab) => list.map((x) => `<option value="${esc(x[val])}">${esc(x[lab])}</option>`).join("");
  const divOpts = divisions.map((d) => {
    const n = counts[d.id] || 0;
    return `<option value="${esc(d.id)}" ${n >= 12 ? "disabled" : ""}>${esc(d.name)} (${n}/12)</option>`;
  }).join("");

  openModal("Speler indelen", `
    <div class="field"><label for="ap">Speler</label><select id="ap">${opts(players, "id", "display_name")}</select></div>
    <div id="apInfo" class="muted" style="font-size:13px;margin:-8px 0 16px"></div>
    <div class="field"><label for="ad">Divisie</label>
      <select id="ad">
        <option value="">Geen divisie</option>
        ${divOpts}
      </select>
    </div>`, async (bg) => {
    const playerId = bg.querySelector("#ap").value;
    const divisionId = bg.querySelector("#ad").value || null;
    await db.assignPlayerToLeague(leagueId, playerId, divisionId);
    toast("Speler ingedeeld");
    router();
  }, "Opslaan");

  // Toont platform/nickname/gemiddelde van de gekozen speler, zodat de
  // organisator dit kan gebruiken bij de initiële indeling.
  const infoEl = document.querySelector("#apInfo");
  const playerSel = document.querySelector("#ap");
  const showInfo = () => {
    const o = onboardingByPlayer[playerSel.value];
    infoEl.textContent = o
      ? `${o.platform === "scolia" ? "Scolia" : "DartCounter"} · ${o.platform_nickname} · gem. ${Number(o.reported_average).toFixed(2)}`
      : "Nog geen spelersgegevens ingevuld.";
  };
  playerSel.onchange = showInfo;
  showInfo();
}

async function autoAssignDivisions(leagueId) {
  try {
    const placed = await db.autoAssignDivisions(leagueId);
    const lowConfidence = placed.filter((p) => p.low_confidence);
    let msg = `${placed.length} speler(s) ingedeeld.`;
    if (lowConfidence.length) {
      msg += ` Let op: ${lowConfidence.map((p) => p.display_name).join(", ")} had(den) geen gemiddelde en staat/staan nu in de 4e divisie.`;
    }
    toast(msg);
    router();
  } catch (e) { toast(errText(e)); }
}

async function applyPromotionRelegation(leagueId) {
  try {
    const moves = await db.applyPromotionRelegation(leagueId);
    if (!moves.length) {
      toast("Niemand om te verplaatsen: geen wedstrijden gespeeld, of alle divisies zijn te klein.");
    } else {
      const promoted = moves.filter((m) => m.movement === "promotie");
      const relegated = moves.filter((m) => m.movement === "degradatie");
      const parts = [];
      if (promoted.length) parts.push(`${promoted.length} promotie (${promoted.map((p) => p.display_name).join(", ")})`);
      if (relegated.length) parts.push(`${relegated.length} degradatie (${relegated.map((p) => p.display_name).join(", ")})`);
      toast(parts.join(" · "));
    }
    router();
  } catch (e) { toast(errText(e)); }
}

async function viewTournaments() {
  const list = await db.tournaments();
  setView(`
    <h1>Toernooien</h1>
    ${list.length ? list.map(tournamentCard).join("")
      : emptyView("Nog geen toernooien", "", "target")}
  `);
}

// Voorstel-status voor een wedstrijd: knop om een moment voor te stellen,
// of - als er al een voorstel ligt - de status ervan en (voor wie niet zelf
// heeft voorgesteld) knoppen om te accepteren, een tegenvoorstel te doen of
// een probleem te melden.
function scheduleProposalBlock(m) {
  const meId = state.profile.id;
  const p = m.schedule_proposal;
  if (!p || p.status === "accepted") {
    return `<button class="btn ghost sm" style="margin:-4px 0 8px" onclick="openScheduleProposalDialog('${esc(m.id)}')">${icon.clock} Moment voorstellen</button>`;
  }
  const when = fmtDate(p.proposed_at);
  if (p.proposed_by === meId) {
    const label = p.status === "disputed" ? "Probleem gemeld, wacht op reactie" : `Je hebt ${when} voorgesteld, wacht op reactie`;
    return `
      <p class="muted" style="margin:-4px 0 6px;font-size:13px">${esc(label)}</p>
      <button class="btn ghost sm" style="margin:0 0 10px" onclick="withdrawScheduleProposal('${esc(m.id)}')">Intrekken</button>`;
  }
  return `
    <p class="muted" style="margin:-4px 0 6px;font-size:13px">Voorstel: ${esc(when)}${p.note ? " — " + esc(p.note) : ""}</p>
    <div class="chips" style="margin:0 0 10px">
      <button class="chip" onclick="respondScheduleProposal('${esc(m.id)}', 'accept')">Accepteren</button>
      <button class="chip" onclick="openScheduleProposalDialog('${esc(m.id)}', true)">Tegenvoorstel</button>
      <button class="chip" onclick="respondScheduleProposal('${esc(m.id)}', 'dispute')">Probleem melden</button>
    </div>`;
}

function openScheduleProposalDialog(matchId, isCounter = false) {
  openModal(isCounter ? "Tegenvoorstel doen" : "Moment voorstellen", `
    <div class="field"><label for="sp-when">Datum en tijd</label><input id="sp-when" type="datetime-local" required></div>
    <div class="field"><label for="sp-note">Opmerking <span class="muted" style="font-weight:400">(optioneel)</span></label>
      <input id="sp-note" placeholder="Bijv. reden van het voorstel"></div>`,
    async (bg) => {
      const val = bg.querySelector("#sp-when").value;
      if (!val) throw new Error("Kies een datum en tijd.");
      const proposedAt = new Date(val).toISOString();
      const note = bg.querySelector("#sp-note").value.trim() || null;
      if (isCounter) {
        await db.respondMatchSchedule(matchId, "counter", proposedAt, note);
      } else {
        await db.proposeMatchSchedule(matchId, proposedAt, note);
      }
      toast("Voorstel verstuurd.");
      router();
    }, isCounter ? "Tegenvoorstel versturen" : "Voorstel versturen");
}

async function respondScheduleProposal(matchId, action) {
  try {
    await db.respondMatchSchedule(matchId, action);
    toast(action === "accept" ? "Voorstel geaccepteerd." : "Probleem gemeld bij je tegenstander.");
    router();
  } catch (e) { toast(errText(e)); }
}

async function withdrawScheduleProposal(matchId) {
  try {
    await db.withdrawMatchSchedule(matchId);
    toast("Voorstel ingetrokken.");
    router();
  } catch (e) { toast(errText(e)); }
}

// Geschiedenis van voorstellen ("Datum & uur"-kaart op Mijn divisie).
function scheduleHistoryList(history) {
  if (!history.length) return "";
  const actionLabels = {
    proposed: "stelde voor",
    countered: "deed een tegenvoorstel",
    accepted: "accepteerde het voorstel",
    disputed: "meldde een probleem",
    withdrawn: "trok het voorstel in",
  };
  return `
    <div class="mt16">
      <div class="muted" style="font-size:12px;font-weight:600;margin-bottom:6px">Geschiedenis</div>
      ${history.map((h) => `
        <div class="muted" style="font-size:12.5px;margin-bottom:4px">
          ${esc(h.actor?.display_name || "Iemand")} ${esc(actionLabels[h.action] || h.action)}${h.proposed_at ? " &middot; " + esc(fmtDate(h.proposed_at)) : ""}
        </div>`).join("")}
    </div>`;
}

// Volledige "Datum & uur van deze wedstrijd"-kaart voor Mijn divisie:
// uitleg, voorstel/accepteer/tegenvoorstel/intrekken, beschikbaarheid en
// deadline, en de geschiedenis van alle acties.
function scheduleCard(m, history) {
  return `
    <div class="card">
      <h2 style="margin-bottom:8px">Datum &amp; uur van deze wedstrijd</h2>
      <p class="muted" style="font-size:13px;margin:0 0 14px">
        Stel samen met je tegenstander een datum en tijd voor. Het voorstel wordt naar de andere speler gestuurd. Die speler kan het accepteren of een ander voorstel doen.
      </p>
      ${scheduleProposalBlock(m)}
      ${matchDeadlineLine(m, matchDisplayStatus(m))}
      ${scheduleHistoryList(history)}
    </div>`;
}

// Onderlinge wedstrijden ("head-to-head") tussen de ingelogde speler en de
// tegenstander van de gefocuste wedstrijd.
function headToHeadCard(matches, opponent, meId) {
  if (!matches.length) {
    return `<div class="card">${emptyView("Nog geen eerdere ontmoetingen", `Dit is de eerste keer dat je het opneemt tegen ${esc(opponent?.display_name || "deze speler")}.`, "match")}</div>`;
  }
  return `
    <div class="card">
      ${matches.map((m, i) => {
        const myLegs = m.player_a_id === meId ? m.player_a_legs : m.player_b_legs;
        const oppLegs = m.player_a_id === meId ? m.player_b_legs : m.player_a_legs;
        const myAvg = m.player_a_id === meId ? m.player_a_average : m.player_b_average;
        const won = m.winner_id === meId;
        const draw = m.winner_id === null;
        const color = draw ? "#8A93AA" : won ? "#2ECC71" : "#E74C3C";
        return `
          <div class="row" style="padding:8px 0;${i > 0 ? "border-top:1px solid var(--line)" : ""}">
            <div class="row-main">
              <div class="row-title">${esc(fmtDate(m.confirmed_at, false))}</div>
              <div class="row-sub">${myLegs}-${oppLegs}${myAvg ? " &middot; gem. " + Number(myAvg).toFixed(1) : ""}</div>
            </div>
            <span class="badge" style="color:${color};border-color:${color}66;background:${color}22">
              ${draw ? "Gelijk" : won ? "Gewonnen" : "Verloren"}
            </span>
          </div>`;
      }).join("")}
    </div>`;
}

const CHAT_EMOJIS = ["👍", "😀", "😅", "😬", "🎯", "🔥", "🎉", "😢"];

// Privéchat tussen de twee spelers van de gefocuste wedstrijd (Mijn divisie).
function chatCard(messages, meId, matchId) {
  return `
    <div class="card">
      <h2 style="margin-bottom:8px">Chat</h2>
      <p class="muted" style="font-size:13px;margin:0 0 14px">Alleen jij en je tegenstander kunnen dit gesprek zien.</p>
      <div class="chat-messages" id="chat-messages">
        ${messages.length ? messages.map((m) => `
          <div class="chat-msg ${m.sender_id === meId ? "me" : "them"}">
            ${esc(m.body)}
            <span class="chat-time">${esc(fmtDate(m.created_at))}</span>
          </div>`).join("")
          : `<p class="muted" style="font-size:13px;margin:0">Nog geen berichten. Stuur de eerste!</p>`}
      </div>
      <div class="chat-emojis">
        ${CHAT_EMOJIS.map((e) => `<button type="button" class="chat-emoji-btn" onclick="insertChatEmoji('${e}')">${e}</button>`).join("")}
      </div>
      <form class="chat-input-row" onsubmit="return sendMatchChatMessage(event, '${esc(matchId)}')">
        <input id="chat-input" placeholder="Typ een bericht..." maxlength="1000" autocomplete="off">
        <button class="btn sm" type="submit">Stuur</button>
      </form>
    </div>`;
}

function insertChatEmoji(emoji) {
  const input = document.getElementById("chat-input");
  if (!input) return;
  input.value += emoji;
  input.focus();
}

async function sendMatchChatMessage(event, matchId) {
  event.preventDefault();
  const input = document.getElementById("chat-input");
  const body = input?.value.trim();
  if (!body) return false;
  try {
    await db.sendChatMessage(matchId, body);
    input.value = "";
    await router();
    document.getElementById("chat-messages")?.scrollTo(0, 999999);
  } catch (e) { toast(errText(e)); }
  return false;
}

async function viewMatches() {
  const matches = await db.myMatches(state.profile.id);
  const open = matches.filter((m) => ["scheduled", "in_progress", "pending_confirmation"].includes(m.status));
  const done = matches.filter((m) => !open.includes(m));

  const openItem = (m) => {
    if (m.status === "pending_confirmation") {
      const waitingForMe = m.reported_by && m.reported_by !== state.profile.id;
      if (waitingForMe) {
        return `
          ${matchCard(m)}
          <button class="btn sm" style="margin:-4px 0 14px" onclick="openConfirmDialog('${esc(m.id)}')">Uitslag controleren</button>`;
      }
      const opponentName = m.player_a_id === state.profile.id
        ? m.player_b?.display_name : m.player_a?.display_name;
      return `
        ${matchCard(m)}
        <p class="muted" style="margin:-4px 0 14px;font-size:13px">Wacht op bevestiging van ${esc(opponentName || "je tegenstander")}</p>`;
    }
    return `
      ${matchCard(m)}
      ${scheduleProposalBlock(m)}
      <button class="btn ghost sm" style="margin:-4px 0 10px" onclick="openResultDialog('${esc(m.id)}')">Uitslag doorgeven</button>`;
  };

  setView(`
    <h1>Je wedstrijden</h1>
    <p class="sub">Alles waar jij aan meedoet</p>
    ${matches.length === 0 ? emptyView("Nog geen wedstrijden", "Zodra je bent ingedeeld, verschijnen ze hier.", "match") : ""}
    ${open.length ? `${sectionHead("Open")}${open.map(openItem).join("")}` : ""}
    ${done.length ? `${sectionHead("Gespeeld")}${done.map(matchCard).join("")}` : ""}
  `);
}

async function viewStats() {
  const s = state.profile?.stats;
  if (!s) {
    return setView(`<h1>Statistieken</h1>
      ${emptyView("Nog geen cijfers", "Speel je eerste wedstrijd om hier iets te zien.", "chart")}`);
  }
  const winPct = s.matches_played > 0 ? Math.round((s.matches_won / s.matches_played) * 100) : 0;
  setView(`
    <h1>Statistieken</h1>
    <p class="sub">Je cijfers over alle bevestigde wedstrijden</p>
    <div class="grid">
      ${statCard({ label: "Gespeeld", value: s.matches_played, ico: "match" })}
      ${statCard({ label: "Gewonnen", value: s.matches_won, ico: "trophy", color: "#2ECC71" })}
      ${statCard({ label: "Verloren", value: s.matches_lost, ico: "flag", color: "#E74C3C" })}
      ${statCard({ label: "Winratio", value: winPct + "%", ico: "trend" })}
      ${statCard({ label: "Gemiddelde", value: Number(s.average_score).toFixed(1), ico: "trend" })}
      ${statCard({ label: "Checkout", value: Math.round(s.checkout_percentage) + "%", ico: "target" })}
      ${statCard({ label: "Hoogste finish", value: s.highest_checkout, ico: "flag" })}
      ${statCard({ label: "180's", value: s.count_180, ico: "star", color: "#F5B942" })}
    </div>
    <p class="muted mt24" style="font-size:13px">
      Deze cijfers worden bijgewerkt zodra wedstrijden bevestigd zijn.
    </p>
  `);
}

async function viewProfile() {
  const p = state.profile;
  const s = p.stats;
  const membership = await db.myLeagueMembership();
  setView(`
    <h1>Profiel</h1>
    <p class="sub">Je gegevens en je rol</p>

    <div class="card center">
      <div style="display:inline-block;position:relative">
        ${avatar(p, "lg")}
        <button class="btn sm" id="avatarBtn"
          style="position:absolute;bottom:-4px;right:-4px;border-radius:50%;padding:8px;width:34px;height:34px"
          aria-label="Foto wijzigen">
          <span style="width:16px;height:16px;display:block">${icon.camera}</span>
        </button>
        <input type="file" id="avatarInput" accept="image/*" class="sr">
      </div>
      <div class="mt16" style="font-size:20px;font-weight:700">${esc(p.display_name)}</div>
      <div class="muted" style="font-size:14px">${esc(p.email)}</div>
      <div class="mt8">${p.role === "organizer"
        ? `<span class="badge" style="color:#F47B20;border-color:#F47B2066;background:#F47B2022">Organisator</span>`
        : `<span class="badge" style="color:#D9DEE8;border-color:#22346099;background:#22346055">Speler</span>`}</div>
      <button class="btn ghost sm mt16" onclick="openNameDialog()">Naam wijzigen</button>
    </div>

    ${sectionHead("Kort overzicht")}
    <div class="grid">
      ${statCard({ label: "Gespeeld", value: s?.matches_played ?? 0, ico: "match" })}
      ${statCard({ label: "Gewonnen", value: s?.matches_won ?? 0, ico: "trophy", color: "#2ECC71" })}
      ${statCard({ label: "Gemiddelde", value: Number(s?.average_score ?? 0).toFixed(1), ico: "trend" })}
      ${statCard({ label: "180's", value: s?.count_180 ?? 0, ico: "star", color: "#F5B942" })}
    </div>

    ${sectionHead("League-indeling")}
    <div class="card">
      ${membership ? `
        ${infoRow("League", esc(membership.league.name))}
        ${infoRow("Divisie", esc(membership.division?.name || "Nog niet ingedeeld"))}
        <button class="btn ghost sm mt16" onclick="go('mijn-divisie')">Bekijk mijn divisie</button>
      ` : `<p class="muted" style="font-size:13.5px;margin:0">Nog niet ingedeeld in een league.</p>`}
    </div>

    ${sectionHead("Spelersgegevens")}
    <div class="card">
      <div class="row-sub">Naam</div>
      <div class="row-title mt8">${esc(state.onboarding.first_name)} ${esc(state.onboarding.last_name)}</div>
      <div class="row-sub mt16">Platform</div>
      <div class="row-title mt8">${state.onboarding.platform === "scolia" ? "Scolia" : "DartCounter"} &middot; ${esc(state.onboarding.platform_nickname)}</div>
      <div class="row-sub mt16">Gemiddelde (3 darts)</div>
      <div class="row-title mt8">${Number(state.onboarding.reported_average).toFixed(2)}</div>
      <p class="muted" style="font-size:12.5px;margin:12px 0 0">Enkel zichtbaar voor de beheerder.</p>
      <button class="btn ghost sm mt16" onclick="openOnboardingEditDialog()">Gegevens wijzigen</button>
    </div>

    <button class="btn ghost block mt24" onclick="signOut()">
      <span style="width:18px;height:18px;display:block">${icon.logout}</span> Uitloggen
    </button>
  `);

  const input = document.getElementById("avatarInput");
  document.getElementById("avatarBtn").onclick = () => input.click();
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast("Kies een foto kleiner dan 5 MB.");
    try {
      toast("Foto uploaden...");
      const url = await db.uploadAvatar(p.id, file);
      await db.updateProfile(p.id, { avatar_url: url });
      state.profile = await db.myProfile(p.id);
      router();
      toast("Foto gewijzigd");
    } catch (e) {
      toast(errText(e));
    }
  };
}

async function viewOrganizer() {
  const [c, results] = await Promise.all([db.counts(), db.recentResults(5)]);
  const tile = (label, route, ico) => `
    <button class="card clickable" onclick="go('${route}')">
      <div class="row">
        <div class="row-ico">${icon[ico]}</div>
        <div class="row-main"><div class="row-title">${esc(label)}</div></div>
      </div>
    </button>`;

  setView(`
    <h1>Beheer</h1>
    <p class="sub">Het overzicht van je organisatie</p>

    <div class="grid">
      ${statCard({ label: "Spelers", value: c.players, ico: "users" })}
      ${statCard({ label: "Actieve leagues", value: c.leagues, ico: "league" })}
      ${statCard({ label: "Actieve toernooien", value: c.tournaments, ico: "target" })}
      ${statCard({ label: "Open wedstrijden", value: c.open, ico: "match", color: "#F5B942" })}
    </div>

    ${sectionHead("Snel aanmaken")}
    <div class="chips">
      <button class="chip" onclick="openLeagueDialog()">${icon.plus} League</button>
      <button class="chip" onclick="openTournamentDialog()">${icon.plus} Toernooi</button>
      <button class="chip" onclick="openMatchDialog()">${icon.plus} Wedstrijd</button>
    </div>

    ${sectionHead("Beheren")}
    ${tile("Spelers", "beheer/spelers", "users")}
    ${tile("Leagues", "beheer/leagues", "league")}
    ${tile("Toernooien", "beheer/toernooien", "target")}
    ${tile("Wedstrijden", "beheer/wedstrijden", "match")}
    ${tile("Prijzen", "beheer/prijzen", "trophy")}
    ${tile("Instellingen", "beheer/instellingen", "settings")}

    ${sectionHead("Laatste uitslagen")}
    ${results.length ? results.map(matchCard).join("") : emptyView("Nog geen uitslagen", "", "match")}
  `);
}

async function viewManagePlayers() {
  setView(`
    <h1>Spelers</h1>
    <p class="sub">Iedereen die een account heeft</p>
    <div class="field"><input id="q" type="search" placeholder="Zoek op naam"></div>
    <div id="list">${loadingView()}</div>
  `);

  const list = document.getElementById("list");
  const draw = async (search) => {
    list.innerHTML = loadingView();
    try {
      const players = await db.players(search);
      list.innerHTML = players.length ? players.map((p) => `
        <div class="card">
          <div class="row">
            ${avatar(p)}
            <div class="row-main">
              <div class="row-title">${esc(p.display_name)}</div>
              <div class="row-sub">${p.stats
                ? `Gem. ${Number(p.stats.average_score).toFixed(1)} · ${p.stats.matches_won}W ${p.stats.matches_lost}V`
                : esc(p.email)}</div>
            </div>
            ${p.id === state.profile.id
              ? `<span class="muted" style="font-size:12.5px">jij</span>`
              : `<button class="btn ghost sm" onclick="toggleRole('${esc(p.id)}','${p.role === "organizer" ? "player" : "organizer"}')">
                  ${p.role === "organizer" ? "Rol weghalen" : "Maak organisator"}
                 </button>`}
          </div>
        </div>`).join("")
        : emptyView("Geen spelers gevonden", "Pas je zoekterm aan.", "users");
    } catch (e) { list.innerHTML = errorView(e); }
  };

  let t;
  document.getElementById("q").oninput = (e) => {
    clearTimeout(t);
    const v = e.target.value;
    t = setTimeout(() => draw(v), 280);
  };
  draw("");
}

async function toggleRole(playerId, role) {
  try {
    await db.setRole(playerId, role);
    toast(role === "organizer" ? "Speler is nu organisator" : "Rol weggehaald");
    viewManagePlayers();
  } catch (e) { toast(errText(e)); }
}

async function viewManageLeagues() {
  const leagues = await db.leagues();
  setView(`
    <h1>Leagues</h1>
    <p class="sub">Aanmaken en van status wisselen</p>
    <button class="btn mt8" onclick="openLeagueDialog()">${icon.plus} Nieuwe league</button>
    <div class="mt24">
      ${leagues.length ? leagues.map((l) => `
        ${leagueCard(l, true)}
        <div class="chips" style="margin:-4px 0 8px">
          ${["draft", "active", "finished"].filter((s) => s !== l.status).map((s) => `
            <button class="chip" onclick="changeLeagueStatus('${esc(l.id)}','${s}')">
              Zet op ${esc(STATUS[s].label.toLowerCase())}
            </button>`).join("")}
        </div>
        ${l.status === "draft" ? `
          <div style="margin:0 0 20px">
            <button class="btn ghost sm" style="color:#E74C3C;border-color:#E74C3C66" onclick="confirmDeleteLeague('${esc(l.id)}','${esc(l.name)}')">
              Verwijderen
            </button>
          </div>` : `<div style="margin-bottom:14px"></div>`}`).join("")
        : emptyView("Nog geen leagues", "Maak je eerste league aan.", "league")}
    </div>
  `);
}

async function changeLeagueStatus(id, status) {
  try {
    await db.setLeagueStatus(id, status);
    toast("Status aangepast");
    viewManageLeagues();
  } catch (e) { toast(errText(e)); }
}

function confirmDeleteLeague(id, name) {
  openModal("Concept-league verwijderen", `
    <p style="margin:0 0 4px">Weet je zeker dat je <strong style="color:var(--white)">${esc(name)}</strong> wilt verwijderen?</p>
    <p class="muted" style="font-size:13px;margin:0">Deze actie kan niet ongedaan worden gemaakt.</p>`,
    async () => {
      await db.deleteLeague(id);
      toast("League verwijderd");
      viewManageLeagues();
    }, "Verwijderen", true);
}

async function viewManageTournaments() {
  const list = await db.tournaments();
  setView(`
    <h1>Toernooien</h1>
    <p class="sub">Aanmaken en inzien</p>
    <button class="btn mt8" onclick="openTournamentDialog()">${icon.plus} Nieuw toernooi</button>
    <div class="mt24">
      ${list.length ? list.map(tournamentCard).join("")
        : emptyView("Nog geen toernooien", "Maak je eerste toernooi aan.", "target")}
    </div>
  `);
}

async function viewManageMatches() {
  const matches = await db.allMatches();
  const pending = matches.filter((m) => m.status === "pending_confirmation");
  setView(`
    <h1>Wedstrijden</h1>
    <p class="sub">Inplannen en uitslagen bevestigen</p>
    <button class="btn mt8" onclick="openMatchDialog()">${icon.plus} Nieuwe wedstrijd</button>

    ${pending.length ? `${sectionHead("Wacht op bevestiging")}
      <p class="muted" style="font-size:13px;margin:-4px 0 14px">
        Spelers bevestigen dit normaal gesproken zelf bij elkaar. Grijp hier alleen in als dat vastloopt.
      </p>
      ${pending.map((m) => `
        ${matchCard(m)}
        <button class="btn sm" style="margin:-4px 0 14px" onclick="openConfirmDialog('${esc(m.id)}')">Uitslag controleren</button>
      `).join("")}` : ""}

    ${sectionHead("Alle wedstrijden")}
    ${matches.length ? matches.map((m) => `
        ${matchCard(m)}
        ${!["confirmed", "cancelled"].includes(m.status) && m.deadline_at ? `
          <button class="btn ghost sm" style="margin:-4px 0 14px" onclick="openExtendDeadlineDialog('${esc(m.id)}', '${esc(m.deadline_at)}')">${icon.clock} Deadline verlengen</button>` : ""}
      `).join("")
      : emptyView("Nog geen wedstrijden", "Plan je eerste wedstrijd in.", "match")}
  `);
}

function openExtendDeadlineDialog(matchId, currentDeadlineIso) {
  openModal("Deadline verlengen", `
    <p class="muted" style="font-size:13px;margin:0 0 14px">Huidige deadline: ${esc(fmtDate(currentDeadlineIso))}</p>
    <div class="field"><label for="ed-when">Nieuwe deadline</label>
      <input id="ed-when" type="datetime-local" value="${esc(fmtDatetimeLocal(currentDeadlineIso))}" required></div>`,
    async (bg) => {
      const val = bg.querySelector("#ed-when").value;
      if (!val) throw new Error("Kies een nieuwe deadline.");
      const newDeadline = new Date(val).toISOString();
      if (new Date(newDeadline) <= new Date(currentDeadlineIso)) {
        throw new Error("De nieuwe deadline moet na de huidige deadline liggen.");
      }
      await db.extendMatchDeadline(matchId, newDeadline);
      toast("Deadline verlengd.");
      router();
    }, "Verlengen");
}

async function viewSettings() {
  setView(`
    <h1>Instellingen</h1>
    <p class="sub">Voorkeuren voor je organisatie</p>
    <div class="card">
      <div class="row">
        <div class="row-ico">${icon.settings}</div>
        <div class="row-main">
          <div class="row-title">Nog niets in te stellen</div>
          <div class="row-sub">Standaard speltype, aantal legs en notificaties komen hier.</div>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="row-title">Je database</div>
      <div class="row-sub mt8">Spelers toevoegen doe je door ze te laten registreren op deze site.
        Daarna kun je ze hier een rol geven.</div>
    </div>
  `);
}

/* -------------------------------------------------------------------------
   Dialogen
   ------------------------------------------------------------------------- */

function openModal(title, bodyHtml, onSubmit, submitLabel = "Opslaan", danger = false) {
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <h2>${esc(title)}</h2>
      <div id="modalError"></div>
      <form id="modalForm">${bodyHtml}
        <div class="modal-actions">
          <button type="button" class="btn ghost" id="cancel">Annuleren</button>
          <button type="submit" class="btn${danger ? " danger" : ""}" id="ok">${esc(submitLabel)}</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(bg);

  const close = () => bg.remove();
  bg.querySelector("#cancel").onclick = close;
  bg.onclick = (e) => { if (e.target === bg) close(); };
  document.addEventListener("keydown", function onEsc(e) {
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", onEsc); }
  });
  bg.querySelector("input,select,textarea")?.focus();

  bg.querySelector("#modalForm").onsubmit = async (e) => {
    e.preventDefault();
    const ok = bg.querySelector("#ok");
    busy(ok, true);
    try {
      await onSubmit(bg);
      close();
    } catch (err) {
      busy(ok, false, submitLabel);
      bg.querySelector("#modalError").innerHTML = `<div class="alert bad">${esc(errText(err))}</div>`;
    }
  };
}

function openNameDialog() {
  openModal("Naam wijzigen", `
    <div class="field">
      <label for="dn">Naam</label>
      <input id="dn" value="${esc(state.profile.display_name)}" required>
    </div>`, async (bg) => {
    const name = bg.querySelector("#dn").value.trim();
    if (!name) throw new Error("Vul een naam in.");
    await db.updateProfile(state.profile.id, { display_name: name });
    state.profile = await db.myProfile(state.profile.id);
    toast("Naam gewijzigd");
    router();
  });
}

function openOnboardingEditDialog() {
  const o = state.onboarding;
  openModal("Spelersgegevens wijzigen", `
    <div class="field"><label for="eob-first">Voornaam</label><input id="eob-first" value="${esc(o.first_name)}" required></div>
    <div class="field"><label for="eob-last">Achternaam</label><input id="eob-last" value="${esc(o.last_name)}" required></div>
    <div class="field"><label for="eob-platform">Platform</label>
      <select id="eob-platform">
        <option value="scolia" ${o.platform === "scolia" ? "selected" : ""}>Scolia</option>
        <option value="dartcounter" ${o.platform === "dartcounter" ? "selected" : ""}>DartCounter</option>
      </select>
    </div>
    <div class="field"><label for="eob-nick">Nickname (Scolia / DartCounter)</label>
      <input id="eob-nick" value="${esc(o.platform_nickname)}" required></div>
    <div class="field"><label for="eob-avg">Gemiddelde (3 darts)</label>
      <input id="eob-avg" type="number" step="0.01" min="0" max="180" value="${esc(o.reported_average)}" required></div>`,
    async (bg) => {
      const firstName = bg.querySelector("#eob-first").value.trim();
      const lastName = bg.querySelector("#eob-last").value.trim();
      const nickname = bg.querySelector("#eob-nick").value.trim();
      const average = bg.querySelector("#eob-avg").value;
      if (!firstName || !lastName) throw new Error("Vul je voor- en achternaam in.");
      if (!nickname) throw new Error("Vul je nickname in.");
      if (average === "" || isNaN(Number(average)) || Number(average) < 0) {
        throw new Error("Vul een geldig gemiddelde in.");
      }
      await db.saveOnboarding(state.profile.id, {
        first_name: firstName,
        last_name: lastName,
        platform: bg.querySelector("#eob-platform").value,
        platform_nickname: nickname,
        reported_average: Number(average),
      });
      state.onboarding = await db.myOnboarding(state.profile.id);
      toast("Spelersgegevens opgeslagen");
      router();
    });
}

function openLeagueDialog() {
  openModal("Nieuwe league", `
    <div class="field"><label for="ln">Naam</label><input id="ln" required placeholder="Bijv. Winterleague"></div>
    <div class="field"><label for="ls">Seizoen</label><input id="ls" placeholder="Bijv. 2026"></div>
    <div class="field"><label for="lg">Speltype</label>
      <select id="lg"><option value="501">501</option><option value="301">301</option></select>
    </div>
    <div class="field"><label for="ldc">Aantal divisies</label>
      <select id="ldc">
        <option value="1">1</option><option value="2">2</option><option value="3">3</option>
        <option value="4" selected>4</option>
      </select>
    </div>`, async (bg) => {
    const name = bg.querySelector("#ln").value.trim();
    if (!name) throw new Error("Vul een naam in.");
    const league = await db.createLeague({
      name,
      season: bg.querySelector("#ls").value.trim() || null,
      game_type: bg.querySelector("#lg").value,
      division_count: Number(bg.querySelector("#ldc").value),
      match_format: "best_of_legs",
      status: "draft",
      created_by: state.profile.id,
    });
    toast("League aangemaakt. Voeg spelers toe en deel ze in bij divisies.");
    go("league/" + league.id);
  }, "League aanmaken");
}

function openTournamentDialog() {
  openModal("Nieuw toernooi", `
    <div class="field"><label for="tn">Naam</label><input id="tn" required placeholder="Bijv. Clubkampioenschap"></div>
    <div class="field"><label for="tt">Opzet</label>
      <select id="tt">
        <option value="knockout">Knock-out</option>
        <option value="groups">Poules</option>
        <option value="groups_and_knockout">Poules + knock-out</option>
      </select>
    </div>
    <div class="field"><label for="tg">Speltype</label>
      <select id="tg"><option value="501">501</option><option value="301">301</option></select>
    </div>
    <div class="field"><label for="td">Startdatum</label><input id="td" type="datetime-local"></div>`,
    async (bg) => {
      const name = bg.querySelector("#tn").value.trim();
      if (!name) throw new Error("Vul een naam in.");
      const d = bg.querySelector("#td").value;
      await db.createTournament({
        name,
        tournament_type: bg.querySelector("#tt").value,
        game_type: bg.querySelector("#tg").value,
        match_format: "best_of_legs",
        status: "draft",
        start_at: d ? new Date(d).toISOString() : null,
        created_by: state.profile.id,
      });
      toast("Toernooi aangemaakt");
      router();
    }, "Toernooi aanmaken");
}

async function openMatchDialog() {
  const [leagues, players] = await Promise.all([db.leagues(), db.players()]);
  if (!leagues.length) return toast("Maak eerst een league aan.");
  if (players.length < 2) return toast("Je hebt minstens twee spelers nodig.");

  const opts = (list, val, lab) => list.map((x) => `<option value="${esc(x[val])}">${esc(x[lab])}</option>`).join("");

  openModal("Nieuwe wedstrijd", `
    <div class="field"><label for="ml">League</label><select id="ml">${opts(leagues, "id", "name")}</select></div>
    <div class="field"><label for="mdiv">Divisie <span class="muted" style="font-weight:400">(optioneel)</span></label>
      <select id="mdiv"><option value="">Geen divisie</option></select>
      <div id="mdivInfo" class="muted" style="font-size:12.5px;margin-top:6px"></div>
    </div>
    <div class="field"><label for="ma">Speler A</label><select id="ma">${opts(players, "id", "display_name")}</select></div>
    <div class="field"><label for="mb">Speler B</label><select id="mb">${opts(players, "id", "display_name")}</select></div>
    <div class="field"><label for="md">Wanneer</label><input id="md" type="datetime-local"></div>`,
    async (bg) => {
      const a = bg.querySelector("#ma").value;
      const b = bg.querySelector("#mb").value;
      if (a === b) throw new Error("Kies twee verschillende spelers.");
      const d = bg.querySelector("#md").value;
      await db.createMatch({
        league_id: bg.querySelector("#ml").value,
        division_id: bg.querySelector("#mdiv").value || null,
        player_a_id: a,
        player_b_id: b,
        scheduled_at: d ? new Date(d).toISOString() : null,
        status: "scheduled",
      });
      toast("Wedstrijd ingepland");
      router();
    }, "Wedstrijd inplannen");

  // Speler B standaard op de tweede speler zetten
  const sel = document.querySelector("#mb");
  if (sel && players[1]) sel.value = players[1].id;

  // Divisies horen bij een league; laad ze opnieuw zodra een andere league
  // gekozen wordt. Toont ook of de gekozen divisie al genoeg spelers heeft
  // om een wedstrijd in te plannen (minimaal 4).
  const leagueSel = document.querySelector("#ml");
  const divSel = document.querySelector("#mdiv");
  const divInfo = document.querySelector("#mdivInfo");
  let members = [];
  const showDivInfo = () => {
    if (!divSel.value) return (divInfo.textContent = "");
    const n = members.filter((mem) => mem.division_id === divSel.value).length;
    divInfo.textContent = n < 4
      ? `Deze divisie heeft nog maar ${n} speler(s); minimaal 4 nodig om te starten.`
      : `${n} spelers in deze divisie.`;
  };
  const loadDivisions = async () => {
    const [divisions, mem] = await Promise.all([
      db.divisionsForLeague(leagueSel.value), db.leagueMembers(leagueSel.value),
    ]);
    members = mem;
    divSel.innerHTML = `<option value="">Geen divisie</option>${opts(divisions, "id", "name")}`;
    showDivInfo();
  };
  leagueSel.onchange = loadDivisions;
  divSel.onchange = showDivInfo;
  loadDivisions();
}

async function openResultDialog(matchId) {
  const m = await db.matchById(matchId);
  const a = m.player_a, b = m.player_b;
  const aName = a?.display_name || "Speler A";
  const bName = b?.display_name || "Speler B";
  const legsPerMatch = m.league?.legs_per_match || 10;

  openModal("Uitslag doorgeven", `
    <p class="sub" style="margin-bottom:18px">Jullie spelen altijd alle ${legsPerMatch} legs. Je tegenstander moet dit bevestigen voor het meetelt.</p>

    <div class="field">
      <label>Wie heeft gewonnen?</label>
      <div class="chips" role="radiogroup" aria-label="Winnaar">
        <label class="chip"><input type="radio" name="winner" value="${esc(a.id)}" class="sr">${esc(aName)}</label>
        <label class="chip"><input type="radio" name="winner" value="draw" class="sr">Gelijkspel</label>
        <label class="chip"><input type="radio" name="winner" value="${esc(b.id)}" class="sr">${esc(bName)}</label>
      </div>
    </div>

    <div class="field">
      <label>Gewonnen legs <span class="muted" style="font-weight:400">(samen ${legsPerMatch})</span></label>
      <div class="field-pair">
        <div><div class="field-pair-label">${esc(aName)}</div><input id="ra" type="number" min="0" max="${legsPerMatch}" value="0" required></div>
        <div><div class="field-pair-label">${esc(bName)}</div><input id="rb" type="number" min="0" max="${legsPerMatch}" value="0" required></div>
      </div>
    </div>

    <div class="field">
      <label>Gemiddelde <span class="muted" style="font-weight:400">(optioneel)</span></label>
      <div class="field-pair">
        <input id="avga" type="number" step="0.1" min="0" max="180" placeholder="${esc(aName)}">
        <input id="avgb" type="number" step="0.1" min="0" max="180" placeholder="${esc(bName)}">
      </div>
    </div>

    <div class="field">
      <label>180's <span class="muted" style="font-weight:400">(optioneel)</span></label>
      <div class="field-pair">
        <input id="s180a" type="number" min="0" max="99" placeholder="${esc(aName)}">
        <input id="s180b" type="number" min="0" max="99" placeholder="${esc(bName)}">
      </div>
    </div>

    <div class="field">
      <label>Hoogste finish <span class="muted" style="font-weight:400">(optioneel)</span></label>
      <div class="field-pair">
        <input id="coa" type="number" min="0" max="170" placeholder="${esc(aName)}">
        <input id="cob" type="number" min="0" max="170" placeholder="${esc(bName)}">
      </div>
    </div>`, async (bg) => {
    const winner = bg.querySelector("input[name=winner]:checked")?.value;
    if (!winner) throw new Error("Kies wie er gewonnen heeft, of gelijkspel.");
    const aLegs = parseInt(bg.querySelector("#ra").value, 10);
    const bLegs = parseInt(bg.querySelector("#rb").value, 10);
    if (isNaN(aLegs) || isNaN(bLegs)) throw new Error("Vul beide legscores in.");
    if (aLegs + bLegs !== legsPerMatch) throw new Error(`Samen moeten de legs precies ${legsPerMatch} zijn.`);
    if (aLegs === bLegs) {
      if (winner !== "draw") throw new Error("Bij gelijke legs is het een gelijkspel.");
    } else {
      if (winner === "draw") throw new Error("De legs zijn niet gelijk, dus kies wie er gewonnen heeft.");
      if ((aLegs > bLegs && winner !== a.id) || (bLegs > aLegs && winner !== b.id)) {
        throw new Error("De gekozen winnaar komt niet overeen met de legscore.");
      }
    }
    const num = (sel) => {
      const v = bg.querySelector(sel).value;
      return v === "" ? null : Number(v);
    };
    await db.reportResult(matchId, {
      winnerId: winner === "draw" ? null : winner,
      aLegs, bLegs,
      aAverage: num("#avga"), bAverage: num("#avgb"),
      a180s: num("#s180a") ?? 0, b180s: num("#s180b") ?? 0,
      aCheckout: num("#coa") ?? 0, bCheckout: num("#cob") ?? 0,
    });
    toast("Doorgegeven. Je tegenstander bevestigt de uitslag.");
    router();
  }, "Uitslag versturen");
}

// Toont de door de tegenstander (of jou) ingevulde uitslag ter controle,
// met knoppen om te bevestigen of af te keuren.
async function openConfirmDialog(matchId) {
  const m = await db.matchById(matchId);
  const a = m.player_a, b = m.player_b;
  const isDraw = m.winner_id === null;
  const winnerName = isDraw ? null : (m.winner_id === m.player_a_id ? a?.display_name : b?.display_name);
  const reporterName = m.reported_by === m.player_a_id ? a?.display_name : b?.display_name;

  const row = (label, av, bv) => `
    <div class="row" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line)">
      <span class="row-sub">${esc(label)}</span>
      <span style="font-weight:600">${esc(av ?? "–")} &ndash; ${esc(bv ?? "–")}</span>
    </div>`;

  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <h2>Uitslag controleren</h2>
      <p class="sub" style="margin-bottom:16px">
        ${esc(reporterName || "Je tegenstander")} gaf deze uitslag door voor
        ${esc(a?.display_name)} &ndash; ${esc(b?.display_name)}. Klopt dit?
      </p>
      <div class="card" style="margin-bottom:20px">
        <div style="display:flex;align-items:center;justify-content:center;gap:8px;font-weight:700;margin-bottom:10px">
          ${isDraw ? "Gelijkspel" : `
            <span style="width:18px;height:18px;color:var(--accent)">${icon.trophy}</span>
            ${esc(winnerName || "?")} wint
          `}
        </div>
        ${row("Legs", m.player_a_legs, m.player_b_legs)}
        ${row("Gemiddelde", m.player_a_average, m.player_b_average)}
        ${row("180's", m.player_a_180s, m.player_b_180s)}
        ${row("Hoogste finish", m.player_a_highest_checkout, m.player_b_highest_checkout)}
      </div>
      <div id="confirmError"></div>
      <div class="modal-actions" style="justify-content:space-between">
        <button type="button" class="btn ghost" id="rejectBtn">Afkeuren</button>
        <button type="button" class="btn" id="approveBtn">Bevestigen</button>
      </div>
    </div>`;
  document.body.appendChild(bg);

  const close = () => bg.remove();
  bg.onclick = (e) => { if (e.target === bg) close(); };
  document.addEventListener("keydown", function onEsc(e) {
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", onEsc); }
  });

  const showError = (e) => {
    bg.querySelector("#confirmError").innerHTML = `<div class="alert bad">${esc(errText(e))}</div>`;
  };

  bg.querySelector("#approveBtn").onclick = async () => {
    const btn = bg.querySelector("#approveBtn");
    busy(btn, true);
    try {
      await db.confirmMatch(matchId);
      toast("Uitslag bevestigd");
      close();
      router();
    } catch (e) {
      busy(btn, false, "Bevestigen");
      showError(e);
    }
  };
  bg.querySelector("#rejectBtn").onclick = async () => {
    const btn = bg.querySelector("#rejectBtn");
    busy(btn, true);
    try {
      await db.rejectMatch(matchId);
      toast("Uitslag afgekeurd. Kan opnieuw worden ingevuld.");
      close();
      router();
    } catch (e) {
      busy(btn, false, "Afkeuren");
      showError(e);
    }
  };
}

async function signOut() {
  await sb.auth.signOut();
}

/* -------------------------------------------------------------------------
   8. Start
   ------------------------------------------------------------------------- */

function configMissing() {
  app.innerHTML = authShell(
    "Nog even instellen",
    "De app weet nog niet met welke database hij moet praten",
    `<div class="card" style="text-align:left">
      <p style="margin-top:0">Open <code>js/config.js</code> en vul je Supabase-gegevens in:</p>
      <p class="muted" style="font-size:13.5px;margin-bottom:0">
        Je vindt ze in je Supabase-project onder Project Settings &rarr; API.
        Kopieer de Project URL en de anon public key.
      </p>
    </div>`
  );
}

async function boot() {
  const { data } = await sb.auth.getSession();
  state.session = data.session;

  if (state.session) {
    try {
      state.profile = await db.myProfile(state.session.user.id);
      state.onboarding = await db.myOnboarding(state.session.user.id);
    } catch (e) {
      // Meestal: de SQL-migratie is nog niet gedraaid, dus er is geen
      // profielrij voor deze gebruiker.
      console.error(e);
      app.innerHTML = authShell(
        "Je profiel ontbreekt",
        "Er is geen profielrij voor dit account",
        `<div class="card" style="text-align:left">
          <p style="margin-top:0">Draai de SQL-migratie in Supabase (SQL Editor) en log opnieuw in.</p>
        </div>
        <button class="btn block mt16" onclick="signOut()">Uitloggen</button>`
      );
      return;
    }
  }
  router();
}

function init() {
  if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes("JOUW-PROJECT")) {
    return configMissing();
  }

  sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === "PASSWORD_RECOVERY") {
      state.session = session;
      location.hash = "#/nieuw-wachtwoord";
      return renderNewPassword();
    }
    const wasLoggedIn = !!state.session;
    state.session = session;
    if (!session) {
      state.profile = null;
      state.onboarding = null;
      return renderLanding();
    }
    if (!wasLoggedIn) {
      state.profile = await db.myProfile(session.user.id).catch(() => null);
      state.onboarding = await db.myOnboarding(session.user.id).catch(() => null);
      if (!location.hash || location.hash === "#/nieuw-wachtwoord") location.hash = "#/";
      router();
    }
  });

  window.addEventListener("hashchange", router);
  boot();
}

init();
