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
  draft: { label: "Draft", color: "#6B7280" },
  active: { label: "Active", color: "#2ECC71" },
  finished: { label: "Finished", color: "#9B7BD9" },
  scheduled: { label: "Scheduled", color: "#4EA1F7" },
  in_progress: { label: "In progress", color: "#F47B20" },
  pending_confirmation: { label: "Awaiting confirmation", color: "#F5B942" },
  confirmed: { label: "Confirmed", color: "#2ECC71" },
  cancelled: { label: "Cancelled", color: "#E74C3C" },
};

const TOURNAMENT_TYPES = {
  knockout: "Knockout",
  groups: "Groups",
  groups_and_knockout: "Groups + knockout",
};

const GARMENT_LABELS = { tshirt: "T-shirt", hoodie: "Hoodie", polo: "Polo" };
const SIZE_LABELS = { xs: "XS", s: "S", m: "M", l: "L", xl: "XL", xxl: "XXL", xxxl: "XXXL" };

// Statussen van een prijsclaim: label voor de winnaar (vriendelijk, geen
// interne termen) en voor de organisator (exacte statusnaam), plus kleur.
const PRIZE_STATUS = {
  available:         { label: "Available",              color: "#4EA1F7" },
  claim_started:     { label: "Claim in progress",         color: "#4EA1F7" },
  claimed:           { label: "Claim submitted",        color: "#F5B942" },
  reviewing:         { label: "Under review",          color: "#F5B942" },
  contact_pending:   { label: "Contact to follow",         color: "#F5B942" },
  confirmed:         { label: "Confirmed",                 color: "#2ECC71" },
  in_production:     { label: "Being made",             color: "#9B7BD9" },
  ready:             { label: "Ready for pickup",      color: "#2ECC71" },
  delivered:         { label: "Delivered",                color: "#2ECC71" },
  cancelled:         { label: "Cancelled",                color: "#6B7280" },
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
  return d.toLocaleDateString("en-GB", opts);
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
  if (/Invalid login credentials/i.test(m)) return "Email address or password is incorrect.";
  if (/Email not confirmed/i.test(m)) return "Confirm your email address via the link in your inbox first.";
  if (/User already registered/i.test(m)) return "An account with this email address already exists.";
  if (/Password should be at least/i.test(m)) return "Your password must be at least 6 characters.";
  if (/rate limit|too many/i.test(m)) return "Too many attempts. Wait a moment and try again.";
  if (/Failed to fetch|NetworkError/i.test(m)) return "No connection to the server. Check your internet.";
  return m || "Something went wrong.";
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
      <div class="state-title">Something went wrong</div>
      <div class="state-sub">${esc(errText(error))}</div>
      <button class="btn ghost sm mt16" onclick="location.reload()">Reload</button>
    </div>`;
}

// Vertaalt de ruwe wedstrijdstatus + beschikbaarheid/voorstel naar een van
// de spelersvriendelijke statussen. Puur berekend voor weergave - de
// onderliggende status-kolom (die rapporteren/bevestigen/statistieken
// aanstuurt) blijft ongewijzigd.
function matchDisplayStatus(m) {
  if (m.status === "cancelled") return { label: "Cancelled", color: "#E74C3C" };
  if (m.status === "confirmed") return { label: "Played", color: "#2ECC71" };
  if (m.available_at && new Date(m.available_at) > new Date()) {
    return { label: "Not started yet", color: "#6B7280" };
  }
  const p = m.schedule_proposal;
  if (p) {
    if (p.status === "accepted") return { label: "Time confirmed", color: "#2ECC71" };
    if (p.status === "pending" || p.status === "countered" || p.status === "disputed") {
      return { label: "Time proposed", color: "#F5B942" };
    }
  }
  return { label: "Available", color: "#4EA1F7" };
}

function matchStatusBadge(m) {
  const s = matchDisplayStatus(m);
  return `<span class="badge" style="color:${s.color};border-color:${s.color}66;background:${s.color}22">${esc(s.label)}</span>`;
}

// Beschikbaarheidstekst onder een nog niet gespeelde wedstrijd.
function matchAvailabilityLine(m, status) {
  if (status.label === "Not started yet" && m.available_at) {
    return `<div class="match-meta" style="margin-top:4px">Available from ${esc(fmtDate(m.available_at, false))}</div>`;
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
          ${avatar(a, "sm")}<span class="mp-name">${esc(a?.display_name || "Player A")}</span>
        </div>
        <span class="vs">VS</span>
        <div class="mp right ${bWin ? "winner" : ""}">
          ${avatar(b, "sm")}<span class="mp-name">${esc(b?.display_name || "Player B")}</span>
        </div>
      </div>
      ${played ? `
        <div class="match-score">
          <span class="score ${aWin ? "win" : ""}">${m.player_a_legs}</span>
          <span class="score-sep">-</span>
          <span class="score ${bWin ? "win" : ""}">${m.player_b_legs}</span>
        </div>
        ${isDraw ? `<div class="center muted" style="font-size:12.5px;margin-top:4px">Draw</div>` : ""}` : ""}
      ${m.scheduled_at ? `<div class="match-meta">${icon.clock}<span>${esc(fmtDate(m.scheduled_at))}</span></div>` : ""}
      ${!played && m.status !== "cancelled" ? matchAvailabilityLine(m, status) : ""}
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
  draft: "Draft",
  upcoming: "Coming up",
  registration_open: "Registration open",
  registration_closed: "Registration closed",
  full: "Full",
  in_progress: "In progress",
  finished: "Finished",
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

function tournamentMatchFormatLabel(t) {
  return t.match_format === "best_of_sets"
    ? `best of ${t.sets_per_match} sets (first to ${t.legs_per_set})`
    : `best of ${t.legs_per_match}`;
}

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
    upcoming: "Registration hasn't opened yet.",
    registration_closed: "Registration is closed.",
    full: "This tournament is full.",
    in_progress: "This tournament has already started.",
    finished: "This tournament has finished.",
    draft: "This tournament hasn't been published yet.",
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

function ordinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  if (n % 10 === 1) return `${n}st`;
  if (n % 10 === 2) return `${n}nd`;
  if (n % 10 === 3) return `${n}rd`;
  return `${n}th`;
}

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
      <div class="row-title" style="font-size:14px">Prize money</div>
      ${pool
        ? `<div class="row-sub" style="white-space:normal">${esc(fmtMoney(pool.amount, t.prize_currency))}${pool.pending ? ` <span class="muted">(voorlopig, o.b.v. ${pool.paidCount} betaalde deelnemer${pool.paidCount === 1 ? "" : "s"})</span>` : ""}</div>`
        : (t.prize_amount != null ? `<div class="row-sub" style="white-space:normal">${esc(fmtPrizeAmount(t))}</div>` : "")}
      ${lines.length ? `<div class="muted" style="font-size:12.5px;margin-top:2px">${esc(lines.join(" · "))}</div>` : ""}`;
  }
  if (t.prize_type === "physical") {
    return `
      <div class="row-title" style="font-size:14px">Physical prize</div>
      ${t.prize_description ? `<div class="row-sub" style="white-space:normal">${esc(t.prize_description)}</div>` : ""}`;
  }
  if (t.prize_type === "unknown") {
    return `<div class="row-title" style="font-size:14px;white-space:normal">Prize to be announced later</div>`;
  }
  return `<div class="muted" style="font-size:14px">No prize</div>`;
}

const PAYMENT_STATUS_LABELS = {
  pending: "Payment not yet reported",
  submitted: "Payment reported, awaiting confirmation",
  paid: "Payment confirmed",
  failed: "Payment rejected/expired",
  refunded: "Refunded",
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
    `${t.game_type} · ${tournamentMatchFormatLabel(t)}`,
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
        <span>${entryCount}${t.max_players ? `/${t.max_players}` : ""} players</span>
        ${isMine ? `<span style="color:var(--accent);font-weight:600">You're taking part</span>` : ""}
      </div>
      ${t.entry_fee > 0 ? `<div class="muted" style="font-size:13px;margin-bottom:8px">Entry fee: ${esc(fmtMoney(t.entry_fee, t.prize_currency))}</div>` : ""}
      <div style="margin-bottom:14px">${prizeLine(t, paidCount)}</div>
      <button class="btn ghost sm block" onclick="go('toernooien/${esc(t.id)}')">View tournament</button>
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
      groups.set(key, { id: key, name: r.divisionName || "No division", rank: r.divisionRank, rows: [] });
    }
    groups.get(key).rows.push(r);
  }
  const list = [...groups.values()];
  list.sort((a, b) => a.rank - b.rank);
  return list;
}

// Toont een divisie als kaart: naam, aantal spelers, en de ranglijst met
// punten, W-D-L, legsaldo en gemiddelde. `opts.meId` markeert de kaart en de
// rij van de ingelogde speler ("Your division"). `opts.divisionCount` bepaalt
// - samen met group.rank - of promotie/degradatie-pijltjes getoond worden;
// dit is altijd een voorspelling op basis van de huidige (mogelijk nog
// lopende) tussenstand, niet een definitief resultaat.
// Kleine stip-reeks voor de "vorm" van een speler: laatste (max 5) bevestigde
// resultaten, oudste eerst.
function formDots(form, compact = false) {
  const colorFor = { W: "#2ECC71", D: "#8A93AA", L: "#E74C3C" };
  const labelFor = { W: "Won", D: "Draw", L: "Lost" };
  if (!form || !form.length) return compact ? `<span class="muted">&mdash;</span>` : "";
  return `<div style="display:flex;gap:3px;${compact ? "" : "margin-top:4px"}">
    ${form.map((f) => `<span style="width:7px;height:7px;border-radius:50%;background:${colorFor[f] || "#8A93AA"};display:inline-block" title="${labelFor[f] || f}"></span>`).join("")}
  </div>`;
}

// Volledige standentabel van een divisie: #, speler, punten, gespeeld,
// W/D/L, vorm, legs voor/tegen, saldo en gemiddelde - horizontaal
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
            ? "Not placed by the admin yet"
            : `${group.rows.length}/12 players`}</div>
        </div>
        ${isMyDivision ? `<span class="badge" style="color:#F47B20;border-color:#F47B2066;background:#F47B2022">Your division</span>` : ""}
      </div>
      ${group.rows.length ? `
      <div class="table-scroll">
        <table class="standings-table">
          <thead>
            <tr>
              <th>#</th><th>Player</th><th>Pts</th><th>Pld</th><th>W</th><th>D</th><th>L</th>
              <th>Form</th><th>Legs+</th><th>Legs-</th><th>Diff</th><th>Avg</th>
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
                    <span>${esc(r.player?.display_name || "?")}${isMe ? ` <span class="muted" style="font-weight:400">(you)</span>` : ""}</span>
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
        : `<p class="muted" style="font-size:13.5px;margin:0">No players in this division yet.</p>`}
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

  // Standings per divisie: punten (2 win / 1 gelijk / 0 verlies), legsaldo en
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

  async markTournamentEntryTikkieSent(entryId) {
    const { error } = await sb.from("tournament_entries")
      .update({ tikkie_sent_at: new Date().toISOString() })
      .eq("id", entryId);
    if (error) throw error;
  },

  // Alle (niet-ingetrokken + ingetrokken) inschrijvingen voor een set
  // toernooien in één keer - voor aantallen/"My tournaments" op de
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

  // Report result. Draait via een security-definer functie in de
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

  // Confirm telt de wedstrijd mee in player_statistics (in de database).
  async confirmMatch(matchId) {
    const { error } = await sb.rpc("confirm_league_match_result", { p_match_id: matchId });
    if (error) throw error;
  },

  // Reject zet de wedstrijd terug naar 'scheduled' zodat de uitslag
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
  btnEl.textContent = "Working...";
  const error = await resendSignupEmail(email);
  if (error) {
    btnEl.disabled = false;
    btnEl.textContent = "Resend activation email";
    return toast(errText(error));
  }
  toast(`New activation email sent to ${email}`);
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
        <div style="display:flex;align-items:center;gap:10px">
          <button class="btn ghost sm" onclick="renderLogin()">Log in</button>
        </div>
      </div>

      <div class="landing-wrap">
        <div class="landing-hero-panel">
          <div class="landing-hero-ring" aria-hidden="true"></div>
          <div class="landing-hero-inner">
            <span class="landing-eyebrow">${icon.target}&nbsp;For every darts player</span>
            <h1 class="landing-wordmark">Dart League</h1>
            <p class="sub">Join leagues and tournaments, schedule your matches and track your scores and stats automatically &mdash; all in one place.</p>
            <div class="landing-cta">
              <button class="btn" onclick="renderRegister()">Create a free account</button>
              <button class="btn ghost" onclick="renderLogin()">Log in</button>
              <button class="btn ghost" onclick="document.getElementById('hoe-het-werkt').scrollIntoView({behavior:'smooth'})">How it works</button>
            </div>
            <p class="landing-hero-note">Free to use &middot; no credit card needed</p>
            <p class="landing-hero-note" style="margin-top:4px">For Scolia and DartCounter</p>
          </div>
        </div>

        <div class="landing-notice">
          ${icon.shield}
          <span>Log in to see your league's standings, matches and statistics.</span>
        </div>

        <div class="landing-section">
          <h2>This is what your standings look like</h2>
          <p class="sub">An example &mdash; your own numbers will appear once you join.</p>
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
              ${tile("#2ECC71", "Win ratio", "68%", "Sanne")}
              ${tile("#4EA1F7", "Average", "58.4", "Rick")}
              ${tile("#F5B942", "180's", "24", "Sanne")}
              ${tile("#9B7BD9", "Best finish", "121", "Rick")}
            </div>
          </div>
        </div>

        <div class="landing-section" id="hoe-het-werkt">
          <h2>How it works</h2>
          <div class="landing-step-list">
            ${step("01", "Create an account", "Signed up within a minute, no hassle.")}
            ${step("02", "Join a league or tournament", "The admin sets them up for you, you just join in.")}
            ${step("03", "Play and track your progress", "Standings, results and statistics are ready right away.")}
          </div>
        </div>

        <div class="landing-section">
          <h2>What you get</h2>
          <div class="landing-feature-grid">
            ${feature("01", "Automatic standings", "Every finished match updates the leaderboard instantly.")}
            ${feature("02", "Personal statistics", "Average, 180s, checkouts and win ratio per player.")}
            ${feature("03", "Admin dashboard", "Manage leagues and tournaments from a single overview.")}
            ${feature("04", "Use it anywhere", "Works in the browser, on phone, tablet and desktop.")}
          </div>
        </div>

        <div class="landing-final">
          <h2>Ready to join in?</h2>
          <p>Create a free account and play your first match within a minute.</p>
          <button class="btn" onclick="renderRegister()">Create a free account</button>
        </div>
      </div>

      <div class="landing-foot">© ${new Date().getFullYear()} Dart League</div>
    </div>`;
}

function renderLogin() {
  app.innerHTML = authShell(
    "Dart League",
    "Log in to see your matches",
    `<form id="f" novalidate>
      <div class="field">
        <label for="email">Email address</label>
        <input id="email" type="email" autocomplete="email" required>
      </div>
      <div class="field">
        <label for="pw">Password</label>
        <input id="pw" type="password" autocomplete="current-password" required>
      </div>
      <button class="btn block" id="submit" type="submit">Log in</button>
      <div class="center mt16">
        <button class="linkbtn" type="button" onclick="renderForgot()">Forgot password?</button>
      </div>
    </form>`,
    `<div class="auth-alt">Don't have an account yet?
      <button class="linkbtn" onclick="renderRegister()">Create one</button>
    </div>`
  );

  document.getElementById("f").onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById("submit");
    const email = document.getElementById("email").value.trim();
    const pw = document.getElementById("pw").value;
    if (!email || !pw) return showAuthError("Enter your email address and password.");
    busy(btn, true);
    const { error } = await sb.auth.signInWithPassword({ email, password: pw });
    if (error) {
      busy(btn, false, "Log in");
      const unconfirmed = /Email not confirmed/i.test(error.message || "");
      showAuthError(errText(error), unconfirmed
        ? `<button type="button" class="linkbtn" style="padding:0;margin-top:8px" onclick="handleResendClick('${esc(email)}', this)">Resend activation email</button>`
        : "");
    }
    // Bij succes neemt onAuthStateChange het over.
  };
}

function renderRegister() {
  app.innerHTML = authShell(
    "Create account",
    "You'll be playing within a minute",
    `<form id="f" novalidate>
      <div class="field">
        <label for="name">Name</label>
        <input id="name" type="text" autocomplete="name" required>
      </div>
      <div class="field">
        <label for="email">Email address</label>
        <input id="email" type="email" autocomplete="email" required>
      </div>
      <div class="field">
        <label for="pw">Password</label>
        <input id="pw" type="password" autocomplete="new-password" required>
        <div class="field-error" id="pwHint" style="color:var(--muted)">At least 8 characters</div>
      </div>
      <button class="btn block" id="submit" type="submit">Create account</button>
    </form>`,
    `<div class="auth-alt">Already have an account?
      <button class="linkbtn" onclick="renderLogin()">Log in</button>
    </div>`
  );

  document.getElementById("f").onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById("submit");
    const name = document.getElementById("name").value.trim();
    const email = document.getElementById("email").value.trim();
    const pw = document.getElementById("pw").value;

    if (!name) return showAuthError("Enter your name.");
    if (!email.includes("@")) return showAuthError("Enter a valid email address.");
    if (pw.length < 8) return showAuthError("Choose a password of at least 8 characters.");

    busy(btn, true);
    const { data, error } = await sb.auth.signUp({
      email,
      password: pw,
      options: { data: { display_name: name }, emailRedirectTo: signupRedirectTo() },
    });
    if (error) { busy(btn, false, "Create account"); return showAuthError(errText(error)); }

    // Staat e-mailbevestiging aan, dan is er nog geen sessie.
    if (!data.session) {
      app.innerHTML = authShell(
        "Check your email",
        `We sent a confirmation link to ${email}`,
        `<button class="btn block" onclick="renderLogin()">Back to login</button>`
      );
    }
  };
}

function renderForgot() {
  app.innerHTML = authShell(
    "Forgot password",
    "We'll send you a link to choose a new password",
    `<form id="f" novalidate>
      <div class="field">
        <label for="email">Email address</label>
        <input id="email" type="email" autocomplete="email" required>
      </div>
      <button class="btn block" id="submit" type="submit">Send the link</button>
    </form>`,
    `<div class="auth-alt"><button class="linkbtn" onclick="renderLogin()">Back to login</button></div>`
  );

  document.getElementById("f").onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById("submit");
    const email = document.getElementById("email").value.trim();
    if (!email.includes("@")) return showAuthError("Enter a valid email address.");
    busy(btn, true);
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}${location.pathname}#/nieuw-wachtwoord`,
    });
    if (error) { busy(btn, false, "Send the link"); return showAuthError(errText(error)); }
    app.innerHTML = authShell(
      "Check your email",
      `If there's an account for ${email}, a link is now in your inbox`,
      `<button class="btn block" onclick="renderLogin()">Back to login</button>`
    );
  };
}

