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

// Publieke VAPID-sleutel voor Web Push - hoort net als de Supabase anon key
// publiek te zijn, staat in elke browser die de site opent. De bijbehorende
// privésleutel staat alleen als Edge Function-secret in Supabase.
const VAPID_PUBLIC_KEY = "BN2DVKxw66w5hU3g3hmkbs8oxSgLt4lDzpduHtiDO5hPkgoSJao7nxzoEGfmGY4nDVxieilnR_IJ5ILAxXpE9wE";

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

// "Speel deze wedstrijd uiterlijk vóór 8 oktober 2026."
function fmtDeadlineSentence(iso) {
  const d = new Date(iso);
  const datePart = d.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
  return `Speel deze wedstrijd uiterlijk vóór ${datePart}.`;
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
  darts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="10" r="7"/><circle cx="12" cy="10" r="3.5"/><circle cx="12" cy="10" r="0.8" fill="currentColor"/><path d="M6 22l3.5-6M18 22l-3.5-6" stroke-linecap="round"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.5 3.1-5.5 7-5.5s7 2 7 5.5"/><path d="M17 8.5a3 3 0 0 0 0-1M17.5 14.5c2.6.5 4.5 2.3 4.5 5"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  trend: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>',
  trophy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/></svg>',
  tournament: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3l2.8 6.5M16 3l-2.8 6.5"/><circle cx="12" cy="15" r="6"/></svg>',
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
    return `<div class="match-meta" style="margin-top:4px">Beschikbaar vanaf ${esc(fmtDate(m.available_at, false))}</div>`;
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
        <span class="match-league">${esc(m.league?.name || "")}</span>
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

// Vriendelijke toernooistatus, puur berekend voor weergave (net als
// matchDisplayStatus voor wedstrijden) - de echte status-kolom
// (draft/active/finished) blijft ongewijzigd en stuurt niets extra aan.
const TOURNAMENT_STATUS_LABELS = {
  draft: "Concept",
  upcoming: "Binnenkort",
  registration_open: "Inschrijving geopend",
  registration_closed: "Inschrijving gesloten",
  full: "Vol",
  in_progress: "Bezig",
  finished: "Afgerond",
};
const TOURNAMENT_STATUS_COLORS = {
  draft: "#6B7280",
  upcoming: "#4EA1F7",
  registration_open: "#2ECC71",
  registration_closed: "#6B7280",
  full: "#E74C3C",
  in_progress: "#F47B20",
  finished: "#9B7BD9",
};

function tournamentDisplayStatus(t, entryCount = 0) {
  let key;
  if (t.status === "draft") key = "draft";
  else if (t.status === "finished") key = "finished";
  else {
    const now = new Date();
    const starts = t.start_at ? new Date(t.start_at) : null;
    const opens = t.registration_opens_at ? new Date(t.registration_opens_at) : null;
    const closes = t.registration_closes_at ? new Date(t.registration_closes_at) : null;
    if (starts && starts <= now) key = "in_progress";
    else if (opens && opens > now) key = "upcoming";
    else if (closes && closes <= now) key = "registration_closed";
    else if (t.max_players != null && entryCount >= t.max_players) key = "full";
    else key = "registration_open";
  }
  return { key, label: TOURNAMENT_STATUS_LABELS[key], color: TOURNAMENT_STATUS_COLORS[key] };
}

function tournamentStatusBadge(t, entryCount) {
  const s = tournamentDisplayStatus(t, entryCount);
  return `<span class="badge" style="color:${s.color};border-color:${s.color}66;background:${s.color}22">${esc(s.label)}</span>`;
}

function registrationClosedReason(status) {
  return {
    upcoming: "Inschrijving is nog niet geopend.",
    registration_closed: "Inschrijving is gesloten.",
    full: "Dit toernooi zit vol.",
    in_progress: "Dit toernooi is al begonnen.",
    finished: "Dit toernooi is afgerond.",
    draft: "Dit toernooi is nog niet gepubliceerd.",
  }[status.key] || "";
}

function fmtMoney(n, currency = "EUR") {
  const num = Number(n);
  const formatted = num % 1 === 0 ? num.toFixed(0) : num.toFixed(2);
  return currency === "EUR" ? `€ ${formatted}` : `${formatted} ${currency}`;
}

function fmtPrizeAmount(t) {
  return fmtMoney(t.prize_amount, t.prize_currency);
}

const ORDINALS = { 1: "1e", 2: "2e", 3: "3e", 4: "4e", 5: "5e", 6: "6e", 7: "7e", 8: "8e" };
function ordinal(n) { return ORDINALS[n] || `${n}e`; }

// De prijzenpot: vast bedrag (staat meteen vast), of berekend uit
// inschrijfgeld x aantal betaalde deelnemers (staat pas vast zodra de
// inschrijving sluit - tot die tijd is het een voorlopige schatting).
function prizePoolInfo(t, paidCount = 0) {
  if (t.prize_pool_type === "fixed") {
    return t.prize_amount != null ? { amount: Number(t.prize_amount), pending: false } : null;
  }
  if (t.prize_pool_type === "entry_fee_based") {
    if (t.entry_fee == null) return null;
    const closes = t.registration_closes_at ? new Date(t.registration_closes_at) : null;
    const pending = !closes || closes > new Date();
    return { amount: Number(t.entry_fee) * paidCount, pending, paidCount };
  }
  return null;
}

function prizeDistributionLines(t, pool) {
  const dist = Array.isArray(t.prize_distribution) ? [...t.prize_distribution].sort((a, b) => a.position - b.position) : [];
  return dist.map((d) => {
    if (d.type === "amount") return `${ordinal(d.position)}: ${fmtMoney(d.value, t.prize_currency)}`;
    if (pool && pool.amount) return `${ordinal(d.position)}: ${fmtMoney((pool.amount * d.value) / 100, t.prize_currency)} (${d.value}%)`;
    return `${ordinal(d.position)}: ${d.value}%`;
  });
}

// Prijsinformatie in vier mogelijke vormen - toont nooit fictieve bedragen,
// alleen wat er daadwerkelijk is ingevuld.
function prizeLine(t, paidCount = 0) {
  if (t.prize_type === "money") {
    const pool = prizePoolInfo(t, paidCount);
    const lines = prizeDistributionLines(t, pool);
    return `
      <div class="row-title" style="font-size:14px">Prijzengeld</div>
      ${pool
        ? `<div class="row-sub" style="white-space:normal">${esc(fmtMoney(pool.amount, t.prize_currency))}${pool.pending ? ` <span class="muted">(voorlopig, o.b.v. ${pool.paidCount} betaalde deelnemer${pool.paidCount === 1 ? "" : "s"})</span>` : ""}</div>`
        : (t.prize_amount != null ? `<div class="row-sub" style="white-space:normal">${esc(fmtPrizeAmount(t))}</div>` : "")}
      ${lines.length ? `<div class="muted" style="font-size:12.5px;margin-top:2px">${esc(lines.join(" · "))}</div>` : ""}`;
  }
  if (t.prize_type === "physical") {
    return `
      <div class="row-title" style="font-size:14px">Fysieke prijs</div>
      ${t.prize_description ? `<div class="row-sub" style="white-space:normal">${esc(t.prize_description)}</div>` : ""}`;
  }
  if (t.prize_type === "unknown") {
    return `<div class="row-title" style="font-size:14px;white-space:normal">Prijs wordt later bekendgemaakt</div>`;
  }
  return `<div class="muted" style="font-size:14px">Geen prijs</div>`;
}

const PAYMENT_STATUS_LABELS = {
  pending: "Betaling nog niet gemeld",
  submitted: "Betaling gemeld, wacht op bevestiging",
  paid: "Betaling bevestigd",
  failed: "Betaling afgewezen/verlopen",
  refunded: "Teruggestort",
};
const PAYMENT_STATUS_COLORS = {
  pending: "#6B7280",
  submitted: "#F47B20",
  paid: "#2ECC71",
  failed: "#E74C3C",
  refunded: "#9B7BD9",
};
function paymentStatusBadge(status) {
  const label = PAYMENT_STATUS_LABELS[status];
  if (!label) return "";
  const color = PAYMENT_STATUS_COLORS[status];
  return `<span class="badge" style="color:${color};border-color:${color}66;background:${color}22">${esc(label)}</span>`;
}

function tournamentCard(t, opts = {}) {
  const { entryCount = 0, isMine = false, paidCount = 0 } = opts;
  const meta = [
    TOURNAMENT_TYPES[t.tournament_type] || t.tournament_type,
    t.start_at ? fmtDate(t.start_at) : null,
  ].filter(Boolean).join(" · ");
  const platformLabel = t.platform === "online" ? "Online" : t.platform === "offline" ? "Offline" : null;
  const scoringLabel = t.scoring_platform === "scolia" ? "Scolia" : t.scoring_platform === "dartcounter" ? "DartCounter" : null;
  return `
    <div class="card">
      <div class="row" style="margin-bottom:8px">
        <div class="row-ico">${icon.tournament}</div>
        <div class="row-main">
          <div class="row-title">${esc(t.name)}</div>
          <div class="row-sub">${esc(meta)}</div>
        </div>
      </div>
      <div style="margin:0 0 10px">${tournamentStatusBadge(t, entryCount)}</div>
      <div class="muted" style="font-size:13px;display:flex;flex-wrap:wrap;gap:4px 12px;margin-bottom:12px">
        ${platformLabel ? `<span>${esc(platformLabel)}${scoringLabel ? " · " + esc(scoringLabel) : ""}</span>` : ""}
        <span>${entryCount}${t.max_players ? `/${t.max_players}` : ""} spelers</span>
        ${isMine ? `<span style="color:var(--accent);font-weight:600">Jij doet mee</span>` : ""}
      </div>
      ${t.entry_fee > 0 ? `<div class="muted" style="font-size:13px;margin-bottom:8px">Inschrijfgeld: ${esc(fmtMoney(t.entry_fee, t.prize_currency))}</div>` : ""}
      <div style="margin-bottom:14px">${prizeLine(t, paidCount)}</div>
      <button class="btn ghost sm block" onclick="go('toernooien/${esc(t.id)}')">Bekijk toernooi</button>
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
      groups.set(key, { id: key, name: r.divisionName || "Geen divisie", rank: r.divisionRank, rows: [] });
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
  const isUnassigned = group.id === "none";
  const isMyDivision = !isUnassigned && meId && group.rows.some((r) => r.player?.id === meId);
  const moveCount = Math.min(2, Math.floor(group.rows.length / 2));
  const canPromote = !isUnassigned && group.rank > 1;
  const canRelegate = !isUnassigned && divisionCount && group.rank < divisionCount;

  return `
    <div class="card" style="${isMyDivision ? "border-color:#F47B20" : ""}">
      <div class="row" style="align-items:flex-start;margin-bottom:12px">
        <div class="row-main">
          <h2 style="margin:0">${esc(group.name)}</h2>
          <div class="muted" style="font-size:12.5px;margin-top:2px">${isUnassigned
            ? "Nog niet ingedeeld door de organisator"
            : `${group.rows.length}/12 spelers`}</div>
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
                  <td>${!isUnassigned && i === 0 ? `<span style="display:inline-flex;width:13px;height:13px;color:#F47B20;vertical-align:-2px;margin-right:3px">${icon.trophy}</span>` : ""}${i + 1}</td>
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

  // Plaatst alle spelers van de league in de ene divisie, gesorteerd op
  // gemiddelde (max 12 spelers). Alleen zolang de league nog niet actief is.
  async autoAssignDivisions(leagueId) {
    const { data, error } = await sb.rpc("auto_assign_divisions", { p_league_id: leagueId });
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

  // RLS ("push_subscriptions_own") staat alleen eigen rijen toe - geen
  // security-definer functie nodig, dit is puur eigen-apparaat-beheer.
  async savePushSubscription(sub) {
    const { error } = await sb.from("push_subscriptions").upsert({
      player_id: state.profile.id,
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
    }, { onConflict: "player_id,endpoint" });
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

  async tournaments({ excludeDrafts = false } = {}) {
    let q = sb.from("tournaments").select("*");
    if (excludeDrafts) q = q.neq("status", "draft");
    const { data, error } = await q.order("start_at", { ascending: true, nullsFirst: false });
    if (error) throw error;
    return data || [];
  },

  async tournament(id) {
    const { data, error } = await sb.from("tournaments").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  },

  async createTournament(fields) {
    const { data, error } = await sb.from("tournaments").insert(fields).select().single();
    if (error) throw error;
    return data;
  },

  async updateTournament(id, fields) {
    const { error } = await sb.from("tournaments").update(fields).eq("id", id);
    if (error) throw error;
  },

  // Alle (niet-ingetrokken + ingetrokken) inschrijvingen voor een set
  // toernooien in één keer - voor aantallen/"Mijn toernooien" op de
  // overzichtspagina, zonder N+1 query's.
  async tournamentEntryCounts(tournamentIds) {
    if (!tournamentIds.length) return [];
    const { data, error } = await sb
      .from("tournament_entries")
      .select("tournament_id, player_id, status, payment_status")
      .in("tournament_id", tournamentIds);
    if (error) throw error;
    return data || [];
  },

  async tournamentEntries(tournamentId) {
    const { data, error } = await sb
      .from("tournament_entries")
      .select("*, player:player_id(*)")
      .eq("tournament_id", tournamentId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async tournamentMatchesFor(tournamentId) {
    const { data, error } = await sb
      .from("tournament_matches")
      .select("*, player_a:player_a_id(*), player_b:player_b_id(*)")
      .eq("tournament_id", tournamentId)
      .order("match_number", { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async registerForTournament(tournamentId) {
    const { error } = await sb.rpc("register_for_tournament", { p_tournament_id: tournamentId });
    if (error) throw error;
  },

  async withdrawFromTournament(tournamentId) {
    const { error } = await sb.rpc("withdraw_from_tournament", { p_tournament_id: tournamentId });
    if (error) throw error;
  },

  async submitTournamentPayment(entryId, reference) {
    const { error } = await sb.rpc("submit_tournament_payment", { p_entry_id: entryId, p_reference: reference || null });
    if (error) throw error;
  },

  async confirmTournamentPayment(entryId, amount) {
    const { error } = await sb.rpc("confirm_tournament_payment", { p_entry_id: entryId, p_amount: amount });
    if (error) throw error;
  },

  async rejectTournamentPayment(entryId, reason) {
    const { error } = await sb.rpc("reject_tournament_payment", { p_entry_id: entryId, p_reason: reason || null });
    if (error) throw error;
  },

  async refundTournamentEntry(entryId) {
    const { error } = await sb.rpc("refund_tournament_entry", { p_entry_id: entryId });
    if (error) throw error;
  },

  async tournamentPayouts(tournamentId) {
    const { data, error } = await sb
      .from("tournament_payouts")
      .select("*, player:player_id(*)")
      .eq("tournament_id", tournamentId)
      .order("placement", { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async setTournamentPayout(tournamentId, playerId, placement, prizeAmount, currency) {
    const { data, error } = await sb.rpc("set_tournament_payout", {
      p_tournament_id: tournamentId,
      p_player_id: playerId,
      p_placement: placement,
      p_prize_amount: prizeAmount,
      p_currency: currency || "EUR",
    });
    if (error) throw error;
    return data;
  },

  async approveTournamentPayout(payoutId) {
    const { error } = await sb.rpc("approve_tournament_payout", { p_payout_id: payoutId });
    if (error) throw error;
  },

  async markTournamentPayoutPaid(payoutId, reference) {
    const { error } = await sb.rpc("mark_tournament_payout_paid", { p_payout_id: payoutId, p_payout_reference: reference || null });
    if (error) throw error;
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

  // Draait via een security-definer functie i.p.v. een kale insert, zodat
  // de twee betrokken spelers meteen een melding krijgen dat er een
  // wedstrijd voor ze is ingepland.
  async createMatch(fields) {
    const { error } = await sb.rpc("create_league_match", {
      p_league_id: fields.league_id,
      p_division_id: fields.division_id,
      p_player_a_id: fields.player_a_id,
      p_player_b_id: fields.player_b_id,
      p_scheduled_at: fields.scheduled_at,
    });
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
      p_extra_a: r.extraA || {},
      p_extra_b: r.extraB || {},
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

function showAuthError(msg, extraHtml = "") {
  const box = document.getElementById("authError");
  if (box) box.innerHTML = `<div class="alert bad">${esc(msg)}</div>${extraHtml}`;
}

async function handleResendClick(email, btnEl) {
  btnEl.disabled = true;
  btnEl.textContent = "Bezig...";
  const error = await resendSignupEmail(email);
  if (error) {
    btnEl.disabled = false;
    btnEl.textContent = "Verstuur activatiemail opnieuw";
    return toast(errText(error));
  }
  toast(`Nieuwe activatiemail verstuurd naar ${email}`);
  btnEl.remove();
}

function busy(btn, on, label) {
  btn.disabled = on;
  btn.innerHTML = on ? `<span class="spinner inline"></span>` : esc(label);
}

// Altijd het huidige origin gebruiken (nooit een hardcoded domein) zodat dit
// vanzelf klopt op productie, Vercel-previews én lokaal - zolang die URL in
// Supabase (Authentication -> URL Configuration -> Redirect URLs) staat.
function signupRedirectTo() {
  return `${location.origin}${location.pathname}#/geactiveerd`;
}

async function resendSignupEmail(email) {
  const { error } = await sb.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: signupRedirectTo() },
  });
  return error;
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
            <p class="landing-hero-note" style="margin-top:4px">Voor Scolia en DartCounter</p>
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
    if (error) {
      busy(btn, false, "Inloggen");
      const unconfirmed = /Email not confirmed/i.test(error.message || "");
      showAuthError(errText(error), unconfirmed
        ? `<button type="button" class="linkbtn" style="padding:0;margin-top:8px" onclick="handleResendClick('${esc(email)}', this)">Verstuur activatiemail opnieuw</button>`
        : "");
    }
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
      options: { data: { display_name: name }, emailRedirectTo: signupRedirectTo() },
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

// Scherm waar de gebruiker landt na het klikken op de activatielink uit de
// registratiemail (zie signupRedirectTo() en de afhandeling in init()).
function renderSignupConfirmed() {
  app.innerHTML = authShell(
    "Account geactiveerd",
    "",
    `<div class="alert ok">Je account is succesvol geactiveerd!</div>
     <button class="btn block" onclick="renderLogin()">Naar inloggen</button>`
  );
}

// Scherm voor een verlopen of ongeldige activatielink: duidelijke uitleg +
// meteen de mogelijkheid om een nieuwe activatiemail aan te vragen.
function renderSignupLinkError() {
  app.innerHTML = authShell(
    "Link verlopen of ongeldig",
    "Vraag hieronder een nieuwe activatielink aan",
    `<form id="f" novalidate>
      <div class="field">
        <label for="email">E-mailadres</label>
        <input id="email" type="email" autocomplete="email" required>
      </div>
      <button class="btn block" id="submit" type="submit">Verstuur activatiemail opnieuw</button>
    </form>`,
    `<div class="auth-alt"><button class="linkbtn" onclick="renderLogin()">Terug naar inloggen</button></div>`
  );

  document.getElementById("f").onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById("submit");
    const email = document.getElementById("email").value.trim();
    if (!email.includes("@")) return showAuthError("Vul een geldig e-mailadres in.");
    busy(btn, true);
    const error = await resendSignupEmail(email);
    if (error) { busy(btn, false, "Verstuur activatiemail opnieuw"); return showAuthError(errText(error)); }
    app.innerHTML = authShell(
      "Check je mail",
      `We stuurden een nieuwe activatielink naar ${email}`,
      `<button class="btn block" onclick="renderLogin()">Terug naar inloggen</button>`
    );
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
  { route: "toernooien", label: "Toernooien", ico: "tournament" },
  { route: "wedstrijden", label: "Wedstrijden", ico: "darts" },
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
    if (route.startsWith("toernooien/")) {
      return await viewTournamentDetail(route.split("/")[1]);
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

// "Mijn league & divisie"-kaart op Home: welke league/divisie, positie,
// aantal spelers en gespeelde wedstrijden - de speler moet in één oogopslag
// zien waar hij speelt. myRow is de eigen rij uit standingsForLeague().
function myLeagueOverviewCard(membership, myRow, position, divisionTotal) {
  if (!membership) {
    return `<div class="card">${emptyView("Nog niet ingedeeld", "Zodra de organisator je indeelt in een league, zie je hier je overzicht.", "league")}</div>`;
  }
  return `
    <button class="card clickable" onclick="go('mijn-divisie')">
      <div class="row" style="margin-bottom:${myRow ? "14px" : "0"}">
        <div class="row-ico">${icon.league}</div>
        <div class="row-main">
          <div class="row-title">${esc(membership.league.name)}</div>
          ${!membership.division ? `<div class="row-sub">Nog niet ingedeeld</div>` : ""}
        </div>
      </div>
      ${myRow ? `
        <div class="muted" style="font-size:13px">
          Positie ${position} van ${divisionTotal} &middot; ${myRow.played} gespeeld${myRow.points != null ? ` &middot; ${myRow.points} pt` : ""}
        </div>` : ""}
    </button>`;
}

// Compacte snelkoppelingen naar de belangrijkste pagina's - vervangt de
// vroegere org-brede lijsten (actieve leagues/toernooien/uitslagen) op
// Home, die niet speler-centrisch waren en al bereikbaar zijn via het menu.
function quickActionsGrid() {
  const tiles = [
    { label: "Toernooien", route: "toernooien", ico: "tournament" },
    { label: "Wedstrijden", route: "wedstrijden", ico: "darts" },
    { label: "Statistieken", route: "statistieken", ico: "chart" },
    { label: "Mijn divisie", route: "mijn-divisie", ico: "league" },
  ];
  return `
    <div class="grid">
      ${tiles.map((t) => `
        <button class="card clickable center" style="padding:16px 10px" onclick="go('${t.route}')">
          <div style="width:26px;height:26px;margin:0 auto 8px;color:var(--accent)">${icon[t.ico]}</div>
          <div style="font-size:13px;font-weight:600">${esc(t.label)}</div>
        </button>`).join("")}
    </div>`;
}

async function viewHome() {
  const me = state.profile;
  const firstName = (me?.display_name || "").split(" ")[0];

  const [matches, prizeNotification, notification, membership] = await Promise.all([
    db.myMatches(me.id),
    db.myPendingPrizeNotification(),
    db.myPendingNotification(),
    db.myLeagueMembership(),
  ]);

  const next = matches.find((m) => m.status === "scheduled" || m.status === "in_progress");

  let myRow = null, position = null, divisionTotal = 0;
  if (membership) {
    const standings = await db.standingsForLeague(membership.league.id);
    const inMyDivision = standings.filter((r) => r.divisionId === membership.division?.id);
    divisionTotal = inMyDivision.length;
    const idx = inMyDivision.findIndex((r) => r.player.id === me.id);
    position = idx >= 0 ? idx + 1 : null;
    myRow = inMyDivision[idx] || null;
  }

  setView(`
    <h1>Welkom terug, ${esc(firstName)}</h1>
    <p class="sub">Dit is jouw darts-overzicht.</p>

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

    <div class="home-top-grid">
      <div>
        ${sectionHead("Eerstvolgende wedstrijd", "Alle wedstrijden", "wedstrijden")}
        ${next ? `
          ${matchCard(next)}
          <button class="btn ghost sm" style="margin-top:-4px" onclick="go('mijn-divisie/${esc(next.id)}')">Wedstrijd bekijken</button>
        ` : emptyView("Niets ingepland", "Zodra de organisator een wedstrijd voor je inplant, staat hij hier.", "darts")}
      </div>
      <div>
        ${sectionHead("Mijn league & divisie")}
        ${myLeagueOverviewCard(membership, myRow, position, divisionTotal)}
      </div>
    </div>

    ${myRow ? `
      ${sectionHead("League-overzicht")}
      <div class="grid">
        ${statCard({ label: "Positie", value: `${position}/${divisionTotal}`, ico: "league" })}
        ${statCard({ label: "Gespeeld", value: myRow.played, ico: "darts" })}
        ${statCard({ label: "Gemiddelde", value: Number(myRow.displayAverage ?? 0).toFixed(1), ico: "trend" })}
        ${statCard({ label: "Punten", value: myRow.points, ico: "trophy", color: "#2ECC71" })}
      </div>
    ` : ""}

    ${sectionHead("Snelle acties")}
    ${quickActionsGrid()}
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
    <p class="sub">${esc(league.name)}${league.season ? " &middot; Seizoen: " + esc(league.season) : ""}</p>
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
    ` : emptyView("Geen open wedstrijden", "Je hebt op dit moment geen wedstrijden om te spelen.", "darts")}

    ${sectionHead("Wedstrijden deze week")}
    ${leagueMatches.length ? leagueMatches.map((m) => `
        ${matchCard(m)}
        ${focusMatch && m.id === focusMatch.id
          ? `<p class="muted" style="margin:-4px 0 14px;font-size:12.5px">Dit is je huidige wedstrijd hierboven.</p>`
          : `<button class="btn ghost sm" style="margin:-4px 0 14px" onclick="go('mijn-divisie/${esc(m.id)}')">Bekijk wedstrijd</button>`}
      `).join("")
      : emptyView("Geen wedstrijden", "", "darts")}

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
        <p>Een league is één groep van maximaal 12 spelers, gerangschikt op punten: 1e, 2e, 3e, enzovoort. Wil je meerdere niveaus (bv. een 1e en 2e divisie), maak daar dan aparte leagues voor aan.</p>
        <p>De wedstrijden worden automatisch ingedeeld. Iedere wedstrijd heeft vanaf het moment waarop deze beschikbaar wordt gesteld 7 dagen de tijd om gespeeld te worden. De deadline geldt afzonderlijk per wedstrijd.</p>
        <p>De winnaar van de league ontvangt een kampioenstitel en een gepersonaliseerde prijs, beschikbaar gesteld door LWPrints. Dit kan bijvoorbeeld een bedrukt T-shirt, hoodie of polo zijn.</p>
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
        ${infoRow("Spelers", `${members.length}/12`)}
        ${infoRow("Tijdzone", esc(league.timezone))}
        ${infoRow("Wedstrijden aangemaakt", matches.length)}
        <p class="muted" style="font-size:13px;margin:12px 0 0">${esc(leagueNextActionText(league))}</p>
      </div>
      ${canEditSchedule ? `
        <div class="card mt16">
          <div class="field"><label for="lp-desc">Beschrijving <span class="muted" style="font-weight:400">(optioneel)</span></label>
            <input id="lp-desc" value="${esc(league.description || "")}" placeholder="Bijv. Najaarscompetitie 2026"></div>
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
      ${sectionHead("Spelers")}
      <div class="chips" style="margin-bottom:14px">
        ${league.status === "draft" ? `
          <button class="chip" onclick="autoAssignDivisions('${esc(id)}')">${icon.target} Automatisch indelen</button>` : ""}
        <button class="chip" onclick="openAssignPlayerDialog('${esc(id)}')">${icon.plus} Speler indelen</button>
      </div>
      ${league.status === "draft" ? `
        <p class="muted" style="font-size:12.5px;margin:-6px 0 14px">
          Automatisch indelen: rangschikt spelers op gemiddelde (max 12 spelers per league).
        </p>` : ""}
    ` : ""}

    ${isOrg && league.status === "finished" ? `
      ${sectionHead("Winnaar & prijs")}
      ${winners.length ? `
        <div class="card">
          ${winners.map((w, i) => `
            <div class="row" style="padding:7px 0;${i > 0 ? "border-top:1px solid var(--line)" : ""}">
              ${avatar(w.player, "sm")}
              <div class="row-main">
                <div class="row-title">${esc(w.player?.display_name || "?")}</div>
              </div>
              ${w.claim ? prizeStatusBadge(w.claim.status) : ""}
            </div>`).join("")}
        </div>
        <button class="btn ghost sm mt8" onclick="go('beheer/prijzen')">Alle prijzen beheren</button>
      ` : `
        <button class="btn" onclick="determineDivisionWinners('${esc(id)}')">${icon.trophy} Bepaal winnaar</button>
        <p class="muted" style="font-size:12.5px;margin:8px 0 0">
          De winnaar krijgt automatisch een melding en kan zijn prijs claimen (beschikbaar gesteld door LWPrints).
        </p>
      `}
    ` : ""}

    ${sectionHead("Wedstrijden")}
    ${matches.length ? matches.map(matchCard).join("")
      : emptyView("Nog geen wedstrijden", "Er is nog niets ingepland voor deze league.", "darts")}
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
      ? "Winnaar bepaald en op de hoogte gebracht."
      : "Geen winnaar: er is nog geen wedstrijd gespeeld.");
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

  const prizeBlurb = "De winnaar van de league ontvangt een gepersonaliseerd bedrukt kledingstuk, " +
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
      <h1 style="font-size:22px">${esc(w.league_name)} gewonnen!</h1>
      ${w.season ? `<p class="sub" style="margin-bottom:4px">${esc(w.season)}</p>` : ""}
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
            <div class="row-sub">${esc(w.league_name)}${w.season ? " · " + esc(w.season) : ""}</div>
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
      <div class="muted" style="font-size:14px">${esc(w.league_name)}${w.season ? " · " + esc(w.season) : ""}</div>
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
      msg += ` Let op: ${lowConfidence.map((p) => p.display_name).join(", ")} had(den) geen gemiddelde en telt/tellen nu als 0.`;
    }
    toast(msg);
    router();
  } catch (e) { toast(errText(e)); }
}

async function viewTournaments() {
  const me = state.profile;
  const list = await db.tournaments({ excludeDrafts: true });
  const entryRows = await db.tournamentEntryCounts(list.map((t) => t.id));

  const countByTournament = {};
  const paidCountByTournament = {};
  const mineSet = new Set();
  for (const e of entryRows) {
    if (e.status === "withdrawn") continue;
    countByTournament[e.tournament_id] = (countByTournament[e.tournament_id] || 0) + 1;
    if (e.payment_status === "paid") {
      paidCountByTournament[e.tournament_id] = (paidCountByTournament[e.tournament_id] || 0) + 1;
    }
    // Een niet-betaalde reservering telt nog niet als definitieve aanmelding.
    if (e.player_id === me.id && (e.payment_status === "paid" || e.payment_status === "not_required")) {
      mineSet.add(e.tournament_id);
    }
  }

  const filters = [
    { key: "all", label: "Alle toernooien" },
    { key: "upcoming", label: "Aankomende toernooien" },
    { key: "registration_open", label: "Inschrijving geopend" },
    { key: "mine", label: "Mijn toernooien" },
    { key: "finished", label: "Afgeronde toernooien" },
  ];

  const matchesFilter = (t, key) => {
    if (key === "all") return true;
    if (key === "mine") return mineSet.has(t.id);
    const statusKey = tournamentDisplayStatus(t, countByTournament[t.id] || 0).key;
    if (key === "upcoming") return ["upcoming", "registration_open", "registration_closed", "full"].includes(statusKey);
    if (key === "registration_open") return statusKey === "registration_open";
    if (key === "finished") return statusKey === "finished";
    return true;
  };

  let active = "all";

  const renderList = () => {
    const shown = list.filter((t) => matchesFilter(t, active));
    document.getElementById("tournaments-results").innerHTML = shown.length
      ? `<div class="tournament-grid">${shown.map((t) => tournamentCard(t, {
          entryCount: countByTournament[t.id] || 0,
          paidCount: paidCountByTournament[t.id] || 0,
          isMine: mineSet.has(t.id),
        })).join("")}</div>`
      : emptyView("Nog geen toernooien beschikbaar", "Er zijn momenteel geen toernooien beschikbaar. Kom later terug om mee te doen aan een nieuw toernooi.", "tournament");
    document.querySelectorAll(".tournament-filter-chip").forEach((el) => {
      el.classList.toggle("active", el.dataset.key === active);
    });
  };

  setView(`
    <h1>Toernooien</h1>
    <p class="sub">Strijd tegen andere spelers en maak kans op mooie prijzen.</p>

    <div class="card" style="margin-bottom:16px">
      <div class="row">
        <div class="row-ico">${icon.trophy}</div>
        <div class="row-main">
          <div class="row-title" style="white-space:normal">Toernooien met mogelijk prijzengeld</div>
          <div class="row-sub" style="white-space:normal">Neem deel aan darttoernooien en strijd tegen andere spelers. Afhankelijk van het toernooi kunnen er prijzen of prijzengeld beschikbaar zijn.</div>
        </div>
      </div>
    </div>

    <div class="chips" style="margin-bottom:20px">
      ${filters.map((f) => `<button type="button" class="chip tournament-filter-chip" data-key="${f.key}">${esc(f.label)}</button>`).join("")}
    </div>

    <div id="tournaments-results"></div>
  `);

  document.querySelectorAll(".tournament-filter-chip").forEach((el) => {
    el.onclick = () => { active = el.dataset.key; renderList(); };
  });
  renderList();
}

function tournamentMatchRow(m) {
  const played = m.player_a_legs > 0 || m.player_b_legs > 0;
  const aWin = m.winner_id && m.winner_id === m.player_a_id;
  const bWin = m.winner_id && m.winner_id === m.player_b_id;
  return `
    <div class="card">
      ${m.round_name ? `<div class="muted" style="font-size:12px;font-weight:600;margin-bottom:8px">${esc(m.round_name)}</div>` : ""}
      <div class="match-row">
        <div class="mp ${aWin ? "winner" : ""}"><span class="mp-name">${esc(m.player_a?.display_name || "Nog onbekend")}</span></div>
        <span class="vs">VS</span>
        <div class="mp right ${bWin ? "winner" : ""}"><span class="mp-name">${esc(m.player_b?.display_name || "Nog onbekend")}</span></div>
      </div>
      ${played ? `
        <div class="match-score">
          <span class="score ${aWin ? "win" : ""}">${m.player_a_legs}</span>
          <span class="score-sep">-</span>
          <span class="score ${bWin ? "win" : ""}">${m.player_b_legs}</span>
        </div>` : ""}
      ${m.scheduled_at ? `<div class="match-meta">${icon.clock}<span>${esc(fmtDate(m.scheduled_at))}</span></div>` : ""}
    </div>`;
}

// Betaalblok voor de eigen inschrijving: instructies + "Ik heb betaald" bij
// pending, wacht-op-bevestiging bij submitted, bevestiging bij paid.
function myPaymentBlock(t, entry) {
  if (!entry || entry.payment_status === "not_required") return "";
  const fee = t.entry_fee != null ? fmtMoney(t.entry_fee, t.prize_currency) : "";
  if (entry.payment_status === "pending") {
    return `
      <div class="card" style="margin-bottom:16px">
        <div class="row-title" style="font-size:14px;margin-bottom:6px">Inschrijfgeld: ${esc(fee)}</div>
        ${t.payment_instructions ? `<p class="row-sub" style="white-space:pre-wrap;margin:0 0 10px">${esc(t.payment_instructions)}</p>` : ""}
        ${t.payment_deadline_hours ? `<p class="muted" style="font-size:12.5px;margin:0 0 10px">Betaal binnen ${t.payment_deadline_hours} uur na inschrijving, anders vervalt je plek automatisch.</p>` : ""}
        <button class="btn sm" id="submitPaymentBtn">Ik heb betaald</button>
      </div>`;
  }
  if (entry.payment_status === "submitted") {
    return `
      <div class="card" style="margin-bottom:16px">
        <div class="row-title" style="font-size:14px">${paymentStatusBadge("submitted")}</div>
        <p class="row-sub" style="margin:6px 0 0">Wacht op bevestiging door de organisator.${entry.payment_reference ? ` Referentie: ${esc(entry.payment_reference)}` : ""}</p>
      </div>`;
  }
  if (entry.payment_status === "paid") {
    return `
      <div class="card" style="margin-bottom:16px">
        <div class="row-title" style="font-size:14px">${paymentStatusBadge("paid")}</div>
        ${entry.amount_paid != null ? `<p class="row-sub" style="margin:6px 0 0">${esc(fmtMoney(entry.amount_paid, t.prize_currency))} ontvangen.</p>` : ""}
      </div>`;
  }
  return "";
}

// Uitklapbare uitleg over hoe de prijzenpot en uitbetaling werken, alleen
// getoond als er daadwerkelijk prijzengeld is (mirrort de "Hoe werkt de
// league?"-uitleg op de Leagues-pagina).
function prizeExplainerCard(t) {
  if (t.prize_type !== "money") return "";

  let potText;
  if (t.prize_pool_type === "entry_fee_based") {
    potText = "De pot wordt berekend als inschrijfgeld × het aantal spelers dat daadwerkelijk heeft betaald. Zolang de inschrijving nog open is, is het genoemde bedrag dus een voorlopige schatting - pas zodra de inschrijving sluit staat de pot definitief vast.";
  } else if (t.prize_pool_type === "fixed") {
    potText = "Dit toernooi heeft een vast prijzenbedrag. Dat bedrag staat vooraf vast, ongeacht het aantal deelnemers.";
  } else {
    potText = "Het genoemde bedrag is het totale prijzengeld voor dit toernooi.";
  }

  const hasDistribution = Array.isArray(t.prize_distribution) && t.prize_distribution.length > 0;
  const distText = hasDistribution
    ? "Per eindpositie is al een deel van de pot toegewezen (zie hierboven) - als percentage van de pot of als vast bedrag."
    : "De organisator heeft nog geen verdeling per eindpositie vastgelegd.";

  const payoutText = "Na afloop van het toernooi legt de organisator de uitbetaling per eindpositie handmatig vast, keurt deze goed en maakt het bedrag zelf over (bijvoorbeeld via Tikkie). Dit gaat niet automatisch via de app - de app houdt alleen bij wat er zou moeten gebeuren.";

  return `
    <details class="card info-card" style="margin-bottom:16px">
      <summary>
        <div class="row">
          <div class="row-ico">${icon.trophy}</div>
          <div class="row-main"><div class="row-title" style="white-space:normal">Hoe werkt de prijzenpot?</div></div>
          <span class="muted toggle-label" style="font-size:13px;flex-shrink:0">Meer info &darr;</span>
        </div>
      </summary>
      <div class="muted" style="font-size:13.5px;line-height:1.6;margin-top:14px">
        <p>${esc(potText)}</p>
        <p>${esc(distText)}</p>
        <p>${esc(payoutText)}</p>
      </div>
    </details>`;
}

async function viewTournamentDetail(id) {
  const me = state.profile;
  const isOrg = me?.role === "organizer";

  const [t, entries, matches, payouts] = await Promise.all([
    db.tournament(id),
    db.tournamentEntries(id),
    db.tournamentMatchesFor(id),
    db.tournamentPayouts(id),
  ]);
  if (!t) {
    return setView(emptyView("Toernooi niet gevonden", "Dit toernooi bestaat niet (meer).", "tournament"));
  }
  if (t.status === "draft" && !isOrg) {
    return setView(emptyView("Toernooi niet gevonden", "Dit toernooi bestaat niet (meer).", "tournament"));
  }

  const activeEntries = entries.filter((e) => e.status !== "withdrawn");
  const myEntry = activeEntries.find((e) => e.player_id === me.id);
  const paidCount = activeEntries.filter((e) => e.payment_status === "paid").length;
  const status = tournamentDisplayStatus(t, activeEntries.length);
  const canRegister = status.key === "registration_open" && !myEntry;
  const canWithdraw = !!myEntry;
  const isPaidTournament = t.entry_fee != null && Number(t.entry_fee) > 0;

  const platformLabel = t.platform === "online" ? "Online" : t.platform === "offline" ? "Offline" : null;
  const scoringLabel = t.scoring_platform === "scolia" ? "Scolia" : t.scoring_platform === "dartcounter" ? "DartCounter" : null;

  const pendingEntries = activeEntries.filter((e) => e.payment_status === "pending" || e.payment_status === "submitted");
  const paidEntries = activeEntries.filter((e) => e.payment_status === "paid");
  const myPayout = !isOrg ? payouts.find((p) => p.player_id === me.id) : null;

  setView(`
    <button class="linkbtn" onclick="go('toernooien')" style="display:flex;align-items:center;gap:4px;margin-bottom:12px">
      <span style="width:16px;height:16px;display:inline-flex">${icon.back}</span> Toernooien
    </button>
    <h1>${esc(t.name)}</h1>
    <p class="sub">${esc([TOURNAMENT_TYPES[t.tournament_type] || t.tournament_type, t.start_at ? fmtDate(t.start_at) : null].filter(Boolean).join(" · "))}</p>
    <div style="margin-bottom:20px">${tournamentStatusBadge(t, activeEntries.length)}</div>

    <div class="card" style="margin-bottom:16px">
      ${infoRow("Format", esc(TOURNAMENT_TYPES[t.tournament_type] || t.tournament_type))}
      ${platformLabel ? infoRow("Speelwijze", esc(platformLabel + (scoringLabel ? ` · ${scoringLabel}` : ""))) : ""}
      ${infoRow("Deelnemers", `${activeEntries.length}${t.max_players ? `/${t.max_players}` : ""}`)}
      ${t.min_players ? infoRow("Minimum aantal spelers", String(t.min_players)) : ""}
      ${t.registration_opens_at ? infoRow("Inschrijving opent", esc(fmtDate(t.registration_opens_at))) : ""}
      ${t.registration_closes_at ? infoRow("Inschrijving sluit", esc(fmtDate(t.registration_closes_at))) : ""}
      ${isPaidTournament ? infoRow("Inschrijfgeld", esc(fmtMoney(t.entry_fee, t.prize_currency))) : ""}
    </div>

    <div class="card" style="margin-bottom:16px">${prizeLine(t, paidCount)}</div>

    ${prizeExplainerCard(t)}

    ${!isOrg ? myPaymentBlock(t, myEntry) : ""}

    ${myPayout ? `
      <div class="card" style="margin-bottom:16px">
        <div class="row-title" style="font-size:14px">Jouw resultaat: ${esc(ordinal(myPayout.placement))} plaats</div>
        <p class="row-sub" style="margin:6px 0 0">${esc(fmtMoney(myPayout.prize_amount, myPayout.currency))} — ${myPayout.payout_status === "paid" ? "uitbetaald" : myPayout.payout_status === "approved" ? "goedgekeurd, wordt overgemaakt" : "wacht op goedkeuring"}</p>
      </div>` : ""}

    ${(t.refund_policy || t.refund_cutoff_hours) && !isOrg ? `
      <div class="card" style="margin-bottom:16px">
        <div class="row-title" style="font-size:14px">Annuleringsvoorwaarden</div>
        ${t.refund_policy ? `<p class="row-sub" style="white-space:pre-wrap;margin:6px 0 0">${esc(t.refund_policy)}</p>` : ""}
        ${t.refund_cutoff_hours != null ? `<p class="muted" style="font-size:12.5px;margin:6px 0 0">Terugbetaling mogelijk tot ${t.refund_cutoff_hours} uur voor aanvang.</p>` : ""}
      </div>` : ""}

    ${!isOrg ? `
      <div style="margin-bottom:16px">
        ${canRegister ? `<button class="btn block" onclick="registerForTournament('${esc(t.id)}')">${isPaidTournament ? "Inschrijven en betalen" : "Inschrijven"}</button>` : ""}
        ${canWithdraw ? `<button class="btn ghost block" onclick="withdrawFromTournament('${esc(t.id)}')">Uitschrijven</button>` : ""}
        ${!canRegister && !canWithdraw ? `<p class="muted" style="font-size:13px;margin:0">${esc(registrationClosedReason(status))}</p>` : ""}
      </div>
    ` : `
      <button class="btn ghost sm" style="margin-bottom:16px" onclick="openEditTournamentDialog('${esc(t.id)}')">${icon.settings} Toernooi bewerken</button>
    `}

    ${t.description ? `
      ${sectionHead("Toernooiregels")}
      <div class="card" style="margin-bottom:16px"><p style="margin:0;white-space:pre-wrap">${esc(t.description)}</p></div>
    ` : ""}

    ${isOrg && isPaidTournament ? `
      ${sectionHead("Betalingen")}
      ${pendingEntries.length ? `
        <div class="card" style="margin-bottom:16px">
          ${pendingEntries.map((e, i) => `
            <div class="row" style="padding:9px 0;${i > 0 ? "border-top:1px solid var(--line)" : ""}">
              ${avatar(e.player, "sm")}
              <div class="row-main">
                <div class="row-title">${esc(e.player?.display_name || "?")}</div>
                <div class="row-sub">${paymentStatusBadge(e.payment_status)}${e.payment_reference ? ` · ${esc(e.payment_reference)}` : ""}</div>
              </div>
              <div style="display:flex;gap:6px;flex-shrink:0">
                <button class="btn ghost sm reject-payment-btn" data-entry-id="${esc(e.id)}">Afwijzen</button>
                <button class="btn sm confirm-payment-btn" data-entry-id="${esc(e.id)}">Bevestigen</button>
              </div>
            </div>`).join("")}
        </div>` : `<div class="card" style="margin-bottom:16px">${emptyView("Geen openstaande betalingen", "", "flag")}</div>`}
      ${paidEntries.length ? `
        <div class="card" style="margin-bottom:16px">
          ${paidEntries.map((e, i) => `
            <div class="row" style="padding:9px 0;${i > 0 ? "border-top:1px solid var(--line)" : ""}">
              ${avatar(e.player, "sm")}
              <div class="row-main">
                <div class="row-title">${esc(e.player?.display_name || "?")}</div>
                <div class="row-sub">${paymentStatusBadge(e.payment_status)}${e.amount_paid != null ? ` · ${esc(fmtMoney(e.amount_paid, t.prize_currency))}` : ""}</div>
              </div>
              <button class="btn ghost sm refund-entry-btn" data-entry-id="${esc(e.id)}">Terugbetalen</button>
            </div>`).join("")}
        </div>` : ""}
    ` : ""}

    ${sectionHead("Deelnemers")}
    ${activeEntries.length ? `
      <div class="card" style="margin-bottom:16px">
        ${activeEntries.map((e, i) => `
          <div class="row" style="padding:7px 0;${i > 0 ? "border-top:1px solid var(--line)" : ""}">
            ${avatar(e.player, "sm")}
            <div class="row-main"><div class="row-title">${esc(e.player?.display_name || "?")}</div></div>
            ${isOrg && isPaidTournament ? paymentStatusBadge(e.payment_status) : ""}
          </div>`).join("")}
      </div>` : `<div class="card" style="margin-bottom:16px">${emptyView("Nog geen deelnemers", "", "users")}</div>`}

    ${isOrg ? `
      ${sectionHead("Uitbetalingen")}
      ${payouts.length ? `
        <div class="card" style="margin-bottom:16px">
          ${payouts.map((p, i) => `
            <div class="row" style="padding:9px 0;${i > 0 ? "border-top:1px solid var(--line)" : ""}">
              ${avatar(p.player, "sm")}
              <div class="row-main">
                <div class="row-title">${esc(ordinal(p.placement))} — ${esc(p.player?.display_name || "?")}</div>
                <div class="row-sub">${esc(fmtMoney(p.prize_amount, p.currency))} · ${esc(p.payout_status === "paid" ? "Betaald" : p.payout_status === "approved" ? "Goedgekeurd" : p.payout_status === "cancelled" ? "Geannuleerd" : "Wacht op goedkeuring")}</div>
              </div>
              <div style="display:flex;gap:6px;flex-shrink:0">
                ${p.payout_status === "pending_approval" ? `<button class="btn ghost sm approve-payout-btn" data-payout-id="${esc(p.id)}">Goedkeuren</button>` : ""}
                ${p.payout_status === "approved" ? `<button class="btn sm mark-payout-paid-btn" data-payout-id="${esc(p.id)}">Als betaald markeren</button>` : ""}
              </div>
            </div>`).join("")}
        </div>` : `<div class="card" style="margin-bottom:16px">${emptyView("Nog geen uitbetalingen vastgelegd", "", "trophy")}</div>`}
      <button class="btn ghost sm" style="margin-bottom:16px" id="addPayoutBtn">${icon.plus} Uitbetaling toevoegen</button>
    ` : ""}

    ${sectionHead("Wedstrijdschema")}
    ${matches.length ? matches.map(tournamentMatchRow).join("")
      : `<div class="card">${emptyView("Nog geen wedstrijdschema", "Het schema verschijnt zodra het toernooi begint.", "darts")}</div>`}
  `);

  document.getElementById("submitPaymentBtn")?.addEventListener("click", () => openSubmitPaymentDialog(myEntry.id));
  document.querySelectorAll(".confirm-payment-btn").forEach((el) => {
    el.onclick = () => openConfirmPaymentDialog(el.dataset.entryId, t.entry_fee, t.prize_currency);
  });
  document.querySelectorAll(".reject-payment-btn").forEach((el) => {
    el.onclick = () => openRejectPaymentDialog(el.dataset.entryId);
  });
  document.querySelectorAll(".refund-entry-btn").forEach((el) => {
    const entry = paidEntries.find((e) => e.id === el.dataset.entryId);
    el.onclick = () => openRefundConfirm(entry, t.prize_currency);
  });
  document.querySelectorAll(".approve-payout-btn").forEach((el) => {
    el.onclick = () => approvePayoutAction(el.dataset.payoutId);
  });
  document.querySelectorAll(".mark-payout-paid-btn").forEach((el) => {
    el.onclick = () => openMarkPayoutPaidDialog(el.dataset.payoutId);
  });
  document.getElementById("addPayoutBtn")?.addEventListener("click", () => openSetPayoutDialog(t.id, activeEntries));

  const infoCard = document.querySelector(".info-card");
  infoCard?.addEventListener("toggle", () => {
    infoCard.querySelector(".toggle-label").innerHTML = infoCard.open ? "Minder info &uarr;" : "Meer info &darr;";
  });
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
    return `<div class="card">${emptyView("Nog geen eerdere ontmoetingen", `Dit is de eerste keer dat je het opneemt tegen ${esc(opponent?.display_name || "deze speler")}.`, "darts")}</div>`;
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
    ${matches.length === 0 ? emptyView("Nog geen wedstrijden", "Zodra je bent ingedeeld, verschijnen ze hier.", "darts") : ""}
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
      ${statCard({ label: "Gespeeld", value: s.matches_played, ico: "darts" })}
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
      ${statCard({ label: "Gespeeld", value: s?.matches_played ?? 0, ico: "darts" })}
      ${statCard({ label: "Gewonnen", value: s?.matches_won ?? 0, ico: "trophy", color: "#2ECC71" })}
      ${statCard({ label: "Gemiddelde", value: Number(s?.average_score ?? 0).toFixed(1), ico: "trend" })}
      ${statCard({ label: "180's", value: s?.count_180 ?? 0, ico: "star", color: "#F5B942" })}
    </div>

    ${sectionHead("Meldingen")}
    <div class="card">
      <div class="row-sub">Pushmeldingen op dit toestel</div>
      <p class="muted" style="font-size:12.5px;margin:8px 0 12px">Ontvang een melding zodra er een wedstrijd voor je is ingepland of een speelmoment wordt voorgesteld - ook als de app niet open staat. Op iPhone: zet de site eerst via Safari op je beginscherm (deel-icoon &rarr; Zet op beginscherm) voordat je dit inschakelt.</p>
      <button class="btn ghost sm" id="enablePushBtn">Inschakelen op dit toestel</button>
    </div>

    ${sectionHead("League-indeling")}
    <div class="card">
      ${membership ? `
        ${infoRow("League", esc(membership.league.name))}
        ${!membership.division ? `<p class="muted" style="font-size:13px;margin:-2px 0 0">Nog niet ingedeeld door de organisator.</p>` : ""}
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

  document.getElementById("enablePushBtn").onclick = enablePushNotifications;

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
      ${statCard({ label: "Actieve toernooien", value: c.tournaments, ico: "tournament" })}
      ${statCard({ label: "Open wedstrijden", value: c.open, ico: "darts", color: "#F5B942" })}
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
    ${tile("Toernooien", "beheer/toernooien", "tournament")}
    ${tile("Wedstrijden", "beheer/wedstrijden", "darts")}
    ${tile("Prijzen", "beheer/prijzen", "trophy")}
    ${tile("Instellingen", "beheer/instellingen", "settings")}

    ${sectionHead("Laatste uitslagen")}
    ${results.length ? results.map(matchCard).join("") : emptyView("Nog geen uitslagen", "", "darts")}
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
  const entryRows = await db.tournamentEntryCounts(list.map((t) => t.id));
  const countByTournament = {};
  const paidCountByTournament = {};
  for (const e of entryRows) {
    if (e.status === "withdrawn") continue;
    countByTournament[e.tournament_id] = (countByTournament[e.tournament_id] || 0) + 1;
    if (e.payment_status === "paid") {
      paidCountByTournament[e.tournament_id] = (paidCountByTournament[e.tournament_id] || 0) + 1;
    }
  }
  setView(`
    <h1>Toernooien</h1>
    <p class="sub">Aanmaken en inzien</p>
    <button class="btn mt8" onclick="openTournamentDialog()">${icon.plus} Nieuw toernooi</button>
    <div class="tournament-grid mt24">
      ${list.length ? list.map((t) => tournamentCard(t, {
          entryCount: countByTournament[t.id] || 0,
          paidCount: paidCountByTournament[t.id] || 0,
        })).join("")
        : emptyView("Nog geen toernooien", "Maak je eerste toernooi aan.", "tournament")}
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
      : emptyView("Nog geen wedstrijden", "Plan je eerste wedstrijd in.", "darts")}
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

// Een league is altijd één divisie (max 12 spelers); meerdere niveaus maak
// je als aparte leagues (bv. "1e divisie", "2e divisie").
function openLeagueDialog() {
  openModal("Nieuwe league", `
    <div class="field"><label for="ln">Naam</label><input id="ln" required placeholder="Bijv. 1e divisie"></div>
    <div class="field"><label for="ls">Seizoen</label><input id="ls" placeholder="Bijv. 2026"></div>
    <div class="field"><label for="lg">Speltype</label>
      <select id="lg"><option value="501">501</option><option value="301">301</option></select>
    </div>`, async (bg) => {
    const name = bg.querySelector("#ln").value.trim();
    if (!name) throw new Error("Vul een naam in.");
    const league = await db.createLeague({
      name,
      season: bg.querySelector("#ls").value.trim() || null,
      game_type: bg.querySelector("#lg").value,
      match_format: "best_of_legs",
      status: "draft",
      created_by: state.profile.id,
    });
    toast("League aangemaakt. Voeg spelers toe en deel ze in.");
    go("league/" + league.id);
  }, "League aanmaken");
}

// Zonder `existing` = nieuw toernooi (concept, organisator publiceert later
// door de status te wijzigen); met `existing` = bewerken van dat toernooi.
function openTournamentDialog(existing) {
  const t = existing || {};
  const isEdit = !!existing;

  openModal(isEdit ? "Toernooi bewerken" : "Nieuw toernooi", `
    <div class="field"><label for="tn">Naam</label><input id="tn" required value="${esc(t.name || "")}" placeholder="Bijv. Clubkampioenschap"></div>
    <div class="field-pair">
      <div><div class="field-pair-label">Opzet</div>
        <select id="tt">
          <option value="knockout" ${!t.tournament_type || t.tournament_type === "knockout" ? "selected" : ""}>Knock-out</option>
          <option value="groups" ${t.tournament_type === "groups" ? "selected" : ""}>Poules</option>
          <option value="groups_and_knockout" ${t.tournament_type === "groups_and_knockout" ? "selected" : ""}>Poules + knock-out</option>
        </select>
      </div>
      <div><div class="field-pair-label">Speltype</div>
        <select id="tg">
          <option value="501" ${t.game_type !== "301" ? "selected" : ""}>501</option>
          <option value="301" ${t.game_type === "301" ? "selected" : ""}>301</option>
        </select>
      </div>
    </div>
    <div class="field-pair">
      <div><div class="field-pair-label">Speelwijze</div>
        <select id="tp">
          <option value="">Onbekend</option>
          <option value="online" ${t.platform === "online" ? "selected" : ""}>Online</option>
          <option value="offline" ${t.platform === "offline" ? "selected" : ""}>Offline</option>
        </select>
      </div>
      <div><div class="field-pair-label">Scoresysteem</div>
        <select id="tsp">
          <option value="">-</option>
          <option value="scolia" ${t.scoring_platform === "scolia" ? "selected" : ""}>Scolia</option>
          <option value="dartcounter" ${t.scoring_platform === "dartcounter" ? "selected" : ""}>DartCounter</option>
        </select>
      </div>
    </div>
    <div class="field"><label for="td">Startdatum en -tijd</label><input id="td" type="datetime-local" value="${t.start_at ? fmtDatetimeLocal(t.start_at) : ""}"></div>
    <div class="field-pair">
      <div><div class="field-pair-label">Inschrijving opent</div><input id="tro" type="datetime-local" value="${t.registration_opens_at ? fmtDatetimeLocal(t.registration_opens_at) : ""}"></div>
      <div><div class="field-pair-label">Inschrijving sluit</div><input id="trc" type="datetime-local" value="${t.registration_closes_at ? fmtDatetimeLocal(t.registration_closes_at) : ""}"></div>
    </div>
    <div class="field"><label for="tmax">Maximum aantal spelers <span class="muted" style="font-weight:400">(optioneel)</span></label><input id="tmax" type="number" min="2" value="${t.max_players || ""}"></div>
    <div class="field"><label for="tstatus">Status</label>
      <select id="tstatus">
        <option value="draft" ${!t.status || t.status === "draft" ? "selected" : ""}>Concept (nog niet zichtbaar voor spelers)</option>
        <option value="active" ${t.status === "active" ? "selected" : ""}>Actief</option>
        <option value="finished" ${t.status === "finished" ? "selected" : ""}>Afgerond</option>
      </select>
    </div>
    <div class="field-pair">
      <div><div class="field-pair-label">Inschrijfgeld (€) <span class="muted" style="font-weight:400">(optioneel)</span></div>
        <input id="tfee" type="number" min="0" step="0.01" value="${t.entry_fee ?? ""}" onchange="togglePaidFields(this.value)"></div>
      <div><div class="field-pair-label">Minimum aantal spelers <span class="muted" style="font-weight:400">(optioneel)</span></div>
        <input id="tmin" type="number" min="1" value="${t.min_players ?? ""}"></div>
    </div>
    <div id="paidFields" style="display:${Number(t.entry_fee) > 0 ? "block" : "none"}">
      <div class="field"><label for="tpdh">Betaaldeadline <span class="muted" style="font-weight:400">(uren na inschrijving, optioneel)</span></label><input id="tpdh" type="number" min="1" value="${t.payment_deadline_hours ?? ""}"></div>
      <div class="field"><label for="tpinstr">Betaalinstructies <span class="muted" style="font-weight:400">(bijv. Tikkie-link/telefoonnummer)</span></label><textarea id="tpinstr" rows="2" placeholder="Bijv. Stuur € 10 via Tikkie naar 06-12345678">${esc(t.payment_instructions || "")}</textarea></div>
      <div class="field"><label for="trefpolicy">Annuleringsvoorwaarden <span class="muted" style="font-weight:400">(optioneel)</span></label><textarea id="trefpolicy" rows="2" placeholder="Bijv. Volledige terugbetaling tot 24 uur voor aanvang">${esc(t.refund_policy || "")}</textarea></div>
      <div class="field"><label for="trefcutoff">Terugbetaling mogelijk tot <span class="muted" style="font-weight:400">(uren voor aanvang, optioneel)</span></label><input id="trefcutoff" type="number" min="0" value="${t.refund_cutoff_hours ?? ""}"></div>
    </div>
    <div class="field"><label for="tprize">Prijs</label>
      <select id="tprize" onchange="togglePrizeFields(this.value)">
        <option value="none" ${!t.prize_type || t.prize_type === "none" ? "selected" : ""}>Geen prijs</option>
        <option value="money" ${t.prize_type === "money" ? "selected" : ""}>Prijzengeld</option>
        <option value="physical" ${t.prize_type === "physical" ? "selected" : ""}>Fysieke prijs</option>
        <option value="unknown" ${t.prize_type === "unknown" ? "selected" : ""}>Nog niet bekend</option>
      </select>
    </div>
    <div id="prizeMoneyFields" style="display:${t.prize_type === "money" ? "block" : "none"}">
      <div class="field"><label for="tpooltype">Prijzenpot</label>
        <select id="tpooltype" onchange="togglePoolType(this.value)">
          <option value="" ${!t.prize_pool_type ? "selected" : ""}>Vast bedrag, geen verdeling</option>
          <option value="fixed" ${t.prize_pool_type === "fixed" ? "selected" : ""}>Vast bedrag met verdeling</option>
          <option value="entry_fee_based" ${t.prize_pool_type === "entry_fee_based" ? "selected" : ""}>Berekend uit inschrijfgeld x betaalde deelnemers</option>
        </select>
      </div>
      <div id="tamountField" class="field" style="display:${t.prize_pool_type === "entry_fee_based" ? "none" : "block"}">
        <label for="tamount">Bedrag (€) <span class="muted" style="font-weight:400">(optioneel)</span></label>
        <input id="tamount" type="number" min="0" step="0.01" value="${t.prize_amount ?? ""}">
      </div>
      <div id="distField" style="display:${t.prize_pool_type ? "block" : "none"}">
        <div class="field-pair-label" style="margin-bottom:6px">Prijsverdeling per plaatsing <span class="muted" style="font-weight:400">(optioneel)</span></div>
        <div id="distRows">${renderDistRowsHtml(t.prize_distribution)}</div>
        <button type="button" class="btn ghost sm" onclick="addPrizeDistRow()">${icon.plus} Plaats toevoegen</button>
      </div>
    </div>
    <div id="prizePhysicalFields" style="display:${t.prize_type === "physical" ? "block" : "none"}">
      <div class="field"><label for="tpdesc">Omschrijving</label><input id="tpdesc" value="${esc(t.prize_description || "")}" placeholder="Bijv. Gepersonaliseerd dartshirt"></div>
    </div>
    <div class="field"><label for="tdesc">Toernooiregels <span class="muted" style="font-weight:400">(optioneel)</span></label><textarea id="tdesc" rows="3" placeholder="Regels of extra info voor deelnemers">${esc(t.description || "")}</textarea></div>`,
    async (bg) => {
      const name = bg.querySelector("#tn").value.trim();
      if (!name) throw new Error("Vul een naam in.");
      const d = bg.querySelector("#td").value;
      const ro = bg.querySelector("#tro").value;
      const rc = bg.querySelector("#trc").value;
      if (ro && rc && new Date(ro) >= new Date(rc)) {
        throw new Error("Inschrijving moet sluiten na het openen.");
      }
      const maxPlayers = bg.querySelector("#tmax").value;
      const minPlayers = bg.querySelector("#tmin").value;
      if (maxPlayers && minPlayers && Number(minPlayers) > Number(maxPlayers)) {
        throw new Error("Minimum aantal spelers kan niet hoger zijn dan het maximum.");
      }
      const entryFeeRaw = bg.querySelector("#tfee").value;
      const entryFee = entryFeeRaw !== "" ? Number(entryFeeRaw) : null;
      if (entryFee != null && entryFee < 0) throw new Error("Inschrijfgeld mag niet negatief zijn.");
      const isPaid = entryFee != null && entryFee > 0;

      const prizeType = bg.querySelector("#tprize").value;
      const poolType = bg.querySelector("#tpooltype")?.value || null;
      const amount = bg.querySelector("#tamount")?.value;
      const prizeAmount = prizeType === "money" && poolType !== "entry_fee_based" && amount ? Number(amount) : null;
      const distRows = prizeType === "money" ? [...bg.querySelectorAll(".dist-row")].map((row, i) => ({
        position: i + 1,
        type: row.querySelector(".dist-type").value,
        value: Number(row.querySelector(".dist-value").value) || 0,
      })).filter((r) => r.value > 0) : [];

      if (distRows.length) {
        const pctSum = distRows.filter((r) => r.type === "percentage").reduce((s, r) => s + r.value, 0);
        if (pctSum > 100) throw new Error("De percentages in de prijsverdeling mogen samen niet meer dan 100% zijn.");
        if (poolType === "entry_fee_based" && distRows.some((r) => r.type === "amount")) {
          throw new Error("Bij een pot op basis van inschrijfgeld zijn alleen percentages toegestaan - het totaalbedrag staat pas na afloop vast.");
        }
        if (poolType === "fixed" && prizeAmount != null) {
          const amtSum = distRows.filter((r) => r.type === "amount").reduce((s, r) => s + r.value, 0);
          if (amtSum > prizeAmount) throw new Error("De vaste bedragen in de prijsverdeling zijn hoger dan de totale pot.");
        }
      }

      const fields = {
        name,
        tournament_type: bg.querySelector("#tt").value,
        game_type: bg.querySelector("#tg").value,
        platform: bg.querySelector("#tp").value || null,
        scoring_platform: bg.querySelector("#tsp").value || null,
        start_at: d ? new Date(d).toISOString() : null,
        registration_opens_at: ro ? new Date(ro).toISOString() : null,
        registration_closes_at: rc ? new Date(rc).toISOString() : null,
        max_players: maxPlayers ? Number(maxPlayers) : null,
        status: bg.querySelector("#tstatus").value,
        entry_fee: entryFee,
        min_players: minPlayers ? Number(minPlayers) : null,
        payment_deadline_hours: isPaid && bg.querySelector("#tpdh").value ? Number(bg.querySelector("#tpdh").value) : null,
        payment_instructions: isPaid ? (bg.querySelector("#tpinstr").value.trim() || null) : null,
        refund_policy: isPaid ? (bg.querySelector("#trefpolicy").value.trim() || null) : null,
        refund_cutoff_hours: isPaid && bg.querySelector("#trefcutoff").value ? Number(bg.querySelector("#trefcutoff").value) : null,
        prize_type: prizeType,
        prize_amount: prizeAmount,
        prize_currency: "EUR",
        prize_pool_type: prizeType === "money" ? poolType : null,
        prize_distribution: distRows.length ? distRows : null,
        prize_description: prizeType === "physical" ? (bg.querySelector("#tpdesc").value.trim() || null) : null,
        description: bg.querySelector("#tdesc").value.trim() || null,
      };
      if (isEdit) {
        await db.updateTournament(t.id, fields);
        toast("Toernooi bijgewerkt");
        router();
      } else {
        const created = await db.createTournament({
          ...fields,
          match_format: "best_of_legs",
          created_by: state.profile.id,
        });
        toast("Toernooi aangemaakt");
        go("toernooien/" + created.id);
      }
    }, isEdit ? "Wijzigingen opslaan" : "Toernooi aanmaken");
}

function togglePrizeFields(prizeType) {
  const moneyEl = document.getElementById("prizeMoneyFields");
  const physicalEl = document.getElementById("prizePhysicalFields");
  if (moneyEl) moneyEl.style.display = prizeType === "money" ? "block" : "none";
  if (physicalEl) physicalEl.style.display = prizeType === "physical" ? "block" : "none";
}

function togglePaidFields(entryFeeValue) {
  const el = document.getElementById("paidFields");
  if (el) el.style.display = Number(entryFeeValue) > 0 ? "block" : "none";
}

function togglePoolType(poolType) {
  const amountField = document.getElementById("tamountField");
  const distField = document.getElementById("distField");
  if (amountField) amountField.style.display = poolType === "entry_fee_based" ? "none" : "block";
  if (distField) distField.style.display = poolType ? "block" : "none";
}

function distRowHtml(type, value) {
  return `
    <div class="dist-row" style="display:flex;gap:8px;align-items:flex-end;margin-bottom:8px">
      <div style="flex:1"><div class="field-pair-label">Type</div>
        <select class="dist-type">
          <option value="percentage" ${type !== "amount" ? "selected" : ""}>% van de pot</option>
          <option value="amount" ${type === "amount" ? "selected" : ""}>Vast bedrag (€)</option>
        </select>
      </div>
      <div style="flex:1"><div class="field-pair-label">Waarde</div>
        <input class="dist-value" type="number" min="0" step="0.01" value="${value ?? ""}">
      </div>
      <button type="button" class="btn ghost sm" onclick="this.closest('.dist-row').remove()">✕</button>
    </div>`;
}

function renderDistRowsHtml(dist) {
  const arr = Array.isArray(dist) ? [...dist].sort((a, b) => a.position - b.position) : [];
  return arr.map((d) => distRowHtml(d.type, d.value)).join("");
}

function addPrizeDistRow() {
  document.getElementById("distRows")?.insertAdjacentHTML("beforeend", distRowHtml("percentage", ""));
}

async function openEditTournamentDialog(id) {
  try {
    const t = await db.tournament(id);
    if (!t) return toast("Toernooi niet gevonden.");
    openTournamentDialog(t);
  } catch (e) { toast(errText(e)); }
}

async function registerForTournament(id) {
  try {
    await db.registerForTournament(id);
    toast("Je bent ingeschreven!");
    router();
  } catch (e) { toast(errText(e)); }
}

async function withdrawFromTournament(id) {
  try {
    await db.withdrawFromTournament(id);
    toast("Je bent uitgeschreven.");
    router();
  } catch (e) { toast(errText(e)); }
}

function openSubmitPaymentDialog(entryId) {
  openModal("Betaling melden", `
    <p class="muted" style="font-size:13px;margin:0 0 12px">Meld dit pas nadat je het bedrag daadwerkelijk via Tikkie hebt overgemaakt. De organisator controleert dit voordat je inschrijving definitief wordt.</p>
    <div class="field"><label for="spr">Referentie <span class="muted" style="font-weight:400">(optioneel, bijv. Tikkie-omschrijving)</span></label><input id="spr" placeholder="Bijv. TIKKIE-123"></div>`,
    async (bg) => {
      const ref = bg.querySelector("#spr").value.trim() || null;
      await db.submitTournamentPayment(entryId, ref);
      toast("Betaling gemeld. De organisator controleert dit.");
      router();
    }, "Ik heb betaald");
}

function openConfirmPaymentDialog(entryId, defaultAmount, currency) {
  openModal("Betaling bevestigen", `
    <p class="muted" style="font-size:13px;margin:0 0 12px">Bevestig pas nadat je het bedrag daadwerkelijk in je eigen Tikkie-overzicht ziet staan.</p>
    <div class="field"><label for="cpa">Ontvangen bedrag (${esc(currency || "EUR")})</label><input id="cpa" type="number" min="0" step="0.01" value="${defaultAmount ?? ""}" required></div>`,
    async (bg) => {
      const amount = Number(bg.querySelector("#cpa").value);
      if (bg.querySelector("#cpa").value === "" || isNaN(amount) || amount < 0) throw new Error("Vul een geldig bedrag in.");
      await db.confirmTournamentPayment(entryId, amount);
      toast("Betaling bevestigd.");
      router();
    }, "Bevestigen");
}

function openRejectPaymentDialog(entryId) {
  openModal("Betaling afwijzen", `
    <div class="field"><label for="rpr">Reden <span class="muted" style="font-weight:400">(optioneel, wordt getoond aan de speler)</span></label><input id="rpr" placeholder="Bijv. bedrag niet ontvangen"></div>`,
    async (bg) => {
      const reason = bg.querySelector("#rpr").value.trim() || null;
      await db.rejectTournamentPayment(entryId, reason);
      toast("Betaling afgewezen. De plek is vrijgegeven.");
      router();
    }, "Afwijzen", true);
}

function openRefundConfirm(entry, currency) {
  if (!entry) return;
  const name = entry.player?.display_name || "deze speler";
  const amount = entry.amount_paid ?? 0;
  openModal("Terugbetaling registreren", `
    <p style="margin:0 0 4px">Bevestig dat je <strong style="color:var(--white)">${esc(fmtMoney(amount, currency))}</strong> hebt teruggestort aan <strong style="color:var(--white)">${esc(name)}</strong> via Tikkie.</p>
    <p class="muted" style="font-size:13px;margin:0">Dit registreert alleen dat de terugbetaling is gedaan - de app maakt zelf geen geld over.</p>`,
    async () => {
      await db.refundTournamentEntry(entry.id);
      toast("Terugbetaling geregistreerd.");
      router();
    }, "Terugbetaling registreren");
}

function openSetPayoutDialog(tournamentId, entries) {
  const opts = entries.map((e) => `<option value="${esc(e.player_id)}">${esc(e.player?.display_name || "?")}</option>`).join("");
  openModal("Uitbetaling toevoegen", `
    <div class="field"><label for="poPlace">Plaatsing</label><input id="poPlace" type="number" min="1" value="1" required></div>
    <div class="field"><label for="poPlayer">Speler</label><select id="poPlayer">${opts}</select></div>
    <div class="field"><label for="poAmount">Bedrag (€)</label><input id="poAmount" type="number" min="0" step="0.01" required></div>`,
    async (bg) => {
      const placement = Number(bg.querySelector("#poPlace").value);
      const playerId = bg.querySelector("#poPlayer").value;
      const amount = Number(bg.querySelector("#poAmount").value);
      if (!placement || placement < 1) throw new Error("Vul een geldige plaatsing in.");
      if (!playerId) throw new Error("Kies een speler.");
      if (bg.querySelector("#poAmount").value === "" || isNaN(amount) || amount < 0) throw new Error("Vul een geldig bedrag in.");
      await db.setTournamentPayout(tournamentId, playerId, placement, amount, "EUR");
      toast("Uitbetaling vastgelegd.");
      router();
    }, "Opslaan");
}

async function approvePayoutAction(payoutId) {
  try {
    await db.approveTournamentPayout(payoutId);
    toast("Uitbetaling goedgekeurd.");
    router();
  } catch (e) { toast(errText(e)); }
}

function openMarkPayoutPaidDialog(payoutId) {
  openModal("Uitbetaling registreren", `
    <p class="muted" style="font-size:13px;margin:0 0 12px">Registreer dit pas nadat je het bedrag daadwerkelijk via Tikkie hebt overgemaakt.</p>
    <div class="field"><label for="mpr">Referentie <span class="muted" style="font-weight:400">(optioneel)</span></label><input id="mpr" placeholder="Bijv. Tikkie-omschrijving"></div>`,
    async (bg) => {
      const ref = bg.querySelector("#mpr").value.trim() || null;
      await db.markTournamentPayoutPaid(payoutId, ref);
      toast("Uitbetaling geregistreerd als betaald.");
      router();
    }, "Als betaald markeren");
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
  const legsToWin = Math.floor(legsPerMatch / 2) + 1;
  const drawLegs = legsPerMatch / 2;
  const canDraw = Number.isInteger(drawLegs);

  openModal("Uitslag doorgeven", `
    <p class="sub" style="margin-bottom:18px">
      Zodra een speler ${legsToWin} legs wint is de wedstrijd beslist - jullie hoeven dan niet alle ${legsPerMatch} legs te spelen.
      ${canDraw ? `Bij ${drawLegs}-${drawLegs} is het gelijkspel.` : ""}
      Je tegenstander moet de uitslag bevestigen voor het meetelt.
    </p>

    <div class="field">
      <label>Wie heeft gewonnen?</label>
      <div class="chips" role="radiogroup" aria-label="Winnaar">
        <label class="chip"><input type="radio" name="winner" value="${esc(a.id)}" class="sr">${esc(aName)}</label>
        <label class="chip"><input type="radio" name="winner" value="draw" class="sr">Gelijkspel</label>
        <label class="chip"><input type="radio" name="winner" value="${esc(b.id)}" class="sr">${esc(bName)}</label>
      </div>
    </div>

    <div class="field">
      <label>Gewonnen legs <span class="muted" style="font-weight:400">(max ${legsToWin} per speler)</span></label>
      <div class="field-pair">
        <div><div class="field-pair-label">${esc(aName)}</div><input id="ra" type="number" min="0" max="${legsToWin}" value="0" required></div>
        <div><div class="field-pair-label">${esc(bName)}</div><input id="rb" type="number" min="0" max="${legsToWin}" value="0" required></div>
      </div>
    </div>

    <div class="field">
      <label>Gemiddelde</label>
      <div class="field-pair">
        <input id="avga" type="number" step="0.1" min="0" max="180" placeholder="${esc(aName)}" required>
        <input id="avgb" type="number" step="0.1" min="0" max="180" placeholder="${esc(bName)}" required>
      </div>
    </div>

    <div class="field">
      <label>180's</label>
      <div class="field-pair">
        <input id="s180a" type="number" min="0" max="99" placeholder="${esc(aName)}" required>
        <input id="s180b" type="number" min="0" max="99" placeholder="${esc(bName)}" required>
      </div>
    </div>

    <div class="field">
      <label>Hoogste finish</label>
      <div class="field-pair">
        <input id="coa" type="number" min="0" max="170" placeholder="${esc(aName)}" required>
        <input id="cob" type="number" min="0" max="170" placeholder="${esc(bName)}" required>
      </div>
    </div>

    <div class="row-title" style="font-size:14px;margin:4px 0 12px">Meer statistieken</div>
    <div class="field">
      <label>Scoring</label>
      <div class="field-pair">
        <input id="scora" type="number" step="0.1" min="0" max="180" placeholder="${esc(aName)}" required>
        <input id="scorb" type="number" step="0.1" min="0" max="180" placeholder="${esc(bName)}" required>
      </div>
    </div>
    <div class="field">
      <label>Eerste 9 gem.</label>
      <div class="field-pair">
        <input id="f9a" type="number" step="0.1" min="0" max="180" placeholder="${esc(aName)}" required>
        <input id="f9b" type="number" step="0.1" min="0" max="180" placeholder="${esc(bName)}" required>
      </div>
    </div>
    <div class="field">
      <label>Checkouts geraakt</label>
      <div class="field-pair">
        <input id="cha" type="number" min="0" placeholder="${esc(aName)}" required>
        <input id="chb" type="number" min="0" placeholder="${esc(bName)}" required>
      </div>
    </div>
    <div class="field">
      <label>Checkout pogingen</label>
      <div class="field-pair">
        <input id="caa" type="number" min="0" placeholder="${esc(aName)}" required>
        <input id="cab" type="number" min="0" placeholder="${esc(bName)}" required>
      </div>
    </div>
    <div class="field">
      <label>Worpen</label>
      <div class="field-pair">
        <input id="dta" type="number" min="0" placeholder="${esc(aName)}" required>
        <input id="dtb" type="number" min="0" placeholder="${esc(bName)}" required>
      </div>
    </div>
    <div class="field">
      <label>Beste leg <span class="muted" style="font-weight:400">(darts)</span></label>
      <div class="field-pair">
        <input id="bla" type="number" min="0" placeholder="${esc(aName)}" required>
        <input id="blb" type="number" min="0" placeholder="${esc(bName)}" required>
      </div>
    </div>
    <div class="field">
      <label>60+</label>
      <div class="field-pair">
        <input id="s60a" type="number" min="0" placeholder="${esc(aName)}" required>
        <input id="s60b" type="number" min="0" placeholder="${esc(bName)}" required>
      </div>
    </div>
    <div class="field">
      <label>80+</label>
      <div class="field-pair">
        <input id="s80a" type="number" min="0" placeholder="${esc(aName)}" required>
        <input id="s80b" type="number" min="0" placeholder="${esc(bName)}" required>
      </div>
    </div>
    <div class="field">
      <label>100+</label>
      <div class="field-pair">
        <input id="s100a" type="number" min="0" placeholder="${esc(aName)}" required>
        <input id="s100b" type="number" min="0" placeholder="${esc(bName)}" required>
      </div>
    </div>
    <div class="field">
      <label>140+</label>
      <div class="field-pair">
        <input id="s140a" type="number" min="0" placeholder="${esc(aName)}" required>
        <input id="s140b" type="number" min="0" placeholder="${esc(bName)}" required>
      </div>
    </div>`, async (bg) => {
    const winner = bg.querySelector("input[name=winner]:checked")?.value;
    if (!winner) throw new Error("Kies wie er gewonnen heeft, of gelijkspel.");
    const aLegs = parseInt(bg.querySelector("#ra").value, 10);
    const bLegs = parseInt(bg.querySelector("#rb").value, 10);
    if (isNaN(aLegs) || isNaN(bLegs)) throw new Error("Vul beide legscores in.");
    if (aLegs + bLegs > legsPerMatch) throw new Error(`Samen mogen de legs niet meer dan ${legsPerMatch} zijn.`);
    if (aLegs === bLegs) {
      if (aLegs !== drawLegs) throw new Error(canDraw ? `Een gelijkspel kan alleen bij ${drawLegs}-${drawLegs}.` : `Bij ${legsPerMatch} legs is een gelijkspel niet mogelijk.`);
      if (winner !== "draw") throw new Error("Bij gelijke legs is het een gelijkspel.");
    } else {
      if (Math.max(aLegs, bLegs) !== legsToWin) throw new Error(`Zodra een speler ${legsToWin} legs wint is de wedstrijd beslist.`);
      if (winner === "draw") throw new Error("De legs zijn niet gelijk, dus kies wie er gewonnen heeft.");
      if ((aLegs > bLegs && winner !== a.id) || (bLegs > aLegs && winner !== b.id)) {
        throw new Error("De gekozen winnaar komt niet overeen met de legscore.");
      }
    }
    const num = (sel) => {
      const v = bg.querySelector(sel).value;
      return v === "" ? null : Number(v);
    };
    const requiredIds = ["#avga", "#avgb", "#s180a", "#s180b", "#coa", "#cob",
      "#scora", "#scorb", "#f9a", "#f9b", "#cha", "#chb", "#caa", "#cab",
      "#dta", "#dtb", "#bla", "#blb", "#s60a", "#s60b", "#s80a", "#s80b",
      "#s100a", "#s100b", "#s140a", "#s140b"];
    if (requiredIds.some((sel) => num(sel) === null)) {
      throw new Error("Vul alle statistieken in voor beide spelers (Gemiddelde, 180's, Hoogste finish, Scoring, Eerste 9 gem., Checkouts, Worpen, Beste leg, 60+/80+/100+/140+).");
    }
    await db.reportResult(matchId, {
      winnerId: winner === "draw" ? null : winner,
      aLegs, bLegs,
      aAverage: num("#avga"), bAverage: num("#avgb"),
      a180s: num("#s180a"), b180s: num("#s180b"),
      aCheckout: num("#coa"), bCheckout: num("#cob"),
      extraA: {
        scoring_average: num("#scora"), first9_average: num("#f9a"),
        checkouts_hit: num("#cha"), checkout_attempts: num("#caa"),
        darts_thrown: num("#dta"), best_leg_darts: num("#bla"),
        score_60_plus: num("#s60a"), score_80_plus: num("#s80a"),
        score_100_plus: num("#s100a"), score_140_plus: num("#s140a"),
      },
      extraB: {
        scoring_average: num("#scorb"), first9_average: num("#f9b"),
        checkouts_hit: num("#chb"), checkout_attempts: num("#cab"),
        darts_thrown: num("#dtb"), best_leg_darts: num("#blb"),
        score_60_plus: num("#s60b"), score_80_plus: num("#s80b"),
        score_100_plus: num("#s100b"), score_140_plus: num("#s140b"),
      },
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
  // Extra statistieken alleen tonen als er voor minstens één speler iets is
  // ingevuld - anders een lange rij "– – –" voor wedstrijden waar alleen de
  // basis (legs/gemiddelde) is doorgegeven.
  const rowIf = (label, av, bv) => (av != null || bv != null) ? row(label, av, bv) : "";
  const checkoutPct = (hit, attempts) => (hit != null && attempts) ? `${((hit / attempts) * 100).toFixed(2)}%` : null;
  const checkoutFraction = (hit, attempts) => (hit != null || attempts != null) ? `${hit ?? "–"}/${attempts ?? "–"}` : null;

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
        ${rowIf("Scoring", m.player_a_scoring_average, m.player_b_scoring_average)}
        ${rowIf("Eerste 9 gem.", m.player_a_first9_average, m.player_b_first9_average)}
        ${rowIf("Checkout %", checkoutPct(m.player_a_checkouts_hit, m.player_a_checkout_attempts), checkoutPct(m.player_b_checkouts_hit, m.player_b_checkout_attempts))}
        ${rowIf("Checkouts", checkoutFraction(m.player_a_checkouts_hit, m.player_a_checkout_attempts), checkoutFraction(m.player_b_checkouts_hit, m.player_b_checkout_attempts))}
        ${row("Hoogste finish", m.player_a_highest_checkout, m.player_b_highest_checkout)}
        ${rowIf("Worpen", m.player_a_darts_thrown, m.player_b_darts_thrown)}
        ${rowIf("Beste leg", m.player_a_best_leg_darts, m.player_b_best_leg_darts)}
        ${rowIf("60+", m.player_a_score_60_plus, m.player_b_score_60_plus)}
        ${rowIf("80+", m.player_a_score_80_plus, m.player_b_score_80_plus)}
        ${rowIf("100+", m.player_a_score_100_plus, m.player_b_score_100_plus)}
        ${rowIf("140+", m.player_a_score_140_plus, m.player_b_score_140_plus)}
        ${row("180's", m.player_a_180s, m.player_b_180s)}
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

// Supabase plakt na een activatie-/herstellink de tokens (of, bij een
// verlopen/ongeldige link, een foutmelding) als key=value-paren achter de
// redirectTo-URL - als hash-fragment, als querystring, of allebei, en soms
// nog met onze eigen "#/geactiveerd"-route ervoor. In plaats van te gokken
// naar de precieze vorm: hash én query samenvoegen en alles zonder "="
// (zoals onze eigen routenaam) weggooien, dan simpel als een key/value-set
// lezen. Werkt hierdoor ook onaangetast door voor normale routes (#/leagues
// e.d. bevatten geen "=").
function parseAuthRedirectParams() {
  const raw = (location.hash.slice(1) + "&" + location.search.slice(1))
    .split(/[&?]/)
    .filter((s) => s.includes("="))
    .join("&");
  return new URLSearchParams(raw);
}

// Live pop-up zodra er een nieuwe melding binnenkomt (bv. "wedstrijd
// ingepland" of "nieuwe wedstrijd beschikbaar"), zonder dat de speler de
// pagina hoeft te verversen. RLS blijft van toepassing op de stream.
let notificationsChannel = null;

function subscribeToNotifications(playerId) {
  notificationsChannel?.unsubscribe();
  notificationsChannel = sb
    .channel(`notifications:${playerId}`)
    .on("postgres_changes", {
      event: "INSERT", schema: "public", table: "notifications", filter: `player_id=eq.${playerId}`,
    }, (payload) => {
      const n = payload.new;
      toast(n.body ? `${n.title} — ${n.body}` : n.title);
    })
    .subscribe();
}

function unsubscribeFromNotifications() {
  notificationsChannel?.unsubscribe();
  notificationsChannel = null;
}

// VAPID-publieke sleutel (base64url) omzetten naar de Uint8Array die de
// Push API verwacht als applicationServerKey.
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

// Pushmeldingen op dit toestel inschakelen: registreert de service worker,
// vraagt toestemming, en slaat het abonnement op zodat send-push-
// notifications er meldingen naartoe kan sturen. Vereist een expliciete
// gebruikersactie (knop) - browsers staan geen stille aanvraag toe.
async function enablePushNotifications() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return toast("Pushmeldingen worden niet ondersteund op dit toestel of in deze browser.");
  }
  try {
    const reg = await navigator.serviceWorker.register("/sw.js");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return toast("Toestemming voor meldingen geweigerd.");
    }
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    const json = sub.toJSON();
    await db.savePushSubscription({
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    });
    toast("Pushmeldingen ingeschakeld op dit toestel.");
  } catch (e) {
    toast(errText(e));
  }
}

function init() {
  if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes("JOUW-PROJECT")) {
    return configMissing();
  }

  const authParams = parseAuthRedirectParams();
  const authType = authParams.get("type");
  const authError = authParams.get("error") || authParams.get("error_code");

  // Bij een fout is er geen sessie te herstellen uit de URL - de rommelige
  // hash meteen opruimen zodat de router hem niet als onbekende route ziet.
  if (authError) {
    history.replaceState(null, "", location.pathname);
  }

  sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  // Bij een geslaagde activatie meldt Supabase alleen het generieke
  // "SIGNED_IN"-event (anders dan "PASSWORD_RECOVERY" bij een resetlink) -
  // dit onthoudt dat we net van een activatielink komen, zodat we in plaats
  // van gewoon in te loggen het bevestigingsscherm tonen.
  let awaitingSignupConfirmation = authType === "signup";
  let skipNextSignedOutRender = false;

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
      unsubscribeFromNotifications();
      if (skipNextSignedOutRender) { skipNextSignedOutRender = false; return; }
      return renderLanding();
    }
    if (!wasLoggedIn) {
      state.profile = await db.myProfile(session.user.id).catch(() => null);
      state.onboarding = await db.myOnboarding(session.user.id).catch(() => null);
      if (awaitingSignupConfirmation) {
        awaitingSignupConfirmation = false;
        // De gebruiker moet zelf inloggen (zie de gewenste flow); niet
        // await'en, anders wint de renderLanding() van de resulterende
        // SIGNED_OUT-event het van het bevestigingsscherm hieronder.
        skipNextSignedOutRender = true;
        sb.auth.signOut();
        return renderSignupConfirmed();
      }
      if (state.profile) subscribeToNotifications(session.user.id);
      if (!location.hash || location.hash === "#/nieuw-wachtwoord") location.hash = "#/";
      router();
    }
  });

  window.addEventListener("hashchange", router);

  if (authError) {
    return renderSignupLinkError();
  }
  boot();
}

init();
