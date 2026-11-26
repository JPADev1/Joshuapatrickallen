// jpa-live v5: Josh Allen live stats from Tank01 for notjoshingaround.com
// v5: "Shut up, Collinsworth" counter at /?shutup (needs a D1 binding named SHUTUP to the jpa-shutup database;
// without it the rest of the Worker runs exactly as v4 and the counter just reports "not connected").
// Tank01 is called ONLY by the Worker's own timer, and ONLY from 10 minutes before a Bills kickoff until the game is
// final. Visitors read the saved copy (KV), so page views never use Tank01 requests.
// v4: the timer runs every minute (Cloudflare: Settings > Triggers > Cron "* * * * *"), and the Worker picks how often
// to actually call Tank01: every minute while the ball is in play, every 5 minutes before kickoff and at halftime,
// and slower if the free plan's monthly calls (1,000, reset on the 1st) run short for the games left that month.
// Check it any time at /?quota.
// v3: the same box-score call now includes play-by-play, and the Worker builds the Bills win-chance curve from
// every play (score, time left, who has the ball, down, distance, field position, pregame line), so every
// visitor gets the whole curve from kickoff. Also passes the quarter, which v2 left out.
const HOST = "tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com";
const MATCHUP = "https://raw.githubusercontent.com/JPADev1/Joshuapatrickallen/stats-data/matchup.json";
const BEFORE = 10 * 60e3, AFTER = 8 * 3600e3; // game window: 10 min before kickoff until final (8 hours at most)
// 2026 Bills regular season (nflverse game id, kickoff ET). The matchup file still supplies flexed times and playoff games.
const SCHEDULE = [["2026_01_BUF_HOU","2026-09-13 13:00"],["2026_02_DET_BUF","2026-09-17 20:15"],["2026_03_LAC_BUF","2026-09-27 13:00"],
  ["2026_04_NE_BUF","2026-10-04 13:00"],["2026_05_BUF_LA","2026-10-12 20:15"],["2026_06_BUF_LV","2026-10-18 16:25"],
  ["2026_08_BAL_BUF","2026-11-01 13:00"],["2026_09_BUF_MIN","2026-11-09 20:15"],["2026_10_BUF_NYJ","2026-11-15 13:00"],
  ["2026_11_MIA_BUF","2026-11-22 13:00"],["2026_12_KC_BUF","2026-11-26 20:20"],["2026_13_BUF_NE","2026-12-06 16:25"],
  ["2026_14_BUF_GB","2026-12-13 20:20"],["2026_15_CHI_BUF","2026-12-19 20:20"],["2026_16_BUF_DEN","2026-12-25 16:30"],
  ["2026_17_BUF_MIA","2027-01-03 13:00"],["2026_18_NYJ_BUF","2027-01-10 13:00"]];
const MONTHS = { "Jan.": 0, "Feb.": 1, "March": 2, "April": 3, "May": 4, "June": 5, "July": 6,
  "Aug.": 7, "Sept.": 8, "Oct.": 9, "Nov.": 10, "Dec.": 11 };
const TEAM = { LA: "LAR", WAS: "WSH" }; // nflverse vs Tank01 abbreviations (the backup lookup covers any others)

function etWall(ms) { // the Eastern-time wall clock at a moment, as if it were UTC
  const p = {};
  new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric",
    month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" })
    .formatToParts(new Date(ms)).forEach(x => (p[x.type] = x.value));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
}
function kickoff(m) { // "Sunday, Nov. 1, 2026" + "1:00 p.m. ET" -> UTC milliseconds
  const d = /, (\S+) (\d+), (\d{4})$/.exec(m.date || ""), t = /(\d+):(\d+) (a|p)\.m\./.exec(m.time || "");
  if (!d || !t || MONTHS[d[1]] == null) return null;
  return etToUTC(+d[3], MONTHS[d[1]], +d[2], (+t[1] % 12) + (t[3] === "p" ? 12 : 0), +t[2]);
}
function etToUTC(y, mo, d, h, mi) { const g = Date.UTC(y, mo, d, h, mi); return g + (g - etWall(g)); }
function ymdET(ms) { const d = new Date(etWall(ms)); return d.toISOString().slice(0, 10).replaceAll("-", ""); }