// Scherm waar de gebruiker landt na het klikken op de reset-link.
function renderNewPassword() {
  app.innerHTML = authShell(
    "New password",
    "Choose a password to log in with",
    `<form id="f" novalidate>
      <div class="field">
        <label for="pw">New password</label>
        <input id="pw" type="password" autocomplete="new-password" required>
      </div>
      <button class="btn block" id="submit" type="submit">Save password</button>
    </form>`
  );

  document.getElementById("f").onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById("submit");
    const pw = document.getElementById("pw").value;
    if (pw.length < 8) return showAuthError("Choose a password of at least 8 characters.");
    busy(btn, true);
    const { error } = await sb.auth.updateUser({ password: pw });
    if (error) { busy(btn, false, "Save password"); return showAuthError(errText(error)); }
    location.hash = "#/";
    toast("Password saved");
    boot();
  };
}

// Scherm waar de gebruiker landt na het klikken op de activatielink uit de
// registratiemail (zie signupRedirectTo() en de afhandeling in init()).
function renderSignupConfirmed() {
  app.innerHTML = authShell(
    "Account activated",
    "",
    `<div class="alert ok">Your account has been successfully activated!</div>
     <button class="btn block" onclick="renderLogin()">Go to login</button>`
  );
}

// Scherm voor een verlopen of ongeldige activatielink: duidelijke uitleg +
// meteen de mogelijkheid om een nieuwe activatiemail aan te vragen.
function renderSignupLinkError() {
  app.innerHTML = authShell(
    "Link expired or invalid",
    "Request a new activation link below",
    `<form id="f" novalidate>
      <div class="field">
        <label for="email">Email address</label>
        <input id="email" type="email" autocomplete="email" required>
      </div>
      <button class="btn block" id="submit" type="submit">Resend activation email</button>
    </form>`,
    `<div class="auth-alt"><button class="linkbtn" onclick="renderLogin()">Back to login</button></div>`
  );

  document.getElementById("f").onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById("submit");
    const email = document.getElementById("email").value.trim();
    if (!email.includes("@")) return showAuthError("Enter a valid email address.");
    busy(btn, true);
    const error = await resendSignupEmail(email);
    if (error) { busy(btn, false, "Resend activation email"); return showAuthError(errText(error)); }
    app.innerHTML = authShell(
      "Check your email",
      `We sent a new activation link to ${email}`,
      `<button class="btn block" onclick="renderLogin()">Back to login</button>`
    );
  };
}

// Verplicht scherm direct na registratie/inloggen zolang er nog geen
// player_onboarding-rij is. Deze gegevens zijn alleen zichtbaar voor de
// speler zelf en de organisator, en worden gebruikt voor de initiële
// indeling in divisies.
function renderOnboarding() {
  app.innerHTML = authShell(
    "Your player details",
    "Needed by the organizer to place you",
    `<form id="f" novalidate>
      <div class="field">
        <label for="ob-first">First name</label>
        <input id="ob-first" required autocomplete="given-name">
      </div>
      <div class="field">
        <label for="ob-last">Last name</label>
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
        <label for="ob-avg">Average (3 darts)</label>
        <input id="ob-avg" type="number" step="0.01" min="0" max="180" placeholder="Bijv. 53.08" required>
        <div class="muted" style="font-size:12.5px;margin-top:6px">
          Enkel zichtbaar voor de beheerder, gebruikt voor de initiële indeling.
        </div>
      </div>
      <button class="btn block" id="submit" type="submit">Save en verder</button>
    </form>`,
    `<div class="auth-alt"><button class="linkbtn" onclick="signOut()">Log out</button></div>`
  );

  document.getElementById("f").onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById("submit");
    const firstName = document.getElementById("ob-first").value.trim();
    const lastName = document.getElementById("ob-last").value.trim();
    const platform = document.getElementById("ob-platform").value;
    const nickname = document.getElementById("ob-nick").value.trim();
    const average = document.getElementById("ob-avg").value;

    if (!firstName || !lastName) return showAuthError("Enter your first and last name.");
    if (!nickname) return showAuthError("Enter your nickname.");
    if (average === "" || isNaN(Number(average)) || Number(average) < 0) {
      return showAuthError("Enter a valid average.");
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
      busy(btn, false, "Save en verder");
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
  { route: "toernooien", label: "Tournaments", ico: "tournament" },
  { route: "wedstrijden", label: "Matches", ico: "darts" },
  { route: "statistieken", label: "Statistics", ico: "chart" },
  { route: "profiel", label: "Profile", ico: "user" },
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
        ${icon.shield}<span>Admin</span>
      </button>
    </div>` : "";

  const tabs = NAV.map((n) => `
    <button class="${navActive(n.route, cur) ? "active" : ""}" onclick="go('${n.route}')">
      ${icon[n.ico]}<span>${esc(n.label)}</span>
    </button>`).join("") + (isOrg ? `
    <button class="${cur.startsWith("beheer") ? "active" : ""}" onclick="go('beheer')">
      ${icon.shield}<span>Admin</span>
    </button>` : "");

  app.innerHTML = `
    <div class="shell">
      <nav class="sidebar" aria-label="Main menu">
        <div class="brand"><img class="brand-mark" src="https://qspfphnailbelqmmzjbk.supabase.co/storage/v1/object/public/app-assets/favicon.png" alt=""><span class="brand-name">Dart League</span></div>
        ${links}
        ${orgLink}
      </nav>
      <main class="main"><div class="page" id="view">${loadingView()}</div></main>
    </div>
    <nav class="bottomnav" aria-label="Main menu">${tabs}</nav>`;
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
        return setView(emptyView("Organizers only", "Ask the organizer for access."));
      }
      return await viewManagePrizeDetail(route.split("/")[2]);
    }
    const handler = ROUTES[route];
    if (!handler) {
      return setView(emptyView("This page doesn't exist", "Use the menu to continue."));
    }
    if (route.startsWith("beheer") && state.profile?.role !== "organizer") {
      return setView(emptyView("Organizers only", "Ask the organizer for access."));
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

// "My league & division"-kaart op Home: welke league/divisie, positie,
// aantal spelers en gespeelde wedstrijden - de speler moet in één oogopslag
// zien waar hij speelt. myRow is de eigen rij uit standingsForLeague().
function myLeagueOverviewCard(membership, myRow, position, divisionTotal) {
  if (!membership) {
    return `<div class="card">${emptyView("Not placed yet", "Once the admin places you in a league, you'll see your overview here.", "league")}</div>`;
  }
  return `
    <button class="card clickable" onclick="go('mijn-divisie')">
      <div class="row" style="margin-bottom:${myRow ? "14px" : "0"}">
        <div class="row-ico">${icon.league}</div>
        <div class="row-main">
          <div class="row-title">${esc(membership.league.name)}</div>
          ${!membership.division ? `<div class="row-sub">Not placed yet</div>` : ""}
        </div>
      </div>
      ${myRow ? `
        <div class="muted" style="font-size:13px">
          Position ${position} of ${divisionTotal} &middot; ${myRow.played} played${myRow.points != null ? ` &middot; ${myRow.points} pt` : ""}
        </div>` : ""}
    </button>`;
}

// Compacte snelkoppelingen naar de belangrijkste pagina's - vervangt de
// vroegere org-brede lijsten (actieve leagues/toernooien/uitslagen) op
// Home, die niet speler-centrisch waren en al bereikbaar zijn via het menu.
function quickActionsGrid() {
  const tiles = [
    { label: "Tournaments", route: "toernooien", ico: "tournament" },
    { label: "Matches", route: "wedstrijden", ico: "darts" },
    { label: "Statistics", route: "statistieken", ico: "chart" },
    { label: "My division", route: "mijn-divisie", ico: "league" },
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
    <h1>Welcome back, ${esc(firstName)}</h1>
    <p class="sub">This is your darts overview.</p>

    ${prizeNotification ? `
      <button class="card clickable" style="border-color:#F5B94266;background:#F5B94214;margin-bottom:16px"
        onclick="go('prijs/${esc(prizeNotification.claim.division_winner_id)}')">
        <div class="row">
          <div class="row-ico" style="background:#F5B94222;color:#F5B942">${icon.trophy}</div>
          <div class="row-main">
            <div class="row-title">${esc(prizeNotification.title)}</div>
            <div class="row-sub">View your prize &rarr;</div>
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
        ${sectionHead("Next match", "All matches", "wedstrijden")}
        ${next ? `
          ${matchCard(next)}
          <button class="btn ghost sm" style="margin-top:-4px" onclick="go('mijn-divisie/${esc(next.id)}')">View match</button>
        ` : emptyView("Nothing scheduled", "Once the admin schedules a match for you, it'll show up here.", "darts")}
      </div>
      <div>
        ${sectionHead("My league & division")}
        ${myLeagueOverviewCard(membership, myRow, position, divisionTotal)}
      </div>
    </div>

    ${myRow ? `
      ${sectionHead("League overview")}
      <div class="grid">
        ${statCard({ label: "Position", value: `${position}/${divisionTotal}`, ico: "league" })}
        ${statCard({ label: "Played", value: myRow.played, ico: "darts" })}
        ${statCard({ label: "Average", value: Number(myRow.displayAverage ?? 0).toFixed(1), ico: "trend" })}
        ${statCard({ label: "Points", value: myRow.points, ico: "trophy", color: "#2ECC71" })}
      </div>
    ` : ""}

    ${sectionHead("Quick actions")}
    ${quickActionsGrid()}
  `);
}

// "My division": de league/divisie waarin de ingelogde speler op dit
// moment zit (er kan er maar één zijn, zie enforce_single_active_league),
// met alle divisies van die league als kaarten en de eigen divisie/rij
// gemarkeerd - dezelfde weergave als op de leaguepagina, hier alvast
// gefilterd naar "van mij".
// "My division": league-info, de gefocuste wedstrijd (huidige wedstrijd +
// datum&tijd-kaart + onderlinge wedstrijden tegen die tegenstander), alle
// open wedstrijden van de speler in deze league (wisselbare focus), en de
// volledige stand. Een speler kan meerdere open wedstrijden tegelijk hebben
// (round-robin), dus focusMatchId (via de route mijn-divisie/:id) bepaalt
// welke wedstrijd bovenaan uitgelicht wordt - standaard de eerst beschikbaar
// gekomen wedstrijd.
async function viewMyDivision(focusMatchId) {
  const membership = await db.myLeagueMembership();
  if (!membership) {
    return setView(`
      <h1>My division</h1>
      ${emptyView("Not placed yet", "Once the admin places you in a league, you'll see your division here.", "league")}
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
    .sort((a, b) => new Date(a.available_at || 0) - new Date(b.available_at || 0));

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
    <h1>Your division</h1>
    <p class="sub">${esc(league.name)}${league.season ? " &middot; Season: " + esc(league.season) : ""}</p>
    <button class="linkbtn mt8" style="margin-bottom:16px" onclick="go('league/${esc(league.id)}')">View the whole league &rarr;</button>

    ${focusMatch ? `
      ${sectionHead("Current match")}
      ${matchCard(focusMatch)}
      ${!["confirmed", "cancelled"].includes(focusMatch.status) ? `
        <button class="btn ghost sm" style="margin:-4px 0 14px" onclick="${
          focusMatch.status === "pending_confirmation"
            ? `openConfirmDialog('${esc(focusMatch.id)}')`
            : `openResultDialog('${esc(focusMatch.id)}')`
        }">${focusMatch.status === "pending_confirmation" ? "Check result" : "Report result"}</button>` : ""}

      ${sectionHead("Date & time of this match")}
      ${scheduleCard(focusMatch, proposalHistory)}

      ${opponent ? `
        ${sectionHead("Chat")}
        ${chatCard(chatMessages, me.id, focusMatch.id)}

        ${sectionHead("Head-to-head matches")}
        ${headToHeadCard(headToHead, opponent, me.id)}
      ` : ""}
    ` : emptyView("No open matches", "You currently have no matches to play.", "darts")}

    ${sectionHead("Matches this week")}
    ${leagueMatches.length ? leagueMatches.map((m) => `
        ${matchCard(m)}
        ${focusMatch && m.id === focusMatch.id
          ? `<p class="muted" style="margin:-4px 0 14px;font-size:12.5px">This is your current match above.</p>`
          : `<button class="btn ghost sm" style="margin:-4px 0 14px" onclick="go('mijn-divisie/${esc(m.id)}')">View match</button>`}
      `).join("")
      : emptyView("No matches", "", "darts")}

    ${sectionHead("Standings")}
    ${groups.length ? groups.map((g) => divisionStandingsCard(g, { meId: me.id, divisionCount: league.division_count })).join("")
      : emptyView("No divisions yet", "", "league")}
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
          <div class="row-main"><div class="row-title" style="white-space:normal">How does the league work?</div></div>
          <span class="muted toggle-label" style="font-size:13px;flex-shrink:0">More info &darr;</span>
        </div>
      </summary>
      <div class="muted" style="font-size:13.5px;line-height:1.6;margin-top:14px">
        <p>A league is a single group of up to 12 players, ranked by points: 1st, 2nd, 3rd, and so on. Want multiple levels (e.g. a 1st and 2nd division)? Create separate leagues for those.</p>
        <p>Matches are scheduled automatically, one round per week.</p>
        <p>The league winner receives a champion title and a personalized prize, provided by LWPrints. This could for example be a printed T-shirt, hoodie or polo.</p>
      </div>
    </details>

    ${leagues.length ? leagues.map((l) => leagueCard(l)).join("")
      : emptyView("No leagues yet", "", "league")}
  `);
  const infoCard = document.querySelector(".info-card");
  infoCard?.addEventListener("toggle", () => {
    infoCard.querySelector(".toggle-label").innerHTML = infoCard.open ? "Less info &uarr;" : "More info &darr;";
  });
}

