// Win-chance share card (used by share.js when a card has `wp`): the Bills win-chance curve on a navy card in the
// share-card style (Lora, gold number, red chip, NJA logo), with the game's biggest swings labeled.
// draw(c, d, e, logo): e = 0..1 is how much of the game has been drawn so far, so the same function makes the
// still image (e = 1) and every frame of the video (the line drawing in from kickoff).
// d = {wp: {pts: [[game seconds, Bills chance, Bills pts, opp pts, mark, play text], ...], p0}, final, oppNick, oppAb,
//      oppColor, sit (down and distance, live only), game (e.g. "Week 10 at Jets")}
(function(){
  var W = 1080, H = 1350, GOLD = '#e9c46a', SOFT = '#e1e6f8', MUTE = '#a0afd7', RED = '#c60c30', NAVY = '#040e30', OK = '#0b6b3a';
  function F(it, w, s){ return (it ? 'italic ' : '') + w + ' ' + s + 'px LoraShare, Georgia, serif'; }
  function sh(c, fn){ c.save(); c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 12; c.shadowOffsetY = 3; fn(); c.restore(); }
  function pct(p){ return p >= .995 && p < 1 ? '>99%' : p <= .005 && p > 0 ? '<1%' : Math.round(p * 100) + '%'; }
  function clock(t){ if(t >= 3600) return t > 3600 ? 'OT' : 'End of Q4'; var q = Math.min(4, Math.floor(t / 900) + 1), l = q * 900 - t;
    return 'Q' + q + ' ' + Math.floor(l / 60) + ':' + ('0' + Math.round(l % 60)).slice(-2); }
  function rr(c, x, y, w, h, r){ c.beginPath(); if(c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h); }
  // The opponent's color, lifted so it reads on navy
  function lift(hex){
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); if(!m) return '#b9a6ff';
    var v = parseInt(m[1], 16), r = v >> 16, g = v >> 8 & 255, b = v & 255, L = (r * .3 + g * .59 + b * .11) / 255, k = L < .55 ? .55 - L + .25 : .15;
    function f(x){ return Math.round(x + (255 - x) * Math.min(.75, k)); }
    var d = Math.abs(f(r) - 120) + Math.abs(f(g) - 160) + Math.abs(f(b) - 255); // too close to the Bills blue: use lavender
    return d < 90 ? '#b9a6ff' : 'rgb(' + f(r) + ',' + f(g) + ',' + f(b) + ')';
  }

  // ---------- Big swings: legs between turning points (zigzag), captioned with the play that moved it most ----------
  function nm(s){ return String(s || '').replace(/^\d+-/, '').replace(/^[A-Z][a-z]*\./, '').replace(/\.$/, ''); }
  function caption(text, kind, billsScored, opp){
    var t = String(text || '').replace(/(\d+-)?[A-Z]\.[\w'-]+ reported in as eligible\.\s*/gi, '').replace(/\(\d{1,2}:\d{2}\)\s*/, '')
      .replace(/\((No Huddle|Shotgun|No Huddle, Shotgun)\)\s*/gi, ''), m, td = /TOUCHDOWN/i.test(t) || kind === 'td';
    if((m = /INTERCEPTED by (\d+-)?([A-Z][\w'.-]+)/i.exec(t))) return 'Picked off by ' + nm(m[2]) + (td ? ', returned for a TD' : '');
    if(/FUMBLES/i.test(t)){ m = /RECOVERED by ([A-Z]{2,3})/i.exec(t); var who = /^(\d+-)?([A-Z]\.[\w'-]+) /.exec(t);
      return (who ? nm(who[2]) + ' fumble' : 'Fumble') + (m ? ', ' + (m[1].toUpperCase() === 'BUF' ? 'Bills ball' : opp + ' ball') : ''); }
    if(/field goal is GOOD/i.test(t)){ m = /(\d+) yard field goal/i.exec(t); return (billsScored ? 'Bills' : opp) + ' FG' + (m ? ', ' + m[1] + ' yds' : ''); }
    if(/field goal is (NO GOOD|BLOCKED)/i.test(t)) return 'Missed field goal';
    if((m = /([A-Z]\.[\w'-]+) pass (?:short|deep) \w+ to (\d+-)?([A-Z]\.[\w'-]+).*? for (-?\d+) yards?/i.exec(t)))
      return nm(m[1]) + ' to ' + nm(m[3]) + ', ' + m[4] + ' yds' + (td ? ', TD' : '');
    if((m = /([A-Z]\.[\w'-]+) pass (?:short|deep) \w+ to (\d+-)?([A-Z]\.[\w'-]+)/i.exec(t)) && td) return nm(m[1]) + ' to ' + nm(m[3]) + ', TD';
    if((m = /([A-Z]\.[\w'-]+) sacked/i.exec(t))) return nm(m[1]) + ' sacked';
    if(/incomplete/i.test(t) && /4th|turnover on downs/i.test(t)) return '4th-down stop';
    if((m = /^(\d+-)?([A-Z]\.[\w'-]+) (?:left|right|up the middle|scrambles)[^.]*? for (-?\d+) yards?/i.exec(t)))
      return nm(m[2]) + ' run, ' + m[3] + ' yds' + (td ? ', TD' : '');
    if(td) return (billsScored ? 'Bills' : opp) + ' touchdown';
    if(/punts/i.test(t)) return 'Punt';
    if(/TWO-POINT/i.test(t)) return /FAILS/i.test(t) ? '2-point try fails' : '2-point try good';
    if((m = /^(\d+-)?([A-Z]\.[\w'-]+) (?:left|right|up the middle)[^.]*?for no gain/i.exec(t))) return nm(m[2]) + ' stopped, no gain';
    if((m = /([A-Z]\.[\w'-]+) pass [^.]*incomplete/i.exec(t))) return nm(m[1]) + ' incomplete';
    if((m = /^(\d+-)?([A-Z]\.[\w'-]+) (\w+(?: \w+){0,3})/.exec(t))) return nm(m[2]) + ' ' + m[3];
    return t.split(/[.(]/)[0].slice(0, 34);
  }
  function swings(pts, n, opp, min){
    if(min == null){ var r = swings(pts, n, opp, .12); return r.length >= 2 ? r : swings(pts, n, opp, .07); }
    var st = 0; while(st < pts.length - 1 && pts[st + 1][0] <= 30) st++; // start after the opening kickoff
    var ext = [st], dir = 0, cand = st;
    for(var i = st + 1; i < pts.length; i++){
      if(pts[i][4] === 'end') break;
      var p = pts[i][1], pc = pts[cand][1];
      if(dir === 0){ if(Math.abs(p - pts[st][1]) >= min){ dir = p > pts[st][1] ? 1 : -1; cand = i; } }
      else if(dir === 1){ if(p >= pc) cand = i; else if(pc - p >= min){ ext.push(cand); dir = -1; cand = i; } }
      else { if(p <= pc) cand = i; else if(p - pc >= min){ ext.push(cand); dir = 1; cand = i; } }
    }
    if(dir !== 0) ext.push(cand);
    var legs = [];
    for(var k = 1; k < ext.length; k++){
      var a = ext[k - 1], b = ext[k], d = pts[b][1] - pts[a][1]; if(Math.abs(d) < min) continue;
      var best = null;
      for(var j = Math.max(a + 1, 2); j <= b; j++){ // the opening kickoff and other kicks don't count as the play behind a swing
        var s = pts[j][1] - pts[j - 1][1], sj = pts[j][4] === 'td' || pts[j][4] === 'fg' ? pts[j] : pts[j - 1];
        if(/kicks \d+ yards/i.test(sj[5]) && !/touchdown|fumble/i.test(sj[5])) continue;
        if(s * d > 0 && (!best || Math.abs(s) > Math.abs(best.s))) best = {j: j, s: s}; }
      if(!best) continue;
      var q = pts[best.j], src = q[4] === 'td' || q[4] === 'fg' ? q : pts[best.j - 1];
      legs.push({i: b, from: a, key: best.j, d: d, cap: caption(src[5], src[4] || q[4], q[2] > pts[best.j - 1][2], opp)});
    }
    legs.sort(function(x, y){ return Math.abs(y.d) - Math.abs(x.d); });
    return legs.slice(0, n).sort(function(x, y){ return x.i - y.i; });
  }

  // ---------- Card ----------
  function base(c, logo){
    var g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#061a52'); g.addColorStop(.55, '#04103a'); g.addColorStop(1, '#2a0716');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    var r = c.createRadialGradient(W * .5, 260, 40, W * .5, 260, 760); r.addColorStop(0, 'rgba(40,90,220,.35)'); r.addColorStop(1, 'rgba(40,90,220,0)');
    c.fillStyle = r; c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(255,255,255,.035)'; c.lineWidth = 2;
    for(var x = 0; x <= W; x += 54){ c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
    c.textBaseline = 'top'; c.textAlign = 'left';
    var tx = 56; if(logo){ c.save(); c.shadowColor = 'rgba(0,0,0,.55)'; c.shadowBlur = 16; c.shadowOffsetY = 4; c.drawImage(logo, 40, 30, 112, 112); c.restore(); tx = 166; }
    sh(c, function(){ c.fillStyle = '#fff'; c.font = F(0, 700, 26); if('letterSpacing' in c) c.letterSpacing = '2px';
      c.fillText('NOTJOSHINGAROUND.COM', tx, logo ? 73 : 52); if('letterSpacing' in c) c.letterSpacing = '0px'; });
  }
  function chip(c, text, color){
    c.font = F(1, 700, 28); var cw = c.measureText(text).width + 40, x1 = W - 56;
    c.fillStyle = color || RED; rr(c, x1 - cw, 40, cw, 52, 26); c.fill();
    c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, x1 - cw / 2, 67); c.textAlign = 'left'; c.textBaseline = 'top';
  }
  function center(c, text, it, w, size, color, y, maxW){
    c.textAlign = 'center'; c.font = F(it, w, size);
    while(maxW && size > 18 && c.measureText(text).width > maxW){ size -= 2; c.font = F(it, w, size); }
    sh(c, function(){ c.fillStyle = color; c.fillText(text, W / 2, y); }); c.textAlign = 'left';
  }
  function rule(c, y){ c.strokeStyle = GOLD; c.lineWidth = 2; c.beginPath(); c.moveTo(W / 2 - 200, y); c.lineTo(W / 2 + 200, y); c.stroke(); }

  function chart(c, all, shown, box, d, sw, alpha){
    var oc = lift(d.oppColor), oa = d.oppAb || 'OPP';
    var X = function(t){ return box.x + Math.min(1, t / 3600) * box.w; }, Y = function(p){ return box.y + (1 - p) * box.h; }, y50 = Y(.5), lane = 112;
    c.fillStyle = 'rgba(255,255,255,.04)'; rr(c, box.x - 24, box.y - 24 - lane, box.w + 48, box.h + 72 + lane, 22); c.fill();
    c.strokeStyle = 'rgba(255,255,255,.12)'; c.lineWidth = 2;
    [900, 1800, 2700].forEach(function(t){ c.beginPath(); c.moveTo(X(t), box.y); c.lineTo(X(t), box.y + box.h); c.stroke(); });
    c.font = F(0, 600, 24); c.fillStyle = MUTE; c.textAlign = 'center';
    ['Q1','Q2','Q3','Q4'].forEach(function(q, i){ c.fillText(q, X(i * 900 + 450), box.y + box.h + 14); });
    c.textAlign = 'left'; c.font = F(0, 700, 22); c.fillStyle = 'rgba(255,255,255,.55)'; if('letterSpacing' in c) c.letterSpacing = '2px';
    c.fillText('BILLS', box.x + 8, box.y + 8); c.fillText(oa, box.x + 8, box.y + box.h - 30); if('letterSpacing' in c) c.letterSpacing = '0px';
    var last = shown[shown.length - 1];
    if(shown.length > 1){
      var area = function(){ c.beginPath(); c.moveTo(X(shown[0][0]), y50); shown.forEach(function(p){ c.lineTo(X(p[0]), Y(p[1])); }); c.lineTo(X(last[0]), y50); c.closePath(); };
      c.save(); c.beginPath(); c.rect(0, 0, W, y50); c.clip(); area(); c.fillStyle = 'rgba(47,107,255,.42)'; c.fill(); c.restore();
      c.save(); c.beginPath(); c.rect(0, y50, W, H); c.clip(); area(); c.globalAlpha = .38; c.fillStyle = oc; c.fill(); c.restore();
    }
    c.setLineDash([10, 12]); c.strokeStyle = 'rgba(255,255,255,.45)'; c.lineWidth = 2; c.beginPath(); c.moveTo(box.x, y50); c.lineTo(box.x + box.w, y50); c.stroke(); c.setLineDash([]);
    c.lineJoin = 'round'; c.lineCap = 'round';
    c.save(); c.shadowColor = 'rgba(233,196,106,.45)'; c.shadowBlur = 18; c.strokeStyle = '#fff'; c.lineWidth = 5;
    c.beginPath(); shown.forEach(function(p, i){ i ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1])); }); c.stroke(); c.restore();
    shown.forEach(function(p, i){ if(!p[4] || p[4] === 'end' || i === shown.length - 1) return; var a = shown[i - 1] || p;
      c.beginPath(); c.arc(X(p[0]), Y(p[1]), p[4] === 'td' ? 9 : 7, 0, 7);
      if(p[4] === 'to'){ c.fillStyle = NAVY; c.fill(); c.lineWidth = 4; c.strokeStyle = '#fff'; c.stroke(); }
      else { c.fillStyle = p[2] > a[2] ? '#5b8cff' : oc; c.fill(); c.lineWidth = 3; c.strokeStyle = NAVY; c.stroke(); } });
    // swing labels: one row in the lane above the plot, in game order, a dotted leader down to the play
    if(sw.length){
      var L = sw.map(function(s){ var q = all[s.key], num = (s.d > 0 ? '+' : '−') + Math.round(Math.abs(s.d) * 100);
        c.font = F(0, 700, 34); var w1 = c.measureText(num).width; c.font = F(1, 500, 24); var w2 = c.measureText(s.cap).width;
        var fs = 24; while(fs > 18 && w2 + 32 > 300){ fs -= 1; c.font = F(1, 500, fs); w2 = c.measureText(s.cap).width; } // shrink to fit, don't cut
        return {s: s, px: X(q[0]), py: Y(q[1]), num: num, fs: fs, w: Math.min(Math.max(w1, w2) + 32, 300), h: 82, a: alpha(s)}; });
      var left = box.x - 12, right = box.x + box.w + 12, xs = L.map(function(l){ return Math.max(left, Math.min(right - l.w, l.px - l.w / 2)); });
      for(var i = 1; i < xs.length; i++) xs[i] = Math.max(xs[i], xs[i - 1] + L[i - 1].w + 12);
      for(i = xs.length - 1; i >= 0; i--) xs[i] = Math.min(xs[i], (i === xs.length - 1 ? right : xs[i + 1] - 12) - L[i].w);
      var by = box.y - lane - 6;
      L.forEach(function(l, i){ if(l.a <= 0) return; var bx = xs[i], pos = l.s.d > 0, col = pos ? GOLD : oc;
        c.save(); c.globalAlpha = l.a;
        c.strokeStyle = col; c.lineWidth = 2; c.setLineDash([3, 5]); c.beginPath(); c.moveTo(Math.max(bx + 16, Math.min(bx + l.w - 16, l.px)), by + l.h); c.lineTo(l.px, l.py - 11); c.stroke(); c.setLineDash([]);
        c.fillStyle = 'rgba(4,14,48,.9)'; rr(c, bx, by, l.w, l.h, 14); c.fill(); c.strokeStyle = col; c.lineWidth = 2; c.stroke();
        c.font = F(0, 700, 34); c.fillStyle = col; c.fillText(l.num, bx + 16, by + 8);
        c.font = F(1, 500, l.fs); c.fillStyle = SOFT; var cap = l.s.cap; while(cap.length > 4 && c.measureText(cap).width > l.w - 32) cap = cap.slice(0, -2);
        c.fillText(cap === l.s.cap ? cap : cap.replace(/[ ,]+$/, '') + '…', bx + 16, by + 48);
        c.beginPath(); c.arc(l.px, l.py, 9, 0, 7); c.fillStyle = col; c.fill(); c.lineWidth = 3; c.strokeStyle = NAVY; c.stroke();
        c.restore(); });
    }
    var cx = X(last[0]), cy = Y(last[1]);
    c.beginPath(); c.arc(cx, cy, 26, 0, 7); c.fillStyle = 'rgba(233,196,106,.25)'; c.fill();
    c.beginPath(); c.arc(cx, cy, 14, 0, 7); c.fillStyle = GOLD; c.fill(); c.lineWidth = 4; c.strokeStyle = NAVY; c.stroke();
  }
  // Points up to game time `t` (the last one interpolated, so the line moves smoothly in the video)
  function upTo(pts, t){
    var out = [];
    for(var i = 0; i < pts.length; i++){
      if(pts[i][0] <= t){ out.push(pts[i]); continue; }
      var a = pts[i - 1]; if(a && pts[i][0] > a[0]){ var f = (t - a[0]) / (pts[i][0] - a[0]); out.push([t, a[1] + (pts[i][1] - a[1]) * f, a[2], a[3], '', '']); }
      break;
    }
    return out;
  }
  function draw(c, d, e, logo){
    var all = d.wp.pts.slice(); if(!all.length) return;
    var k0 = [0, d.wp.p0 != null ? d.wp.p0 : all[0][1], 0, 0, '', 'Kickoff']; // start from the betting-line chance, as on the site
    if(all[0][0] > 0) all.unshift(k0); else all[0] = [0, k0[1], all[0][2], all[0][3], all[0][4], all[0][5]];
    var end = all[all.length - 1][0], t = e >= 1 ? end : end * Math.max(0, e), shown = e >= 1 ? all : upTo(all, t);
    if(!shown.length) shown = [all[0]];
    var cur = shown[shown.length - 1], opp = d.oppNick || 'Opponent', fin = !!d.final;
    var sw = swings(all, 3, opp), done = e >= 1;
    var alpha = function(s){ var kt = all[s.key][0]; if(done) return 1; return t >= kt ? Math.min(1, (t - kt) / (end * .06) + .15) : 0; };
    base(c, logo);
    var lastP = all[all.length - 1], b = lastP[2], o = lastP[3];
    if(fin){
      chip(c, 'FINAL', b > o ? OK : b < o ? RED : '#555c70');
      var res = b > o ? 'Bills win, ' + b + '-' + o : b < o ? 'Bills fall, ' + o + '-' + b : 'Tie, ' + b + '-' + o;
      center(c, res, 0, 700, 66, '#fff', 172, W - 120);
      var lo = all.reduce(function(a, p){ return p[1] < a[1] ? p : a; }), hi = all.reduce(function(a, p){ return p[1] > a[1] ? p : a; });
      var from = b > o ? (lo[1] < .35 ? lo : all[0]) : b < o ? (hi[1] > .65 ? hi : all[0]) : all[0];
      center(c, pct(from[1]) + ' → ' + pct(done ? lastP[1] : cur[1]), 0, 700, 140, GOLD, 252);
      function when(t){ if(t >= 3600) return 'in overtime'; var q = Math.min(4, Math.floor(t / 900) + 1), l = q * 900 - t;
        return 'with ' + Math.floor(l / 60) + ':' + ('0' + Math.round(l % 60)).slice(-2) + ' left in the ' + ['', '1st', '2nd', '3rd', '4th'][q]; }
      var sub = b > o ? (lo[1] < .35 ? 'Down to a ' + pct(lo[1]) + ' win chance ' + when(lo[0]) : 'From ' + pct(all[0][1]) + ' at kickoff, never below ' + pct(lo[1]))
        : b < o ? (hi[1] > .65 ? 'Up to a ' + pct(hi[1]) + ' win chance ' + when(hi[0]) : 'From ' + pct(all[0][1]) + ' at kickoff') : 'Overtime ends tied';
      center(c, sub, 1, 500, 32, SOFT, 418, W - 120);
      rule(c, 474);
      chart(c, all, shown, {x: 90, y: 680, w: 900, h: 500}, d, sw, alpha);
      c.textAlign = 'center'; c.font = F(0, 500, 24); c.fillStyle = MUTE; c.fillText('Unofficial win chance, play by play' + (d.game ? '  ·  ' + d.game : ''), W / 2, 1296);
    } else {
      chip(c, 'LIVE · ' + clock(cur[0]));
      center(c, 'Bills ' + (d.home ? 'vs' : 'at') + ' the ' + opp, 1, 500, 38, SOFT, 178);
      center(c, 'Bills win chance', 0, 700, 58, '#fff', 228);
      center(c, pct(cur[1]), 0, 700, 170, GOLD, 292);
      var ln = 'Bills ' + cur[2] + ', ' + opp + ' ' + cur[3] + '  ·  ' + clock(cur[0]) + (done && d.sit ? '  ·  ' + d.sit : '');
      center(c, ln, 1, 500, 30, SOFT, 482, W - 100);
      rule(c, 538);
      chart(c, all, shown, {x: 90, y: 720, w: 900, h: 460}, d, sw, alpha);
      c.textAlign = 'center'; c.font = F(0, 500, 24); c.fillStyle = MUTE;
      c.fillText('Live and unofficial. Every play: score, time, possession, down, distance, field position.', W / 2, 1296);
    }
    c.textAlign = 'left';
  }
  window.JPAWinCard = {draw: draw, swings: swings, caption: caption, W: W, H: H};
})();
