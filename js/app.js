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
  profile: null,   // profiel van de ingelogde gebruiker
  session: null,
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

function matchCard(m) {
  const a = m.player_a, b = m.player_b;
  const played = m.player_a_legs > 0 || m.player_b_legs > 0;
  const aWin = m.winner_id && m.winner_id === m.player_a_id;
  const bWin = m.winner_id && m.winner_id === m.player_b_id;
  return `
    <div class="card">
      <div class="match-top">
        <span class="match-league">${esc(m.league?.name || "")}</span>
        ${badge(m.status)}
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
        </div>` : ""}
      ${m.scheduled_at ? `<div class="match-meta">${icon.clock}<span>${esc(fmtDate(m.scheduled_at))}</span></div>` : ""}
    </div>`;
}

function leagueCard(l, clickable = true) {
  const meta = [
    l.season,
    `${l.game_type} · best of legs`,
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
    const { error } = await sb.from("leagues").insert(fields);
    if (error) throw error;
  },

  async setLeagueStatus(id, status) {
    const { error } = await sb.from("leagues").update({ status }).eq("id", id);
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
      .select("*, player_a:player_a_id(*), player_b:player_b_id(*), league:league_id(name)")
      .eq("league_id", leagueId)
      .order("scheduled_at", { nullsFirst: false });
    if (error) throw error;
    return data || [];
  },

  async myMatches(playerId) {
    const { data, error } = await sb
      .from("league_matches")
      .select("*, player_a:player_a_id(*), player_b:player_b_id(*), league:league_id(name)")
      .or(`player_a_id.eq.${playerId},player_b_id.eq.${playerId}`)
      .order("scheduled_at", { nullsFirst: false });
    if (error) throw error;
    return data || [];
  },

  async allMatches(limit = 50) {
    const { data, error } = await sb
      .from("league_matches")
      .select("*, player_a:player_a_id(*), player_b:player_b_id(*), league:league_id(name)")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
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

  // Uitslag doorgeven. Zet de status op pending_confirmation; de
  // organisator bevestigt daarna.
  async reportResult(matchId, aLegs, bLegs, winnerId) {
    const { error } = await sb.from("league_matches").update({
      player_a_legs: aLegs,
      player_b_legs: bLegs,
      winner_id: winnerId,
      status: "pending_confirmation",
    }).eq("id", matchId);
    if (error) throw error;
  },

  async confirmMatch(matchId) {
    const { error } = await sb.from("league_matches").update({
      status: "confirmed",
      confirmed_at: new Date().toISOString(),
    }).eq("id", matchId);
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
          <div class="auth-mark"></div>
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

  app.innerHTML = `
    <div class="landing">
      <div class="landing-nav">
        <div class="brand">
          <div class="brand-mark"></div>
          <span class="brand-name">Dart League</span>
        </div>
        <button class="btn ghost sm" onclick="renderLogin()">Inloggen</button>
      </div>

      <div class="landing-hero">
        <div>
          <span class="landing-eyebrow">${icon.target}&nbsp;Voor elke darter</span>
          <h1>Jouw dartcompetitie, overzichtelijk georganiseerd</h1>
          <p class="sub">Speel mee in leagues en toernooien, plan je wedstrijden en houd je scores en statistieken automatisch bij &mdash; allemaal op één plek.</p>
          <div class="landing-cta">
            <button class="btn" onclick="renderRegister()">Gratis account aanmaken</button>
            <button class="btn ghost" onclick="renderLogin()">Inloggen</button>
          </div>
        </div>

        <div class="landing-preview">
          <div class="landing-preview-tag">Halve finale &middot; League Zuid</div>
          <div class="card" style="margin:0">
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
          <div class="grid">
            ${statCard({ label: "Winratio", value: "68%", ico: "trophy", color: "#2ECC71" })}
            ${statCard({ label: "180's", value: "24", ico: "star", color: "#F5B942" })}
          </div>
        </div>
      </div>

      <div class="landing-steps">
        <h2>Zo werkt het</h2>
        <div class="landing-step-list">
          ${step("01", "Maak een account", "Binnen een minuut aangemeld, zonder gedoe.")}
          ${step("02", "Sluit je aan bij een league of toernooi", "De beheerder zet ze voor je klaar, jij doet mee.")}
          ${step("03", "Speel en volg je voortgang", "Standen, uitslagen en statistieken staan direct klaar.")}
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
    </button>`).join("");

  app.innerHTML = `
    <div class="shell">
      <nav class="sidebar" aria-label="Hoofdmenu">
        <div class="brand"><div class="brand-mark"></div><span class="brand-name">Dart League</span></div>
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
  "beheer/instellingen": viewSettings,
};