// Tekst voor "eerstvolgende actie" op het beheerdersblok, bv. "Deze league
// start op 1 oktober 2026 om 19:00 uur."
function leagueNextActionText(league) {
  if (league.status === "draft") {
    return "Set a start date and time and click 'Schedule' to plan the league.";
  }
  if (league.status === "scheduled") {
    const d = new Date(league.start_at);
    const datePart = d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: league.timezone });
    const timePart = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: league.timezone });
    return `This league starts on ${datePart} at ${timePart}.`;
  }
  if (league.status === "active") {
    return "The league has started.";
  }
  return "This league has finished.";
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
      ${sectionHead("Schedule")}
      <div class="card">
        ${infoRow("Status", badge(league.status))}
        ${infoRow("Players", `${members.length}/12`)}
        ${infoRow("Timezone", esc(league.timezone))}
        ${infoRow("Matches created", matches.length)}
        <p class="muted" style="font-size:13px;margin:12px 0 0">${esc(leagueNextActionText(league))}</p>
      </div>
      ${canEditSchedule ? `
        <div class="card mt16">
          <div class="field"><label for="lp-desc">Description <span class="muted" style="font-weight:400">(optional)</span></label>
            <input id="lp-desc" value="${esc(league.description || "")}" placeholder="Bijv. Najaarscompetitie 2026"></div>
          <div class="field"><label for="lp-start">Start date and time</label>
            <input id="lp-start" type="datetime-local" value="${league.start_at ? fmtDatetimeLocal(league.start_at) : ""}"></div>
          <div class="field"><label for="lp-end">End date <span class="muted" style="font-weight:400">(optional)</span></label>
            <input id="lp-end" type="date" value="${league.end_at ? league.end_at.slice(0, 10) : ""}"></div>
          <div class="chips">
            <button class="chip" onclick="saveLeagueSchedule('${esc(id)}', false)">Save</button>
            ${league.status === "draft" ? `
              <button class="chip" onclick="saveLeagueSchedule('${esc(id)}', true)">${icon.clock} Schedule</button>` : ""}
          </div>
        </div>` : ""}
    ` : ""}

    ${sectionHead("Standings")}
    ${groups.length ? groups.map((g) => divisionStandingsCard(g, { meId: state.profile.id, divisionCount: league.division_count })).join("")
      : emptyView("No divisions yet", "No players have been placed in this league yet.", "league")}

    ${isOrg ? `
      ${sectionHead("Players")}
      <div class="chips" style="margin-bottom:14px">
        ${league.status === "draft" ? `
          <button class="chip" onclick="autoAssignDivisions('${esc(id)}')">${icon.target} Auto-assign</button>` : ""}
        <button class="chip" onclick="openAssignPlayerDialog('${esc(id)}')">${icon.plus} Place player</button>
      </div>
      ${league.status === "draft" ? `
        <p class="muted" style="font-size:12.5px;margin:-6px 0 14px">
          Auto-assign: ranks players by average (max 12 players per league).
        </p>` : ""}
    ` : ""}

    ${isOrg && league.status === "finished" ? `
      ${sectionHead("Winner & prize")}
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
        <button class="btn ghost sm mt8" onclick="go('beheer/prijzen')">Manage all prizes</button>
      ` : `
        <button class="btn" onclick="determineDivisionWinners('${esc(id)}')">${icon.trophy} Determine winner</button>
        <p class="muted" style="font-size:12.5px;margin:8px 0 0">
          The winner automatically gets notified and can claim their prize (provided by LWPrints).
        </p>
      `}
    ` : ""}

    ${sectionHead("Matches")}
    ${matches.length ? matches.map(matchCard).join("")
      : emptyView("No matches yet", "Nothing has been scheduled for this league yet.", "darts")}
  `);
}

async function saveLeagueSchedule(leagueId, schedule) {
  const start = document.querySelector("#lp-start").value;
  if (schedule && !start) {
    return toast("Set a start date and time first before you can schedule.");
  }
  const startAt = start ? new Date(start).toISOString() : null;
  if (schedule && startAt && new Date(startAt) <= new Date()) {
    return toast("Choose a start time in the future.");
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
    toast(schedule ? "League scheduled." : "Data saved.");
    router();
  } catch (e) { toast(errText(e)); }
}

async function determineDivisionWinners(leagueId) {
  try {
    const winners = await db.determineDivisionWinners(leagueId);
    toast(winners.length
      ? "Winner determined and notified."
      : "No winner: no match has been played yet.");
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

  const prizeBlurb = "The league winner receives a personalized printed garment, " +
    "provided by LWPrints. Depending on availability, and in consultation, you can " +
    "choose a printed T-shirt, a hoodie or a polo.";

  const filledIn = claim && (claim.garment || claim.size || claim.full_name);
  const locked = claim && ["confirmed", "in_production", "ready", "delivered", "cancelled"].includes(claim.status);

  setView(`
    <button class="linkbtn" onclick="go('')" style="display:flex;align-items:center;gap:4px;margin-bottom:12px">
      <span style="width:16px;height:16px;display:inline-flex">${icon.back}</span> Home
    </button>

    <div class="card center" style="padding:28px 20px">
      <span style="width:40px;height:40px;color:var(--accent);display:inline-flex;margin:0 auto 12px">${icon.trophy}</span>
      <h1 style="font-size:22px">${esc(w.league_name)} won!</h1>
      ${w.season ? `<p class="sub" style="margin-bottom:4px">${esc(w.season)}</p>` : ""}
      <p class="muted" style="font-size:13px">Determined on ${esc(fmtDate(w.decided_at, false))}</p>
    </div>

    <div class="card mt16">
      <p style="margin:0">${esc(prizeBlurb)}</p>
    </div>

    ${isMine ? `
      <div class="section"><h2>Status of your claim</h2></div>
      <div class="card">
        <div class="row" style="margin-bottom:${filledIn ? "14px" : "0"}">
          <div class="row-main"><div class="row-title">Huidige status</div></div>
          ${claim ? prizeStatusBadge(claim.status) : ""}
        </div>
        ${filledIn ? `
          <div class="row-sub" style="line-height:1.7">
            ${claim.garment ? `Garment: <strong style="color:var(--white)">${esc(GARMENT_LABELS[claim.garment] || claim.garment)}</strong><br>` : ""}
            ${claim.size ? `Size: <strong style="color:var(--white)">${esc(SIZE_LABELS[claim.size] || claim.size)}</strong><br>` : ""}
            ${claim.color ? `Color: <strong style="color:var(--white)">${esc(claim.color)}</strong><br>` : ""}
          </div>` : ""}
        ${!claim || claim.status === "available" ? `
          <button class="btn block mt16" onclick="openPrizeClaimDialog('${esc(id)}')">Prize claimen</button>
        ` : locked ? `
          <p class="muted mt16" style="font-size:13px;margin-bottom:0">
            Je gegevens zijn bevestigd. Neem contact op met de organisator als er iets moet wijzigen.
          </p>
        ` : `
          <button class="btn ghost block mt16" onclick="openPrizeClaimDialog('${esc(id)}')">Change details</button>
        `}
      </div>
    ` : `
      <p class="muted center mt16" style="font-size:13.5px">Congratulations to ${esc(w.player?.display_name || "the winner")}!</p>
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

    openModal("Claim prize", `
      <p class="sub" style="margin-bottom:18px">
        The final prize choice is made in consultation and depends on LWPrints'
        options and availability.
      </p>
      <div class="field"><label for="pcName">Name</label>
        <input id="pcName" required value="${esc(c.full_name || me.display_name || "")}"></div>
      <div class="field"><label for="pcEmail">Email address</label>
        <input id="pcEmail" type="email" required value="${esc(c.email || me.email || "")}"></div>
      <div class="field"><label for="pcPhone">Phone number <span class="muted" style="font-weight:400">(optional)</span></label>
        <input id="pcPhone" type="tel" value="${esc(c.phone || "")}"></div>
      <div class="field"><label for="pcGarment">Garment preference</label>
        <select id="pcGarment" required>
          <option value="">Choose...</option>
          ${garmentOpt("tshirt", "T-shirt")}${garmentOpt("hoodie", "Hoodie")}${garmentOpt("polo", "Polo")}
        </select></div>
      <div class="field"><label for="pcSize">Clothing size</label>
        <select id="pcSize" required>
          <option value="">Choose...</option>
          ${["xs","s","m","l","xl","xxl","xxxl"].map(sizeOpt).join("")}
        </select></div>
      <div class="field"><label for="pcColor">Preferred color <span class="muted" style="font-weight:400">(optional)</span></label>
        <input id="pcColor" value="${esc(c.color || "")}"></div>
      <div class="field"><label for="pcDesign">Preferred print/design <span class="muted" style="font-weight:400">(optional)</span></label>
        <textarea id="pcDesign" rows="2">${esc(c.design_notes || "")}</textarea></div>
      <div class="field"><label for="pcComments">Comments <span class="muted" style="font-weight:400">(optional)</span></label>
        <textarea id="pcComments" rows="2">${esc(c.comments || "")}</textarea></div>
      <div class="field">
        <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer">
          <input type="checkbox" id="pcConsent" style="margin-top:3px" ${c.consent_share_with_lwprints ? "checked" : ""}>
          <span style="font-size:13.5px;color:var(--grey)">
            I agree that my name, email address and (if provided) phone number will be shared with
            LWPrints, solely to produce and deliver my prize.
          </span>
        </label>
      </div>`, async (bg) => {
      const fullName = bg.querySelector("#pcName").value.trim();
      const email = bg.querySelector("#pcEmail").value.trim();
      const garment = bg.querySelector("#pcGarment").value;
      const size = bg.querySelector("#pcSize").value;
      const consent = bg.querySelector("#pcConsent").checked;
      if (!fullName) throw new Error("Enter your name.");
      if (!email.includes("@")) throw new Error("Enter a valid email address.");
      if (!garment) throw new Error("Choose a garment preference.");
      if (!size) throw new Error("Choose your clothing size.");
      if (!consent) throw new Error("You must agree to share your details with LWPrints.");
      await db.submitPrizeClaim(divisionWinnerId, {
        fullName, email,
        phone: bg.querySelector("#pcPhone").value.trim() || null,
        garment, size,
        color: bg.querySelector("#pcColor").value.trim() || null,
        designNotes: bg.querySelector("#pcDesign").value.trim() || null,
        comments: bg.querySelector("#pcComments").value.trim() || null,
        consent,
      });
      toast("Thanks! Your request has been submitted.");
      router();
    }, "Submit request");
  }).catch((e) => toast(errText(e)));
}

async function viewManagePrizes() {
  const winners = await db.allPrizeClaims();
  setView(`
    <h1>Prizes</h1>
    <p class="sub">Division winners and their prize claim (LWPrints)</p>
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
    `).join("") : emptyView("No division winners yet", "Determine winners on a finished league's page.", "trophy")}
  `);
}

