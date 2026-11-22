// Gameday chart builder: fans drop reactions (beers, wings, a thrown remote...) on the Bills win-chance chart and
// share it as an image or a 20-second video. Opens from the win-probability card under the Gameday live card.
// Works before kickoff too: turn on "We pregamed / tailgated" and drop reactions in the gold pregame section.
// Reactions are kept in this browser (localStorage) for the game, so a pregame start carries into the game.
// Uses scripts/wincard.js (the card) and scripts/mp4.js (the video). Icons: images/reactions/*.svg.
// JPAReact.open(get): get() returns {D, date, kick (minutes after midnight ET), analyst} with the latest numbers.
(function(){
  var W = 1080, H = 1350, GOLD = '#e9c46a', NAVY = '#040e30', MUTE = '#a0afd7', SOFT = '#e1e6f8';
  var EM = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  function F(it, w, s){ return (it ? 'italic ' : '') + w + ' ' + s + 'px LoraShare, Georgia, serif'; }
  function hm(m){ m = ((m % 1440) + 1440) % 1440; var h = Math.floor(m / 60), mm = m % 60; return ((h + 11) % 12 + 1) + ':' + ('0' + mm).slice(-2) + (h < 12 ? ' AM' : ' PM'); }
  function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

  // ---------- Reactions ----------
  // Only well-known lead analysts get named in "Told ___ to shut up"; any other crew is "announcers".
  var st = {tv: '', pre: null, kick: 13 * 60};
  function who(){ return st.tv || 'announcers'; }
  function x(n){ return n > 1 ? ' ' + n + 'x' : ''; }
  var R = [
    {id:'beer', e:'🍺', t:function(){ return 'Crushed a beer'; }, c:function(n){ return n > 1 ? n + ' beers crushed' : 'crushed a beer'; }},
    {id:'wings', e:'🍗', t:function(){ return 'Wings'; }, c:function(n){ return n + (n > 1 ? ' wings' : ' wing'); }},
    {id:'remote', e:'', img:'remote', t:function(){ return 'Threw remote'; }, c:function(n){ return n + (n > 1 ? ' remotes thrown' : ' remote thrown'); }},
    {id:'tv', e:'', img:'tv', t:function(){ return 'Smashed the TV'; }, c:function(n){ return n > 1 ? n + ' TVs smashed' : 'smashed the TV'; }},
    {id:'walk', e:'🚪', t:function(){ return 'Walked out'; }, c:function(n){ return 'walked out' + x(n); }},
    {id:'shut', e:'🤐', t:function(){ return 'Told ' + (st.tv ? st.tv.split(' ').pop() : 'announcers') + ' to shut up'; }, c:function(n){ return 'told ' + who() + ' to shut up' + x(n); }},
    {id:'refs', e:'🦓', t:function(){ return 'Blamed the refs'; }, c:function(n){ return 'blamed the refs' + x(n); }},
    {id:'eyes', e:'🙈', t:function(){ return "Couldn't watch"; }, c:function(n){ return "couldn't watch" + x(n); }},
    {id:'pray', e:'🙏', t:function(){ return 'Prayed'; }, c:function(n){ return n + (n > 1 ? ' prayers' : ' prayer'); }},
    {id:'table', e:'', img:'table', t:function(){ return 'Smashed a table'; }, c:function(n){ return n + (n > 1 ? ' tables smashed' : ' table smashed'); }},
    {id:'squish', e:'', img:'squish', opp:'MIA', t:function(){ return 'Chanted "Squish the Fish!"'; }, c:function(n){ return 'chanted "Squish the Fish!"' + x(n); }},
    {id:'laces', e:'', img:'laces', opp:'MIA', t:function(){ return 'Said "Laces out, Dan!"'; }, c:function(n){ return 'said "Laces out, Dan!"' + x(n); }},
    {id:'butt', e:'', img:'butt', opp:'NYJ', t:function(){ return 'Mentioned the Butt Fumble'; }, c:function(n){ return 'brought up the Butt Fumble' + x(n); }},
    {id:'pass', e:'', img:'pass', t:function(){ return 'Told wife Josh Allen is my hall pass'; }, c:function(n){ return 'told wife Josh Allen is my hall pass' + x(n); }},
    {id:'same', e:'😩', t:function(){ return '"Same old Bills"'; }, c:function(n){ return 'said "same old Bills"' + x(n); }},
    {id:'dad', e:'📞', t:function(){ return 'Called my dad'; }, c:function(n){ return 'called dad' + x(n); }},
    {id:'offon', e:'🔁', t:function(){ return 'Turned it off… and on'; }, c:function(n){ return 'turned it off and back on' + x(n); }}
  ];
  var BY = {}; R.forEach(function(r){ BY[r.id] = r; });
  // Drawn icons (width/height ratio); the rest are emoji
  var IMGS = {laces: .938, squish: .833, remote: 1.333, tv: 1.344, table: 1.556, pass: 1.25, butt: 1.333};
  Object.keys(IMGS).forEach(function(k){ var ar = IMGS[k]; IMGS[k] = {ar: ar, src: 'images/reactions/' + k + '.svg', im: new Image()};
    IMGS[k].im.onload = function(){ if(open_) render(); }; IMGS[k].im.src = IMGS[k].src; });

  // ---------- State for this game ----------
  var get = null, D = null, ALL = [], END = 0, BOX0, BOX, LANE = {x: 76, w: 128}, list = [], hist = [], sel = null, key = '', open_ = false;
  function save(){ try{ for(var i = localStorage.length - 1; i >= 0; i--){ var k = localStorage.key(i); if(k && k.indexOf('jpa-rx-') === 0 && k !== key) localStorage.removeItem(k); }
    localStorage.setItem(key, JSON.stringify({list: list, pre: st.pre})); }catch(e){} }
  function load(){ try{ var o = JSON.parse(localStorage.getItem(key)); if(o){ list = o.list || []; st.pre = o.pre == null ? null : o.pre; return; } }catch(e){} list = []; st.pre = null; }
  function refresh(){ // latest numbers from the page
    var g = get(); if(!g || !g.D) return false;
    D = g.D; st.kick = g.kick != null ? g.kick : 13 * 60; st.tv = g.analyst || '';
    D.kickText = hm(st.kick);
    var nk = 'jpa-rx-' + (g.date || 'game'); if(nk !== key){ key = nk; load(); hist = []; }
    ALL = D.wp.pts.slice(); var k0 = [0, D.wp.p0 != null ? D.wp.p0 : (ALL[0] ? ALL[0][1] : .5), 0, 0, '', 'Kickoff'];
    if(!ALL.length || ALL[0][0] > 0) ALL.unshift(k0); else ALL[0] = [0, k0[1], ALL[0][2], ALL[0][3], ALL[0][4], ALL[0][5]];
    END = ALL[ALL.length - 1][0]; BOX0 = JPAWinCard.box(D);
    list = list.filter(function(r){ return (!BY[r.id] || !BY[r.id].opp || BY[r.id].opp === D.oppAb) && BY[r.id] && r.t <= Math.max(END, 0); });
    return true;
  }
  function tS(){ return -Math.max(15, st.kick - st.pre) * 60; }   // pregame start, seconds before kickoff (negative)
  function setBox(){ BOX = st.pre == null ? BOX0 : {x: 248, y: BOX0.y, w: 644, h: BOX0.h}; D.box = st.pre == null ? null : BOX; }
  function pAt(t){ if(t <= 0) return ALL[0][1]; for(var i = 1; i < ALL.length; i++){ if(ALL[i][0] >= t){ var a = ALL[i - 1], b = ALL[i]; if(b[0] === a[0]) return b[1]; return a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]); } } return ALL[ALL.length - 1][1]; }
  function X(t){ if(t < 0) return LANE.x + (t - tS()) / -tS() * LANE.w; return BOX.x + Math.min(1, t / 3600) * BOX.w; }
  function Y(p){ return BOX.y + (1 - p) * BOX.h; }

  // ---------- Drawing (on top of the win-chance card) ----------
  var cv, c, LOGO = new Image(); LOGO.src = 'images/nja-logo.webp';
  function icon(r, x, y, h){ if(r.img){ var o = IMGS[r.img]; h *= o.ar > 1.4 ? 1.25 : 1.35; var w = h * o.ar; if(o.im.complete && o.im.naturalWidth) c.drawImage(o.im, x - w / 2, y - h / 2 - (o.ar > 1.4 ? 5 : 1), w, h); } else c.fillText(r.e, x, y); }
  function layout(tCut){
    var top = BOX.y + 32, bot = BOX.y + BOX.h - 30;
    var shown = list.filter(function(r){ return tCut == null || r.t <= tCut; }).sort(function(a, b){ return a.t - b.t; }), placed = [];
    shown.forEach(function(r){
      var px = X(r.t), py = Y(pAt(r.t)), up = py - 70 >= top, by = up ? py - 70 : py + 70;
      for(var k = 0; k < 8; k++){ // nudge away from bubbles already placed
        var hit = placed.some(function(q){ return Math.abs(q.bx - px) < 62 && Math.abs(q.by - by) < 62; });
        if(!hit) break; by += up ? -64 : 64; if(by < top){ by = py + 70 + 64 * k; up = false; } }
      placed.push({r: r, px: px, py: py, bx: px, by: Math.max(top, Math.min(bot, by))});
    });
    return placed;
  }
  function drawReactions(tCut, pop){
    layout(tCut).forEach(function(q){
      var s = 1;
      if(pop != null){ var age = (pop - q.r.t) / (pop < 0 || q.r.t < 0 && pop <= 0 ? -tS() * .08 : Math.max(END, 600) * .03); s = age >= 1 ? 1 : .4 + .6 * Math.max(0, age) + Math.sin(Math.max(0, age) * Math.PI) * .25; }
      c.save();
      c.strokeStyle = 'rgba(233,196,106,.8)'; c.lineWidth = 2; c.setLineDash([3, 5]);
      c.beginPath(); c.moveTo(q.px, q.py); c.lineTo(q.bx, q.by); c.stroke(); c.setLineDash([]);
      c.beginPath(); c.arc(q.px, q.py, 6, 0, 7); c.fillStyle = GOLD; c.fill();
      c.translate(q.bx, q.by); c.scale(s, s);
      c.shadowColor = 'rgba(0,0,0,.55)'; c.shadowBlur = 12; c.shadowOffsetY = 3;
      c.beginPath(); c.arc(0, 0, 31, 0, 7); c.fillStyle = 'rgba(4,14,48,.95)'; c.fill(); c.shadowColor = 'transparent';
      c.lineWidth = 3; c.strokeStyle = GOLD; c.stroke();
      c.font = '34px ' + EM; c.textAlign = 'center'; c.textBaseline = 'middle';
      icon(BY[q.r.id], 0, 2, 34);
      if(q.r.n > 1){ var t = '×' + q.r.n; c.font = F(0, 700, 22); var w = c.measureText(t).width + 16;
        c.fillStyle = '#c60c30'; c.beginPath(); if(c.roundRect) c.roundRect(14, -40, w, 28, 14); else c.rect(14, -40, w, 28); c.fill();
        c.fillStyle = '#fff'; c.fillText(t, 14 + w / 2, -25); }
      c.restore();
    });
  }
  function damage(tCut){
    var tot = {}, order = [];
    list.forEach(function(r){ if(tCut != null && r.t > tCut) return; if(!tot[r.id]){ tot[r.id] = 0; order.push(r.id); } tot[r.id] += r.n; });
    if(!order.length && st.pre == null) return;
    order.sort(function(a, b){ return tot[b] - tot[a]; });
    var parts = order.map(function(id){ return {r: BY[id], s: BY[id].c(tot[id])}; });
    if(st.pre != null) parts.unshift({r: {e: '🍻'}, s: 'pregaming since ' + hm(st.pre)});
    var SEP = '  ·  ', size = 25, K = 'DAMAGE REPORT   ', kw, lines;
    c.save(); c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    function pw(p){ c.font = F(1, 600, size); var w = c.measureText(' ' + p.s).width; if(p.r.img) return w + size * 1.2 * IMGS[p.r.img].ar; c.font = size + 'px ' + EM; return w + c.measureText(p.r.e).width; }
    function sepw(){ c.font = F(1, 600, size); return c.measureText(SEP).width; }
    function split(){
      c.font = F(0, 700, size - 3); kw = c.measureText(K).width;
      var a = [], cur = [], cw = 0, room = W - 110 - kw;
      parts.forEach(function(p){ var w = pw(p), add = cur.length ? sepw() + w : w;
        if(cur.length && cw + add > room){ a.push({p: cur, w: cw}); cur = [p]; cw = w; room = W - 110; } else { cur.push(p); cw += add; } });
      a.push({p: cur, w: cw}); return a; }
    lines = split(); while(lines.length > 2 && size > 17){ size -= 1; lines = split(); }
    if(lines.length > 2){ var rest = []; lines.slice(1).forEach(function(l){ rest = rest.concat(l.p); }); lines = [lines[0], {p: rest, w: rest.reduce(function(s, p, i){ return s + pw(p) + (i ? sepw() : 0); }, 0)}]; }
    var y0 = lines.length > 1 ? 1249 : 1258;
    lines.forEach(function(l, i){
      var x = (W - l.w - (i ? 0 : kw)) / 2, y = y0 + i * (size + 5);
      if(!i){ c.font = F(0, 700, size - 3); c.fillStyle = GOLD; c.fillText(K, x, y); x += kw; }
      l.p.forEach(function(p, j){
        if(j){ c.font = F(1, 600, size); c.fillStyle = SOFT; c.fillText(SEP, x, y); x += sepw(); }
        if(p.r.img){ var o = IMGS[p.r.img], h = size * 1.2; if(o.im.complete && o.im.naturalWidth) c.drawImage(o.im, x, y - h * .85, h * o.ar, h); x += h * o.ar; }
        else { c.font = size + 'px ' + EM; c.fillText(p.r.e, x, y); x += c.measureText(p.r.e).width; }
        c.font = F(1, 600, size); c.fillStyle = SOFT; c.fillText(' ' + p.s, x, y); x += c.measureText(' ' + p.s).width; }); });
    c.restore();
  }
  function lane(k){ // the gold pregame section; k = 0..1 is how much of its line is drawn
    if(st.pre == null) return;
    var y0 = BOX.y - 24 - 112, hh = BOX.h + 72 + 112, x0 = LANE.x - 20, x1 = BOX.x - 24, yl = Y(ALL[0][1]);
    c.save();
    c.fillStyle = 'rgba(233,196,106,.07)'; c.beginPath(); if(c.roundRect) c.roundRect(x0, y0, x1 - x0, hh, [22, 0, 0, 22]); else c.rect(x0, y0, x1 - x0, hh); c.fill();
    c.strokeStyle = 'rgba(233,196,106,.55)'; c.lineWidth = 2; c.setLineDash([6, 8]); c.beginPath(); c.moveTo(x1, y0 + 10); c.lineTo(x1, y0 + hh - 10); c.stroke(); c.setLineDash([]);
    c.textAlign = 'center'; c.textBaseline = 'top';
    var hy = BOX.y + BOX.h - 168, mx = (x0 + x1) / 2;
    c.fillStyle = '#fff'; c.font = '34px ' + EM; c.fillText('🍻', mx, hy);
    c.font = F(0, 700, 19); if('letterSpacing' in c) c.letterSpacing = '2px'; c.fillStyle = GOLD; c.fillText('PREGAME', mx, hy + 46); if('letterSpacing' in c) c.letterSpacing = '0px';
    c.font = F(1, 600, 22); c.fillStyle = SOFT; c.fillText('since ' + hm(st.pre), mx, hy + 72);
    var xa = LANE.x, xb = xa + (x1 + 24 - xa) * k;
    c.strokeStyle = 'rgba(255,255,255,.75)'; c.lineWidth = 4; c.setLineDash([2, 9]); c.lineCap = 'round';
    c.beginPath(); c.moveTo(xa, yl); c.lineTo(xb, yl); c.stroke(); c.setLineDash([]);
    c.beginPath(); c.arc(xa, yl, 8, 0, 7); c.fillStyle = GOLD; c.fill(); c.lineWidth = 3; c.strokeStyle = NAVY; c.stroke();
    c.font = F(0, 600, 24); c.fillStyle = MUTE; c.textBaseline = 'top'; c.fillText('Pre', (x0 + x1) / 2, BOX.y + BOX.h + 14);
    c.font = F(1, 500, 18); c.fillText(hm(st.pre), xa + 6, yl + 16);
    c.restore();
  }
  // e = -1..0 is the pregame part of the video, 0..1 the game
  function card(e){
    setBox(); JPAWinCard.draw(c, D, Math.max(0, e), LOGO.complete && LOGO.naturalWidth ? LOGO : null);
    if(e < 0){ var k = 1 + e, tp = tS() * (1 - k); lane(k); drawReactions(tp, tp); damage(tp); return; }
    lane(1);
    if(e >= 1){ drawReactions(); damage(); } else { var t = END * e; drawReactions(t, t); damage(t); }
  }
  function render(){ if(c && D) card(1); }

  // ---------- The builder (full screen) ----------
  var box, hint;
  function $(s){ return box.querySelector(s); }
  function build(){
    if(box) return;
    box = document.createElement('div'); box.className = 'rx'; box.hidden = true;
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Your gameday chart');
    box.innerHTML = '<div class="rx-in"><div class="rx-top"><b>Your gameday chart</b><button type="button" class="rx-x">Close</button></div>'
      + '<canvas width="' + W + '" height="' + H + '"></canvas><p class="rx-hint" aria-live="polite"></p>'
      + '<div class="rx-sec">Pregame / tailgate</div><div class="rx-set"><label><input type="checkbox" class="rx-preon"> 🍻 We pregamed / tailgated</label>'
      + '<label class="rx-prerow" hidden>Started at <input type="time" class="rx-pretime" value="10:00" step="300"> <span class="rx-kick"></span></label></div>'
      + '<div class="rx-sec">Add reaction</div><div class="rx-tray"></div>'
      + '<div class="rx-sec rx-swh">Or drop it on a big swing</div><div class="rx-swings"></div>'
      + '<div class="rx-row"><button type="button" class="rx-undo">↩ Undo</button><button type="button" class="rx-clear">Clear</button><button type="button" class="rx-play">▶ Play</button></div>'
      + '<div class="rx-row"><button type="button" class="rx-main rx-img">Share image</button><button type="button" class="rx-main rx-vid">🎬 Make video</button></div>'
      + '<p class="rx-note">Your reactions stay on this phone for this game, so you can keep adding as it goes. Nothing posts anywhere until you share it. Unofficial, for fun.</p></div>'
      + '<div class="rx-out" hidden><img alt="Your gameday chart"><video playsinline controls loop muted hidden></video><p class="rx-msg"></p>'
      + '<div class="rx-row"><button type="button" class="rx-main rx-go">Share</button><a class="rx-dl" download>Save</a><button type="button" class="rx-back">Back</button></div></div>';
    document.body.appendChild(box);
    cv = $('canvas'); c = cv.getContext('2d'); hint = $('.rx-hint');
    $('.rx-x').onclick = close;
    document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && open_) close(); });
    $('.rx-tray').addEventListener('click', function(ev){ var b = ev.target.closest('button'); if(!b) return; var id = b.getAttribute('data-id');
      sel = sel === id ? null : id; tray(); say(sel ? BY[sel].t() + ': now tap the chart' + (END > 0 ? ' (or a big swing below).' : '.') : idle()); });
    $('.rx-swings').addEventListener('click', function(ev){ var b = ev.target.closest('button'); if(b) add(ALL[SW[+b.getAttribute('data-i')].key][0]); });
    $('.rx-undo').onclick = function(){ var h = hist.pop(); if(!h) return;
      if(h.k === 'inc') h.r.n--; else if(h.k === 'move') h.r.t = h.t; else if(h.k === 'merge'){ h.into.n -= h.r.n; h.r.t = h.t; list.push(h.r); } else list.splice(list.indexOf(h.r), 1); save(); render(); };
    $('.rx-clear').onclick = function(){ if(list.length && !confirmClear()) return; list = []; hist = []; save(); render(); };
    $('.rx-play').onclick = play;
    $('.rx-img').onclick = shareImage;
    $('.rx-vid').onclick = makeVideo;
    $('.rx-preon').onchange = preSync; $('.rx-pretime').onchange = preSync;
    $('.rx-back').onclick = function(){ $('.rx-out').hidden = true; $('.rx-in').hidden = false; $('video').pause(); };
    $('.rx-go').onclick = shareOut;
    wireCanvas();
  }
  var clearAsk = 0;
  function confirmClear(){ if(Date.now() - clearAsk < 4000) return true; clearAsk = Date.now(); say('Tap Clear again to remove all your reactions.'); return false; }
  function say(t){ hint.textContent = t; }
  function idle(){ return END > 0 ? 'Pick a reaction, then tap the chart where it happened.'
    : st.pre != null ? 'Pick a reaction, then tap the gold pregame section.' : 'Before kickoff: turn on "We pregamed / tailgated" to start your chart now.'; }
  function tray(){
    var show = R.filter(function(r){ return !r.opp || r.opp === D.oppAb; }).sort(function(a, b){ return (b.opp ? 1 : 0) - (a.opp ? 1 : 0); });
    $('.rx-tray').innerHTML = show.map(function(r){
      return '<button type="button" data-id="' + r.id + '" class="' + (sel === r.id ? 'on' : '') + (r.opp ? ' opp' : '') + '">' + (r.opp ? '<i class="rx-tag">' + esc(D.oppNick) + ' only</i>' : '')
        + '<b>' + (r.img ? '<img src="' + IMGS[r.img].src + '" alt="">' : r.e) + '</b>' + esc(r.t()) + '</button>'; }).join('');
  }
  var SW = [];
  function clk(t){ var q = Math.min(4, Math.floor(t / 900) + 1), l = q * 900 - t; return 'Q' + q + ' ' + Math.floor(l / 60) + ':' + ('0' + Math.round(l % 60)).slice(-2); }
  function swingBtns(){
    SW = END > 0 ? JPAWinCard.swings(ALL, 3, D.oppNick) : [];
    $('.rx-swh').hidden = !SW.length; $('.rx-swings').hidden = !SW.length;
    $('.rx-swings').innerHTML = SW.map(function(s, i){
      return '<button type="button" data-i="' + i + '"><span>' + (s.d > 0 ? '+' : '−') + Math.round(Math.abs(s.d) * 100) + '</span>' + esc(s.cap) + ' · ' + clk(ALL[s.key][0]) + '</button>'; }).join('');
  }
  function snap(t){ if(t < 0) return t; var best = ALL[0]; ALL.forEach(function(p){ if(Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p; }); return best[0]; }
  function add(t){
    if(!sel){ say('Pick a reaction first.'); return; }
    if(t >= 0 && END <= 0){ say(st.pre != null ? 'The game hasn’t started yet. Drop it in the gold pregame section.' : 'The game hasn’t started yet. Turn on "We pregamed / tailgated" to add reactions now.'); return; }
    t = snap(t);
    var same = list.filter(function(r){ return r.id === sel && Math.abs(r.t - t) <= 120; })[0];
    if(same){ same.n++; hist.push({k: 'inc', r: same}); } else { var r = {id: sel, t: t, n: 1}; list.push(r); hist.push({k: 'new', r: r}); }
    save(); render(); say(BY[sel].t() + ' added. Tap again to stack it, or pick another.');
  }
  function pos(ev){ var b = cv.getBoundingClientRect(); return {x: (ev.clientX - b.left) * W / b.width, y: (ev.clientY - b.top) * H / b.height}; }
  function tAt(x){
    if(st.pre != null && x < BOX.x - 12){ var s = tS(), v = s + Math.max(0, Math.min(1, (x - LANE.x) / LANE.w)) * -s; return Math.min(-60, Math.round(v / 300) * 300 || -60); }
    return Math.max(0, Math.min(END, (x - BOX.x) / BOX.w * 3600)); }
  var drag = null;
  function wireCanvas(){
    cv.addEventListener('pointerdown', function(ev){
      var p = pos(ev), L = layout(), hit = null;
      for(var i = L.length - 1; i >= 0; i--){ var q = L[i]; if(Math.hypot(p.x - q.bx, p.y - q.by) < 40 || Math.hypot(p.x - q.px, p.y - q.py) < 18){ hit = q; break; } }
      drag = {x0: p.x, r: hit && hit.r, t0: hit && hit.r.t, dx: hit ? hit.px - p.x : 0, moved: false};
      if(hit){ try{ cv.setPointerCapture(ev.pointerId); }catch(e){} }
    });
    cv.addEventListener('pointermove', function(ev){
      if(!drag || !drag.r) return; var p = pos(ev);
      if(!drag.moved && Math.abs(p.x - drag.x0) < 8) return;
      drag.moved = true; ev.preventDefault();
      var t = tAt(p.x + drag.dx); if(drag.r.t < 0 && t >= 0 && END <= 0) t = -60; // nothing to land on in the game yet
      drag.r.t = snap(t); render(); say('Sliding… let go to drop it.');
    });
    cv.addEventListener('pointerup', function(ev){
      if(!drag) return; var d = drag; drag = null;
      if(d.r && d.moved){
        hist.push({k: 'move', r: d.r, t: d.t0});
        var twin = list.filter(function(o){ return o !== d.r && o.id === d.r.id && Math.abs(o.t - d.r.t) <= 120; })[0]; // dropped on the same reaction: stack them
        if(twin){ twin.n += d.r.n; list.splice(list.indexOf(d.r), 1); hist.pop(); hist.push({k: 'merge', r: d.r, into: twin, t: d.t0}); }
        save(); render(); say('Moved. Press and slide any reaction to move it again.'); return;
      }
      var p = pos(ev);
      if(p.x < (st.pre != null ? LANE.x - 24 : BOX.x - 30) || p.x > BOX.x + BOX.w + 30 || p.y < BOX.y - 130 || p.y > BOX.y + BOX.h + 40){ if(sel) say('Tap inside the chart.'); return; }
      if(!sel && d.r){ say('Press and slide it left or right to move it.'); return; }
      add(tAt(p.x));
    });
    cv.addEventListener('pointercancel', function(){ if(drag && drag.r && drag.moved){ drag.r.t = drag.t0; render(); } drag = null; });
  }
  function preSync(){
    var on = $('.rx-preon').checked, v = $('.rx-pretime').value || '10:00', m = +v.split(':')[0] * 60 + +v.split(':')[1];
    if(on && m >= st.kick){ m = st.kick - 15; $('.rx-pretime').value = ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + m % 60).slice(-2); }
    st.pre = on ? m : null; $('.rx-prerow').hidden = !on;
    if(!on) list = list.filter(function(r){ return r.t >= 0; });            // pregame reactions go with the section
    else list.forEach(function(r){ if(r.t < 0) r.t = Math.max(tS(), r.t); });
    save(); render(); say(on ? 'Pregame added. Tap in the gold section to drop reactions before kickoff.' : idle());
  }
  function syncControls(){
    $('.rx-preon').checked = st.pre != null; $('.rx-prerow').hidden = st.pre == null;
    if(st.pre != null) $('.rx-pretime').value = ('0' + Math.floor(st.pre / 60)).slice(-2) + ':' + ('0' + st.pre % 60).slice(-2);
    $('.rx-kick').textContent = '(kickoff ' + hm(st.kick) + ')';
    tray(); swingBtns();
  }

  // ---------- Play, image, video ----------
  var DRAW = 17000, HOLD = 3000, VFPS = 24, FPS = 30, busy = false;
  function frameE(ms){ var pre = st.pre != null ? 2200 : 0; if(ms < pre) return ms / pre - 1; return Math.min(1, (ms - pre) / (DRAW - pre)); }
  function play(){ if(busy) return; busy = true; var t0 = performance.now();
    (function f(now){ if(!open_){ busy = false; return; } var ms = now - t0; card(frameE(ms)); if(ms < DRAW + HOLD) requestAnimationFrame(f); else { busy = false; render(); } })(t0); }
  var OUT = null;
  function fname(ext){ return 'bills-' + String(D.oppNick || 'game').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-gameday-chart.' + ext; }
  function show(kind, blob, msg){
    OUT = {blob: blob, name: fname(kind === 'img' ? 'png' : (/mp4/.test(blob.type) ? 'mp4' : 'webm'))};
    var url = URL.createObjectURL(blob), im = $('.rx-out img'), v = $('.rx-out video');
    im.hidden = kind !== 'img'; v.hidden = kind === 'img';
    if(kind === 'img') im.src = url; else { v.src = url; v.play().catch(function(){}); }
    var a = $('.rx-dl'); a.href = url; a.download = OUT.name; $('.rx-msg').textContent = msg || '';
    $('.rx-go').hidden = !navigator.share; $('.rx-in').hidden = true; $('.rx-out').hidden = false;
  }
  function shareOut(){
    if(!OUT) return;
    var file = new File([OUT.blob], OUT.name, {type: OUT.blob.type || 'image/png'}), url = 'https://notjoshingaround.com/';
    var data = {files: [file], title: 'My Bills gameday chart', text: 'My Bills gameday chart. Make yours at ' + url};
    if(navigator.canShare && navigator.canShare(data)) navigator.share(data).catch(function(){});
    else if(navigator.share) navigator.share({title: data.title, text: data.text, url: url}).catch(function(){});
  }
  function shareImage(){ render(); cv.toBlob(function(b){ if(b) show('img', b, 'Share it, or press and hold the image to save it.'); }, 'image/png'); }
  function liveType(){
    if(!window.MediaRecorder || !cv.captureStream) return '';
    var t = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
    for(var i = 0; i < t.length; i++) if(MediaRecorder.isTypeSupported(t[i])) return t[i];
    return '';
  }
  function liveRec(prog){ // fallback: record the canvas as it plays, then repair the MP4 so it has a real length
    var type = liveType(); if(!type) return Promise.reject('no video');
    var stream = cv.captureStream(FPS), rec, chunks = [];
    try{ rec = new MediaRecorder(stream, {mimeType: type, videoBitsPerSecond: 8e6}); }catch(e){ return Promise.reject(e); }
    return new Promise(function(ok){
      rec.ondataavailable = function(e){ if(e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = function(){ stream.getTracks().forEach(function(x){ x.stop(); }); var blob = new Blob(chunks, {type: type.split(';')[0]});
        if(!/mp4/.test(blob.type) || !window.JPAMp4) return ok(blob);
        blob.arrayBuffer().then(function(ab){ ok(JPAMp4.defrag(ab) || blob); }, function(){ ok(blob); }); };
      card(frameE(0)); rec.start(250);
      var t0 = performance.now();
      (function f(){ var ms = performance.now() - t0; card(frameE(ms)); prog(Math.min(99, Math.round(ms / (DRAW + HOLD) * 100)));
        if(ms < DRAW + HOLD) setTimeout(f, 1000 / FPS); else rec.stop(); })();
    });
  }
  function makeVideo(){
    if(busy) return; busy = true; var btn = $('.rx-vid'); btn.disabled = true;
    var prog = function(p){ btn.textContent = 'Making video ' + p + '%'; say('Making your 20-second video… ' + p + '%'); };
    prog(0);
    var go = window.JPAMp4 ? JPAMp4.supported(W, H, FPS) : Promise.resolve(false);
    go.then(function(ok){
      if(!ok) return liveRec(prog);
      var nd = Math.round(DRAW / 1000 * VFPS) + 1;
      return JPAMp4.encode(cv, function(e){ card(frameE(e * DRAW)); }, nd, VFPS, function(f){ prog(Math.round(f * 100)); }, function(){ return !open_; }, {hold: HOLD})
        .catch(function(){ return liveRec(prog); });
    }).then(function(blob){ say('Your 20-second video is ready.'); show('vid', blob, 'Share it, or tap Save.'); },
      function(){ say('This browser can’t make the video. Try Chrome or Safari on your phone. The image works everywhere.'); })
    .then(function(){ busy = false; btn.disabled = false; btn.textContent = '🎬 Make video'; render(); });
  }

  // ---------- Open / close ----------
  var fontsReady = null;
  function fonts(){
    if(fontsReady) return fontsReady;
    try{
      var f = [new FontFace('LoraShare', 'url(fonts/lora.woff)', {weight: '400 700'}), new FontFace('LoraShare', 'url(fonts/lora-italic.woff)', {weight: '400 700', style: 'italic'})];
      fontsReady = Promise.all(f.map(function(x){ return x.load().then(function(y){ document.fonts.add(y); }); })).catch(function(){});
    }catch(e){ fontsReady = Promise.resolve(); }
    return fontsReady;
  }
  function open(fn){
    get = fn; build(); if(!refresh()) return;
    open_ = true; sel = null; box.hidden = false; $('.rx-out').hidden = true; $('.rx-in').hidden = false;
    document.documentElement.classList.add('shr-open');
    syncControls(); say(idle()); render();
    fonts().then(render); LOGO.onload = render;
  }
  function close(){ open_ = false; if(box){ box.hidden = true; $('video').pause(); } document.documentElement.classList.remove('shr-open'); }
  // New live numbers while the builder is open: redraw with them (reactions stay put)
  function update(){ if(!open_ || busy || !get) return; if(refresh()){ swingBtns(); tray(); render(); } }
  window.JPAReact = {open: open, update: update, has: function(date){ try{ var o = JSON.parse(localStorage.getItem('jpa-rx-' + date)); return !!(o && (o.list && o.list.length || o.pre != null)); }catch(e){ return false; } }};
})();