let QUOTA = null, CALLS = 0; // what RapidAPI said about the monthly quota on the last call, and calls made this run
async function tank(path, env) {
  const r = await fetch("https://" + HOST + path, {
    headers: { "x-rapidapi-key": env.TANK01_KEY, "x-rapidapi-host": HOST } });
  CALLS++;
  const lim = r.headers.get("x-ratelimit-requests-limit"), rem = r.headers.get("x-ratelimit-requests-remaining"), rs = r.headers.get("x-ratelimit-requests-reset");
  if (rem != null) QUOTA = { limit: +lim || null, remaining: +rem, resetsAt: rs != null ? new Date(Date.now() + +rs * 1000).toISOString() : null, at: new Date().toISOString() };
  if (!r.ok) throw new Error("Tank01 answered " + r.status);
  const j = await r.json();
  return j && typeof j.body === "object" ? j.body : null;
}
async function box(id, env) { // one request; play-by-play rides along in the same call
  const b = await tank("/getNFLBoxScore?gameID=" + encodeURIComponent(id) + "&playByPlay=true&fantasyPoints=false", env);
  return b && b.gameStatus ? b : null;
}

// ---------------- Win chance model ----------------
// Fitted on nflverse play-by-play, 2021-2025 seasons (about 240,000 plays, scored against how each game ended).
// On the 2025 season, held out of the fit, it matched nflfastR's own win-probability model (log loss .474 vs .478).
// ep(): expected points for the team with the ball. wpPos(): that team's chance to win.
const EPC = [6.5829,-0.07112,0.01272,-0.00403,-0.55559,-1.18414,-2.96698,-0.40383,-0.05277,0.18943,0.30669,0.01822];
const WPC = [-0.01677,0.07734,0.06745,0.13647,0.02848,0.02646,0.01488,-0.0327,0.3486,0.13238,0.33756];
function ep(down, dist, yl) {
  dist = Math.max(1, Math.min(40, dist)); const ld = Math.log(dist), c = EPC;
  return c[0] + c[1]*yl + c[2]*yl*yl/100 + c[3]*yl*yl*yl/1e4 + c[4]*(down === 2 ? 1 : 0) + c[5]*(down === 3 ? 1 : 0) + c[6]*(down === 4 ? 1 : 0)
    + c[7]*ld + c[8]*(down === 3 ? ld : 0) + c[9]*(down === 4 ? ld : 0) + c[10]*(down === 4 && yl <= 35 ? 1 : 0) + c[11]*Math.min(yl,10);
}
function wpPos(diff, e, mu, secLeft) { // diff, e, mu all from the side of the team with the ball
  const r = Math.max(0, secLeft) / 3600, s = Math.sqrt(r + .0025), c = WPC;
  const L = diff > 0 && secLeft <= 120 ? 1 : 0, t = (120 - Math.min(120, Math.max(0, secLeft))) / 120;
  const z = c[0] + c[1]*diff/s + c[2]*e/s + c[3]*mu*s + c[4]*diff + c[5]*e + c[6]*mu + c[7]*(r < .05 ? diff + e : 0)
    + c[8]*L + c[9]*L*t + c[10]*(diff <= 8 ? L : 0);
  return 1 / (1 + Math.exp(-z));
}
const KO = ep(1, 10, 75); // after a kickoff: about 1st and 10 at the receiving team's 25
const ko = secLeft => KO * Math.min(1, Math.max(0, secLeft) / 90); // with seconds left, getting the ball is worth less
// Bills chance. lead/mu are from the Bills' side; who: "BUF" | "OPP" | null (unknown: average of both).
function billsWP(lead, mu, secLeft, who, e) {
  if (secLeft <= 0 && lead !== 0) return lead > 0 ? 1 : 0;         // time's up: the lead decides
  if (who === "BUF") return wpPos(lead, e, mu, secLeft);
  if (who === "OPP") return 1 - wpPos(-lead, e, -mu, secLeft);
  return (wpPos(lead, ko(secLeft), mu, secLeft) + 1 - wpPos(-lead, ko(secLeft), -mu, secLeft)) / 2;
}
// Last 40 seconds with the trailing side on offense: the fitted model is thin here, so use what's still possible
// from where the ball is (a field goal try, a shot at the end zone, or a Hail Mary).
function endgame(p, lead, who, yl, secLeft) {
  if (secLeft > 40 || !who || yl == null) return p;
  const need = who === "BUF" ? -lead : lead; if (need <= 0) return p;
  let q = who === "BUF" ? p : 1 - p;                                   // chance for the team with the ball
  if (need <= 3 && yl <= 35) q = Math.max(q, yl <= 25 ? .9 : .8);     // in field-goal range: kick it to win or tie
  if (secLeft <= 15) q = need <= 3 ? (yl <= 35 ? Math.max(q, .8) : yl <= 45 ? .45 : yl <= 60 ? .06 : .02)
    : need <= 8 ? (yl <= 5 ? .5 : yl <= 20 ? .25 : yl <= 60 ? .04 : .015) : .001;
  return who === "BUF" ? q : 1 - q;
}
// Pregame Bills edge in points, from the line in matchup.json (spread first, then no-vig moneylines).
function pregameMu(mf, gameId) {
  const ln = mf && mf.gameId === gameId && mf.lines; if (!ln || (ln.gameId && ln.gameId !== gameId)) return null;
  const c = ln.cur || ln.open || {};
  if (c.spread != null && !isNaN(+c.spread)) return -c.spread;
  const imp = ml => (ml = +ml) ? (ml < 0 ? -ml / (-ml + 100) : 100 / (ml + 100)) : null, a = imp(c.ml), b = imp(c.oppMl);
  if (a == null || b == null) return null;
  let p = a / (a + b), lo = -40, hi = 40; // invert the kickoff chance to points with the model itself
  for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (billsWP(0, m, 3600, null) < p) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

// ---------------- Play-by-play -> curve ----------------
const first = (o, keys) => { for (const k of keys) if (o && o[k] != null && o[k] !== "") return o[k]; return null; };
const list = x => Array.isArray(x) ? x : x && typeof x === "object" ? Object.values(x) : [];
function quarter(v) { // "Q2", "2nd", "2", "OT" -> 1..5
  const s = String(v == null ? "" : v).toLowerCase();
  if (/ot|overtime/.test(s)) return 5;
  const m = /([1-4])/.exec(s); return m ? +m[1] : null;
}
function elapsed(q, clock) { // seconds into the game
  const m = /(\d{1,2}):(\d{2})/.exec(String(clock || "")); if (!q || !m) return null;
  const left = +m[1] * 60 + +m[2];
  return q <= 4 ? (q - 1) * 900 + (900 - Math.min(900, left)) : 3600 + (600 - Math.min(600, left));
}
// "1st & 10 at BUF 25", "3rd and Goal at MIA 4", "2nd & 7 at 50" -> {down, dist, side, yard}
function situation(s) {
  const m = /([1-4])(?:st|nd|rd|th)?\s*(?:&|and)\s*(goal|\d+)\s*(?:at|on)\s*(?:([A-Za-z]{2,3})\s*)?(\d{1,2})/i.exec(String(s || ""));
  if (!m) return null;
  return { down: +m[1], dist: /goal/i.test(m[2]) ? null : +m[2], side: m[3] ? m[3].toUpperCase() : null, yard: +m[4] };
}
function buildCurve(b, mu) {
  const billsHome = b.home === "BUF", opp = billsHome ? b.away : b.home;
  const idTeam = {}; if (b.teamIDHome) idTeam[b.teamIDHome] = b.home; if (b.teamIDAway) idTeam[b.teamIDAway] = b.away;
  const teamOf = o => { const t = first(o, ["teamAbv", "team", "teamAbbreviation", "posteam", "possession"]);
    return t ? (TEAM[t] || String(t).toUpperCase()) : idTeam[first(o, ["teamID", "teamId"])] || null; };
  const pts = (o, side) => { const v = first(o, side === "home" ? ["homeScore", "homePts", "home_score"] : ["awayScore", "awayPts", "away_score"]);
    return v == null ? null : parseInt(v, 10); };
  // Score timeline from the scoring plays (used when plays don't carry the score themselves)
  const scores = list(b.scoringPlays).map(s => ({ t: elapsed(quarter(first(s, ["scorePeriod", "period", "quarter"])), first(s, ["scoreTime", "time", "clock"])),
    h: pts(s, "home"), a: pts(s, "away") })).filter(s => s.t != null && s.h != null && s.a != null).sort((x, y) => x.t - y.t);
  const plays = list(first(b, ["allPlayByPlay", "playByPlay", "plays"]));
  const out = [], seen = { h: 0, a: 0 };
  let last = null, lastWho = null, lastText = "", sitNow = "";
  plays.forEach(pl => {
    const t = elapsed(quarter(first(pl, ["playPeriod", "period", "quarter", "qtr"])), first(pl, ["playClock", "clock", "gameClock", "time"]));
    if (t == null) return;
    let h = pts(pl, "home"), a = pts(pl, "away");
    if (h == null || a == null) { h = 0; a = 0; for (const s of scores) if (s.t <= t) { h = s.h; a = s.a; } }
    const text = String(first(pl, ["play", "playDescription", "description", "text"]) || "");
    if (/^\s*(timeout|two-minute warning|end (of )?(the )?(quarter|half|game)|end quarter|end game)/i.test(text)) return; // not a play
    const team = teamOf(pl), sit = situation(first(pl, ["downAndDistance", "downDistance", "situation", "down_and_distance"]));
    let who = null, e = 0, yl = null;
    if (sit && team) {
      sitNow = team + " ball, " + String(first(pl, ["downAndDistance", "downDistance", "situation", "down_and_distance"])).trim();
      yl = sit.side == null ? 50 : sit.side === team ? 100 - sit.yard : sit.yard;
      who = team === "BUF" ? "BUF" : "OPP"; e = ep(sit.down, sit.dist == null ? yl : sit.dist, Math.max(1, Math.min(99, yl)));
    } else if (/kicks/i.test(text)) { // kickoff: the side kicking is named in the text ("kicks 58 yards from BUF 35")
      const kf = /kicks.*?from ([A-Za-z]{2,3}) \d+/i.exec(text), kicker = kf ? (TEAM[kf[1].toUpperCase()] || kf[1].toUpperCase()) : null;
      if (kicker || team) { who = (kicker ? kicker === "BUF" : team !== "BUF") ? "OPP" : "BUF"; e = ko(3600 - t); yl = 75; }
    }
    const bills = billsHome ? h : a, them = billsHome ? a : h;
    // A scoring play: the down and distance are from before the snap, but the score already counts the points,
    // so use what comes next instead (the other side receives the kickoff; a try is still to come after a TD).
    const gain = h + a - seen.h - seen.a; let lead = bills - them;
    if (gain > 0) {
      const billsScored = bills > (billsHome ? seen.h : seen.a);
      if (gain === 6) lead += billsScored ? .95 : -.95;
      who = billsScored ? "OPP" : "BUF"; e = ko(3600 - t); yl = 75;
    }
    if (!who) { lastText = text; return; } // no snap, kickoff or score (a missed try, timeout, end of quarter): no point
    const p = endgame(billsWP(lead, mu, 3600 - t, who, e), lead, who, yl, 3600 - t);
    // Marks: touchdowns, field goals, and turnovers (the ball changing sides on scrimmage plays with no kick or score between)
    const kind = gain >= 6 ? "td" : gain === 3 ? "fg"
      : who && sit && lastWho && who !== lastWho && !/punt|kick|field goal|extra point|two-point|end of (half|quarter)/i.test(lastText) ? "to" : "";
    seen.h = h; seen.a = a;
    if (who && sit) lastWho = who; else if (who) lastWho = null; lastText = text;
    const pt = [t, Math.round(p * 1000) / 1000, bills, them, kind, text.replace(/\s+/g, " ").slice(0, 90)];
    if (last && last[0] === t) { // same game time (a score, its try, the kickoff): one point with the latest state, keeping the mark
      if (last[4] && !kind) { pt[4] = last[4]; if (!/field goal|touchdown|safety/i.test(text)) pt[5] = last[5]; } out.pop(); }
    out.push(pt); last = pt;
  });
  return { opp: opp, pts: out, sit: sitNow };
}

// ---------------- How often to call Tank01 ----------------
const GAME_MIN = 200;   // minutes of calls per game: 10 before kickoff + about 3 hours 10 minutes
const PER_GAME = 175;   // calls a game at the normal pace (1 a minute in play, every 5 before kickoff and at halftime)
function monthKey(ms) { return new Date(ms).toISOString().slice(0, 7); } // the free quota resets on the 1st
// Remaining calls this month: RapidAPI's own count when we have it (and it is this month's), else 1,000 less our own count.
function remaining(prev, now) {
  const q = prev && prev.quota, u = prev && prev.usage;
  if (q && q.remaining != null && monthKey(Date.parse(q.at)) === monthKey(now)) return q.remaining;
  return 1000 - (u && u.month === monthKey(now) ? u.n : 0);
}
// Minutes between calls right now: 1 in play; 5 before kickoff and at halftime; slower if the month's calls are short.
function cadence(now, k, prev, games) {
  const st = prev ? (prev.status + " " + prev.period + " " + prev.clock) : "";
  const base = now < k ? 5 : /half/i.test(st) && !/2nd half|1st half/i.test(st) ? 5 : 1;
  const left = remaining(prev, now);
  if (left <= 5) return 0;                                            // nearly out: stop, keep the last numbers
  const later = games.filter(x => x.k > now + 3600e3 && monthKey(x.k) === monthKey(now)).length;
  const share = left / (later + 1);                                  // split what's left evenly with the games still to come
  const mins = Math.max(10, k + GAME_MIN * 60e3 - now) / 60e3;
  for (const c of [base, 2, 3, 5, 10]) if (c >= base && mins / c * .9 <= share) return c;
  return later ? Math.max(base, Math.ceil(mins / Math.max(1, left / (later + 1)))) : 10;
}

async function tick(env, when) {
  const now = when || Date.now();
  CALLS = 0; QUOTA = null;
  // Kickoffs: the built-in schedule, with the matchup file's time winning when it covers the same game (flex) or adds one (playoffs).
  const games = SCHEDULE.map(([id, t]) => ({ id: String(id), k: etToUTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10), +t.slice(11, 13), +t.slice(14, 16)) }));
  const mf = await fetch(MATCHUP, { cf: { cacheTtl: 60 } }).then(r => (r.ok ? r.json() : null)).catch(() => null); // free (GitHub)
  const mk = mf && mf.gameId && kickoff(mf);
  if (mk) { const i = games.findIndex(x => x.id === mf.gameId); if (i >= 0) games[i].k = mk; else games.push({ id: String(mf.gameId), k: mk }); }
  const g = games.find(x => now >= x.k - BEFORE && now <= x.k + AFTER);
  if (!g) return;                                                     // not game time: no Tank01 call
  const m = { gameId: g.id }, k = g.k;
  const prev = await env.LIVE.get("game", { type: "json" });
  if (prev && prev.nflGame === m.gameId && /final|completed/i.test(prev.status)) return; // final already saved
  const every = cadence(now, k, prev && prev.nflGame === m.gameId ? prev : (prev ? { quota: prev.quota, usage: prev.usage, status: "", period: "", clock: "" } : null), games);
  if (!every || Math.floor(now / 60e3) % every !== 0) return;         // not this minute (the timer fires every minute)

  const p = m.gameId.split("_"), away = TEAM[p[2]] || p[2], home = TEAM[p[3]] || p[3];
  let id = (prev && prev.nflGame === m.gameId && prev.gameID) || ymdET(k) + "_" + away + "@" + home;
  let b = await box(id, env);
  if (!b) { // backup: look the game up by date
    const s = await tank("/getNFLScoresOnly?gameDate=" + ymdET(k), env) || {};
    const hit = (Array.isArray(s) ? s.map(g => [g.gameID, g]) : Object.entries(s))
      .find(([, g]) => g.home === "BUF" || g.away === "BUF");
    if (!hit) return;
    id = hit[1].gameID || hit[0];
    b = await box(id, env);
    if (!b) return;
  }
  const allen = Object.values(b.playerStats || {}).find(x => /josh allen/i.test(x.longName || "") &&
    (x.team || x.teamAbv) === "BUF") || null;
  const rec = { live: true, nflGame: m.gameId, gameID: id, status: b.gameStatus || "", clock: b.gameClock || "",
    period: b.currentPeriod || b.gamePeriod || b.quarter || "",
    away: b.away, awayPts: b.awayPts, home: b.home, homePts: b.homePts, allen };
  const mo = monthKey(now), pu = prev && prev.usage && prev.usage.month === mo ? prev.usage.n : 0;
  rec.usage = { month: mo, n: pu + CALLS };                          // our own count of Tank01 calls this month
  rec.quota = QUOTA || (prev && prev.quota) || null;                  // RapidAPI's count, from the response headers
  rec.every = every; rec.poll = Number(env.CLIENT_POLL) || 60;        // seconds between visitors' checks (CLIENT_POLL to change)
  rec.wp = winCurve(b, prev && prev.nflGame === m.gameId ? prev.wp : null, pregameMu(mf, m.gameId), rec);
  if (JSON.stringify(prev && { ...prev, fetched: undefined }) !== JSON.stringify(rec)) {
    rec.fetched = new Date().toISOString();
    await env.LIVE.put("game", JSON.stringify(rec));                  // only written when something changed
  }
}
// The curve for the record: rebuilt from every play when Tank01 sends them; otherwise one point per update
// (score, clock, quarter), kept in KV so it still runs from kickoff for every visitor.
function winCurve(b, old, mu, rec) {
  if (mu == null) mu = old && old.mu != null ? old.mu : 0;
  const p0 = Math.round(billsWP(0, mu, 3600, null) * 1000) / 1000, bh = b.home === "BUF";
  const fin = /final|completed/i.test(rec.status);
  const lb = parseInt(bh ? b.homePts : b.awayPts, 10) || 0, lo = parseInt(bh ? b.awayPts : b.homePts, 10) || 0;
  const c = buildCurve(b, mu);
  let pts = c.pts, src = "plays";
  if (pts.length < 2) { // no usable play-by-play: append this update's point
    src = "updates"; pts = (old && old.src === "updates" && old.pts) || [];
    const t = /half/i.test(rec.period + " " + rec.status) ? 1800 : elapsed(quarter(rec.period), rec.clock);
    if (t != null && !fin) {
      const lp = pts[pts.length - 1];
      if (!lp || t > lp[0] || lp[2] !== lb || lp[3] !== lo)
        pts = pts.concat([[Math.max(t, lp ? lp[0] : 0), Math.round(billsWP(lb - lo, mu, 3600 - t, null, 0) * 1000) / 1000, lb, lo, "", ""]]);
    }
  }
  if (fin) { const end = Math.max(3600, pts.length ? pts[pts.length - 1][0] : 3600);
    pts = pts.concat([[end, lb > lo ? 1 : lb < lo ? 0 : .5, lb, lo, "end", "Final"]]); }
  return { mu: Math.round(mu * 10) / 10, p0: p0, src: src, sit: fin || src !== "plays" ? "" : c.sit, pts: pts };
}

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(tick(env, event.scheduledTime)); }, // the 1-minute timer
  async fetch(request, env) {                                          // visitors: read the saved copy only
    const url = new URL(request.url);
    // One-time check of Tank01's play-by-play format on the last saved game (uses ONE Tank01 request, ever;
    // after that the saved answer is returned). Delete the "replay" key in KV to run it again.
    if (url.searchParams.has("replay")) {
      let out = await env.LIVE.get("replay", { type: "json" });
      if (!out) {
        const prev = await env.LIVE.get("game", { type: "json" });
        if (!prev || !prev.gameID) return json({ error: "no saved game to replay" });
        QUOTA = null;
        const b = await box(prev.gameID, env).catch(e => ({ error: String(e) }));
        if (!b || b.error) return json({ error: (b && b.error) || "no box score" });
        const plays = list(first(b, ["allPlayByPlay", "playByPlay", "plays"]));
        const mf = await fetch(MATCHUP).then(r => (r.ok ? r.json() : null)).catch(() => null);
        out = { gameID: prev.gameID, boxKeys: Object.keys(b), currentPeriod: b.currentPeriod, gameClock: b.gameClock,
          playCount: plays.length, samplePlays: plays.slice(0, 3).concat(plays.slice(-2)),
          scoringSample: list(b.scoringPlays).slice(0, 2),
          wp: winCurve(b, null, pregameMu(mf, prev.nflGame), { status: b.gameStatus || "", period: b.currentPeriod || "", clock: b.gameClock || "" }) };
        await env.LIVE.put("replay", JSON.stringify(out));
        if (QUOTA) { prev.quota = QUOTA; await env.LIVE.put("game", JSON.stringify(prev)); } // so /?quota shows RapidAPI's real count
      }
      return json(out);
    }
    if (url.searchParams.has("quota")) { // how the free plan is holding up
      const rec = await env.LIVE.get("game", { type: "json" }), now = Date.now();
      const games = SCHEDULE.map(([id, t]) => ({ id, k: etToUTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10), +t.slice(11, 13), +t.slice(14, 16)) }));
      const next = games.filter(x => x.k > now - AFTER).slice(0, 3);
      const left = remaining(rec, now), later = games.filter(x => x.k > now && monthKey(x.k) === monthKey(now)).length;
      return json({ month: monthKey(now), callsLeft: left, fromRapidAPI: !!(rec && rec.quota && monthKey(Date.parse(rec.quota.at)) === monthKey(now)),
        rapidapi: rec && rec.quota || null, workerCallsThisMonth: rec && rec.usage && rec.usage.month === monthKey(now) ? rec.usage.n : 0,
        billsGamesLeftThisMonth: later, callsPerGameAtFullSpeed: PER_GAME,
        onTrack: left >= later * PER_GAME ? "Yes: every minute for every game left this month" : "Tight: the Worker will slow down to stay under the cap",
        lastGame: rec ? { game: rec.nflGame, status: rec.status, minutesBetweenCalls: rec.every || null, updated: rec.fetched || null } : null,
        nextGames: next.map(x => ({ game: x.id, kickoffUTC: new Date(x.k).toISOString() })) });
    }
    if (url.searchParams.has("shutup")) return shutup(request, env);
    return json(await saved(env));
  },
};
async function saved(env) { // busy games: serve the copy read in the last 15s
  if (MEMO && Date.now() - MEMO.t < 15e3) return MEMO.rec;
  const rec = await env.LIVE.get("game", { type: "json" });
  MEMO = { t: Date.now(), rec: rec || { live: false, note: "No Bills game data yet" } };
  return MEMO.rec;
}