async function viewManagePrizeDetail(claimId) {
  const winners = await db.allPrizeClaims();
  const w = winners.find((x) => x.claim?.id === claimId);
  if (!w) return setView(emptyView("Claim not found", "Go back to Prizes.", "warn"));
  const c = w.claim;
  const history = await db.prizeClaimHistory(claimId);

  const row = (label, value) => value ? `
    <div class="row" style="justify-content:space-between;padding:6px 0;border-top:1px solid var(--line)">
      <span class="row-sub">${esc(label)}</span>
      <span style="font-weight:600;text-align:right">${esc(value)}</span>
    </div>` : "";

  setView(`
    <button class="linkbtn" onclick="go('beheer/prijzen')" style="display:flex;align-items:center;gap:4px;margin-bottom:12px">
      <span style="width:16px;height:16px;display:inline-flex">${icon.back}</span> Prizes
    </button>

    <div class="card center">
      ${avatar(w.player, "lg")}
      <div class="mt16" style="font-size:19px;font-weight:700">${esc(w.player?.display_name || "?")}</div>
      <div class="muted" style="font-size:14px">${esc(w.league_name)}${w.season ? " · " + esc(w.season) : ""}</div>
      <div class="mt8">${prizeStatusBadge(c.status)}</div>
    </div>

    ${sectionHead("Change status")}
    <div class="card">
      <div class="field"><label for="pStatus">New status</label>
        <select id="pStatus">
          ${Object.keys(PRIZE_STATUS).map((s) => `<option value="${s}" ${s === c.status ? "selected" : ""}>${esc(PRIZE_STATUS[s].label)} (${s})</option>`).join("")}
        </select>
      </div>
      <div class="field"><label for="pNote">Note <span class="muted" style="font-weight:400">(optional, appears in the history)</span></label>
        <textarea id="pNote" rows="2" placeholder="Bijv. telefonisch contact gehad op ..."></textarea>
      </div>
      <button class="btn" onclick="submitStatusChange('${esc(claimId)}')">Save status</button>
      ${c.status !== "delivered" ? `
        <button class="btn ghost" style="margin-left:8px" onclick="quickMarkDelivered('${esc(claimId)}')">Mark as delivered</button>` : ""}
    </div>

    ${sectionHead("Submitted details")}
    <div class="card">
      ${row("Name", c.full_name)}
      ${row("Email", c.email)}
      ${row("Phone", c.phone)}
      ${row("Garment", c.garment ? GARMENT_LABELS[c.garment] : null)}
      ${row("Size", c.size ? SIZE_LABELS[c.size] : null)}
      ${row("Color", c.color)}
      ${row("Print/design", c.design_notes)}
      ${row("Winner's comments", c.comments)}
      ${row("Consent to share with LWPrints", c.consent_share_with_lwprints ? `Yes, given on ${fmtDate(c.consent_given_at)}` : "No")}
      ${!c.full_name && !c.garment ? `<p class="muted" style="font-size:13.5px;margin:0">Nothing filled in by the winner yet.</p>` : ""}
    </div>

    ${sectionHead("Admin note")}
    <div class="card">
      <textarea id="pAdminNotes" rows="3" placeholder="Internal note, e.g. contact attempts">${esc(c.admin_notes || "")}</textarea>
      <button class="btn ghost sm mt8" onclick="saveAdminNotes('${esc(claimId)}')">Save</button>
    </div>

    ${sectionHead("History")}
    <div class="card">
      ${history.length ? history.map((h, i) => `
        <div class="row-sub" style="padding:6px 0;${i > 0 ? "border-top:1px solid var(--line)" : ""}">
          ${esc(fmtDate(h.created_at))} &middot; ${esc(PRIZE_STATUS[h.old_status]?.label || h.old_status || "-")} &rarr; ${esc(PRIZE_STATUS[h.new_status]?.label || h.new_status)}
          ${h.changed_by_profile?.display_name ? ` by ${esc(h.changed_by_profile.display_name)}` : ""}
          ${h.note ? `<div style="margin-top:2px">${esc(h.note)}</div>` : ""}
        </div>`).join("")
        : `<p class="muted" style="font-size:13.5px;margin:0">No status changes yet.</p>`}
    </div>
  `);
}

async function submitStatusChange(claimId) {
  const status = document.getElementById("pStatus").value;
  const note = document.getElementById("pNote").value.trim() || null;
  try {
    await db.updatePrizeClaimStatus(claimId, status, note);
    toast("Status updated");
    viewManagePrizeDetail(claimId);
  } catch (e) { toast(errText(e)); }
}

async function quickMarkDelivered(claimId) {
  try {
    await db.updatePrizeClaimStatus(claimId, "delivered", "Marked as delivered");
    toast("Marked as delivered");
    viewManagePrizeDetail(claimId);
  } catch (e) { toast(errText(e)); }
}

async function saveAdminNotes(claimId) {
  const notes = document.getElementById("pAdminNotes").value;
  try {
    await db.updatePrizeClaimFields(claimId, { admin_notes: notes });
    toast("Note saved");
  } catch (e) { toast(errText(e)); }
}

async function openAssignPlayerDialog(leagueId) {
  const [players, divisions, onboardingList, members] = await Promise.all([
    db.players(), db.divisionsForLeague(leagueId), db.allOnboarding(), db.leagueMembers(leagueId),
  ]);
  if (!players.length) return toast("There are no players yet.");
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

  openModal("Place player", `
    <div class="field"><label for="ap">Player</label><select id="ap">${opts(players, "id", "display_name")}</select></div>
    <div id="apInfo" class="muted" style="font-size:13px;margin:-8px 0 16px"></div>
    <div class="field"><label for="ad">Division</label>
      <select id="ad">
        <option value="">No division</option>
        ${divOpts}
      </select>
    </div>`, async (bg) => {
    const playerId = bg.querySelector("#ap").value;
    const divisionId = bg.querySelector("#ad").value || null;
    await db.assignPlayerToLeague(leagueId, playerId, divisionId);
    toast("Player ingedeeld");
    router();
  }, "Save");

  // Toont platform/nickname/gemiddelde van de gekozen speler, zodat de
  // organisator dit kan gebruiken bij de initiële indeling.
  const infoEl = document.querySelector("#apInfo");
  const playerSel = document.querySelector("#ap");
  const showInfo = () => {
    const o = onboardingByPlayer[playerSel.value];
    infoEl.textContent = o
      ? `${o.platform === "scolia" ? "Scolia" : "DartCounter"} · ${o.platform_nickname} · avg. ${Number(o.reported_average).toFixed(2)}`
      : "No player details entered yet.";
  };
  playerSel.onchange = showInfo;
  showInfo();
}

async function autoAssignDivisions(leagueId) {
  try {
    const placed = await db.autoAssignDivisions(leagueId);
    const lowConfidence = placed.filter((p) => p.low_confidence);
    let msg = `${placed.length} player(s) placed.`;
    if (lowConfidence.length) {
      msg += ` Note: ${lowConfidence.map((p) => p.display_name).join(", ")} had no average and now count(s) as 0.`;
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
    { key: "all", label: "All tournaments" },
    { key: "upcoming", label: "Upcoming tournaments" },
    { key: "registration_open", label: "Registration open" },
    { key: "mine", label: "My tournaments" },
    { key: "finished", label: "Finished tournaments" },
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
      : emptyView("No tournaments available yet", "There are currently no tournaments available. Check back later to join a new tournament.", "tournament");
    document.querySelectorAll(".tournament-filter-chip").forEach((el) => {
      el.classList.toggle("active", el.dataset.key === active);
    });
  };

  setView(`
    <h1>Tournaments</h1>
    <p class="sub">Compete against other players and win great prizes.</p>

    <div class="card" style="margin-bottom:16px">
      <div class="row">
        <div class="row-ico">${icon.trophy}</div>
        <div class="row-main">
          <div class="row-title" style="white-space:normal">Tournaments with possible prize money</div>
          <div class="row-sub" style="white-space:normal">Take part in darts tournaments and compete against other players. Depending on the tournament, prizes or prize money may be available.</div>
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
        <div class="mp ${aWin ? "winner" : ""}"><span class="mp-name">${esc(m.player_a?.display_name || "Unknown yet")}</span></div>
        <span class="vs">VS</span>
        <div class="mp right ${bWin ? "winner" : ""}"><span class="mp-name">${esc(m.player_b?.display_name || "Unknown yet")}</span></div>
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

// Betaalblok voor de eigen inschrijving: instructies + "I've paid" bij
// pending, wacht-op-bevestiging bij submitted, bevestiging bij paid.
function myPaymentBlock(t, entry) {
  if (!entry || entry.payment_status === "not_required") return "";
  const fee = t.entry_fee != null ? fmtMoney(t.entry_fee, t.prize_currency) : "";
  if (entry.payment_status === "pending") {
    return `
      <div class="card" style="margin-bottom:16px">
        <div class="row-title" style="font-size:14px;margin-bottom:6px">Entry fee: ${esc(fee)}</div>
        ${t.payment_instructions ? `<p class="row-sub" style="white-space:pre-wrap;margin:0 0 10px">${esc(t.payment_instructions)}</p>` : ""}
        ${t.payment_deadline_hours ? `<p class="muted" style="font-size:12.5px;margin:0 0 10px">Pay within ${t.payment_deadline_hours} hours of registering, or your spot will be released automatically.</p>` : ""}
        <button class="btn sm" id="submitPaymentBtn">I've paid</button>
      </div>`;
  }
  if (entry.payment_status === "submitted") {
    return `
      <div class="card" style="margin-bottom:16px">
        <div class="row-title" style="font-size:14px">${paymentStatusBadge("submitted")}</div>
        <p class="row-sub" style="margin:6px 0 0">Awaiting confirmation from the admin.${entry.payment_reference ? ` Reference: ${esc(entry.payment_reference)}` : ""}</p>
      </div>`;
  }
  if (entry.payment_status === "paid") {
    return `
      <div class="card" style="margin-bottom:16px">
        <div class="row-title" style="font-size:14px">${paymentStatusBadge("paid")}</div>
        ${entry.amount_paid != null ? `<p class="row-sub" style="margin:6px 0 0">${esc(fmtMoney(entry.amount_paid, t.prize_currency))} received.</p>` : ""}
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
    potText = "The pool is calculated as entry fee × the number of players who actually paid. As long as registration is still open, the amount shown is a provisional estimate - the pool is only final once registration closes.";
  } else if (t.prize_pool_type === "fixed") {
    potText = "This tournament has a fixed prize amount. That amount is set in advance, regardless of the number of entrants.";
  } else {
    potText = "The amount shown is the total prize money for this tournament.";
  }

  const hasDistribution = Array.isArray(t.prize_distribution) && t.prize_distribution.length > 0;
  const distText = hasDistribution
    ? "A share of the pool has already been assigned per final position (see above) - either as a percentage of the pool or as a fixed amount."
    : "The admin hasn't set a distribution per final position yet.";

  const payoutText = "After the tournament, the admin manually records the payout per final position, approves it and transfers the amount themselves (e.g. via Tikkie). This doesn't happen automatically through the app - the app only tracks what should happen.";

  return `
    <details class="card info-card" style="margin-bottom:16px">
      <summary>
        <div class="row">
          <div class="row-ico">${icon.trophy}</div>
          <div class="row-main"><div class="row-title" style="white-space:normal">How does the prize pool work?</div></div>
          <span class="muted toggle-label" style="font-size:13px;flex-shrink:0">More info &darr;</span>
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
    return setView(emptyView("Tournament not found", "This tournament no longer exists.", "tournament"));
  }
  if (t.status === "draft" && !isOrg) {
    return setView(emptyView("Tournament not found", "This tournament no longer exists.", "tournament"));
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
      <span style="width:16px;height:16px;display:inline-flex">${icon.back}</span> Tournaments
    </button>
    <h1>${esc(t.name)}</h1>
    <p class="sub">${esc([TOURNAMENT_TYPES[t.tournament_type] || t.tournament_type, t.start_at ? fmtDate(t.start_at) : null].filter(Boolean).join(" · "))}</p>
    <div style="margin-bottom:20px">${tournamentStatusBadge(t, activeEntries.length)}</div>

    <div class="card" style="margin-bottom:16px">
      ${infoRow("Format", esc(TOURNAMENT_TYPES[t.tournament_type] || t.tournament_type))}
      ${infoRow("Match format", esc(`${t.game_type} · ${tournamentMatchFormatLabel(t)}`))}
      ${platformLabel ? infoRow("Play mode", esc(platformLabel + (scoringLabel ? ` · ${scoringLabel}` : ""))) : ""}
      ${infoRow("Entrants", `${activeEntries.length}${t.max_players ? `/${t.max_players}` : ""}`)}
      ${t.min_players ? infoRow("Minimum number of players", String(t.min_players)) : ""}
      ${t.registration_opens_at ? infoRow("Registration opens", esc(fmtDate(t.registration_opens_at))) : ""}
      ${t.registration_closes_at ? infoRow("Registration closes", esc(fmtDate(t.registration_closes_at))) : ""}
      ${isPaidTournament ? infoRow("Entry fee", esc(fmtMoney(t.entry_fee, t.prize_currency))) : ""}
    </div>

    <div class="card" style="margin-bottom:16px">${prizeLine(t, paidCount)}</div>

    ${prizeExplainerCard(t)}

    ${!isOrg ? myPaymentBlock(t, myEntry) : ""}

    ${myPayout ? `
      <div class="card" style="margin-bottom:16px">
        <div class="row-title" style="font-size:14px">Your result: ${esc(ordinal(myPayout.placement))} place</div>
        <p class="row-sub" style="margin:6px 0 0">${esc(fmtMoney(myPayout.prize_amount, myPayout.currency))} — ${myPayout.payout_status === "paid" ? "paid out" : myPayout.payout_status === "approved" ? "approved, will be transferred" : "awaiting approval"}</p>
      </div>` : ""}

    ${(t.refund_policy || t.refund_cutoff_hours) && !isOrg ? `
      <div class="card" style="margin-bottom:16px">
        <div class="row-title" style="font-size:14px">Cancellation terms</div>
        ${t.refund_policy ? `<p class="row-sub" style="white-space:pre-wrap;margin:6px 0 0">${esc(t.refund_policy)}</p>` : ""}
        ${t.refund_cutoff_hours != null ? `<p class="muted" style="font-size:12.5px;margin:6px 0 0">Refund possible up to ${t.refund_cutoff_hours} hours before the start.</p>` : ""}
      </div>` : ""}

    ${!isOrg ? `
      <div style="margin-bottom:16px">
        ${canRegister ? `<button class="btn block" onclick="registerForTournament('${esc(t.id)}')">${isPaidTournament ? "Register and pay" : "Register"}</button>` : ""}
        ${canWithdraw ? `<button class="btn ghost block" onclick="withdrawFromTournament('${esc(t.id)}')">Withdraw</button>` : ""}
        ${!canRegister && !canWithdraw ? `<p class="muted" style="font-size:13px;margin:0">${esc(registrationClosedReason(status))}</p>` : ""}
      </div>
    ` : `
      <button class="btn ghost sm" style="margin-bottom:16px" onclick="openEditTournamentDialog('${esc(t.id)}')">${icon.settings} Edit tournament</button>
    `}

    ${t.description ? `
      ${sectionHead("Tournament rules")}
      <div class="card" style="margin-bottom:16px"><p style="margin:0;white-space:pre-wrap">${esc(t.description)}</p></div>
    ` : ""}

    ${isOrg && isPaidTournament ? `
      ${sectionHead("Payments")}
      ${pendingEntries.length ? `
        <div class="card" style="margin-bottom:16px">
          ${pendingEntries.map((e, i) => `
            <div class="row" style="padding:9px 0;${i > 0 ? "border-top:1px solid var(--line)" : ""}">
              ${avatar(e.player, "sm")}
              <div class="row-main">
                <div class="row-title">${esc(e.player?.display_name || "?")}</div>
                <div class="row-sub">${paymentStatusBadge(e.payment_status)}${e.payment_reference ? ` · ${esc(e.payment_reference)}` : ""}${e.tikkie_sent_at ? ` · Tikkie sent` : ""}</div>
              </div>
              <div style="display:flex;gap:6px;flex-shrink:0">
                ${e.payment_status === "pending" && !e.tikkie_sent_at ? `<button class="btn ghost sm mark-tikkie-sent-btn" data-entry-id="${esc(e.id)}">Mark Tikkie sent</button>` : ""}
                <button class="btn ghost sm reject-payment-btn" data-entry-id="${esc(e.id)}">Reject</button>
                <button class="btn sm confirm-payment-btn" data-entry-id="${esc(e.id)}">Confirm</button>
              </div>
            </div>`).join("")}
        </div>` : `<div class="card" style="margin-bottom:16px">${emptyView("No outstanding payments", "", "flag")}</div>`}
      ${paidEntries.length ? `
        <div class="card" style="margin-bottom:16px">
          ${paidEntries.map((e, i) => `
            <div class="row" style="padding:9px 0;${i > 0 ? "border-top:1px solid var(--line)" : ""}">
              ${avatar(e.player, "sm")}
              <div class="row-main">
                <div class="row-title">${esc(e.player?.display_name || "?")}</div>
                <div class="row-sub">${paymentStatusBadge(e.payment_status)}${e.amount_paid != null ? ` · ${esc(fmtMoney(e.amount_paid, t.prize_currency))}` : ""}</div>
              </div>
              <button class="btn ghost sm refund-entry-btn" data-entry-id="${esc(e.id)}">Refund</button>
            </div>`).join("")}
        </div>` : ""}
    ` : ""}

    ${sectionHead("Entrants")}
    ${activeEntries.length ? `
      <div class="card" style="margin-bottom:16px">
        ${activeEntries.map((e, i) => `
          <div class="row" style="padding:7px 0;${i > 0 ? "border-top:1px solid var(--line)" : ""}">
            ${avatar(e.player, "sm")}
            <div class="row-main"><div class="row-title">${esc(e.player?.display_name || "?")}</div></div>
            ${isOrg && isPaidTournament ? paymentStatusBadge(e.payment_status) : ""}
          </div>`).join("")}
      </div>` : `<div class="card" style="margin-bottom:16px">${emptyView("No entrants yet", "", "users")}</div>`}

    ${isOrg ? `
      ${sectionHead("Payouts")}
      ${payouts.length ? `
        <div class="card" style="margin-bottom:16px">
          ${payouts.map((p, i) => `
            <div class="row" style="padding:9px 0;${i > 0 ? "border-top:1px solid var(--line)" : ""}">
              ${avatar(p.player, "sm")}
              <div class="row-main">
                <div class="row-title">${esc(ordinal(p.placement))} — ${esc(p.player?.display_name || "?")}</div>
                <div class="row-sub">${esc(fmtMoney(p.prize_amount, p.currency))} · ${esc(p.payout_status === "paid" ? "Paid" : p.payout_status === "approved" ? "Approved" : p.payout_status === "cancelled" ? "Cancelled" : "Awaiting approval")}</div>
              </div>
              <div style="display:flex;gap:6px;flex-shrink:0">
                ${p.payout_status === "pending_approval" ? `<button class="btn ghost sm approve-payout-btn" data-payout-id="${esc(p.id)}">Approve</button>` : ""}
                ${p.payout_status === "approved" ? `<button class="btn sm mark-payout-paid-btn" data-payout-id="${esc(p.id)}">Mark as paid</button>` : ""}
              </div>
            </div>`).join("")}
        </div>` : `<div class="card" style="margin-bottom:16px">${emptyView("No payouts recorded yet", "", "trophy")}</div>`}
      <button class="btn ghost sm" style="margin-bottom:16px" id="addPayoutBtn">${icon.plus} Add payout</button>
    ` : ""}

    ${sectionHead("Match schedule")}
    ${matches.length ? matches.map(tournamentMatchRow).join("")
      : `<div class="card">${emptyView("No match schedule yet", "The schedule will appear once the tournament starts.", "darts")}</div>`}
  `);

  document.getElementById("submitPaymentBtn")?.addEventListener("click", () => openSubmitPaymentDialog(myEntry.id));
  document.querySelectorAll(".mark-tikkie-sent-btn").forEach((el) => {
    el.onclick = async () => {
      try {
        await db.markTournamentEntryTikkieSent(el.dataset.entryId);
        toast("Marked as Tikkie sent");
        router();
      } catch (e) { toast(errText(e)); }
    };
  });
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
    infoCard.querySelector(".toggle-label").innerHTML = infoCard.open ? "Less info &uarr;" : "More info &darr;";
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
    return `<button class="btn ghost sm" style="margin:-4px 0 8px" onclick="openScheduleProposalDialog('${esc(m.id)}')">${icon.clock} Propose a time</button>`;
  }
  const when = fmtDate(p.proposed_at);
  if (p.proposed_by === meId) {
    const label = p.status === "disputed" ? "Problem reported, awaiting response" : `You proposed ${when}, awaiting response`;
    return `
      <p class="muted" style="margin:-4px 0 6px;font-size:13px">${esc(label)}</p>
      <button class="btn ghost sm" style="margin:0 0 10px" onclick="withdrawScheduleProposal('${esc(m.id)}')">Withdraw</button>`;
  }
  return `
    <p class="muted" style="margin:-4px 0 6px;font-size:13px">Voorstel: ${esc(when)}${p.note ? " — " + esc(p.note) : ""}</p>
    <div class="chips" style="margin:0 0 10px">
      <button class="chip" onclick="respondScheduleProposal('${esc(m.id)}', 'accept')">Accept</button>
      <button class="chip" onclick="openScheduleProposalDialog('${esc(m.id)}', true)">Counter-proposal</button>
      <button class="chip" onclick="respondScheduleProposal('${esc(m.id)}', 'dispute')">Report a problem</button>
    </div>`;
}

