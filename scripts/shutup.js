// "Shut up, Collinsworth" button: a cutout of the game's analyst beside the Gameday live card, with a big press-me
// button everyone shares. Totals (this game and today) live in the jpa-live Worker (/?shutup, D1), so every visitor
// sees the same count. Shows on gameday when the Next game file's "analyst" is Cris Collinsworth; ?shutup previews it.
// Presses count on screen right away and are sent in batches every 2 seconds (at most 30 a send).
(function(){
  var API = 'https://jpa-live.sterryrochester.workers.dev/?shutup';
  var SRC = ['https://raw.githubusercontent.com/JPADev1/Joshuapatrickallen/stats-data/', 'data/'];
  var slot = document.getElementById('livebar-gameday'); if(!slot) return;
  var preview = /[?&]shutup\b/.test(location.search);
  function today(){ return new Date().toLocaleDateString('en-CA', {timeZone: 'America/New_York'}); }
  function fmt(n){ return Number(n || 0).toLocaleString('en-US'); }
  var box = null, srv = null, pending = 0, sending = false, last = 0, mine = 0, ok = true, myKey = 'jpa-stfu-' + today();
  try{ mine = +localStorage.getItem(myKey) || 0; }catch(e){}

  function load(){
    var i = 0;
    (function next(){
      fetch(SRC[i++] + 'matchup.json', {cache: 'no-cache'}).then(function(r){ if(!r.ok) throw 0; return r.json(); })
        .then(start).catch(function(){ if(i < SRC.length) next(); });
    })();
  }
  function start(m){
    if(!preview && !(m && m.gameday === today() && /collinsworth/i.test(m.analyst || ''))) return;
    build();
    var mo = new MutationObserver(function(recs){   // ignore changes to the panel itself (it lives inside this area)
      if(recs.some(function(r){ return !box.contains(r.target) && !(r.type === 'childList' && [].every.call(r.addedNodes, function(n){ return n === box; }) && [].every.call(r.removedNodes, function(n){ return n === box; })); })) place(); });
    mo.observe(slot, {attributes: true, childList: true, subtree: true});
    addEventListener('resize', place); place();
    poll(); setInterval(function(){ if(!document.hidden && !box.hidden) poll(); }, 15000);
    setInterval(flush, 2000);
    addEventListener('pagehide', function(){ if(pending && navigator.sendBeacon) navigator.sendBeacon(API, new Blob(['n=' + Math.min(30, pending)], {type: 'text/plain'})); });
  }
  function build(){
    box = document.createElement('aside'); box.className = 'stfu'; box.hidden = true; box.setAttribute('aria-label', 'Shut up, Collinsworth counter');
    box.innerHTML = '<div class="stfu-pic"><img class="stfu-cw" src="images/collinsworth.webp" alt="Illustration of NBC analyst Cris Collinsworth holding a microphone" width="400" height="435">'
      + '<span class="stfu-say">Now here&rsquo;s a&nbsp;guy&hellip;</span></div>'
      + '<div class="stfu-go"><div class="stfu-bw"><i class="rays" aria-hidden="true"></i><span class="pm up" aria-hidden="true">press</span>'
      + '<button type="button" class="stfu-b">Shut up, Collins&shy;worth</button><span class="pm dn" aria-hidden="true">me</span></div>'
      + '<div class="stfu-ct"><p><b class="stfu-g">0</b><span class="stfu-gl">this game</span></p><p><b class="stfu-t">0</b><span>today</span></p>'
      + '<p class="stfu-me">You: <span>' + fmt(mine) + '</span></p></div></div>';
    slot.insertAdjacentElement('afterend', box);
    var b = box.querySelector('.stfu-b'), cw = box.querySelector('.stfu-cw');
    b.addEventListener('click', function(e){
      var t = Date.now(); if(t - last < 90) return; last = t;   // about 10 a second at most, so auto-clickers don't run away with it
      pending++; mine++; try{ localStorage.setItem(myKey, mine); }catch(err){}
      b.classList.add('down'); setTimeout(function(){ b.classList.remove('down'); }, 110);
      cw.classList.remove('hush'); void cw.offsetWidth; cw.classList.add('hush');
      var say = box.querySelector('.stfu-say'); say.classList.remove('cut'); void say.offsetWidth; say.classList.add('cut');
      var p = document.createElement('i'); p.className = 'stfu-pop'; p.textContent = '+1'; p.setAttribute('aria-hidden', 'true');
      p.style.left = (40 + Math.random() * 20) + '%'; box.querySelector('.stfu-bw').appendChild(p); setTimeout(function(){ p.remove(); }, 900);
      show();
    });
  }
  // Wide screens: to the right of the live card. Narrower: a strip right under it.
  function place(){
    if(!box) return;
    var on = !slot.hidden && slot.offsetHeight > 0; if(box.hidden !== !on) box.hidden = !on; if(!on) return;
    var lb = document.getElementById('livebar');   // right under the live card (the win-chance card goes after it)
    if(lb && lb.parentNode === slot && box.previousElementSibling !== lb) lb.insertAdjacentElement('afterend', box);
    var r = (lb && lb.parentNode === slot ? lb : slot).getBoundingClientRect(), room = innerWidth - r.right;
    if(room >= 214){
      box.classList.add('side');
      var op = box.offsetParent || document.body, o = op.getBoundingClientRect();   // place it against its positioned parent
      var t = (r.top - o.top + op.scrollTop) + 'px', l = (r.right - o.left + op.scrollLeft + 18) + 'px';
      if(box.style.top !== t) box.style.top = t; if(box.style.left !== l) box.style.left = l;
    } else if(box.classList.contains('side')){ box.classList.remove('side'); box.style.top = box.style.left = ''; }
  }
  function show(){
    if(!box) return;
    var g = box.querySelector('.stfu-g'), gl = box.querySelector('.stfu-gl');
    box.querySelector('.stfu-t').textContent = srv ? fmt(srv.today + pending) : ok ? '…' : fmt(pending);
    var live = srv && srv.live;
    g.textContent = srv ? fmt(srv.game + (live ? pending : 0)) : '…';
    gl.textContent = srv && srv.final ? 'this game (final)' : live || !srv ? 'this game' : 'this game, from kickoff';
    box.querySelector('.stfu-me span').textContent = fmt(mine);
  }
  function take(j){ if(j && !j.error){ srv = j; ok = true; } else { ok = false; } show(); }
  function poll(){ fetch(API, {cache: 'no-store'}).then(function(r){ return r.json(); }).then(take).catch(function(){ ok = false; show(); }); }
  function flush(){
    if(!pending || sending) return;
    var n = Math.min(30, pending); pending -= n; sending = true;
    fetch(API, {method: 'POST', body: 'n=' + n, headers: {'Content-Type': 'text/plain'}}).then(function(r){ return r.json(); })
      .then(function(j){ if(j && j.error && j.error !== 'nothing to add') pending += n; take(j); })
      .catch(function(){ pending += n; ok = false; show(); })   // try again on the next send
      .then(function(){ sending = false; });
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load); else load();
})();