async function router() {
  const route = currentRoute();

  if (route === "nieuw-wachtwoord") return renderNewPassword();
  if (!state.session) return renderLanding();

  renderShell();

  try {
    if (route.startsWith("league/")) {
      return await viewLeagueDetail(route.split("/")[1]);
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

async function viewHome() {
  const me = state.profile;
  const firstName = (me?.display_name || "").split(" ")[0];
  const s = me?.stats;

  const [matches, leagues, tournaments, results] = await Promise.all([
    db.myMatches(me.id),
    db.leagues("active"),
    db.upcomingTournaments(),
    db.recentResults(3),
  ]);

  const next = matches.find((m) => m.status === "scheduled" || m.status === "in_progress");
  const winPct = s && s.matches_played > 0
    ? Math.round((s.matches_won / s.matches_played) * 100) : 0;

  setView(`
    <h1>Hoi ${esc(firstName)}</h1>
    <p class="sub">${esc(new Date().toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" }))}</p>

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

async function viewLeagues() {
  const leagues = await db.leagues();
  setView(`
    <h1>Leagues</h1>
    <p class="sub">Alle competities van de organisatie</p>
    ${leagues.length ? leagues.map((l) => leagueCard(l)).join("")
      : emptyView("Nog geen leagues", "De organisator maakt ze aan.", "league")}
  `);
}

async function viewLeagueDetail(id) {
  const [league, matches] = await Promise.all([db.league(id), db.matchesForLeague(id)]);
  setView(`
    <button class="linkbtn" onclick="go('leagues')" style="display:flex;align-items:center;gap:4px;margin-bottom:12px">
      <span style="width:16px;height:16px;display:inline-flex">${icon.back}</span> Leagues
    </button>
    <h1>${esc(league.name)}</h1>
    <p class="sub">${esc([league.season, `${league.game_type} · best of legs`].filter(Boolean).join(" · "))}</p>
    <div style="margin-bottom:24px">${badge(league.status)}</div>

    ${sectionHead("Wedstrijden")}
    ${matches.length ? matches.map(matchCard).join("")
      : emptyView("Nog geen wedstrijden", "Er is nog niets ingepland voor deze league.", "match")}
  `);
}

async function viewTournaments() {
  const list = await db.tournaments();
  setView(`
    <h1>Toernooien</h1>
    <p class="sub">Losse toernooien naast de competitie</p>
    ${list.length ? list.map(tournamentCard).join("")
      : emptyView("Nog geen toernooien", "De organisator maakt ze aan.", "target")}
  `);
}

async function viewMatches() {
  const matches = await db.myMatches(state.profile.id);
  const open = matches.filter((m) => ["scheduled", "in_progress", "pending_confirmation"].includes(m.status));
  const done = matches.filter((m) => !open.includes(m));

  setView(`
    <h1>Je wedstrijden</h1>
    <p class="sub">Alles waar jij aan meedoet</p>
    ${matches.length === 0 ? emptyView("Nog geen wedstrijden", "Zodra je bent ingedeeld, verschijnen ze hier.", "match") : ""}
    ${open.length ? `${sectionHead("Open")}${open.map((m) => `
      ${matchCard(m)}
      ${m.status !== "pending_confirmation" ? `
        <button class="btn ghost sm" style="margin:-4px 0 10px" onclick="openResultDialog('${esc(m.id)}')">Uitslag doorgeven</button>` : ""}
    `).join("")}` : ""}
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
        ${leagueCard(l, false)}
        <div class="chips" style="margin:-4px 0 14px">
          ${["draft", "active", "finished"].filter((s) => s !== l.status).map((s) => `
            <button class="chip" onclick="changeLeagueStatus('${esc(l.id)}','${s}')">
              Zet op ${esc(STATUS[s].label.toLowerCase())}
            </button>`).join("")}
        </div>`).join("")
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
      ${pending.map((m) => `
        ${matchCard(m)}
        <button class="btn sm" style="margin:-4px 0 14px" onclick="confirmMatch('${esc(m.id)}')">Uitslag bevestigen</button>
      `).join("")}` : ""}

    ${sectionHead("Alle wedstrijden")}
    ${matches.length ? matches.map(matchCard).join("")
      : emptyView("Nog geen wedstrijden", "Plan je eerste wedstrijd in.", "match")}
  `);
}

async function confirmMatch(id) {
  try {
    await db.confirmMatch(id);
    toast("Uitslag bevestigd");
    viewManageMatches();
  } catch (e) { toast(errText(e)); }
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

function openModal(title, bodyHtml, onSubmit, submitLabel = "Opslaan") {
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <h2>${esc(title)}</h2>
      <div id="modalError"></div>
      <form id="modalForm">${bodyHtml}
        <div class="modal-actions">
          <button type="button" class="btn ghost" id="cancel">Annuleren</button>
          <button type="submit" class="btn" id="ok">${esc(submitLabel)}</button>
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

function openLeagueDialog() {
  openModal("Nieuwe league", `
    <div class="field"><label for="ln">Naam</label><input id="ln" required placeholder="Bijv. Winterleague"></div>
    <div class="field"><label for="ls">Seizoen</label><input id="ls" placeholder="Bijv. 2026"></div>
    <div class="field"><label for="lg">Speltype</label>
      <select id="lg"><option value="501">501</option><option value="301">301</option></select>
    </div>`, async (bg) => {
    const name = bg.querySelector("#ln").value.trim();
    if (!name) throw new Error("Vul een naam in.");
    await db.createLeague({
      name,
      season: bg.querySelector("#ls").value.trim() || null,
      game_type: bg.querySelector("#lg").value,
      match_format: "best_of_legs",
      status: "draft",
      created_by: state.profile.id,
    });
    toast("League aangemaakt");
    router();
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
}

async function openResultDialog(matchId) {
  const matches = await db.myMatches(state.profile.id);
  const m = matches.find((x) => x.id === matchId);
  if (!m) return toast("Wedstrijd niet gevonden.");

  openModal("Uitslag doorgeven", `
    <p class="sub" style="margin-bottom:18px">Vul het aantal gewonnen legs in.</p>
    <div class="field">
      <label for="ra">${esc(m.player_a?.display_name || "Speler A")}</label>
      <input id="ra" type="number" min="0" max="99" value="0" required>
    </div>
    <div class="field">
      <label for="rb">${esc(m.player_b?.display_name || "Speler B")}</label>
      <input id="rb" type="number" min="0" max="99" value="0" required>
    </div>`, async (bg) => {
    const a = parseInt(bg.querySelector("#ra").value, 10);
    const b = parseInt(bg.querySelector("#rb").value, 10);
    if (isNaN(a) || isNaN(b)) throw new Error("Vul beide scores in.");
    if (a === b) throw new Error("Een wedstrijd kan niet gelijk eindigen.");
    const winner = a > b ? m.player_a_id : m.player_b_id;
    await db.reportResult(matchId, a, b, winner);
    toast("Doorgegeven. De organisator bevestigt het.");
    router();
  }, "Uitslag versturen");
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
      return renderLanding();
    }
    if (!wasLoggedIn) {
      state.profile = await db.myProfile(session.user.id).catch(() => null);
      if (!location.hash || location.hash === "#/nieuw-wachtwoord") location.hash = "#/";
      router();
    }
  });

  window.addEventListener("hashchange", router);
  boot();
}

init();