function openScheduleProposalDialog(matchId, isCounter = false) {
  openModal(isCounter ? "Make a counter-proposal" : "Propose a time", `
    <div class="field"><label for="sp-when">Date and time</label><input id="sp-when" type="datetime-local" required></div>
    <div class="field"><label for="sp-note">Note <span class="muted" style="font-weight:400">(optional)</span></label>
      <input id="sp-note" placeholder="E.g. reason for the proposal"></div>`,
    async (bg) => {
      const val = bg.querySelector("#sp-when").value;
      if (!val) throw new Error("Choose a date and time.");
      const proposedAt = new Date(val).toISOString();
      const note = bg.querySelector("#sp-note").value.trim() || null;
      if (isCounter) {
        await db.respondMatchSchedule(matchId, "counter", proposedAt, note);
      } else {
        await db.proposeMatchSchedule(matchId, proposedAt, note);
      }
      toast("Proposal sent.");
      router();
    }, isCounter ? "Send counter-proposal" : "Send proposal");
}

async function respondScheduleProposal(matchId, action) {
  try {
    await db.respondMatchSchedule(matchId, action);
    toast(action === "accept" ? "Proposal accepted." : "Problem reported to your opponent.");
    router();
  } catch (e) { toast(errText(e)); }
}

async function withdrawScheduleProposal(matchId) {
  try {
    await db.withdrawMatchSchedule(matchId);
    toast("Proposal withdrawn.");
    router();
  } catch (e) { toast(errText(e)); }
}

// History van voorstellen ("Datum & uur"-kaart op My division).
function scheduleHistoryList(history) {
  if (!history.length) return "";
  const actionLabels = {
    proposed: "proposed a time",
    countered: "made a counter-proposal",
    accepted: "accepted the proposal",
    disputed: "reported a problem",
    withdrawn: "withdrew the proposal",
  };
  return `
    <div class="mt16">
      <div class="muted" style="font-size:12px;font-weight:600;margin-bottom:6px">History</div>
      ${history.map((h) => `
        <div class="muted" style="font-size:12.5px;margin-bottom:4px">
          ${esc(h.actor?.display_name || "Someone")} ${esc(actionLabels[h.action] || h.action)}${h.proposed_at ? " &middot; " + esc(fmtDate(h.proposed_at)) : ""}
        </div>`).join("")}
    </div>`;
}

// Volledige "Date & time of this match"-kaart voor My division:
// uitleg, voorstel/accepteer/tegenvoorstel/intrekken, beschikbaarheid, en
// de geschiedenis van alle acties.
function scheduleCard(m, history) {
  return `
    <div class="card">
      <h2 style="margin-bottom:8px">Date &amp; time of this match</h2>
      <p class="muted" style="font-size:13px;margin:0 0 14px">
        Agree on a date and time with your opponent. The proposal is sent to the other player, who can accept it or make a different proposal.
      </p>
      ${scheduleProposalBlock(m)}
      ${matchAvailabilityLine(m, matchDisplayStatus(m))}
      ${scheduleHistoryList(history)}
    </div>`;
}

// Head-to-head matches ("head-to-head") tussen de ingelogde speler en de
// tegenstander van de gefocuste wedstrijd.
function headToHeadCard(matches, opponent, meId) {
  if (!matches.length) {
    return `<div class="card">${emptyView("No previous meetings yet", `This is the first time you're facing ${esc(opponent?.display_name || "this player")}.`, "darts")}</div>`;
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
              ${draw ? "Draw" : won ? "Won" : "Lost"}
            </span>
          </div>`;
      }).join("")}
    </div>`;
}

const CHAT_EMOJIS = ["👍", "😀", "😅", "😬", "🎯", "🔥", "🎉", "😢"];

// Privéchat tussen de twee spelers van de gefocuste wedstrijd (My division).
function chatCard(messages, meId, matchId) {
  return `
    <div class="card">
      <h2 style="margin-bottom:8px">Chat</h2>
      <p class="muted" style="font-size:13px;margin:0 0 14px">Only you and your opponent can see this conversation.</p>
      <div class="chat-messages" id="chat-messages">
        ${messages.length ? messages.map((m) => `
          <div class="chat-msg ${m.sender_id === meId ? "me" : "them"}">
            ${esc(m.body)}
            <span class="chat-time">${esc(fmtDate(m.created_at))}</span>
          </div>`).join("")
          : `<p class="muted" style="font-size:13px;margin:0">No messages yet. Send the first one!</p>`}
      </div>
      <div class="chat-emojis">
        ${CHAT_EMOJIS.map((e) => `<button type="button" class="chat-emoji-btn" onclick="insertChatEmoji('${e}')">${e}</button>`).join("")}
      </div>
      <form class="chat-input-row" onsubmit="return sendMatchChatMessage(event, '${esc(matchId)}')">
        <input id="chat-input" placeholder="Type a message..." maxlength="1000" autocomplete="off">
        <button class="btn sm" type="submit">Send</button>
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
          <button class="btn sm" style="margin:-4px 0 14px" onclick="openConfirmDialog('${esc(m.id)}')">Check result</button>`;
      }
      const opponentName = m.player_a_id === state.profile.id
        ? m.player_b?.display_name : m.player_a?.display_name;
      return `
        ${matchCard(m)}
        <p class="muted" style="margin:-4px 0 14px;font-size:13px">Awaiting confirmation from ${esc(opponentName || "your opponent")}</p>`;
    }
    return `
      ${matchCard(m)}
      ${scheduleProposalBlock(m)}
      <button class="btn ghost sm" style="margin:-4px 0 10px" onclick="openResultDialog('${esc(m.id)}')">Report result</button>`;
  };

  setView(`
    <h1>Your matches</h1>
    <p class="sub">Everything you're taking part in</p>
    ${matches.length === 0 ? emptyView("No matches yet", "Once you're placed, they'll show up here.", "darts") : ""}
    ${open.length ? `${sectionHead("Open")}${open.map(openItem).join("")}` : ""}
    ${done.length ? `${sectionHead("Played")}${done.map(matchCard).join("")}` : ""}
  `);
}

async function viewStats() {
  const s = state.profile?.stats;
  if (!s) {
    return setView(`<h1>Statistics</h1>
      ${emptyView("No numbers yet", "Play your first match to see something here.", "chart")}`);
  }
  const winPct = s.matches_played > 0 ? Math.round((s.matches_won / s.matches_played) * 100) : 0;
  setView(`
    <h1>Statistics</h1>
    <p class="sub">Your numbers across all confirmed matches</p>
    <div class="grid">
      ${statCard({ label: "Played", value: s.matches_played, ico: "darts" })}
      ${statCard({ label: "Won", value: s.matches_won, ico: "trophy", color: "#2ECC71" })}
      ${statCard({ label: "Lost", value: s.matches_lost, ico: "flag", color: "#E74C3C" })}
      ${statCard({ label: "Win ratio", value: winPct + "%", ico: "trend" })}
      ${statCard({ label: "Average", value: Number(s.average_score).toFixed(1), ico: "trend" })}
      ${statCard({ label: "Checkout", value: Math.round(s.checkout_percentage) + "%", ico: "target" })}
      ${statCard({ label: "Hoogste finish", value: s.highest_checkout, ico: "flag" })}
      ${statCard({ label: "180's", value: s.count_180, ico: "star", color: "#F5B942" })}
    </div>
    <p class="muted mt24" style="font-size:13px">
      These numbers are updated as soon as matches are confirmed.
    </p>
  `);
}

