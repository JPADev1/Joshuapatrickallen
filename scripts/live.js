// Live game layer: adds Josh Allen's in-progress game (Tank01, via the jpa-live Cloudflare Worker) on top of the
// hourly nflverse files, so every tile, table, record card and mountain moves during Bills games.
// Once nflverse publishes the game (usually that night), the live numbers are dropped automatically and the
// official nflverse line takes over. Nothing here touches Netlify: the Worker is polled from the visitor's browser.
(function(){
  var WORKER = 'https://jpa-live.sterryrochester.workers.dev/';
  var EVERY = 60000;           // 1 minute; the Worker can ask for more or less with "poll" (seconds)
  var ALLEN = '00-0034857';
  var state = null, listeners = [], sig = '', timer = null, changed = false;

  function n(v){ v = parseInt(String(v == null ? '' : v).split('-')[0], 10); return isNaN(v) ? 0 : v; }
  // Tank01 nests stats by group (Passing, Rushing, ...); find a key wherever it lives.
  function pick(obj, keys){
    var found = null;
    (function walk(o){ if(!o || typeof o !== 'object' || found !== null) return;
      for(var i=0;i<keys.length;i++){ if(o[keys[i]] != null && o[keys[i]] !== ''){ found = o[keys[i]]; return; } }
      for(var k in o){ if(o[k] && typeof o[k] === 'object') walk(o[k]); } })(obj);
    return n(found);
  }
  function weekOf(ymd){ // 2026 regular season: Week 1 began Thu. Sept. 10
    var d = Date.UTC(+ymd.slice(0,4), +ymd.slice(4,6)-1, +ymd.slice(6,8));
    return Math.floor((d - Date.UTC(2026,8,10)) / 864e5 / 7) + 1;
  }
  function line(a){
    return { cmp: pick(a,['passCompletions','completions','passComp']), att: pick(a,['passAttempts','attempts','passAtt']),
      yds: pick(a,['passYds','passingYards']), td: pick(a,['passTD','passingTD']), int: pick(a,['int','interceptions','passInt']),
      sk: pick(a,['sacked','sacks','timesSacked']), rushAtt: pick(a,['carries','rushAttempts','rushAtt']),
      rushYds: pick(a,['rushYds','rushingYards']), rushTD: pick(a,['rushTD','rushingTD']), recTD: pick(a,['recTD','receivingTD']),
      fum: pick(a,['fumbles']), fumLost: pick(a,['fumblesLost','fumLost']) };
  }
  function parse(j){
    if(!j || !j.live || !j.gameID) return null;
    var st = String(j.status || ''), ymd = String(j.gameID).slice(0,8);
    if(/not started|scheduled|postponed|canceled|cancelled/i.test(st)) return null;
    if(!j.allen) return null;
    var y = ymd.slice(0,4)+'-'+ymd.slice(4,6)+'-'+ymd.slice(6,8);
    var opp = j.home === 'BUF' ? j.away : j.home;
    var fin = /final|completed/i.test(st);
    return { date: y, week: weekOf(ymd), opp: opp, final: fin, status: st, clock: j.clock || '',
      period: String(j.period || j.currentPeriod || j.quarter || ''), wp: j.wp && j.wp.pts ? j.wp : null,
      home: j.home === 'BUF', bills: j.home === 'BUF' ? j.homePts : j.awayPts, them: j.home === 'BUF' ? j.awayPts : j.homePts, s: line(j.allen) };
  }
  // The Worker says how often to check (seconds); follow it, between 30 seconds and 5 minutes.
  function pace(j){
    var s = j && +j.poll; if(!s) return; var ms = Math.max(30, Math.min(300, s)) * 1000;
    if(ms !== EVERY){ EVERY = ms; if(timer){ clearInterval(timer); timer = setInterval(poll, EVERY); } }
  }
  function get(){
    var ctl = window.AbortController ? new AbortController() : null;
    var t = setTimeout(function(){ if(ctl) ctl.abort(); }, 5000);
    return fetch(WORKER, {cache:'no-store', signal: ctl ? ctl.signal : undefined})
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){ clearTimeout(t); pace(j); return parse(j); })
      .catch(function(){ clearTimeout(t); return null; });
  }

  // Is this game already in the official (nflverse) files? Then the live numbers must not be added again.
  var official = {};
  function noteOfficial(d){ (d && d.games || []).forEach(function(g){ official[g.date] = true; }); }
  function use(){ return state && !official[state.date] ? state : null; }
  function find(list){ for(var i=0;i<(list||[]).length;i++){ if(list[i].id === ALLEN) return list[i]; } return null; }
  function dropBye(d, wk){ if(d && d.billsBye) d.billsBye = d.billsBye.filter(function(w){ return w !== wk; }); }

  function rating(c,a,y,t,i){ if(!a) return 0; function k(x){return Math.max(0,Math.min(2.375,x));}
    return (k((c/a-.3)*5)+k((y/a-3)*.25)+k(t/a*20)+k(2.375-i/a*25))/6*100; }

  // Returns a patched copy of one of the stats-data files.
  function patch(name, d){
    if(!d) return d;
    if(name === 'allen-2026.json') noteOfficial(d);
    var L = use(); if(!L) return d;
    d = JSON.parse(JSON.stringify(d));
    var s = L.s, me;
    if(name === 'allen-2026.json' && d.now){
      var w = d.now;
      w.g += 1; w.gs += 1; w.cmp += s.cmp; w.att += s.att; w.yds += s.yds; w.td += s.td; w.int += s.int;
      if(w.sk != null) w.sk += s.sk; w.rushAtt += s.rushAtt; w.rushYds += s.rushYds; w.rushTD += s.rushTD;
      w.recTD = (w.recTD || 0) + s.recTD; if(w.fum != null) w.fum += s.fum; if(w.fumLost != null) w.fumLost += s.fumLost;
      w.rate = rating(w.cmp, w.att, w.yds, w.td, w.int);
      d.thru = 'Week ' + L.week + ' (' + (L.final ? 'final, unofficial' : 'live') + ')';
      d.live = L;
    } else if(name === 'td-mountain-2026.json' && (me = find(d.players))){
      me.td = [me.td[0] + s.td, me.td[1] + s.rushTD, me.td[2] + s.recTD]; if(me.g != null) me.g += 1;
    } else if(name === 'td-week-2026.json' && (me = find(d.players))){
      me.w = (me.w || []).filter(function(r){ return r[0] !== L.week; }).concat([[L.week, s.td, s.rushTD, s.recTD]]); dropBye(d, L.week);
    } else if(name === 'mtn-live-2026.json' && (me = find(d.players))){
      me.y = [me.y[0] + s.yds, me.y[1] + s.rushYds, (me.y[2] || 0) + 1];
    } else if(name === 'mtn-week-2026.json' && (me = find(d.players))){
      me.w = (me.w || []).filter(function(r){ return r[0] !== L.week; }).concat([[L.week, s.yds, s.rushYds, null]]); dropBye(d, L.week);
    }
    return d;
  }

  // Idle teaser: every few seconds (at random) a gold light runs once around its border.
  var sweeping = false;
  function sweep(){
    if(sweeping || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    sweeping = true;
    (function go(){
      var el = document.getElementById('livebar');
      if(!el || !el.classList.contains('idle')){ sweeping = false; return; }
      if(!document.hidden){ el.classList.remove('sweep'); void el.offsetWidth; el.classList.add('sweep');
        setTimeout(function(){ el.classList.remove('sweep'); }, 2800); }
      setTimeout(go, 5000 + Math.random() * 6000);
    })();
  }

  // ---------- Records watch (from matchup.json, built hourly by update_data.py) ----------
  var SRC = ['https://raw.githubusercontent.com/JPADev1/Joshuapatrickallen/stats-data/', 'data/'];
  var match = null; // the Next game file: date, opponent, kickoff, records watch
  function loadMatch(){
    var i = 0;
    function next(){ var u = SRC[i++] + 'matchup.json';
      return fetch(u, {cache:'no-cache'}).then(function(r){ if(!r.ok) throw 0; return r.json(); })
        .catch(function(e){ if(i < SRC.length) return next(); return null; }); }
    return next().then(function(m){ match = m; });
  }
  function today(){ // YYYY-MM-DD in Buffalo
    try { return new Date().toLocaleDateString('en-CA', {timeZone:'America/New_York'}); }
    catch(e){ var d = new Date(); return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2); }
  }
  function gameDate(m){ // ISO kickoff date of the Next game file ("gameday", or parsed from "Sunday, Nov. 1, 2026")
    if(!m) return '';
    if(m.gameday) return m.gameday;
    var d = new Date(String(m.date || '').replace(/^[A-Za-z]+,\s*/, '').replace(/\./g, ''));
    return isNaN(d) ? '' : d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);
  }
  // Gameday: a Bills game is on today (or one is live / just finished). The card moves up the page for the day.
  function isGameday(){ var L = use(); return !!L || (match && gameDate(match) === today()); }

  function esc(x){ return String(x == null ? '' : x).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function fmt(v){ return Number(v).toLocaleString('en-US'); }
  var UNIT = { passTD:['passing TD','passing TDs'], rushTD:['rushing TD','rushing TDs'], totalTD:['total TD','total TDs'],
    passYds:['passing yard','passing yards'], rushYds:['rushing yard','rushing yards'] };
  // "Very close": this many or fewer left (lights come on)
  var CLOSE = { passTD:1, rushTD:1, totalTD:1, passYds:30, rushYds:15 };
  function u(k, n){ return UNIT[k][n === 1 ? 0 : 1]; }
  function liveVal(k, s){
    if(k === 'totalTD') return s.td + s.rushTD + (s.recTD || 0);
    return { passTD:s.td, rushTD:s.rushTD, passYds:s.yds, rushYds:s.rushYds }[k] || 0;
  }
  // One records-watch line during (or after) the game: {cls: 'done'|'close'|'', html}
  function liveItem(x, L){
    var s = L.s, k = x.k, ctx = x.ctx ? ' <i>' + esc(x.ctx) + '</i>' : '';
    if(k === 'both'){
      var p = s.td >= 1, r = s.rushTD >= 1;
      if(p && r) return {cls:'done', html: esc(x.done)};
      var st = 'Passing TD ' + (p ? '&#10003;' : '&ndash;') + ' &middot; Rushing TD ' + (r ? '&#10003;' : '&ndash;');
      if(L.final) return {cls:'', html: st + '. Not this time.'};
      return {cls: (p || r) ? 'close' : '', html: st + '. Needs ' + (p ? 'a rushing TD' : r ? 'a passing TD' : 'one of each') + ' ' + esc(x.goal) + '.' + ctx};
    }
    if(k === 'win'){
      var b = parseInt(L.bills, 10), t = parseInt(L.them, 10), sc = isNaN(b) || isNaN(t) ? '' : b + '-' + t;
      if(L.final) return b > t ? {cls:'done', html: esc(x.done)} : {cls:'', html: (b === t ? 'Tie, ' : 'Loss, ') + sc + '.'};
      if(!sc) return {cls:'', html: 'A win ' + esc(x.goal) + '.' + ctx};
      return {cls:'', html: (b > t ? 'Bills lead ' : b < t ? 'Bills trail ' : 'Tied ') + sc + '. A win ' + esc(x.goal) + '.' + ctx};
    }
    if(!UNIT[k] || x.need == null) return null;
    var v = liveVal(k, s), left = x.need - v, left2 = x.need2 != null ? x.need2 - v : null;
    var today_ = ' Today: ' + fmt(v) + ' ' + u(k, v) + '.';
    // Stepped records: once he passes this name, show who he passed since and who's next up the list.
    // Returns the "He passed ... and moved up to No. N." line (rank taken from the LAST name passed) plus "Next up".
    function nextUp(base){
      var nx = x.next || [], passed = [], lastSpot = null, h = ''; near = false;
      for(var i=0;i<nx.length;i++){
        var r = nx[i];
        if(v >= r.pass){ passed.push(r.who); if(r.spot) lastSpot = r.spot; continue; }
        var spot = r.spot ? ' for No. ' + r.spot : ''; near = !L.final && r.pass - v <= CLOSE[k];
        h = ' <span class="nup">Next up: ' + esc(r.who) + '. ' + (v >= r.tie ? 'Tied' + spot + '; ' + fmt(r.pass - v) + ' more to pass.'
          : fmt(r.tie - v) + ' more ' + u(k, r.tie - v) + ' to tie' + spot + ', ' + fmt(r.pass - v) + ' to pass.') + '</span>';
        break;
      }
      var m = passed.length && lastSpot ? /^He passed (.+) and moved up to No\. \d+\.$/.exec(base) : null;
      if(m){
        var all = [m[1]].concat(passed);
        var list = all.length === 2 ? all.join(' and ') : all.slice(0, -1).join(', ') + ' and ' + all[all.length - 1];
        base = 'He passed ' + list + ' and moved up to No. ' + lastSpot + '.';
      } else if(passed.length){
        base += ' Also passed ' + passed.join(', ') + '.';
      }
      return esc(base) + (L.final ? '' : h);
    }
    var near = false, passedIt = left2 != null ? left2 <= 0 : left <= 0;
    if(passedIt && x.next){ var nu = nextUp(left2 != null ? x.done2 : x.done); return {cls:'done', near: near, html: nu + today_}; }
    if(left2 != null && left2 <= 0) return {cls:'done', html: esc(x.done2) + today_};
    if(left <= 0){
      if(left2 == null) return {cls:'done', html: esc(x.done) + today_};
      return {cls: (!L.final && left2 <= CLOSE[k]) ? 'close' : 'done',
        html: esc(x.done) + (L.final ? '' : ' ' + fmt(left2) + ' more ' + u(k, left2) + ' ' + esc(x.goal2) + '.') + today_};
    }
    if(L.final) return {cls:'', html: 'Fell ' + fmt(left) + ' ' + u(k, left) + ' short.' + today_};
    var h = 'Needs ' + fmt(left) + ' more ' + u(k, left) + ' ' + esc(x.goal);
    if(left2 != null) h += '; ' + fmt(left2) + ' ' + esc(x.goal2);
    return {cls: left <= CLOSE[k] ? 'close' : '', html: h + '.' + today_ + ctx};
  }
  // The records watch block inside the card. Live numbers only apply when the watch is for the game being played.
  function watchHtml(L, dark){
    var W = match && match.watch; // only on the two pages with a gameday spot (stats, Next game)
    if(!document.getElementById('livebar-gameday') || !W || !W.items || !W.items.length) return {html:'', close:false, broke:false};
    // The watch belongs to one game (W.gameday). Right after a game it stays on that game until Allen's official
    // stats are in (update_data.py holds it), even though the page has moved on to the next opponent. Its final
    // numbers come from the live Worker, or, once the Worker has moved on, from the box score saved with the watch.
    var wDate = W.gameday || gameDate(match);
    if(!(L && L.date === wDate)) L = (W.final && W.final.date === wDate && !official[wDate]) ? W.final : null;
    var forThis = !!L, close = false, broke = false;
    var oppNick = W.opp || (match.opp && match.opp.nick), oppHome = W.opp ? W.home : match.home;
    var shareItems = [];
    function plain(h){ return String(h).replace(/<[^>]+>/g, '').replace(/&#10003;/g, '\u2713').replace(/&ndash;/g, '\u2013').replace(/&middot;/g, '\u00b7').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim(); }
    // Items with their own watch card (wst/wsb/wsk/wsl) get a Record Watch share button before the record falls
    // Record Watch share card for one record. Items with their own card (wst...) use it; before kickoff every record gets one.
    function watchBtn(x, pre){
      if(!window.JPAShare || !(x.wst || pre)) return '';
      var url = location.pathname.indexOf('matchup') >= 0 ? 'matchup.html' : '';
      if(x.wst) return JPAShare.btn({chip: 'Record Watch', kicker: x.wsk || '', title: x.wst, big: x.wsb || '', line: x.wsl || '',
        foot: 'Follow it live at notjoshingaround.com', url: url, bg: x.bg || ''}, x.title);
      return JPAShare.btn({chip: 'Record Watch', kicker: 'Josh Allen' + (oppNick ? (oppHome ? ' vs the ' : ' at the ') + oppNick : '') + (isGameday() ? ' today' : ', next game'),
        title: x.title, line: String(x.detail || '').replace(/ \(career high in a game: \d+\)/, '') + (x.ctx && x.k === 'win' ? ' ' + x.ctx : ''),
        foot: 'Follow it live at notjoshingaround.com', url: url, bg: x.bg || ''}, x.title);
    }
    var rows = W.items.map(function(x){
      var r = forThis ? liveItem(x, L) : null;
      shareItems.push({t: x.title, d: plain(r ? r.html : x.detail).replace(/ \(career high in a game: \d+\)/g, '').replace(/ Today: .*$/, function(m){ return r && r.cls !== 'done' ? '' : m; }), done: !!(r && r.cls === 'done')});
      if(!r) return '<li><b>' + esc(x.title) + '</b><span>' + esc(x.detail) + (x.ctx && x.k === 'win' ? ' <i>' + esc(x.ctx) + '</i>' : '') + '</span>' + watchBtn(x, true) + '</li>';
      if(r.cls === 'close' || r.near) close = true; if(r.cls === 'done') broke = true;
      var sh = (r.cls === 'done' && window.JPAShare) ? JPAShare.btn({chip: L.final ? 'Achieved' : 'Achieved Today', kicker: 'Josh Allen' + (oppNick ? (oppHome ? ' vs the ' : ' at the ') + oppNick : '') + (x.sk ? ' \u00b7 ' + x.sk : ''),
        title: x.st || x.title, big: x.sb || '', line: x.sl || String(r.html).replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim(),
        foot: L.final ? 'Unofficial until the official stats are in' : 'Live, unofficial', url: (location.pathname.indexOf('matchup') >= 0 ? 'matchup.html' : ''), bg: x.bg || ''}, x.title) : (L.final ? '' : watchBtn(x));
      return '<li class="' + r.cls + (r.cls === 'done' ? ' gold' : '') + '"><b>' + esc(x.title) + (r.cls === 'done' ? ' <em class="wtag">' + (L.final ? 'Achieved' : 'Achieved today') + '</em>'
        : r.cls === 'close' ? ' <em class="wtag">Almost there</em>' : '') + '</b><span>' + r.html + '</span>' + sh + '</li>';
    }).join('');
    var note = forThis ? (L.final ? 'Final numbers are unofficial. The records watch for the next game appears once the official stats are in, usually the day after the game.' : 'Counts down live with Allen’s numbers today (unofficial).')
      : 'Only records Allen could reach with a performance at or below his best single game. Most likely first. Updated ' + esc(W.asOf) + '.';
    var vs = oppNick ? (oppHome ? 'vs' : 'at') + ' the ' + oppNick : '';
    var gday = match.date && wDate === gameDate(match) ? String(match.date).replace(/, \d{4}$/, '') : '';
    var shareAll = window.JPAShare ? JPAShare.btn({chip: forThis ? (L.final ? 'Final' : 'Live') : 'Next Game',
      kicker: forThis ? (L.final ? 'How it went' : 'Counting down live') + (vs ? ', ' + vs : '')
        : 'NFL/franchise records and career milestones Allen could achieve this week' + (oppNick ? ' against the ' + oppNick : ''),
      title: 'Milestone watch' + (gday && !forThis ? ': ' + gday : ''), items: shareItems,
      foot: forThis ? 'Live numbers are unofficial' : 'Updated ' + W.asOf, url: location.pathname.indexOf('matchup') >= 0 ? 'matchup.html' : '',
      share: 'Josh Allen milestone watch' + (vs ? ' ' + vs : '')}, 'Milestone watch') : '';
    return {close: close && L && !L.final, broke: broke,
      html: '<div class="lw"><div class="lwh">Records watch' + (oppNick ? ' <span>' + (oppHome ? 'vs' : 'at') + ' the ' + esc(oppNick) + '</span>' : '') + shareAll + '</div>'
        + '<ol class="wlist">' + rows + '</ol><p class="lwn">' + note + '</p></div>'};
  }
  // Two spinning goal lights on top of the card when a record is within reach.
  // Each: beam (b), the turning mirror and bulb inside (.mech), a see-through colored cover (.cov), and the base.
  function light(side, color){ return '<span class="gl ' + side + ' ' + color + '"><b></b><span class="mech"><i class="mir"></i><i class="bulb"></i></span><i class="cov"></i></span>'; }
  var LIGHTS = '<div class="glights" aria-hidden="true">' + light('l', 'red') + light('r', 'blue') + '</div>';

  // ---------- Win chance chart ----------
  // Bills chance to win, rebuilt from the live score and game clock every minute and drawn as a line that
  // grows from kickoff (0%) to the final whistle (100% of the game). The model is the classic one for the NFL:
  // the final margin is roughly normal around (current lead + the pregame edge for the time left), with a
  // spread of 13.45 points over a full game that shrinks with the square root of the time left. The pregame
  // edge comes from the betting line already in matchup.json (no-vig moneylines, or the spread).
  // It doesn't know who has the ball or where, so it moves on scores, not drives.
  var SIG = 13.45, GAME = 3600;
  function Phi(z){ var t = 1 / (1 + .2316419 * Math.abs(z)), d = .3989423 * Math.exp(-z * z / 2),
    q = d * t * (.3193815 + t * (-.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - q : q; }
  function PhiInv(p){ var lo = -8, hi = 8; for(var i=0;i<60;i++){ var m = (lo + hi) / 2; if(Phi(m) < p) lo = m; else hi = m; } return (lo + hi) / 2; }
  function implied(ml){ ml = parseFloat(ml); if(!ml) return null; return ml < 0 ? -ml / (-ml + 100) : 100 / (ml + 100); }
  // Pregame edge for the game on `date`: {mu: expected Bills margin, p: kickoff chance, book}
  function pregame(date){
    var m = match, ln = m && m.lines; if(!ln || gameDate(m) !== date || (ln.gameId && m.gameId && ln.gameId !== m.gameId)) return null;
    var c = ln.cur || ln.open || {}, a = implied(c.ml), b = implied(c.oppMl);
    if(a != null && b != null){ var p = a / (a + b); return {p: p, mu: SIG * PhiInv(p), book: ln.book || ''}; }
    if(c.spread != null && !isNaN(+c.spread)){ var mu = -c.spread; return {p: Phi(mu / SIG), mu: mu, book: ln.book || ''}; }
    return null;
  }
  // Kickoff as a timestamp (Buffalo time), for when the Worker gives no usable clock
  function kickoff(m){
    var d = gameDate(m), t = /(\d{1,2}):(\d{2})\s*([ap])/i.exec(String(m && m.time || ''));
    if(!d || !t) return null;
    var h = +t[1] % 12 + (/p/i.test(t[3]) ? 12 : 0), base = Date.UTC(+d.slice(0,4), +d.slice(5,7)-1, +d.slice(8,10), h, +t[2]);
    var dst = /EDT/.test(new Date(base + 5 * 36e5).toLocaleString('en-US', {timeZone:'America/New_York', timeZoneName:'short'}));
    return base + (dst ? 4 : 5) * 36e5;
  }
  // Where the game is: {x: share of the game played 0-1, left: regulation seconds left, ot: OT seconds left or null, lab}
  function gameTime(L){
    var txt = (L.period + ' ' + L.clock + ' ' + L.status).toLowerCase();
    if(L.final) return {x:1, left:0, ot:null, lab:'Final'};
    var mm = /(\d{1,2}):(\d{2})/.exec(txt), sec = mm ? +mm[1] * 60 + +mm[2] : null, q = null, k;
    if(/\b(ot|overtime)\b/.test(txt)) q = 5;
    else if((k = /\b([1-4])(?:st|nd|rd|th)\b/.exec(txt) || /\bq(?:uarter)?\s*([1-4])\b/.exec(txt) || /quarter\s*([1-4])/.exec(txt))) q = +k[1];
    if(/half\s*time|halftime/.test(txt) || (/\bhalf\b/.test(txt) && !q)) return {x:.5, left:1800, ot:null, lab:'Halftime'};
    if(/end of/.test(txt)) sec = 0;
    if(q === 5) return {x:.99, left:0, ot: sec == null ? 300 : sec, lab:'OT' + (mm ? ' ' + mm[0] : '')};
    if(q){ if(sec == null) sec = 450; sec = Math.min(900, sec);
      var left = (4 - q) * 900 + sec; return {x: Math.min(.985, 1 - left / GAME), left: left, ot:null, lab:'Q' + q + (mm ? ' ' + mm[0] : '')}; }
    // No usable clock: estimate from the wall clock (a game runs about 3 hours 10 minutes)
    var k0 = gameDate(match) === L.date ? kickoff(match) : null; if(!k0) return null;
    var x = Math.max(.01, Math.min(.97, (Date.now() - k0) / (190 * 6e4)));
    return {x: x, left: Math.round((1 - x) * GAME), ot:null, lab:'Q' + Math.min(4, Math.floor(x * 4) + 1) + ' (est.)'};
  }
  function winP(lead, t, mu){
    if(t.x >= 1 && t.lab === 'Final') return lead > 0 ? 1 : lead < 0 ? 0 : .5;
    var r = t.ot != null ? Math.max(t.ot, 1) / GAME : t.left / GAME;
    if(r <= 0) return lead > 0 ? 1 : lead < 0 ? 0 : Phi(mu * Math.sqrt(600 / GAME) / SIG); // tied at the end of regulation: OT
    // Plus about one score's worth of doubt that grows late (it can't see who has the ball); none at kickoff.
    return Math.min(.995, Math.max(.005, Phi((lead + mu * r) / Math.sqrt(SIG * SIG * r + 16 * (1 - r)))));
  }
  // The curve is kept in this browser (localStorage) for the game, so a refresh doesn't lose it.
  var wpMem = {}, wpShown = {}, wpLastP = {}, wpReg = {};
  // Share data for the win-chance card (scripts/wincard.js): the curve in game seconds, plus who and where.
  function wpShare(key){
    var r = wpReg[key]; if(!r) return null; var L = r.L, rec = r.rec;
    var pts = L.wp && L.wp.pts && L.wp.pts.length ? L.wp.pts
      : rec.pts.map(function(q){ return [Math.round(q[0] * 3600), q[1], q[2], q[3], q[5] || '', q[6] || '']; });
    if(L.final && pts.length && pts[pts.length - 1][4] !== 'end'){ var z = pts[pts.length - 1], b = parseInt(L.bills, 10), o = parseInt(L.them, 10);
      if(!isNaN(b) && !isNaN(o)) pts = pts.concat([[Math.max(3600, z[0]), b > o ? 1 : b < o ? 0 : .5, b, o, 'end', 'Final']]); }
    var nick = oppNick(L), vs = (L.home ? 'vs' : 'at') + ' the ' + nick;
    return {wp: {pts: pts, p0: rec.p0}, final: !!L.final, oppNick: nick, oppAb: L.opp || 'OPP', oppColor: oppHex(L), home: !!L.home,
      sit: L.sit || (L.wp && L.wp.sit) || '', game: L.game || '', title: 'Bills win chance ' + vs,
      share: 'Bills win chance ' + vs + (L.final ? ', play by play' : ', live'), url: L.recap ? '#recap' : (location.pathname.indexOf('matchup') >= 0 ? 'matchup.html' : '')};
  }
  document.addEventListener('click', function(e){
    var b = e.target.closest && e.target.closest('.wpshr'); if(!b) return;
    e.preventDefault(); e.stopPropagation();
    var d = wpShare(b.getAttribute('data-wpk')); if(d && window.JPAShare) JPAShare.open(d);
  }, true);
  function wpLoad(date){ try{ return JSON.parse(localStorage.getItem('jpa-wp-' + date)); }catch(e){ return null; } }
  function wpSave(date, rec){ try{
    for(var i = localStorage.length - 1; i >= 0; i--){ var k = localStorage.key(i); if(k && k.indexOf('jpa-wp-') === 0 && k !== 'jpa-wp-' + date) localStorage.removeItem(k); }
    localStorage.setItem('jpa-wp-' + date, JSON.stringify(rec)); }catch(e){} }
  // From the Worker (v3): every play, already scored with down, distance, field position and the line.
  // Points there are [game seconds, Bills chance, Bills pts, opp pts, mark, play text].
  function wpLabel(t, kind){
    if(kind === 'end') return 'Final';
    if(t >= 3600) return 'OT ' + (function(l){ return Math.floor(l / 60) + ':' + ('0' + l % 60).slice(-2); })(Math.max(0, 4200 - t));
    var q = Math.min(4, Math.floor(t / 900) + 1), l = q * 900 - t;
    return 'Q' + q + ' ' + Math.floor(l / 60) + ':' + ('0' + l % 60).slice(-2);
  }
  function wpFromWorker(L){
    var W = L.wp, pg = pregame(L.date), fin = L.final;
    var pts = W.pts.map(function(q){
      var x = q[4] === 'end' ? 1 : q[0] <= 3600 ? q[0] / 3600 : .99 + Math.min(1, (q[0] - 3600) / 600) * .009;
      if(!fin && x > .995) x = .995;
      return [Math.round(x * 10000) / 10000, q[1], q[2], q[3], wpLabel(q[0], q[4]), q[4] || '', q[5] || ''];
    });
    return {pts: pts, p0: W.p0, mu: W.mu, line: !!pg || W.mu !== 0, book: pg ? pg.book : '', worker: W.src === 'plays'};
  }
  function wpTrack(L){
    if(L.wp && L.wp.pts && L.wp.pts.length) return wpFromWorker(L);
    var rec = wpMem[L.date] || wpLoad(L.date) || {pts: []};
    if(rec.mu == null){ var pg = pregame(L.date); rec.mu = pg ? pg.mu : 0; rec.p0 = pg ? pg.p : .5; rec.book = pg ? pg.book : ''; rec.line = !!pg; }
    var b = parseInt(L.bills, 10), o = parseInt(L.them, 10); if(isNaN(b) || isNaN(o)){ b = 0; o = 0; }
    var t = gameTime(L); if(!t){ wpMem[L.date] = rec; return rec; }
    var last = rec.pts[rec.pts.length - 1], x = last ? Math.max(t.x, last[0]) : t.x; // never runs backwards
    var p = Math.round(winP(b - o, t, rec.mu) * 1000) / 1000;
    if(!last || x > last[0] + .0005 || last[2] !== b || last[3] !== o || last[4] !== t.lab){
      if(last && x === last[0] && last[2] === b && last[3] === o) rec.pts.pop(); // same moment, newer label
      rec.pts.push([Math.round(x * 10000) / 10000, p, b, o, t.lab]);
    }
    wpMem[L.date] = rec; wpSave(L.date, rec); return rec;
  }
  function hexRGB(h){ var m = /^#?([0-9a-f]{6})$/i.exec(String(h || '')); if(!m) return null; var v = parseInt(m[1], 16); return [v >> 16, v >> 8 & 255, v & 255]; }
  function oppHex(L){ // the opponent's main color: given (recap), or from the Next game file when it's that game
    if(L && L.oppColor) return L.oppColor;
    if(L && L.opp && match && match.opp && match.opp.abbr && match.opp.abbr !== L.opp) return '';
    return match && (match.teamColors && match.teamColors.opp && match.teamColors.opp[0] || match.colors && match.colors.opp) || '';
  }
  function oppNick(L){ return L.oppNick || (match && match.opp && (!L.opp || match.opp.abbr === L.opp) ? match.opp.nick : '') || L.opp || 'Opponent'; }
  function oppColor(L){
    var tc = oppHex(L), c = hexRGB(tc), bills = [0, 51, 141];
    if(!tc) return '#8b93a7';
    if(!c) return 'var(--red)';
    var d = Math.sqrt(Math.pow(c[0]-bills[0],2) + Math.pow(c[1]-bills[1],2) + Math.pow(c[2]-bills[2],2));
    return d < 90 ? '#8b93a7' : tc; // navy opponents would blend into Bills blue
  }
  // SVG chart. Above the 50% line is shaded Bills blue, below in the opponent's color; dashed stretches are
  // ones this browser didn't see (page closed, or joined mid-game), drawn straight between the known points.
  var WP = {W:600, H:190, l:10, r:62, t:14, b:24};
  function wpX(x){ return WP.l + x * (WP.W - WP.l - WP.r); }
  function wpY(p){ return WP.t + (1 - p) * (WP.H - WP.t - WP.b); }
  function wpPct(p){ return p >= .995 && p < 1 ? '>99' : p <= .005 && p > 0 ? '<1' : String(Math.round(p * 100)); }
  // ---------- Win probability card: its own card just under the Gameday live card ----------
  // Before kickoff: "Pregame win probability" (the betting line) so pregamers can start their chart now;
  // during and after the game: the live chart. Either way, "Customize your gameday chart" opens scripts/reactions.js.
  var rxGet = null;
  function kickMin(m){ var t = /(\d{1,2}):(\d{2})\s*([ap])/i.exec(String(m && m.time || '')); return t ? (+t[1] % 12 + (/p/i.test(t[3]) ? 12 : 0)) * 60 + +t[2] : null; }
  function wpCard(el, L, pre){
    var card = document.getElementById('wpcard');
    var pg = match ? pregame(gameDate(match)) : null;
    var html = L ? wpHtml(L) : pre && pg ? preWpHtml(pg) : '';
    if(!el || !html){ if(card) card.hidden = true; rxGet = null; return; }
    if(!card){ card = document.createElement('div'); card.id = 'wpcard'; card.className = 'wpcard'; }
    var after = el.nextSibling && el.nextSibling.classList && el.nextSibling.classList.contains('stfu') ? el.nextSibling : el; // the Collinsworth button stays right under the live card
    if(card.previousSibling !== after) el.parentNode.insertBefore(card, after.nextSibling);
    var date = L ? L.date : gameDate(match), mine = window.JPAReact && JPAReact.has(date);
    card.innerHTML = html + (window.JPAReact && window.JPAWinCard ? '<button type="button" class="rxgo">🍻 ' + (mine ? 'Keep building your gameday chart' : 'Customize your gameday chart') + '</button>'
      + '<p class="rxsub">' + (L ? 'Add your beers, wings, thrown remotes and more right on the chart, then share it as an image or a 20-second video.'
        : 'Pregaming? Start now: mark when the tailgate started and drop your first reactions. Keep adding during the game, then share it.') + '</p>' : '');
    card.hidden = false;
    if(L) wpWire(card);
    rxGet = function(){
      if(L){ var k = (L.recap ? 'r' : 'l') + L.date, d = wpShare(k); if(!d) return null;
        return {D: d, date: L.date, kick: kickMin(match && gameDate(match) === L.date ? match : null), analyst: match && match.analyst || ''}; }
      var p = pregame(gameDate(match));
      return {D: {wp: {pts: [[0, p ? p.p : .5, 0, 0, '', 'Kickoff']], p0: p ? p.p : .5}, final: false, oppNick: match.opp && match.opp.nick || 'Opponent', oppAb: match.opp && match.opp.abbr || 'OPP',
        oppColor: oppHex({}), home: !!match.home, game: match.label || ''}, date: gameDate(match), kick: kickMin(match), analyst: match.analyst || ''};
    };
    if(window.JPAReact) JPAReact.update();
  }
  document.addEventListener('click', function(e){
    var b = e.target.closest && e.target.closest('.rxgo'); if(!b || !rxGet || !window.JPAReact) return;
    e.preventDefault(); JPAReact.open(function(){ return rxGet ? rxGet() : null; });
  });
  // Before kickoff: the empty chart, with the betting-line chance at kickoff
  function preWpHtml(pg){
    if(!pg) return '';
    var oc = oppColor({}), y50 = wpY(.5), grid = '', lab = '', ax = wpX(1) + 8, y = wpY(pg.p).toFixed(1);
    [.25, .75].forEach(function(v){ grid += '<line class="wpg" x1="' + wpX(0) + '" x2="' + wpX(1) + '" y1="' + wpY(v) + '" y2="' + wpY(v) + '"/>'; });
    [.25, .5, .75].forEach(function(v){ grid += '<line class="wpg" x1="' + wpX(v) + '" x2="' + wpX(v) + '" y1="' + WP.t + '" y2="' + (WP.H - WP.b) + '"/>'; });
    ['Q1','Q2','Q3','Q4'].forEach(function(q, i){ lab += '<text class="wpt" x="' + wpX(i / 4 + .125) + '" y="' + (WP.H - 7) + '" text-anchor="middle">' + q + '</text>'; });
    lab += '<text class="wpt" x="' + ax + '" y="' + (wpY(1) + 4) + '">100%</text><text class="wpt wps wpw" x="' + ax + '" y="' + (wpY(1) + 15) + '">Win</text>'
      + '<text class="wpt" x="' + ax + '" y="' + (y50 + 4) + '">50%</text>'
      + '<text class="wpt" x="' + ax + '" y="' + (wpY(0) - 7) + '">100%</text><text class="wpt wps" x="' + ax + '" y="' + (wpY(0) + 4) + '">Lose</text>';
    var svg = '<svg viewBox="0 0 ' + WP.W + ' ' + WP.H + '" role="img" aria-label="Pregame Bills win probability ' + wpPct(pg.p) + ' percent">' + grid
      + '<line class="wpmid" x1="' + wpX(0) + '" x2="' + wpX(1) + '" y1="' + y50 + '" y2="' + y50 + '"/>' + lab
      + '<line class="wpline wpdash" x1="' + wpX(0) + '" x2="' + wpX(1) + '" y1="' + y + '" y2="' + y + '" opacity=".45"/>'
      + '<circle class="wpdot wplive" cx="' + wpX(0) + '" cy="' + y + '" r="5" fill="' + (pg.p >= .5 ? 'var(--blue)' : oc) + '"/></svg>';
    return '<div class="wp wppre"><div class="wph"><span class="wpht">Pregame win probability <b class="wpbig">' + wpPct(pg.p) + '%</b></span></div>'
      + '<div class="wpc">' + svg + '</div>'
      + '<p class="wpn">From the ' + (pg.book ? esc(pg.book) + ' ' : '') + 'betting line. At kickoff the line builds here, play by play.</p></div>';
  }
  function wpHtml(L){
    var rec = wpTrack(L), oppAb = esc(L.opp || (match && match.opp && match.opp.abbr) || 'OPP');
    var pts = (rec.pts.length && rec.pts[0][0] === 0 ? [] : [[0, rec.p0, 0, 0, 'Kickoff']]).concat(rec.pts), n = pts.length, cur = pts[n - 1];
    var prevP = wpLastP[L.date] != null ? wpLastP[L.date] : rec.p0, sinceWhat = wpLastP[L.date] != null ? 'last update' : 'kickoff';
    if(wpLastP[L.date] == null || cur[1] !== wpLastP[L.date]) wpLastP[L.date] = cur[1];
    if(n < 2) return '';
    // Draw-in: the whole line the first time it shows on this page, then just the newest stretch.
    var seen = wpShown[L.date] || 0, motion = !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    var drawFrom = motion && n > seen ? Math.max(1, seen) : n, anim = '';
    var GAP = rec.worker ? 2 : .08, solid = '', dash = '', area = 'M' + wpX(0) + ' ' + wpY(.5);
    pts.forEach(function(q, i){
      var X = wpX(q[0]).toFixed(1), Y = wpY(q[1]).toFixed(1); area += ' L' + X + ' ' + Y;
      if(!i) return; var a = pts[i - 1], seg = 'M' + wpX(a[0]).toFixed(1) + ' ' + wpY(a[1]).toFixed(1) + ' L' + X + ' ' + Y + ' ';
      if(i >= drawFrom){ anim += (anim ? ' L' + X + ' ' + Y : seg); return; }
      if(q[0] - a[0] > GAP) dash += seg; else solid += seg;
    });
    if(anim) anim = '<path class="wpline wpnew' + (seen ? '' : ' wpall') + '" pathLength="1" d="' + anim + '"/>';
    wpShown[L.date] = n;
    area += ' L' + wpX(cur[0]).toFixed(1) + ' ' + wpY(.5) + ' Z';
    var oc = oppColor(L), y50 = wpY(.5), grid = '', lab = '';
    [.25, .75].forEach(function(v){ grid += '<line class="wpg" x1="' + wpX(0) + '" x2="' + wpX(1) + '" y1="' + wpY(v) + '" y2="' + wpY(v) + '"/>'; });
    [.25, .5, .75].forEach(function(v){ grid += '<line class="wpg" x1="' + wpX(v) + '" x2="' + wpX(v) + '" y1="' + WP.t + '" y2="' + (WP.H - WP.b) + '"/>'; });
    ['Q1','Q2','Q3','Q4'].forEach(function(q, i){ lab += '<text class="wpt" x="' + wpX(i / 4 + .125) + '" y="' + (WP.H - 7) + '" text-anchor="middle">' + q + '</text>'; });
    // Axis on the right: 100% Win at the top, 50% in the middle, 100% Lose at the bottom (Bills' side)
    var ax = wpX(1) + 8;
    lab += '<text class="wpt" x="' + ax + '" y="' + (wpY(1) + 4) + '">100%</text><text class="wpt wps wpw" x="' + ax + '" y="' + (wpY(1) + 15) + '">Win</text>'
      + '<text class="wpt" x="' + ax + '" y="' + (y50 + 4) + '">50%</text>'
      + '<text class="wpt" x="' + ax + '" y="' + (wpY(0) - 7) + '">100%</text><text class="wpt wps" x="' + ax + '" y="' + (wpY(0) + 4) + '">Lose</text>';
    var marks = '', hasTO = false, hasSc = false;
    pts.forEach(function(q, i){ if(!q[5] || q[5] === 'end' || i === n - 1) return; var X = wpX(q[0]).toFixed(1), Y = wpY(q[1]).toFixed(1), a = pts[i - 1] || q;
      if(q[5] === 'to'){ hasTO = true; marks += '<circle class="wpmk wpto" cx="' + X + '" cy="' + Y + '" r="4"/>'; return; }
      hasSc = true; marks += '<circle class="wpmk" cx="' + X + '" cy="' + Y + '" r="' + (q[5] === 'td' ? 4 : 3) + '" fill="' + (q[2] > a[2] ? 'var(--blue)' : oc) + '"/>'; });
    var cx = wpX(cur[0]), cy = wpY(cur[1]), dotC = cur[1] >= .5 ? 'var(--blue)' : oc;
    var svg = '<svg viewBox="0 0 ' + WP.W + ' ' + WP.H + '" role="img" aria-label="Bills win chance through the game, now ' + wpPct(cur[1]) + ' percent">'
      + '<defs><clipPath id="wpA"><rect x="0" y="0" width="' + WP.W + '" height="' + y50 + '"/></clipPath>'
      + '<clipPath id="wpB"><rect x="0" y="' + y50 + '" width="' + WP.W + '" height="' + (WP.H - y50) + '"/></clipPath></defs>'
      + grid + '<path d="' + area + '" fill="var(--blue)" fill-opacity=".16" clip-path="url(#wpA)"/>'
      + '<path d="' + area + '" fill="' + oc + '" fill-opacity=".22" clip-path="url(#wpB)"/>'
      + '<line class="wpmid" x1="' + wpX(0) + '" x2="' + wpX(1) + '" y1="' + y50 + '" y2="' + y50 + '"/>' + lab
      + (dash ? '<path class="wpline wpdash" d="' + dash + '"/>' : '') + (solid ? '<path class="wpline" d="' + solid + '"/>' : '') + anim
      + marks
      + '<circle class="wpdot' + (L.final ? '' : ' wplive') + (anim ? ' wpwait' + (seen ? '' : ' wpslow') : '') + '" cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="5" fill="' + dotC + '"/>'
      + '<line class="wpx" x1="0" x2="0" y1="' + WP.t + '" y2="' + (WP.H - WP.b) + '" visibility="hidden"/>'
      + '<circle class="wphov" r="5" visibility="hidden"/>'
      + '<rect class="wphit" x="' + WP.l + '" y="0" width="' + (WP.W - WP.l - WP.r) + '" height="' + WP.H + '" fill="transparent"/></svg>';
    var ch = Math.round(cur[1] * 100) - Math.round(prevP * 100);
    var delta = L.final ? '' : ch ? ' <span class="wpd ' + (ch > 0 ? 'up' : 'dn') + '">' + (ch > 0 ? '&#9650; ' : '&#9660; ') + Math.abs(ch) + ' since ' + sinceWhat + '</span>' : '';
    var head = L.final ? (cur[2] > cur[3] ? 'Bills win' : cur[2] < cur[3] ? 'Bills lose' : 'Tie') + ', ' + cur[2] + '-' + cur[3]
      : 'Bills win chance <b class="wpbig">' + wpPct(cur[1]) + '%</b>' + delta;
    var rows = pts.map(function(q){ return '<tr><td>' + esc(q[4]) + '</td><td>' + q[2] + '-' + q[3] + '</td><td>' + wpPct(q[1]) + '%</td></tr>'; }).join('');
    // Share: the card (image or video) is drawn by scripts/wincard.js from the whole curve so far
    var key = (L.recap ? 'r' : 'l') + L.date; wpReg[key] = {L: L, rec: rec};
    var shr = window.JPAShare && window.JPAWinCard ? '<button type="button" class="shr wpshr" data-wpk="' + esc(key) + '" aria-label="Share the win chance chart">'
      + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>Share</button>' : '';
    return '<div class="wp" data-opp="' + oppAb + '" data-oc="' + esc(oc) + '" data-pts="' + esc(JSON.stringify(pts)) + '"><div class="wph"><span class="wpht">' + head + '</span>' + shr + '</div>'
      + '<div class="wpc">' + svg + '<div class="wptip" hidden></div></div>'
      + '<p class="wpn">Kickoff: ' + wpPct(rec.p0) + '%' + (rec.line ? ' (' + (rec.book ? esc(rec.book) + ' ' : '') + 'betting line)' : ' (no betting line found, so even odds)')
      + (rec.worker ? '. Every play counts: the score, time left, who has the ball, down, distance and field position. Model fitted on five seasons of NFL play-by-play.'
        : '. Updates every minute from the score and the time left.')
      + (hasSc || hasTO ? ' Dots: ' + (hasSc ? 'scores (filled, in the scoring team&rsquo;s color)' : '') + (hasSc && hasTO ? ', ' : '') + (hasTO ? 'turnovers (rings)' : '') + '.' : '')
      + (dash ? ' Dashed stretches are times this page wasn&rsquo;t open.' : '') + ' Unofficial, for fun.</p>'
      + '<details class="wptab"><summary>Show as a table</summary><table><thead><tr><th>When</th><th>Score</th><th>Bills win</th></tr></thead><tbody>' + rows + '</tbody></table></details></div>';
  }
  // Hover / touch: crosshair, dot and a tooltip on the nearest point.
  function wpWire(root){
    var box = root.querySelector('.wp'); if(!box) return;
    var pts = JSON.parse(box.getAttribute('data-pts')), svg = box.querySelector('.wpc svg'), tip = box.querySelector('.wptip'),
      vx = svg.querySelector('.wpx'), hv = svg.querySelector('.wphov'), hit = svg.querySelector('.wphit'), oc = box.getAttribute('data-oc') || '#8b93a7';
    function show(ev){
      var r = svg.getBoundingClientRect(), x = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) / r.width * WP.W;
      var best = pts[0]; pts.forEach(function(q){ if(Math.abs(wpX(q[0]) - x) < Math.abs(wpX(best[0]) - x)) best = q; });
      var X = wpX(best[0]), Y = wpY(best[1]);
      vx.setAttribute('x1', X); vx.setAttribute('x2', X); vx.setAttribute('visibility', 'visible');
      hv.setAttribute('cx', X); hv.setAttribute('cy', Y); hv.setAttribute('fill', best[1] >= .5 ? 'var(--blue)' : oc); hv.setAttribute('visibility', 'visible');
      tip.innerHTML = '<b>' + esc(best[4]) + '</b> &middot; Bills ' + best[2] + ', ' + esc(box.getAttribute('data-opp')) + ' ' + best[3] + '<br>Bills win chance: <b>' + wpPct(best[1]) + '%</b>' + (best[6] ? '<span class="wptx">' + ({td:'Touchdown. ', fg:'Field goal. ', to:'Turnover. '}[best[5]] || '') + esc(best[6]) + '</span>' : '');
      tip.hidden = false; var px = X / WP.W * r.width; tip.style.left = Math.max(4, Math.min(r.width - tip.offsetWidth - 4, px - tip.offsetWidth / 2)) + 'px';
      tip.style.top = Math.max(0, Y / WP.H * r.height - tip.offsetHeight - 12) + 'px';
    }
    function hide(){ vx.setAttribute('visibility', 'hidden'); hv.setAttribute('visibility', 'hidden'); tip.hidden = true; }
    hit.addEventListener('pointermove', show); hit.addEventListener('pointerdown', show); hit.addEventListener('pointerleave', hide);
  }

  // The Gameday live card. Normal spot: #livebar-slot. On gameday it moves up to #livebar-gameday
  // (stats page: under the social links; Next game page: under the team cards) and goes back the next day.
  function bar(){
    var L = use(), el = document.getElementById('livebar'), slot = document.getElementById('livebar-slot');
    var up = document.getElementById('livebar-gameday'), gd = isGameday();
    var idle = !L && slot && slot.hasAttribute('data-idle');
    if(!L && !idle){ if(el) el.hidden = true; wpCard(null); return; }
    if(!el){ el = document.createElement('div'); el.id = 'livebar'; el.setAttribute('role','status'); }
    var home = gd && up ? up : slot;
    if(home && el.parentNode !== home) home.appendChild(el);
    else if(!home && !el.parentNode){ var mn = document.querySelector('main');
      if(mn) mn.insertBefore(el, mn.firstChild); else document.body.insertBefore(el, document.body.firstChild); }
    if(up) up.hidden = !(gd && el.parentNode === up);
    var w = watchHtml(L, idle);
    el.className = (idle ? 'livebar idle' : 'livebar') + (gd ? ' gd' : '') + (w.close ? ' lit' : '');
    if(idle){ // No game on: hold the spot with a teaser (pages opt in with data-idle on #livebar-slot)
      var pre = gd && match;
      el.innerHTML = '<span class="dot"></span><b>GAMEDAY LIVE</b><br>' + (pre
        ? '<span class="ln">It’s gameday: Bills ' + (match.home ? 'vs' : 'at') + ' the ' + esc(match.opp && match.opp.nick) + (match.time ? ', ' + esc(match.time) : '') + '.</span>'
          + '<span class="lnote">Once the Bills kick off, Allen&rsquo;s stats show up right here and the records watch counts down live, every minute.</span>'
        : '<span class="ln">Check back on gameday to watch records broken live.</span>'
          + '<span class="lnote">Once the Bills kick off, Allen&rsquo;s stats show up right here and update every minute.</span>') + w.html
;
      el.hidden = false; sweep(); wpCard(el, null, !!pre); return; }
    var s = L.s, parts = [];
    if(s.att) parts.push(s.cmp + '/' + s.att + ', ' + s.yds + ' yds, ' + s.td + ' TD' + (s.int ? ', ' + s.int + ' INT' : ''));
    if(s.rushAtt || s.rushTD) parts.push(s.rushAtt + ' rush, ' + s.rushYds + ' yds' + (s.rushTD ? ', ' + s.rushTD + ' TD' : ''));
    var score = (L.bills !== '' && L.bills != null) ? ' · Bills ' + L.bills + ', ' + L.opp + ' ' + L.them : ' vs ' + L.opp;
    el.innerHTML = (w.close ? LIGHTS + '<span class="sr">A record is within reach.</span>' : '') + (w.broke ? '<span class="sr">A record fell today.</span>' : '') +
      '<div class="lhead"><span class="dot' + (L.final ? ' fin' : '') + '"></span><b>' + (L.final ? 'FINAL' : 'LIVE') + '</b>' + score +
      (!L.final && L.clock ? ' · ' + L.clock : '') + '<br><span class="ln">Allen today: ' + (parts.join(' · ') || 'no stats yet') +
      '</span>' + (window.JPALIVE_RELOAD && changed ? '<button type="button" class="lrel" onclick="location.reload()">New numbers: tap to update</button>' : '') + '</div>' + w.html + '<span class="lnote">Live numbers are unofficial and update every minute. They are checked against the official stats after the game.</span>';
    el.hidden = false;
    wpCard(el, L, false);
  }

  // Which games nflverse already has (from the hourly file), so the live line is never counted twice.
  function loadOfficial(){
    return fetch('https://raw.githubusercontent.com/JPADev1/Joshuapatrickallen/stats-data/allen-2026.json', {cache:'no-cache'})
      .then(function(r){ return r.ok ? r.json() : null; }).then(noteOfficial).catch(function(){});
  }
  var ready = Promise.all([get(), loadOfficial(), loadMatch()]).then(function(r){ state = r[0]; sig = JSON.stringify(state); return state; });
  function poll(){
    if(document.hidden) return;
    get().then(function(L){
      if(!L && state && !state.final) return; // one missed or slow reply mid-game: keep the last numbers
      var s2 = JSON.stringify(L);
      if(s2 !== sig){ state = L; sig = s2; changed = true; loadOfficial().then(function(){ bar(); listeners.forEach(function(f){ try{ f(); }catch(e){} }); }); }

      if(L ? L.final : !isGameday()){ clearInterval(timer); timer = null; } // nothing left to follow
    });
  }
  // Poll during the game, and on gameday before kickoff so the card goes live without a reload.
  ready.then(function(L){ bar(); if(L ? !L.final : isGameday()) timer = setInterval(poll, EVERY); });
  document.addEventListener('visibilitychange', function(){ if(!document.hidden && timer) poll(); });

  window.JPALive = {
    ready: ready,
    patch: patch,
    // Wrap a page's load(name): fetch, then add the live game once the Worker has answered (or timed out).
    wrap: function(load){ return function(name){ return load(name).then(function(d){ return ready.then(function(){ return patch(name, d); }); }); }; },
    onChange: function(f){ listeners.push(f); },
    // A finished game's chart (Weekly Record Recap): g = {date, opp (abbr), oppNick, oppColor, home, bills, them, game, wp: {pts, p0, mu}}
    chart: function(el, g){
      if(!el || !g || !g.wp || !g.wp.pts || !g.wp.pts.length) return false;
      var L = {date: g.date, final: true, recap: true, opp: g.opp, oppNick: g.oppNick, oppColor: g.oppColor, home: !!g.home,
        bills: g.bills, them: g.them, game: g.game || '', wp: g.wp, s: {}};
      el.innerHTML = wpHtml(L); wpWire(el);
      // The same chart builder as on gameday (reactions save per game date, so ones added during the game are still there)
      if(window.JPAReact && window.JPAWinCard){
        var mine = JPAReact.has(g.date), btn = document.createElement('button'), sub = document.createElement('p');
        btn.type = 'button'; btn.className = 'rxgo';
        btn.textContent = '\ud83c\udf7b ' + (mine ? 'Keep building your gameday chart' : 'Customize your gameday chart');
        sub.className = 'rxsub'; sub.textContent = 'Add your beers, wings, thrown remotes and more right on the chart, then share it as an image or a 20-second video.';
        btn.addEventListener('click', function(e){
          e.preventDefault(); e.stopPropagation(); // not the gameday card's builder (that one may be on the next game by now)
          JPAReact.open(function(){ var d = wpShare('r' + g.date); if(!d) return null;
            return {D: d, date: g.date, kick: kickMin(match && gameDate(match) === g.date ? match : g), analyst: g.analyst || (match && gameDate(match) === g.date && match.analyst) || ''}; });
        });
        el.appendChild(btn); el.appendChild(sub);
      }
      return true;
    }
  };
})();
