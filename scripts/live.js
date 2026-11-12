// Live game layer: adds Josh Allen's in-progress game (Tank01, via the jpa-live Cloudflare Worker) on top of the
// hourly nflverse files, so every tile, table, record card and mountain moves during Bills games.
// Once nflverse publishes the game (usually that night), the live numbers are dropped automatically and the
// official nflverse line takes over. Nothing here touches Netlify: the Worker is polled from the visitor's browser.
(function(){
  var WORKER = 'https://jpa-live.sterryrochester.workers.dev/';
  var EVERY = 120000;          // 2 minutes, same as the Worker's own Tank01 timer
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
      bills: j.home === 'BUF' ? j.homePts : j.awayPts, them: j.home === 'BUF' ? j.awayPts : j.homePts, s: line(j.allen) };
  }
  function get(){
    var ctl = window.AbortController ? new AbortController() : null;
    var t = setTimeout(function(){ if(ctl) ctl.abort(); }, 5000);
    return fetch(WORKER, {cache:'no-store', signal: ctl ? ctl.signal : undefined})
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){ clearTimeout(t); return parse(j); })
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
      if(!sc) return {cls:'', html: 'A win ' + esc(x.goal) + '.'};
      return {cls:'', html: (b > t ? 'Bills lead ' : b < t ? 'Bills trail ' : 'Tied ') + sc + '. A win ' + esc(x.goal) + '.'};
    }
    if(!UNIT[k] || x.need == null) return null;
    var v = liveVal(k, s), left = x.need - v, left2 = x.need2 != null ? x.need2 - v : null;
    var today_ = ' Today: ' + fmt(v) + ' ' + u(k, v) + '.';
    // Stepped records: once he passes this name, show who he passed since and who's next up the list.
    function nextUp(){
      var nx = x.next || [], passed = [], h = ''; near = false;
      for(var i=0;i<nx.length;i++){
        var r = nx[i];
        if(v >= r.pass){ passed.push(r.who); continue; }
        var spot = r.spot ? ' for No. ' + r.spot : ''; near = !L.final && r.pass - v <= CLOSE[k];
        h = ' <span class="nup">Next up: ' + esc(r.who) + '. ' + (v >= r.tie ? 'Tied' + spot + '; ' + fmt(r.pass - v) + ' more to pass.'
          : fmt(r.tie - v) + ' more ' + u(k, r.tie - v) + ' to tie' + spot + ', ' + fmt(r.pass - v) + ' to pass.') + '</span>';
        break;
      }
      return (passed.length ? ' Also passed ' + esc(passed.join(', ')) + '.' : '') + (L.final ? '' : h);
    }
    var near = false, passedIt = left2 != null ? left2 <= 0 : left <= 0;
    if(passedIt && x.next){ var nu = nextUp(); return {cls:'done', near: near, html: esc(left2 != null ? x.done2 : x.done) + nu + today_}; }
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
    var rows = W.items.map(function(x){
      var r = forThis ? liveItem(x, L) : null;
      shareItems.push({t: x.title, d: plain(r ? r.html : x.detail).replace(/ \(career high in a game: \d+\)/g, '').replace(/ Today: .*$/, function(m){ return r && r.cls !== 'done' ? '' : m; }), done: !!(r && r.cls === 'done')});
      if(!r) return '<li><b>' + esc(x.title) + '</b><span>' + esc(x.detail) + '</span></li>';
      if(r.cls === 'close' || r.near) close = true; if(r.cls === 'done') broke = true;
      var sh = (r.cls === 'done' && window.JPAShare) ? JPAShare.btn({chip: L.final ? 'Achieved' : 'Achieved Today', kicker: 'Josh Allen' + (oppNick ? (oppHome ? ' vs the ' : ' at the ') + oppNick : ''),
        title: x.title, line: String(r.html).replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim(),
        foot: L.final ? 'Unofficial until the official stats are in' : 'Live, unofficial', url: (location.pathname.indexOf('matchup') >= 0 ? 'matchup.html' : '')}, x.title) : '';
      return '<li class="' + r.cls + (r.cls === 'done' ? ' gold' : '') + '"><b>' + esc(x.title) + (r.cls === 'done' ? ' <em class="wtag">' + (L.final ? 'Achieved' : 'Achieved today') + '</em>'
        : r.cls === 'close' ? ' <em class="wtag">Almost there</em>' : '') + '</b><span>' + r.html + '</span>' + sh + '</li>';
    }).join('');
    var note = forThis ? (L.final ? 'Final numbers are unofficial. The records watch for the next game appears once the official stats are in, usually the day after the game.' : 'Counts down live with Allen’s numbers today (unofficial).')
      : 'Only records Allen could reach with a performance at or below his best single game. Most likely first. Updated ' + esc(W.asOf) + '.';
    var vs = oppNick ? (oppHome ? 'vs' : 'at') + ' the ' + oppNick : '';
    var gday = match.date && wDate === gameDate(match) ? String(match.date).replace(/, \d{4}$/, '') : '';
    var shareAll = window.JPAShare ? JPAShare.btn({chip: forThis ? (L.final ? 'Final' : 'Live') : 'Next Game',
      kicker: forThis ? (L.final ? 'How it went' : 'Counting down live') + (vs ? ', ' + vs : '') : 'What Josh Allen could break' + (vs ? ' ' + vs : ''),
      title: 'Records watch' + (gday && !forThis ? ': ' + gday : ''), items: shareItems,
      foot: forThis ? 'Live numbers are unofficial' : 'Updated ' + W.asOf, url: location.pathname.indexOf('matchup') >= 0 ? 'matchup.html' : '',
      share: 'Josh Allen records watch' + (vs ? ' ' + vs : '')}, 'Records watch') : '';
    return {close: close && L && !L.final, broke: broke,
      html: '<div class="lw"><div class="lwh">Records watch' + (oppNick ? ' <span>' + (oppHome ? 'vs' : 'at') + ' the ' + esc(oppNick) + '</span>' : '') + shareAll + '</div>'
        + '<ol class="wlist">' + rows + '</ol><p class="lwn">' + note + '</p></div>'};
  }
  // Two spinning goal lights on top of the card when a record is within reach.
  // Each: beam (b), the turning mirror and bulb inside (.mech), a see-through colored cover (.cov), and the base.
  function light(side, color){ return '<span class="gl ' + side + ' ' + color + '"><b></b><span class="mech"><i class="mir"></i><i class="bulb"></i></span><i class="cov"></i></span>'; }
  var LIGHTS = '<div class="glights" aria-hidden="true">' + light('l', 'red') + light('r', 'blue') + '</div>';

  // The Gameday live card. Normal spot: #livebar-slot. On gameday it moves up to #livebar-gameday
  // (stats page: under the social links; Next game page: under the team cards) and goes back the next day.
  function bar(){
    var L = use(), el = document.getElementById('livebar'), slot = document.getElementById('livebar-slot');
    var up = document.getElementById('livebar-gameday'), gd = isGameday();
    var idle = !L && slot && slot.hasAttribute('data-idle');
    if(!L && !idle){ if(el) el.hidden = true; return; }
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
          + '<span class="lnote">Once the Bills kick off, Allen&rsquo;s stats show up right here and the records watch counts down live, every 2 minutes.</span>'
        : '<span class="ln">Check back on gameday to watch records broken live.</span>'
          + '<span class="lnote">Once the Bills kick off, Allen&rsquo;s stats show up right here and update every 2 minutes.</span>') + w.html;
      el.hidden = false; sweep(); return; }
    var s = L.s, parts = [];
    if(s.att) parts.push(s.cmp + '/' + s.att + ', ' + s.yds + ' yds, ' + s.td + ' TD' + (s.int ? ', ' + s.int + ' INT' : ''));
    if(s.rushAtt || s.rushTD) parts.push(s.rushAtt + ' rush, ' + s.rushYds + ' yds' + (s.rushTD ? ', ' + s.rushTD + ' TD' : ''));
    var score = (L.bills !== '' && L.bills != null) ? ' · Bills ' + L.bills + ', ' + L.opp + ' ' + L.them : ' vs ' + L.opp;
    el.innerHTML = (w.close ? LIGHTS + '<span class="sr">A record is within reach.</span>' : '') + (w.broke ? '<span class="sr">A record fell today.</span>' : '') +
      '<div class="lhead"><span class="dot' + (L.final ? ' fin' : '') + '"></span><b>' + (L.final ? 'FINAL' : 'LIVE') + '</b>' + score +
      (!L.final && L.clock ? ' · ' + L.clock : '') + '<br><span class="ln">Allen today: ' + (parts.join(' · ') || 'no stats yet') +
      '</span>' + (window.JPALIVE_RELOAD && changed ? '<button type="button" class="lrel" onclick="location.reload()">New numbers: tap to update</button>' : '') + '</div>' + w.html + '<span class="lnote">Live numbers are unofficial and update every 2 minutes. They are checked against the official stats after the game.</span>';
    el.hidden = false;
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
    onChange: function(f){ listeners.push(f); }
  };
})();