async function viewProfile() {
  const p = state.profile;
  const s = p.stats;
  const membership = await db.myLeagueMembership();
  setView(`
    <h1>Profile</h1>
    <p class="sub">Your details and your role</p>

    <div class="card center">
      <div style="display:inline-block;position:relative">
        ${avatar(p, "lg")}
        <button class="btn sm" id="avatarBtn"
          style="position:absolute;bottom:-4px;right:-4px;border-radius:50%;padding:8px;width:34px;height:34px"
          aria-label="Change photo">
          <span style="width:16px;height:16px;display:block">${icon.camera}</span>
        </button>
        <input type="file" id="avatarInput" accept="image/*" class="sr">
      </div>
      <div class="mt16" style="font-size:20px;font-weight:700">${esc(p.display_name)}</div>
      <div class="muted" style="font-size:14px">${esc(p.email)}</div>
      <div class="mt8">${p.role === "organizer"
        ? `<span class="badge" style="color:#F47B20;border-color:#F47B2066;background:#F47B2022">Admin</span>`
        : `<span class="badge" style="color:#D9DEE8;border-color:#22346099;background:#22346055">Player</span>`}</div>
      <button class="btn ghost sm mt16" onclick="openNameDialog()">Change name</button>
    </div>

    ${sectionHead("Quick overview")}
    <div class="grid">
      ${statCard({ label: "Played", value: s?.matches_played ?? 0, ico: "darts" })}
      ${statCard({ label: "Won", value: s?.matches_won ?? 0, ico: "trophy", color: "#2ECC71" })}
      ${statCard({ label: "Average", value: Number(s?.average_score ?? 0).toFixed(1), ico: "trend" })}
      ${statCard({ label: "180's", value: s?.count_180 ?? 0, ico: "star", color: "#F5B942" })}
    </div>

    ${sectionHead("Notifications")}
    <div class="card">
      <div class="row-sub">Push notifications on this device</div>
      <p class="muted" style="font-size:12.5px;margin:8px 0 12px">Get notified as soon as a match is scheduled for you or a time is proposed - even when the app isn't open. On iPhone: first add the site to your home screen via Safari (share icon &rarr; Add to Home Screen) before enabling this.</p>
      <button class="btn ghost sm" id="enablePushBtn">Enable on this device</button>
    </div>

    ${sectionHead("League placement")}
    <div class="card">
      ${membership ? `
        ${infoRow("League", esc(membership.league.name))}
        ${!membership.division ? `<p class="muted" style="font-size:13px;margin:-2px 0 0">Not placed by the admin yet.</p>` : ""}
        <button class="btn ghost sm mt16" onclick="go('mijn-divisie')">View my division</button>
      ` : `<p class="muted" style="font-size:13.5px;margin:0">Not placed in a league yet.</p>`}
    </div>

    ${sectionHead("Player details")}
    <div class="card">
      <div class="row-sub">Name</div>
      <div class="row-title mt8">${esc(state.onboarding.first_name)} ${esc(state.onboarding.last_name)}</div>
      <div class="row-sub mt16">Platform</div>
      <div class="row-title mt8">${state.onboarding.platform === "scolia" ? "Scolia" : "DartCounter"} &middot; ${esc(state.onboarding.platform_nickname)}</div>
      <div class="row-sub mt16">Average (3 darts)</div>
      <div class="row-title mt8">${Number(state.onboarding.reported_average).toFixed(2)}</div>
      <p class="muted" style="font-size:12.5px;margin:12px 0 0">Only visible to the admin.</p>
      <button class="btn ghost sm mt16" onclick="openOnboardingEditDialog()">Change details</button>
    </div>

    <button class="btn ghost block mt24" onclick="signOut()">
      <span style="width:18px;height:18px;display:block">${icon.logout}</span> Log out
    </button>
  `);

  document.getElementById("enablePushBtn").onclick = enablePushNotifications;

  const input = document.getElementById("avatarInput");
  document.getElementById("avatarBtn").onclick = () => input.click();
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast("Choose a photo smaller than 5 MB.");
    try {
      toast("Uploading photo...");
      const url = await db.uploadAvatar(p.id, file);
      await db.updateProfile(p.id, { avatar_url: url });
      state.profile = await db.myProfile(p.id);
      router();
      toast("Photo changed");
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
    <h1>Admin</h1>
    <p class="sub">The overview of your organization</p>

    <div class="grid">
      ${statCard({ label: "Players", value: c.players, ico: "users" })}
      ${statCard({ label: "Active leagues", value: c.leagues, ico: "league" })}
      ${statCard({ label: "Active tournaments", value: c.tournaments, ico: "tournament" })}
      ${statCard({ label: "Open matches", value: c.open, ico: "darts", color: "#F5B942" })}
    </div>

    ${sectionHead("Quick create")}
    <div class="chips">
      <button class="chip" onclick="openLeagueDialog()">${icon.plus} League</button>
      <button class="chip" onclick="openTournamentDialog()">${icon.plus} Tournament</button>
      <button class="chip" onclick="openMatchDialog()">${icon.plus} Match</button>
    </div>

    ${sectionHead("Manage")}
    ${tile("Players", "beheer/spelers", "users")}
    ${tile("Leagues", "beheer/leagues", "league")}
    ${tile("Tournaments", "beheer/toernooien", "tournament")}
    ${tile("Matches", "beheer/wedstrijden", "darts")}
    ${tile("Prizes", "beheer/prijzen", "trophy")}
    ${tile("Settings", "beheer/instellingen", "settings")}

    ${sectionHead("Latest results")}
    ${results.length ? results.map(matchCard).join("") : emptyView("No results yet", "", "darts")}
  `);
}

async function viewManagePlayers() {
  setView(`
    <h1>Players</h1>
    <p class="sub">Everyone who has an account</p>
    <div class="field"><input id="q" type="search" placeholder="Search by name"></div>
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
                ? `Avg ${Number(p.stats.average_score).toFixed(1)} · ${p.stats.matches_won}W ${p.stats.matches_lost}L`
                : esc(p.email)}</div>
            </div>
            ${p.id === state.profile.id
              ? `<span class="muted" style="font-size:12.5px">you</span>`
              : `<button class="btn ghost sm" onclick="toggleRole('${esc(p.id)}','${p.role === "organizer" ? "player" : "organizer"}')">
                  ${p.role === "organizer" ? "Remove role" : "Make admin"}
                 </button>`}
          </div>
        </div>`).join("")
        : emptyView("No players found", "Adjust your search term.", "users");
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
    toast(role === "organizer" ? "Player is now admin" : "Role removed");
    viewManagePlayers();
  } catch (e) { toast(errText(e)); }
}

async function viewManageLeagues() {
  const leagues = await db.leagues();
  setView(`
    <h1>Leagues</h1>
    <p class="sub">Create and switch status</p>
    <button class="btn mt8" onclick="openLeagueDialog()">${icon.plus} New league</button>
    <div class="mt24">
      ${leagues.length ? leagues.map((l) => `
        ${leagueCard(l, true)}
        <div class="chips" style="margin:-4px 0 8px">
          ${["draft", "active", "finished"].filter((s) => s !== l.status).map((s) => `
            <button class="chip" onclick="changeLeagueStatus('${esc(l.id)}','${s}')">
              Set to ${esc(STATUS[s].label.toLowerCase())}
            </button>`).join("")}
        </div>
        ${l.status === "draft" ? `
          <div style="margin:0 0 20px">
            <button class="btn ghost sm" style="color:#E74C3C;border-color:#E74C3C66" onclick="confirmDeleteLeague('${esc(l.id)}','${esc(l.name)}')">
              Delete
            </button>
          </div>` : `<div style="margin-bottom:14px"></div>`}`).join("")
        : emptyView("No leagues yet", "Create your first league.", "league")}
    </div>
  `);
}

async function changeLeagueStatus(id, status) {
  try {
    await db.setLeagueStatus(id, status);
    toast("Status updated");
    viewManageLeagues();
  } catch (e) { toast(errText(e)); }
}

function confirmDeleteLeague(id, name) {
  openModal("Delete draft league", `
    <p style="margin:0 0 4px">Weet je zeker dat je <strong style="color:var(--white)">${esc(name)}</strong> wilt verwijderen?</p>
    <p class="muted" style="font-size:13px;margin:0">This action cannot be undone.</p>`,
    async () => {
      await db.deleteLeague(id);
      toast("League deleted");
      viewManageLeagues();
    }, "Delete", true);
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
    <h1>Tournaments</h1>
    <p class="sub">Create and view</p>
    <button class="btn mt8" onclick="openTournamentDialog()">${icon.plus} New tournament</button>
    <div class="tournament-grid mt24">
      ${list.length ? list.map((t) => tournamentCard(t, {
          entryCount: countByTournament[t.id] || 0,
          paidCount: paidCountByTournament[t.id] || 0,
        })).join("")
        : emptyView("No tournaments yet", "Create your first tournament.", "tournament")}
    </div>
  `);
}

async function viewManageMatches() {
  const matches = await db.allMatches();
  const pending = matches.filter((m) => m.status === "pending_confirmation");
  setView(`
    <h1>Matches</h1>
    <p class="sub">Schedule and confirm results</p>
    <button class="btn mt8" onclick="openMatchDialog()">${icon.plus} New match</button>

    ${pending.length ? `${sectionHead("Awaiting confirmation")}
      <p class="muted" style="font-size:13px;margin:-4px 0 14px">
        Players normally confirm this between themselves. Only step in here if that gets stuck.
      </p>
      ${pending.map((m) => `
        ${matchCard(m)}
        <button class="btn sm" style="margin:-4px 0 14px" onclick="openConfirmDialog('${esc(m.id)}')">Check result</button>
      `).join("")}` : ""}

    ${sectionHead("All matches")}
    ${matches.length ? matches.map((m) => matchCard(m)).join("")
      : emptyView("No matches yet", "Schedule your first match.", "darts")}
  `);
}

async function viewSettings() {
  setView(`
    <h1>Settings</h1>
    <p class="sub">Preferences for your organization</p>
    <div class="card">
      <div class="row">
        <div class="row-ico">${icon.settings}</div>
        <div class="row-main">
          <div class="row-title">Nothing to configure yet</div>
          <div class="row-sub">Default game type, number of legs and notifications will go here.</div>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="row-title">Je database</div>
      <div class="row-sub mt8">Players toevoegen doe je by ze te laten registreren op deze site.
        Daarna kun je ze hier een rol geven.</div>
    </div>
  `);
}

/* -------------------------------------------------------------------------
   Dialogen
   ------------------------------------------------------------------------- */

function openModal(title, bodyHtml, onSubmit, submitLabel = "Save", danger = false) {
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <h2>${esc(title)}</h2>
      <div id="modalError"></div>
      <form id="modalForm">${bodyHtml}
        <div class="modal-actions">
          <button type="button" class="btn ghost" id="cancel">Cancel</button>
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
  openModal("Change name", `
    <div class="field">
      <label for="dn">Name</label>
      <input id="dn" value="${esc(state.profile.display_name)}" required>
    </div>`, async (bg) => {
    const name = bg.querySelector("#dn").value.trim();
    if (!name) throw new Error("Enter a name.");
    await db.updateProfile(state.profile.id, { display_name: name });
    state.profile = await db.myProfile(state.profile.id);
    toast("Name changed");
    router();
  });
}

function openOnboardingEditDialog() {
  const o = state.onboarding;
  openModal("Change player details", `
    <div class="field"><label for="eob-first">First name</label><input id="eob-first" value="${esc(o.first_name)}" required></div>
    <div class="field"><label for="eob-last">Last name</label><input id="eob-last" value="${esc(o.last_name)}" required></div>
    <div class="field"><label for="eob-platform">Platform</label>
      <select id="eob-platform">
        <option value="scolia" ${o.platform === "scolia" ? "selected" : ""}>Scolia</option>
        <option value="dartcounter" ${o.platform === "dartcounter" ? "selected" : ""}>DartCounter</option>
      </select>
    </div>
    <div class="field"><label for="eob-nick">Nickname (Scolia / DartCounter)</label>
      <input id="eob-nick" value="${esc(o.platform_nickname)}" required></div>
    <div class="field"><label for="eob-avg">Average (3 darts)</label>
      <input id="eob-avg" type="number" step="0.01" min="0" max="180" value="${esc(o.reported_average)}" required></div>`,
    async (bg) => {
      const firstName = bg.querySelector("#eob-first").value.trim();
      const lastName = bg.querySelector("#eob-last").value.trim();
      const nickname = bg.querySelector("#eob-nick").value.trim();
      const average = bg.querySelector("#eob-avg").value;
      if (!firstName || !lastName) throw new Error("Enter your first and last name.");
      if (!nickname) throw new Error("Enter your nickname.");
      if (average === "" || isNaN(Number(average)) || Number(average) < 0) {
        throw new Error("Enter a valid average.");
      }
      await db.saveOnboarding(state.profile.id, {
        first_name: firstName,
        last_name: lastName,
        platform: bg.querySelector("#eob-platform").value,
        platform_nickname: nickname,
        reported_average: Number(average),
      });
      state.onboarding = await db.myOnboarding(state.profile.id);
      toast("Player details saved");
      router();
    });
}

// Een league is altijd één divisie (max 12 spelers); meerdere niveaus maak
// je als aparte leagues (bv. "1e divisie", "2e divisie").
function openLeagueDialog() {
  openModal("New league", `
    <div class="field"><label for="ln">Name</label><input id="ln" required placeholder="E.g. 1st division"></div>
    <div class="field"><label for="ls">Season</label><input id="ls" placeholder="E.g. 2026"></div>
    <div class="field"><label for="lg">Game type</label>
      <select id="lg"><option value="501">501</option><option value="301">301</option></select>
    </div>`, async (bg) => {
    const name = bg.querySelector("#ln").value.trim();
    if (!name) throw new Error("Enter a name.");
    const league = await db.createLeague({
      name,
      season: bg.querySelector("#ls").value.trim() || null,
      game_type: bg.querySelector("#lg").value,
      match_format: "best_of_legs",
      status: "draft",
      created_by: state.profile.id,
    });
    toast("League created. Add players and assign them.");
    go("league/" + league.id);
  }, "Create league");
}

