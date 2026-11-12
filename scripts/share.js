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
      var text = cur.d.title + (cur.d.big ? ': ' + cur.d.big : '') + '. More Josh Allen records at ' + cur.link;
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
