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

  // Small "LIVE" bar at the top of the page.
  function bar(){
    var L = use(), el = document.getElementById('livebar');
    if(!L){ if(el) el.hidden = true; return; }
    if(!el){ el = document.createElement('div'); el.id = 'livebar'; el.className = 'livebar'; el.setAttribute('role','status');
      var slot = document.getElementById('livebar-slot'), m = document.querySelector('main');
      if(slot) slot.appendChild(el); else if(m) m.insertBefore(el, m.firstChild); else document.body.insertBefore(el, document.body.firstChild); }
    var s = L.s, parts = [];
    if(s.att) parts.push(s.cmp + '/' + s.att + ', ' + s.yds + ' yds, ' + s.td + ' TD' + (s.int ? ', ' + s.int + ' INT' : ''));
    if(s.rushAtt || s.rushTD) parts.push(s.rushAtt + ' rush, ' + s.rushYds + ' yds' + (s.rushTD ? ', ' + s.rushTD + ' TD' : ''));
    var score = (L.bills !== '' && L.bills != null) ? ' · Bills ' + L.bills + ', ' + L.opp + ' ' + L.them : ' vs ' + L.opp;
    el.innerHTML = '<span class="dot' + (L.final ? ' fin' : '') + '"></span><b>' + (L.final ? 'FINAL' : 'LIVE') + '</b>' + score +
      (!L.final && L.clock ? ' · ' + L.clock : '') + '<br><span class="ln">Allen today: ' + (parts.join(' · ') || 'no stats yet') +
      '</span>' + (window.JPALIVE_RELOAD && changed ? '<button type="button" class="lrel" onclick="location.reload()">New numbers: tap to update</button>' : '') + '<span class="lnote">Live numbers are unofficial and update every 2 minutes. They are checked against the official stats after the game.</span>';
    el.hidden = false;
  }

  // Which games nflverse already has (from the hourly file), so the live line is never counted twice.
  function loadOfficial(){
    return fetch('https://raw.githubusercontent.com/JPADev1/Joshuapatrickallen/stats-data/allen-2026.json', {cache:'no-cache'})
      .then(function(r){ return r.ok ? r.json() : null; }).then(noteOfficial).catch(function(){});
  }
  var ready = Promise.all([get(), loadOfficial()]).then(function(r){ state = r[0]; sig = JSON.stringify(state); return state; });
  function poll(){
    if(document.hidden) return;
    get().then(function(L){
      var s2 = JSON.stringify(L);
      if(s2 !== sig){ state = L; sig = s2; changed = true; loadOfficial().then(function(){ bar(); listeners.forEach(function(f){ try{ f(); }catch(e){} }); }); }

      if(!L || L.final){ clearInterval(timer); timer = null; } // nothing left to follow
    });
  }
  ready.then(function(L){ bar(); if(L && !L.final) timer = setInterval(poll, EVERY); });
  document.addEventListener('visibilitychange', function(){ if(!document.hidden && timer) poll(); });

  window.JPALive = {
    ready: ready,
    patch: patch,
    // Wrap a page's load(name): fetch, then add the live game once the Worker has answered (or timed out).
    wrap: function(load){ return function(name){ return load(name).then(function(d){ return ready.then(function(){ return patch(name, d); }); }); }; },
    onChange: function(f){ listeners.push(f); }
  };
})();