// Zonder `existing` = nieuw toernooi (concept, organisator publiceert later
// by de status te wijzigen); met `existing` = bewerken van dat toernooi.
function openTournamentDialog(existing) {
  const t = existing || {};
  const isEdit = !!existing;

  openModal(isEdit ? "Edit tournament" : "New tournament", `
    <div class="field"><label for="tn">Name</label><input id="tn" required value="${esc(t.name || "")}" placeholder="E.g. Club championship"></div>
    <div class="field-pair">
      <div><div class="field-pair-label">Format</div>
        <select id="tt">
          <option value="knockout" ${!t.tournament_type || t.tournament_type === "knockout" ? "selected" : ""}>Knockout</option>
          <option value="groups" ${t.tournament_type === "groups" ? "selected" : ""}>Groups</option>
          <option value="groups_and_knockout" ${t.tournament_type === "groups_and_knockout" ? "selected" : ""}>Groups + knockout</option>
        </select>
      </div>
      <div><div class="field-pair-label">Game type</div>
        <select id="tg">
          <option value="501" ${t.game_type !== "301" ? "selected" : ""}>501</option>
          <option value="301" ${t.game_type === "301" ? "selected" : ""}>301</option>
        </select>
      </div>
    </div>
    <div class="field"><div class="field-pair-label">Match format</div>
      <select id="tmf" onchange="toggleMatchFormatFields(this.value)">
        <option value="best_of_legs" ${t.match_format !== "best_of_sets" ? "selected" : ""}>Legs</option>
        <option value="best_of_sets" ${t.match_format === "best_of_sets" ? "selected" : ""}>Sets</option>
      </select>
    </div>
    <div id="legsField" class="field" style="display:${t.match_format === "best_of_sets" ? "none" : "block"}">
      <div class="field-pair-label">Legs per match</div>
      <input id="tlpm" type="number" min="1" value="${t.legs_per_match || 10}">
    </div>
    <div id="setsFields" class="field-pair" style="display:${t.match_format === "best_of_sets" ? "grid" : "none"}">
      <div><div class="field-pair-label">Sets per match</div>
        <input id="tspm" type="number" min="1" value="${t.sets_per_match || 5}"></div>
      <div><div class="field-pair-label">Legs per set</div>
        <input id="tlps" type="number" min="1" value="${t.legs_per_set || 3}"></div>
    </div>
    <div class="field-pair">
      <div><div class="field-pair-label">Play mode</div>
        <select id="tp">
          <option value="">Unknown</option>
          <option value="online" ${t.platform === "online" ? "selected" : ""}>Online</option>
          <option value="offline" ${t.platform === "offline" ? "selected" : ""}>Offline</option>
        </select>
      </div>
      <div><div class="field-pair-label">Scoring system</div>
        <select id="tsp">
          <option value="">-</option>
          <option value="scolia" ${t.scoring_platform === "scolia" ? "selected" : ""}>Scolia</option>
          <option value="dartcounter" ${t.scoring_platform === "dartcounter" ? "selected" : ""}>DartCounter</option>
        </select>
      </div>
    </div>
    <div class="field"><label for="td">Start date and time</label><input id="td" type="datetime-local" value="${t.start_at ? fmtDatetimeLocal(t.start_at) : ""}"></div>
    <div class="field-pair">
      <div><div class="field-pair-label">Registration opens</div><input id="tro" type="datetime-local" value="${t.registration_opens_at ? fmtDatetimeLocal(t.registration_opens_at) : ""}"></div>
      <div><div class="field-pair-label">Registration closes</div><input id="trc" type="datetime-local" value="${t.registration_closes_at ? fmtDatetimeLocal(t.registration_closes_at) : ""}"></div>
    </div>
    <div class="field"><label for="tmax">Maximum number of players <span class="muted" style="font-weight:400">(optional)</span></label><input id="tmax" type="number" min="2" value="${t.max_players || ""}"></div>
    <div class="field"><label for="tstatus">Status</label>
      <select id="tstatus">
        <option value="draft" ${!t.status || t.status === "draft" ? "selected" : ""}>Draft (not visible to players yet)</option>
        <option value="active" ${t.status === "active" ? "selected" : ""}>Active</option>
        <option value="finished" ${t.status === "finished" ? "selected" : ""}>Finished</option>
      </select>
    </div>
    <div class="field-pair">
      <div><div class="field-pair-label">Entry fee (€) <span class="muted" style="font-weight:400">(optional)</span></div>
        <input id="tfee" type="number" min="0" step="0.01" value="${t.entry_fee ?? ""}" onchange="togglePaidFields(this.value)"></div>
      <div><div class="field-pair-label">Minimum number of players <span class="muted" style="font-weight:400">(optional)</span></div>
        <input id="tmin" type="number" min="1" value="${t.min_players ?? ""}"></div>
    </div>
    <div id="paidFields" style="display:${Number(t.entry_fee) > 0 ? "block" : "none"}">
      <div class="field"><label for="tpdh">Payment deadline <span class="muted" style="font-weight:400">(hours after registering, optional)</span></label><input id="tpdh" type="number" min="1" value="${t.payment_deadline_hours ?? ""}"></div>
      <div class="field"><label for="tpinstr">Payment instructions <span class="muted" style="font-weight:400">(e.g. Tikkie link/phone number)</span></label><textarea id="tpinstr" rows="2" placeholder="E.g. Send €10 via Tikkie to 06-12345678">${esc(t.payment_instructions || "")}</textarea></div>
      <div class="field"><label for="trefpolicy">Cancellation terms <span class="muted" style="font-weight:400">(optional)</span></label><textarea id="trefpolicy" rows="2" placeholder="E.g. Full refund up to 24 hours before the start">${esc(t.refund_policy || "")}</textarea></div>
      <div class="field"><label for="trefcutoff">Refund possible up to <span class="muted" style="font-weight:400">(hours before the start, optional)</span></label><input id="trefcutoff" type="number" min="0" value="${t.refund_cutoff_hours ?? ""}"></div>
    </div>
    <div class="field"><label for="tprize">Prize</label>
      <select id="tprize" onchange="togglePrizeFields(this.value)">
        <option value="none" ${!t.prize_type || t.prize_type === "none" ? "selected" : ""}>No prize</option>
        <option value="money" ${t.prize_type === "money" ? "selected" : ""}>Prize money</option>
        <option value="physical" ${t.prize_type === "physical" ? "selected" : ""}>Physical prize</option>
        <option value="unknown" ${t.prize_type === "unknown" ? "selected" : ""}>Not known yet</option>
      </select>
    </div>
    <div id="prizeMoneyFields" style="display:${t.prize_type === "money" ? "block" : "none"}">
      <div class="field"><label for="tpooltype">Prize pool</label>
        <select id="tpooltype" onchange="togglePoolType(this.value)">
          <option value="" ${!t.prize_pool_type ? "selected" : ""}>Fixed amount, no distribution</option>
          <option value="fixed" ${t.prize_pool_type === "fixed" ? "selected" : ""}>Fixed amount with distribution</option>
          <option value="entry_fee_based" ${t.prize_pool_type === "entry_fee_based" ? "selected" : ""}>Calculated from entry fee × paid entrants</option>
        </select>
      </div>
      <div id="tamountField" class="field" style="display:${t.prize_pool_type === "entry_fee_based" ? "none" : "block"}">
        <label for="tamount">Amount (€) <span class="muted" style="font-weight:400">(optional)</span></label>
        <input id="tamount" type="number" min="0" step="0.01" value="${t.prize_amount ?? ""}">
      </div>
      <div id="distField" style="display:${t.prize_pool_type ? "block" : "none"}">
        <div class="field-pair-label" style="margin-bottom:6px">Prize distribution per placement <span class="muted" style="font-weight:400">(optional)</span></div>
        <div id="distRows">${renderDistRowsHtml(t.prize_distribution)}</div>
        <button type="button" class="btn ghost sm" onclick="addPrizeDistRow()">${icon.plus} Add placement</button>
      </div>
    </div>
    <div id="prizePhysicalFields" style="display:${t.prize_type === "physical" ? "block" : "none"}">
      <div class="field"><label for="tpdesc">Description</label><input id="tpdesc" value="${esc(t.prize_description || "")}" placeholder="E.g. Personalized darts shirt"></div>
    </div>
    <div class="field"><label for="tdesc">Tournament rules <span class="muted" style="font-weight:400">(optional)</span></label><textarea id="tdesc" rows="3" placeholder="Rules or extra info for entrants">${esc(t.description || "")}</textarea></div>`,
    async (bg) => {
      const name = bg.querySelector("#tn").value.trim();
      if (!name) throw new Error("Enter a name.");
      const d = bg.querySelector("#td").value;
      const ro = bg.querySelector("#tro").value;
      const rc = bg.querySelector("#trc").value;
      if (ro && rc && new Date(ro) >= new Date(rc)) {
        throw new Error("Registration must close after it opens.");
      }
      const maxPlayers = bg.querySelector("#tmax").value;
      const minPlayers = bg.querySelector("#tmin").value;
      if (maxPlayers && minPlayers && Number(minPlayers) > Number(maxPlayers)) {
        throw new Error("Minimum number of players cannot be higher than the maximum.");
      }
      const entryFeeRaw = bg.querySelector("#tfee").value;
      const entryFee = entryFeeRaw !== "" ? Number(entryFeeRaw) : null;
      if (entryFee != null && entryFee < 0) throw new Error("Entry fee cannot be negative.");
      const isPaid = entryFee != null && entryFee > 0;

      const matchFormat = bg.querySelector("#tmf").value;
      const legsPerMatch = Number(bg.querySelector("#tlpm").value) || 10;
      const setsPerMatch = Number(bg.querySelector("#tspm").value) || 5;
      const legsPerSet = Number(bg.querySelector("#tlps").value) || 3;
      if (matchFormat === "best_of_legs" && legsPerMatch < 1) {
        throw new Error("Legs per match must be at least 1.");
      }
      if (matchFormat === "best_of_sets" && (setsPerMatch < 1 || legsPerSet < 1)) {
        throw new Error("Sets per match and legs per set must be at least 1.");
      }

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
        if (pctSum > 100) throw new Error("The percentages in the prize distribution cannot add up to more than 100%.");
        if (poolType === "entry_fee_based" && distRows.some((r) => r.type === "amount")) {
          throw new Error("For a pool based on entry fees, only percentages are allowed - the total amount is only final once the tournament ends.");
        }
        if (poolType === "fixed" && prizeAmount != null) {
          const amtSum = distRows.filter((r) => r.type === "amount").reduce((s, r) => s + r.value, 0);
          if (amtSum > prizeAmount) throw new Error("The fixed amounts in the prize distribution exceed the total pool.");
        }
      }

      const fields = {
        name,
        tournament_type: bg.querySelector("#tt").value,
        game_type: bg.querySelector("#tg").value,
        match_format: matchFormat,
        legs_per_match: legsPerMatch,
        sets_per_match: matchFormat === "best_of_sets" ? setsPerMatch : null,
        legs_per_set: matchFormat === "best_of_sets" ? legsPerSet : null,
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
        toast("Tournament updated");
        router();
      } else {
        const created = await db.createTournament({
          ...fields,
          match_format: "best_of_legs",
          created_by: state.profile.id,
        });
        toast("Tournament created");
        go("toernooien/" + created.id);
      }
    }, isEdit ? "Save changes" : "Create tournament");
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

function toggleMatchFormatFields(matchFormat) {
  const legsEl = document.getElementById("legsField");
  const setsEl = document.getElementById("setsFields");
  if (legsEl) legsEl.style.display = matchFormat === "best_of_sets" ? "none" : "block";
  if (setsEl) setsEl.style.display = matchFormat === "best_of_sets" ? "grid" : "none";
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
          <option value="percentage" ${type !== "amount" ? "selected" : ""}>% of the pool</option>
          <option value="amount" ${type === "amount" ? "selected" : ""}>Fixed amount (€)</option>
        </select>
      </div>
      <div style="flex:1"><div class="field-pair-label">Value</div>
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
    if (!t) return toast("Tournament not found.");
    openTournamentDialog(t);
  } catch (e) { toast(errText(e)); }
}

async function registerForTournament(id) {
  try {
    await db.registerForTournament(id);
    toast("You're registered!");
    router();
  } catch (e) { toast(errText(e)); }
}

async function withdrawFromTournament(id) {
  try {
    await db.withdrawFromTournament(id);
    toast("You've withdrawn.");
    router();
  } catch (e) { toast(errText(e)); }
}

function openSubmitPaymentDialog(entryId) {
  openModal("Report payment", `
    <p class="muted" style="font-size:13px;margin:0 0 12px">Only report this after you've actually transferred the amount via Tikkie. The admin will check this before your registration becomes final.</p>
    <div class="field"><label for="spr">Reference <span class="muted" style="font-weight:400">(optional, e.g. Tikkie description)</span></label><input id="spr" placeholder="E.g. TIKKIE-123"></div>`,
    async (bg) => {
      const ref = bg.querySelector("#spr").value.trim() || null;
      await db.submitTournamentPayment(entryId, ref);
      toast("Payment reported. The admin will check this.");
      router();
    }, "I've paid");
}

function openConfirmPaymentDialog(entryId, defaultAmount, currency) {
  openModal("Confirm payment", `
    <p class="muted" style="font-size:13px;margin:0 0 12px">Only confirm after you actually see the amount in your own Tikkie overview.</p>
    <div class="field"><label for="cpa">Amount received (${esc(currency || "EUR")})</label><input id="cpa" type="number" min="0" step="0.01" value="${defaultAmount ?? ""}" required></div>`,
    async (bg) => {
      const amount = Number(bg.querySelector("#cpa").value);
      if (bg.querySelector("#cpa").value === "" || isNaN(amount) || amount < 0) throw new Error("Enter a valid amount.");
      await db.confirmTournamentPayment(entryId, amount);
      toast("Payment confirmed.");
      router();
    }, "Confirm");
}

function openRejectPaymentDialog(entryId) {
  openModal("Reject payment", `
    <div class="field"><label for="rpr">Reason <span class="muted" style="font-weight:400">(optional, shown to the player)</span></label><input id="rpr" placeholder="E.g. amount not received"></div>`,
    async (bg) => {
      const reason = bg.querySelector("#rpr").value.trim() || null;
      await db.rejectTournamentPayment(entryId, reason);
      toast("Payment rejected. The spot has been released.");
      router();
    }, "Reject", true);
}