// ---------------- "Shut up, Collinsworth" counter ----------------
// GET  /?shutup            today's totals: {day, today, game, live, final, kickoff}
// POST /?shutup  body "n=5" adds a fan's presses since their last send (1 to 30 per send; the page sends every 2 s).
// "today" counts every press on the Eastern-time date; "game" only presses from kickoff to the final whistle of today's
// Bills game. Stored in D1 (binding SHUTUP, table presses(day, scope, n)), so every visitor sees the same numbers.
let SHUT = null; // last totals read, reused for 5 s so lots of fans checking the count don't each read D1
async function shutup(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { headers: { "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "Content-Type" } });
  if (!env.SHUTUP) return json({ error: "counter not connected" });
  const now = Date.now(), day = new Date(etWall(now)).toISOString().slice(0, 10);
  const today = SCHEDULE.find(([, t]) => t.slice(0, 10) === day);
  const kick = today ? etToUTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), +today[1].slice(11, 13), +today[1].slice(14, 16)) : null;
  let final = false;
  if (kick && now >= kick) {
    const rec = await saved(env);
    final = !!(rec && rec.gameID && String(rec.gameID).slice(0, 8) === day.replaceAll("-", "") && /final|completed/i.test(rec.status || ""));
  }
  const live = !!kick && now >= kick && !final && now < kick + 6 * 3600e3;
  const totals = rows => { const o = { day, today: 0, game: 0, live, final, kickoff: kick ? new Date(kick).toISOString() : null };
    (rows || []).forEach(r => { if (r.scope === "day") o.today = r.n; if (r.scope === "game") o.game = r.n; }); return o; };
  const read = env.SHUTUP.prepare("SELECT scope, n FROM presses WHERE day = ?1").bind(day);
  if (request.method !== "POST") {
    if (SHUT && SHUT.day === day && now - SHUT.t < 5e3) return json(Object.assign({}, SHUT.out, { live, final }));
    const out = totals((await read.all()).results);
    SHUT = { t: now, day, out };
    return json(out);
  }
  const m = /(\d+)/.exec(await request.text()), n = m ? Math.min(30, +m[1]) : 0;
  if (n < 1) return json({ error: "nothing to add" });
  const add = scope => env.SHUTUP.prepare("INSERT INTO presses (day, scope, n) VALUES (?1, ?2, ?3) " +
    "ON CONFLICT(day, scope) DO UPDATE SET n = n + excluded.n").bind(day, scope, n);
  const res = await env.SHUTUP.batch(live ? [add("day"), add("game"), read] : [add("day"), read]);
  const out = totals(res[res.length - 1].results);
  SHUT = { t: now, day, out };
  return json(out);
}
let MEMO = null; // last copy read from KV in this Worker instance (fewer KV reads when lots of fans are watching)
function json(o) {
  return new Response(JSON.stringify(o, null, 2), {
    headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
