// Share cards: any element with data-share='{"chip","kicker","title","big","line","foot","url"}' gets a Share button.
// Clicking it draws a 1080x1350 image (Lora type on images/share-bg.webp), shows it full screen, and offers
// the phone's share sheet (image + a link back to the site) or a download. Everything runs in the browser.
(function(){
  var W = 1080, H = 1350, SITE = 'https://joshuapatrickallen.com';
  var GOLD = '#e9c46a', SOFT = '#e1e6f8', MUTE = '#a0afd7', RED = '#c60c30';
  var ready = null;
  function assets(){
    if(ready) return ready;
    var fonts = [new FontFace('LoraShare', 'url(fonts/lora.woff)', {weight:'400 700'}),
                 new FontFace('LoraShare', 'url(fonts/lora-italic.woff)', {weight:'400 700', style:'italic'})];
    var img = new Image(); img.decoding = 'async';
    var pic = new Promise(function(ok, no){ img.onload = function(){ ok(img); }; img.onerror = no; img.src = 'images/share-bg.webp'; });
    ready = Promise.all(fonts.map(function(f){ return f.load().then(function(x){ document.fonts.add(x); }); })).then(function(){ return pic; });
    ready.catch(function(){ ready = null; });
    return ready;
  }
  function F(style, weight, size){ return (style ? 'italic ' : '') + weight + ' ' + size + 'px LoraShare, Georgia, serif'; }
  // Split text into at most `max` lines that fit `width`; shrink the size until it fits.
  function fit(c, text, style, weight, size, min, width, max){
    for(var s = size; s >= min; s -= 2){
      c.font = F(style, weight, s);
      var words = String(text).split(/\s+/), lines = [], cur = '';
      for(var i = 0; i < words.length; i++){
        var t = cur ? cur + ' ' + words[i] : words[i];
        if(c.measureText(t).width <= width || !cur) cur = t; else { lines.push(cur); cur = words[i]; }
      }
      if(cur) lines.push(cur);
      var ok = lines.length <= max && lines.every(function(l){ return c.measureText(l).width <= width; });
      if(ok || s - 2 < min) return {size:s, lines:lines.slice(0, max), lh:Math.round(s * 1.16)};
    }
  }
  function shadowed(c, fn){ c.save(); c.shadowColor = 'rgba(0,0,0,.75)'; c.shadowBlur = 14; c.shadowOffsetY = 4; fn(); c.restore(); }
  function draw(d, img){
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var c = cv.getContext('2d');
    var s = Math.max(W / img.width, H / img.height), iw = img.width * s, ih = img.height * s;
    c.drawImage(img, (W - iw) / 2, (H - ih) / 2, iw, ih);
    // Shade: light at the top for the header, deep at the bottom for the text
    var g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(4,14,48,.6)'); g.addColorStop(.1, 'rgba(4,14,48,0)');
    g.addColorStop(.5, 'rgba(4,14,48,0)'); g.addColorStop(.72, 'rgba(4,14,48,.82)'); g.addColorStop(1, 'rgba(4,14,48,.97)');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.textBaseline = 'top';
    // Header: site name (left), chip (right)
    c.fillStyle = 'rgba(255,255,255,.92)'; c.font = F(0, 600, 24);
    if('letterSpacing' in c) c.letterSpacing = '3px';
    c.fillText('JOSHUAPATRICKALLEN.COM', 56, 52);
    if('letterSpacing' in c) c.letterSpacing = '0px';
    if(d.chip){
      c.font = F(1, 700, 28); var cw = c.measureText(d.chip).width + 40, x1 = W - 56;
      c.fillStyle = RED; c.beginPath();
      if(c.roundRect) c.roundRect(x1 - cw, 40, cw, 52, 26); else c.rect(x1 - cw, 40, cw, 52);
      c.fill(); c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(d.chip, x1 - cw / 2, 67); c.textAlign = 'left'; c.textBaseline = 'top';
    }
    if(d.items && d.items.length){ list(c, d); return cv; }
    if(d.mtn){ mountain(c, d); return cv; }
    // Text block, stacked up from the bottom
    var cx = W / 2, wide = W - 120;
    var kick = d.kicker ? fit(c, d.kicker, 1, 500, 44, 30, wide, 1) : null;
    var title = fit(c, d.title || '', 0, 700, d.big ? 54 : 66, 34, wide, d.big ? 2 : 3);
    var big = d.big ? fit(c, d.big, 0, 700, 170, 70, wide, 1) : null;
    var line = d.line ? fit(c, d.line, 1, 500, 32, 22, wide, 2) : null;
    var h = (kick ? kick.lh + 10 : 0) + title.lines.length * title.lh + (big ? big.size * 1.02 + 10 : 24) + 26 + (line ? line.lines.length * line.lh : 0);
    var y = Math.min(1268 - h, 1010);
    c.textAlign = 'center';
    if(kick){ shadowed(c, function(){ c.font = F(1, 500, kick.size); c.fillStyle = SOFT; c.fillText(kick.lines[0], cx, y); }); y += kick.lh + 10; }
    shadowed(c, function(){ c.font = F(0, 700, title.size); c.fillStyle = '#fff';
      title.lines.forEach(function(l, i){ c.fillText(l, cx, y + i * title.lh); }); });
    y += title.lines.length * title.lh;
    if(big){ y += 6; shadowed(c, function(){ c.font = F(0, 700, big.size); c.fillStyle = GOLD; c.fillText(big.lines[0], cx, y); }); y += big.size * 1.02 + 4; }
    else y += 18;
    c.strokeStyle = GOLD; c.lineWidth = 2; c.beginPath(); c.moveTo(cx - 220, y + 8); c.lineTo(cx + 220, y + 8); c.stroke();
    y += 26;
    if(line){ c.font = F(1, 500, line.size); c.fillStyle = SOFT; line.lines.forEach(function(l, i){ c.fillText(l, cx, y + i * line.lh); }); }
    if(d.foot){ c.font = F(0, 500, 24); c.fillStyle = MUTE; c.fillText(d.foot, cx, 1300); }
    return cv;
  }
  // List card (records watch): heading, then up to 5 items (gold title + one or two lines of detail), left-aligned.
  function list(c, d){
    var x = 64, wide = W - 128, items = d.items.slice(0, 5);
    var g = c.createLinearGradient(0, 0, 0, H); // extra shade so the list reads over the jersey
    g.addColorStop(.32, 'rgba(4,14,48,0)'); g.addColorStop(.48, 'rgba(4,14,48,.78)'); g.addColorStop(1, 'rgba(4,14,48,.96)');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    var parts = items.map(function(it){
      return {t: fit(c, it.t, 0, 700, 36, 26, wide - 40, 1), d: it.d ? fit(c, it.d, 1, 500, 26, 20, wide - 40, 2) : null, done: it.done};
    });
    var kick = d.kicker ? fit(c, d.kicker, 1, 500, 34, 26, wide, 2) : null, title = fit(c, d.title || 'Milestone watch', 0, 700, 60, 40, wide, 1);
    var h = (kick ? kick.lines.length * kick.lh + 4 : 0) + title.lh + 34 + parts.reduce(function(a, p){ return a + p.t.lh + (p.d ? p.d.lines.length * p.d.lh : 0) + 18; }, 0);
    var y = Math.max(560, 1266 - h);
    c.textAlign = 'left';
    if(kick){ shadowed(c, function(){ c.font = F(1, 500, kick.size); c.fillStyle = SOFT; kick.lines.forEach(function(l, i){ c.fillText(l, x, y + i * kick.lh); }); }); y += kick.lines.length * kick.lh + 4; }
    shadowed(c, function(){ c.font = F(0, 700, title.size); c.fillStyle = '#fff'; c.fillText(title.lines[0], x, y); });
    y += title.lh + 8;
    c.strokeStyle = GOLD; c.lineWidth = 2; c.beginPath(); c.moveTo(x, y); c.lineTo(x + 300, y); c.stroke();
    y += 26;
    parts.forEach(function(p, i){
      shadowed(c, function(){
        c.font = F(0, 700, 30); c.fillStyle = GOLD; c.fillText(p.done ? '\u2713' : String(i + 1), x, y + (p.t.size - 30) / 2);
        c.font = F(0, 700, p.t.size); c.fillStyle = p.done ? GOLD : '#fff'; c.fillText(p.t.lines[0], x + 40, y);
      });
      y += p.t.lh;
      if(p.d){ c.font = F(1, 500, p.d.size); c.fillStyle = SOFT; p.d.lines.forEach(function(l){ c.fillText(l, x + 40, y); y += p.d.lh; }); }
      y += 18;
    });
    if(d.foot){ c.textAlign = 'center'; c.font = F(0, 500, 24); c.fillStyle = MUTE; c.fillText(d.foot, W / 2, 1300); }
  }
  // Mountain card (Touchdown Mountain and the stat mountains): snow-capped peak with a flag, #1 at the summit,
  // every other player between Allen and the top along the ridge, Allen in gold.
  function mountain(c, d){
    var R = d.mtn.rows, i = -1; R.forEach(function(r, k){ if(r.me && i < 0) i = k; }); if(i < 0) return;
    var g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(.36, 'rgba(4,14,48,0)'); g.addColorStop(.56, 'rgba(4,14,48,.97)'); g.addColorStop(1, 'rgba(4,14,48,1)');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.textAlign = 'center'; c.textBaseline = 'top';
    var kick = d.kicker ? fit(c, d.kicker, 1, 500, 36, 24, W - 120, 2) : null, ttl = fit(c, d.title, 0, 700, 70, 40, W - 120, 1);
    var ty = 612 - (kick ? kick.lines.length * kick.lh : 0);
    if(kick) shadowed(c, function(){ c.font = F(1, 500, kick.size); c.fillStyle = SOFT; kick.lines.forEach(function(l, k){ c.fillText(l, W / 2, ty + k * kick.lh); }); });
    shadowed(c, function(){ c.font = F(0, 700, ttl.size); c.fillStyle = GOLD; c.fillText(ttl.lines[0], W / 2, 618); });
    var x0 = 0, xp = 800, yb = 1236, yp = 790, xr = 1080;
    function ry(x){ var t = Math.max(0, Math.min(1, (x - x0) / (xp - x0))); return yb - (yb - yp) * Math.pow(t, 1.35); }
    var jag = [0,-5,3,-2,6,-4,1,-6,4,-1], pts = [];
    for(var k = 0; k <= 40; k++){ var x = x0 + (xp - x0) * k / 40; pts.push([x, ry(x) + (k % 40 ? jag[k % 10] * (1 - k / 40) * 1.4 : 0)]); }
    var right = [[.18,.22],[.35,.3],[.55,.55],[.72,.64],[1,1]].map(function(a){ return [xp + (xr - xp) * a[0], yp + (yb - yp) * a[1]]; });
    var ridge = pts.concat(right);
    function path(list){ c.beginPath(); list.forEach(function(p, k){ k ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); }); }
    // back peak, body, snow cap, ridge line, ground
    c.fillStyle = 'rgba(30,60,150,.66)'; path([[300,H],[560,yp+(yb-yp)*.38],[650,yp+(yb-yp)*.45],[740,yp+(yb-yp)*.33],[W,H]]); c.fill();
    var bg = c.createLinearGradient(0, yp, 0, yb); bg.addColorStop(0, '#1a46aa'); bg.addColorStop(1, '#081850');
    c.fillStyle = bg; path(ridge.concat([[xr,H],[x0,H]])); c.fill();
    var sy = yp + (yb - yp) * .28, cap = pts.filter(function(p){ return p[1] <= sy; }), rx = xp + (xr - xp) * .24, lx = cap[0][0], snow = cap.concat([[xp + (xr - xp) * .18, yp + (yb - yp) * .22], [rx, sy - 6]]);
    for(k = 1; k < 9; k++) snow.push([rx - (rx - lx) * k / 9, sy + (k % 2 ? 18 : -8)]);
    snow.push([lx, sy + 4]);
    c.fillStyle = '#f4f8ff'; path(snow); c.fill();
    c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = 3; path(ridge); c.stroke();
    c.fillStyle = '#040e30'; c.fillRect(0, H - 26, W, 26);
    c.strokeStyle = '#ebebf0'; c.lineWidth = 5; c.beginPath(); c.moveTo(xp, yp - 2); c.lineTo(xp, yp - 62); c.stroke();
    c.fillStyle = RED; path([[xp + 2, yp - 62], [xp + 48, yp - 49], [xp + 2, yp - 36]]); c.fill();
    c.textAlign = 'right'; c.textBaseline = 'alphabetic'; c.font = F(0, 700, 18); c.fillStyle = MUTE; c.fillText('BASE CAMP', W - 16, H - 34);
    // who's on the ridge: #1, every other player between, and Allen (if he's #1: the next five)
    var show = [0];
    if(i === 0){ for(k = 1; k < Math.min(R.length, 6); k++) show.push(k); }
    else { var mid = []; for(k = i - 1; k > 0; k -= 2) mid.push(k);
      if(mid.length > 8){ var pick = []; for(k = 0; k < 8; k++) pick.push(mid[Math.round(k * (mid.length - 1) / 7)]); mid = pick; } // keep it readable: at most 8 in between
      show = show.concat(mid); show.push(i); show.sort(function(a, b){ return a - b; }); }
    show = show.filter(function(v, k, a){ return a.indexOf(v) === k; });
    var n = show.length;
    c.textBaseline = 'middle'; c.textAlign = 'center';
    show.forEach(function(j, idx){
      var r = R[j], mine = r.me, t = j === 0 ? 1 : 1 - idx / (n - 1) * 0.9, X = x0 + (xp - x0) * t, Y = ry(X);
      var lab = r.rank + '. ' + (mine ? 'Josh Allen' : r.name) + '  ' + r.v;
      c.font = F(0, mine ? 700 : 600, mine ? 30 : 23);
      var w = c.measureText(lab).width + (mine ? 36 : 26), h = mine ? 50 : 36, bx, by, side = (n - 1 - idx) % 2 ? -1 : 1;
      if(j === 0){ bx = X - w - 30; by = Y - h - 14; }
      else if(mine){ bx = X + 26; by = Y - h / 2 + 2; }
      else { bx = side > 0 ? X + 24 : X - 24 - w; by = Y - h / 2 - (side > 0 ? 6 : 26); }
      bx = Math.max(16, Math.min(W - 16 - w, bx));
      c.strokeStyle = mine ? GOLD : '#fff'; c.lineWidth = 2; c.beginPath(); c.moveTo(X, Y); c.lineTo(bx > X ? bx : bx + w, by + h / 2); c.stroke();
      c.fillStyle = mine ? GOLD : 'rgba(255,255,255,.93)'; c.beginPath();
      if(c.roundRect) c.roundRect(bx, by, w, h, h / 2); else c.rect(bx, by, w, h); c.fill();
      c.fillStyle = '#040e30'; c.fillText(lab, bx + w / 2, by + h / 2 + 1);
      var rr = mine ? 12 : 7; c.beginPath(); c.arc(X, Y, rr, 0, 7); c.fillStyle = mine ? GOLD : '#fff'; c.fill(); c.lineWidth = 3; c.strokeStyle = '#040e30'; c.stroke();
    });
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    if(d.line){ c.font = F(1, 500, 26); c.fillStyle = SOFT; c.fillText(d.line, 40, H - 40); }
    if(d.foot){ c.font = F(0, 500, 18); c.fillStyle = MUTE; c.fillText(d.foot, 40, H - 7); }
  }
  // Mountain pages: a Share button next to full screen, built from what's on screen (top-20 table + headline).
  function mtnData(){
    var rows = [].map.call(document.querySelectorAll('#list tbody tr'), function(tr){
      var t = [].map.call(tr.cells, function(td){ return td.textContent.trim(); });
      return {rank: t[0], name: t[1].replace(/\s*\(\d+\)$/, ''), v: t[2], num: parseFloat(t[2].replace(/,/g, '')), me: tr.classList.contains('me-row')};
    });
    var me = rows.filter(function(r){ return r.me; })[0]; if(!me) return null;
    var hb = document.querySelector('#headline b'), title = hb ? hb.textContent.replace(/^Josh Allen is /, '') : me.rank;
    title = title.charAt(0).toUpperCase() + title.slice(1);
    var i = rows.indexOf(me), line;
    if(i === 0 && rows[1]) line = 'Next closest: ' + rows[1].name + ', ' + (me.num - rows[1].num).toLocaleString('en-US') + ' behind';
    else if(i > 0){ // the page's own "Next up" (the table skips from #20 to Allen when he's lower)
      var m = (document.getElementById('headline') || {}).textContent.match(/Next up: (.+?) with ([\d,.]+) \(([\d,.]+) more\)/);
      line = m ? 'Next up: ' + m[1] + ', ' + m[3] + ' more' : 'Next up: ' + rows[i - 1].name + ', ' + (rows[i - 1].num - me.num).toLocaleString('en-US') + ' more'; }
    var sub = document.getElementById('sub'), lab = document.getElementById('sliderLabel'), h1 = document.querySelector('h1');
    var u = location.pathname.split('/').pop() + location.hash;
    return {chip: h1 ? h1.textContent.trim() : 'Stat Mountain', kicker: sub ? sub.textContent.trim() : '', title: title, mtn: {rows: rows},
      line: line, foot: (lab ? lab.textContent.trim() + '  ·  ' : '') + 'Regular season', url: u, share: 'Josh Allen, ' + title};
  }
  function addMtnButton(){
    var box = document.getElementById('mtn'); if(!box || document.getElementById('mtnShare')) return;
    var b = document.createElement('button'); b.type = 'button'; b.id = 'mtnShare'; b.className = 'mtn-max mtn-shr'; b.title = 'Share this view'; b.setAttribute('aria-label', 'Share this view as an image');
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>';
    b.onclick = function(e){ e.stopPropagation(); var d = mtnData(); if(d) open(d); };
    box.appendChild(b);
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addMtnButton); else addMtnButton();
  // ---------- Full-screen viewer ----------
  var box = null, cur = null;
  function close(){ if(box){ box.hidden = true; document.documentElement.classList.remove('shr-open'); if(cur && cur.url) URL.revokeObjectURL(cur.url); cur = null; } }
  function viewer(){
    if(box) return box;
    box = document.createElement('div'); box.className = 'shr-box'; box.hidden = true;
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Share this record');
    box.innerHTML = '<div class="shr-in"><img alt=""><p class="shr-msg" aria-live="polite"></p><div class="shr-btns">'
      + '<button type="button" class="shr-go">Share</button><a class="shr-dl" download>Save image</a><button type="button" class="shr-x">Close</button></div>'
      + '<p class="shr-tip">Or press and hold the image to save it.</p></div>';
    document.body.appendChild(box);
    box.addEventListener('click', function(e){ if(e.target === box) close(); });
    box.querySelector('.shr-x').onclick = close;
    document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && !box.hidden) close(); });
    box.querySelector('.shr-go').onclick = function(){
      if(!cur) return;
      var text = (cur.d.share || cur.d.title + (cur.d.big ? ': ' + cur.d.big : '')) + '. More Josh Allen records at ' + cur.link;
      var file = new File([cur.blob], cur.name, {type:'image/png'});
      var data = {files:[file], title:'Josh Allen: ' + cur.d.title, text:text};
      if(navigator.canShare && navigator.canShare(data)) navigator.share(data).catch(function(){});
      else if(navigator.share) navigator.share({title:data.title, text:text, url:cur.link}).catch(function(){});
      else if(navigator.clipboard){ navigator.clipboard.writeText(text).then(function(){ msg('Link copied. Save the image, then paste the link with your post.'); }); }
    };
    return box;
  }
  function msg(t){ box.querySelector('.shr-msg').textContent = t || ''; }
  function open(d){
    viewer(); msg('Making your card…'); box.hidden = false; document.documentElement.classList.add('shr-open');
    var im = box.querySelector('img'); im.removeAttribute('src');
    box.querySelector('.shr-go').hidden = !navigator.share && !navigator.clipboard;
    assets().then(function(img){
      draw(d, img).toBlob(function(blob){
        if(!blob){ msg('Sorry, the card could not be made on this device.'); return; }
        var name = 'josh-allen-' + String(d.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) + '.png';
        if(cur && cur.url) URL.revokeObjectURL(cur.url);
        cur = {d:d, blob:blob, name:name, url:URL.createObjectURL(blob), link:SITE + '/' + (d.url || '')};
        im.src = cur.url; im.alt = 'Share card: ' + d.title;
        var a = box.querySelector('.shr-dl'); a.href = cur.url; a.download = name;
        msg(''); box.querySelector('.shr-x').focus();
      }, 'image/png');
    }).catch(function(){ msg('Sorry, the card could not be made. Check your connection and try again.'); });
  }
  // One listener for every Share button on the page (records, tiles, NFL firsts, records watch)
  document.addEventListener('click', function(e){
    var b = e.target.closest && e.target.closest('[data-share]');
    if(!b) return;
    e.preventDefault(); e.stopPropagation();
    try { open(JSON.parse(b.getAttribute('data-share'))); } catch(err){}
  }, true);
  // Helper for pages building HTML strings
  window.JPAShare = {
    btn: function(d, label){
      var j = JSON.stringify(d).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/</g, '&lt;');
      return '<button type="button" class="shr" data-share=\'' + j + '\' aria-label="Share' + (label ? ': ' + String(label).replace(/"/g, '&quot;') : '') + '">'
        + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>Share</button>';
    },
    open: open
  };
})();