function openRefundConfirm(entry, currency) {
  if (!entry) return;
  const name = entry.player?.display_name || "this player";
  const amount = entry.amount_paid ?? 0;
  openModal("Register refund", `
    <p style="margin:0 0 4px">Confirm that you <strong style="color:var(--white)">${esc(fmtMoney(amount, currency))}</strong> have refunded <strong style="color:var(--white)">${esc(name)}</strong> via Tikkie.</p>
    <p class="muted" style="font-size:13px;margin:0">This only records that the refund was made - the app doesn't transfer money itself.</p>`,
    async () => {
      await db.refundTournamentEntry(entry.id);
      toast("Refund registered.");
      router();
    }, "Register refund");
}

function openSetPayoutDialog(tournamentId, entries) {
  const opts = entries.map((e) => `<option value="${esc(e.player_id)}">${esc(e.player?.display_name || "?")}</option>`).join("");
  openModal("Add payout", `
    <div class="field"><label for="poPlace">Placement</label><input id="poPlace" type="number" min="1" value="1" required></div>
    <div class="field"><label for="poPlayer">Player</label><select id="poPlayer">${opts}</select></div>
    <div class="field"><label for="poAmount">Amount (€)</label><input id="poAmount" type="number" min="0" step="0.01" required></div>`,
    async (bg) => {
      const placement = Number(bg.querySelector("#poPlace").value);
      const playerId = bg.querySelector("#poPlayer").value;
      const amount = Number(bg.querySelector("#poAmount").value);
      if (!placement || placement < 1) throw new Error("Enter a valid placement.");
      if (!playerId) throw new Error("Choose a player.");
      if (bg.querySelector("#poAmount").value === "" || isNaN(amount) || amount < 0) throw new Error("Enter a valid amount.");
      await db.setTournamentPayout(tournamentId, playerId, placement, amount, "EUR");
      toast("Payout recorded.");
      router();
    }, "Save");
}

async function approvePayoutAction(payoutId) {
  try {
    await db.approveTournamentPayout(payoutId);
    toast("Payout approved.");
    router();
  } catch (e) { toast(errText(e)); }
}

function openMarkPayoutPaidDialog(payoutId) {
  openModal("Uitbetaling registreren", `
    <p class="muted" style="font-size:13px;margin:0 0 12px">Only record this after you've actually transferred the amount via Tikkie.</p>
    <div class="field"><label for="mpr">Reference <span class="muted" style="font-weight:400">(optional)</span></label><input id="mpr" placeholder="E.g. Tikkie description"></div>`,
    async (bg) => {
      const ref = bg.querySelector("#mpr").value.trim() || null;
      await db.markTournamentPayoutPaid(payoutId, ref);
      toast("Payout recorded as paid.");
      router();
    }, "Mark as paid");
}

async function openMatchDialog() {
  const [leagues, players] = await Promise.all([db.leagues(), db.players()]);
  if (!leagues.length) return toast("Create a league first.");
  if (players.length < 2) return toast("You need at least two players.");

  const opts = (list, val, lab) => list.map((x) => `<option value="${esc(x[val])}">${esc(x[lab])}</option>`).join("");

  openModal("New match", `
    <div class="field"><label for="ml">League</label><select id="ml">${opts(leagues, "id", "name")}</select></div>
    <div class="field"><label for="mdiv">Division <span class="muted" style="font-weight:400">(optional)</span></label>
      <select id="mdiv"><option value="">No division</option></select>
      <div id="mdivInfo" class="muted" style="font-size:12.5px;margin-top:6px"></div>
    </div>
    <div class="field"><label for="ma">Player A</label><select id="ma">${opts(players, "id", "display_name")}</select></div>
    <div class="field"><label for="mb">Player B</label><select id="mb">${opts(players, "id", "display_name")}</select></div>
    <div class="field"><label for="md">When</label><input id="md" type="datetime-local"></div>`,
    async (bg) => {
      const a = bg.querySelector("#ma").value;
      const b = bg.querySelector("#mb").value;
      if (a === b) throw new Error("Choose two different players.");
      const d = bg.querySelector("#md").value;
      await db.createMatch({
        league_id: bg.querySelector("#ml").value,
        division_id: bg.querySelector("#mdiv").value || null,
        player_a_id: a,
        player_b_id: b,
        scheduled_at: d ? new Date(d).toISOString() : null,
        status: "scheduled",
      });
      toast("Match scheduled");
      router();
    }, "Schedule match");

  // Player B standaard op de tweede speler zetten
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
      ? `This division only has ${n} player(s) so far; at least 4 are needed to start.`
      : `${n} players in this division.`;
  };
  const loadDivisions = async () => {
    const [divisions, mem] = await Promise.all([
      db.divisionsForLeague(leagueSel.value), db.leagueMembers(leagueSel.value),
    ]);
    members = mem;
    divSel.innerHTML = `<option value="">No division</option>${opts(divisions, "id", "name")}`;
    showDivInfo();
  };
  leagueSel.onchange = loadDivisions;
  divSel.onchange = showDivInfo;
  loadDivisions();
}

async function openResultDialog(matchId) {
  const m = await db.matchById(matchId);
  const a = m.player_a, b = m.player_b;
  const aName = a?.display_name || "Player A";
  const bName = b?.display_name || "Player B";
  const legsPerMatch = m.league?.legs_per_match || 10;
  const legsToWin = Math.floor(legsPerMatch / 2) + 1;
  const drawLegs = legsPerMatch / 2;
  const canDraw = Number.isInteger(drawLegs);

  openModal("Report result", `
    <p class="sub" style="margin-bottom:18px">
      Once a player wins ${legsToWin} legs the match is decided - you don't have to play all ${legsPerMatch} legs.
      ${canDraw ? `At ${drawLegs}-${drawLegs} it's a draw.` : ""}
      Your opponent needs to confirm the result before it counts.
    </p>

    <div class="field">
      <label>Who won?</label>
      <div class="chips" role="radiogroup" aria-label="Winner">
        <label class="chip"><input type="radio" name="winner" value="${esc(a.id)}" class="sr">${esc(aName)}</label>
        <label class="chip"><input type="radio" name="winner" value="draw" class="sr">Draw</label>
        <label class="chip"><input type="radio" name="winner" value="${esc(b.id)}" class="sr">${esc(bName)}</label>
      </div>
    </div>

    <div class="field">
      <label>Won legs <span class="muted" style="font-weight:400">(max ${legsToWin} per player)</span></label>
      <div class="field-pair">
        <div><div class="field-pair-label">${esc(aName)}</div><input id="ra" type="number" min="0" max="${legsToWin}" value="0" required></div>
        <div><div class="field-pair-label">${esc(bName)}</div><input id="rb" type="number" min="0" max="${legsToWin}" value="0" required></div>
      </div>
    </div>

    <div class="field">
      <label>Average</label>
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

    <div class="row-title" style="font-size:14px;margin:4px 0 12px">More statistics</div>
    <div class="field">
      <label>Scoring</label>
      <div class="field-pair">
        <input id="scora" type="number" step="0.1" min="0" max="180" placeholder="${esc(aName)}" required>
        <input id="scorb" type="number" step="0.1" min="0" max="180" placeholder="${esc(bName)}" required>
      </div>
    </div>
    <div class="field">
      <label>First 9 avg.</label>
      <div class="field-pair">
        <input id="f9a" type="number" step="0.1" min="0" max="180" placeholder="${esc(aName)}" required>
        <input id="f9b" type="number" step="0.1" min="0" max="180" placeholder="${esc(bName)}" required>
      </div>
    </div>
    <div class="field">
      <label>Checkouts hit</label>
      <div class="field-pair">
        <input id="cha" type="number" min="0" placeholder="${esc(aName)}" required>
        <input id="chb" type="number" min="0" placeholder="${esc(bName)}" required>
      </div>
    </div>
    <div class="field">
      <label>Checkout attempts</label>
      <div class="field-pair">
        <input id="caa" type="number" min="0" placeholder="${esc(aName)}" required>
        <input id="cab" type="number" min="0" placeholder="${esc(bName)}" required>
      </div>
    </div>
    <div class="field">
      <label>Darts thrown</label>
      <div class="field-pair">
        <input id="dta" type="number" min="0" placeholder="${esc(aName)}" required>
        <input id="dtb" type="number" min="0" placeholder="${esc(bName)}" required>
      </div>
    </div>
    <div class="field">
      <label>Best leg <span class="muted" style="font-weight:400">(darts)</span></label>
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
    if (!winner) throw new Error("Choose who won, or a draw.");
    const aLegs = parseInt(bg.querySelector("#ra").value, 10);
    const bLegs = parseInt(bg.querySelector("#rb").value, 10);
    if (isNaN(aLegs) || isNaN(bLegs)) throw new Error("Enter both leg scores.");
    if (aLegs + bLegs > legsPerMatch) throw new Error(`The legs together can't exceed ${legsPerMatch}.`);
    if (aLegs === bLegs) {
      if (aLegs !== drawLegs) throw new Error(canDraw ? `A draw is only possible at ${drawLegs}-${drawLegs}.` : `A draw isn't possible with ${legsPerMatch} legs.`);
      if (winner !== "draw") throw new Error("Equal legs means it's a draw.");
    } else {
      if (Math.max(aLegs, bLegs) !== legsToWin) throw new Error(`Once a player wins ${legsToWin} legs the match is decided.`);
      if (winner === "draw") throw new Error("The legs aren't equal, so choose who won.");
      if ((aLegs > bLegs && winner !== a.id) || (bLegs > aLegs && winner !== b.id)) {
        throw new Error("The chosen winner doesn't match the leg score.");
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
      throw new Error("Fill in all statistics for both players (Average, 180s, Highest checkout, Scoring, First 9 avg., Checkouts, Darts thrown, Best leg, 60+/80+/100+/140+).");
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
    toast("Submitted. Your opponent will confirm the result.");
    router();
  }, "Submit result");
}

// Toont de by de tegenstander (of jou) ingevulde uitslag ter controle,
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
      <h2>Check result</h2>
      <p class="sub" style="margin-bottom:16px">
        ${esc(reporterName || "Your opponent")} submitted this result for
        ${esc(a?.display_name)} &ndash; ${esc(b?.display_name)}. Is this correct?
      </p>
      <div class="card" style="margin-bottom:20px">
        <div style="display:flex;align-items:center;justify-content:center;gap:8px;font-weight:700;margin-bottom:10px">
          ${isDraw ? "Draw" : `
            <span style="width:18px;height:18px;color:var(--accent)">${icon.trophy}</span>
            ${esc(winnerName || "?")} wins
          `}
        </div>
        ${row("Legs", m.player_a_legs, m.player_b_legs)}
        ${row("Average", m.player_a_average, m.player_b_average)}
        ${rowIf("Scoring", m.player_a_scoring_average, m.player_b_scoring_average)}
        ${rowIf("First 9 avg.", m.player_a_first9_average, m.player_b_first9_average)}
        ${rowIf("Checkout %", checkoutPct(m.player_a_checkouts_hit, m.player_a_checkout_attempts), checkoutPct(m.player_b_checkouts_hit, m.player_b_checkout_attempts))}
        ${rowIf("Checkouts", checkoutFraction(m.player_a_checkouts_hit, m.player_a_checkout_attempts), checkoutFraction(m.player_b_checkouts_hit, m.player_b_checkout_attempts))}
        ${row("Hoogste finish", m.player_a_highest_checkout, m.player_b_highest_checkout)}
        ${rowIf("Darts thrown", m.player_a_darts_thrown, m.player_b_darts_thrown)}
        ${rowIf("Best leg", m.player_a_best_leg_darts, m.player_b_best_leg_darts)}
        ${rowIf("60+", m.player_a_score_60_plus, m.player_b_score_60_plus)}
        ${rowIf("80+", m.player_a_score_80_plus, m.player_b_score_80_plus)}
        ${rowIf("100+", m.player_a_score_100_plus, m.player_b_score_100_plus)}
        ${rowIf("140+", m.player_a_score_140_plus, m.player_b_score_140_plus)}
        ${row("180's", m.player_a_180s, m.player_b_180s)}
      </div>
      <div id="confirmError"></div>
      <div class="modal-actions" style="justify-content:space-between">
        <button type="button" class="btn ghost" id="rejectBtn">Reject</button>
        <button type="button" class="btn" id="approveBtn">Confirm</button>
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
      toast("Result confirmed");
      close();
      router();
    } catch (e) {
      busy(btn, false, "Confirm");
      showError(e);
    }
  };
  bg.querySelector("#rejectBtn").onclick = async () => {
    const btn = bg.querySelector("#rejectBtn");
    busy(btn, true);
    try {
      await db.rejectMatch(matchId);
      toast("Result rejected. It can be submitted again.");
      close();
      router();
    } catch (e) {
      busy(btn, false, "Reject");
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
    "Just a moment of setup",
    "The app doesn't know yet which database to talk to",
    `<div class="card" style="text-align:left">
      <p style="margin-top:0">Open <code>js/config.js</code> and fill in your Supabase details:</p>
      <p class="muted" style="font-size:13.5px;margin-bottom:0">
        You'll find them in your Supabase project under Project Settings &rarr; API.
        Copy the Project URL and the anon public key.
      </p>
    </div>`
  );
}

async function boot() {
  const { data } = await sb.auth.getSession();
  state.session = data.session;

  if (state.session) {
    try {
      [state.profile, state.onboarding] = await Promise.all([
        db.myProfile(state.session.user.id),
        db.myOnboarding(state.session.user.id),
      ]);
    } catch (e) {
      // Meestal: de SQL-migratie is nog niet gedraaid, dus er is geen
      // profielrij voor deze gebruiker.
      console.error(e);
      app.innerHTML = authShell(
        "Your profile is missing",
        "There's no profile row for this account",
        `<div class="card" style="text-align:left">
          <p style="margin-top:0">Run the SQL migration in Supabase (SQL Editor) and log in again.</p>
        </div>
        <button class="btn block mt16" onclick="signOut()">Log out</button>`
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
// lezen. Werkt hierdoor ook onaangetast by voor normale routes (#/leagues
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

// Push notifications on this device inschakelen: registreert de service worker,
// vraagt toestemming, en slaat het abonnement op zodat send-push-
// notifications er meldingen naartoe kan sturen. Vereist een expliciete
// gebruikersactie (knop) - browsers staan geen stille aanvraag toe.
async function enablePushNotifications() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return toast("Push notifications aren't supported on this device or in this browser.");
  }
  try {
    const reg = await navigator.serviceWorker.register("/sw.js");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return toast("Notification permission denied.");
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
    toast("Push notifications enabled on this device.");
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
      [state.profile, state.onboarding] = await Promise.all([
        db.myProfile(session.user.id).catch(() => null),
        db.myOnboarding(session.user.id).catch(() => null),
      ]);
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
