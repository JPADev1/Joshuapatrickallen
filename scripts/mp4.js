// Standard MP4 files made in the browser, for the win-chance video.
// encode(): draws each frame on a canvas and encodes it with the browser's own H.264 encoder (WebCodecs), then writes a
//   normal MP4 (index up front, real duration), so every player shows the right length and the slider works.
//   Much faster than recording in real time.
// defrag(): fallback for browsers without WebCodecs. MediaRecorder writes "fragmented" MP4 with a 0 duration in the
//   header (players then show ~3 seconds and can't seek); this rewrites it as a normal MP4 with the same video data.
(function(){
  // ---------- MP4 writing ----------
  function u32(n){ return [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255]; }
  function u16(n){ return [n >>> 8 & 255, n & 255]; }
  function str(s){ return s.split('').map(function(c){ return c.charCodeAt(0); }); }
  function cat(parts){ // arrays of bytes and Uint8Arrays -> Uint8Array
    var n = 0, i; for(i = 0; i < parts.length; i++) n += parts[i].length;
    var out = new Uint8Array(n), o = 0;
    for(i = 0; i < parts.length; i++){ out.set(parts[i], o); o += parts[i].length; }
    return out;
  }
  function box(type){ var body = cat([].slice.call(arguments, 1)); return cat([u32(body.length + 8), str(type), body]); }
  function full(type, ver, flags){ var rest = [].slice.call(arguments, 3); return box.apply(null, [type, [ver].concat(u32(flags).slice(1))].concat(rest)); }
  var MATRIX = [].concat(u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000));
  // samples: [{size, key}] in decode order, all `delta` long in a `scale` timescale; avcC: the H.264 decoder config
  function moov(w, h, samples, avcC, scale, delta, mdatStart){
    var n = samples.length, durT = n * delta, durMs = Math.round(durT / scale * 1000);
    var avc1 = box('avc1', [0,0,0,0,0,0], u16(1), u16(0), u16(0), u32(0), u32(0), u32(0), u16(w), u16(h),
      u32(0x480000), u32(0x480000), u32(0), u16(1), new Uint8Array(32), u16(0x18), u16(0xffff), box('avcC', avcC));
    var stts = full('stts', 0, 0, u32(1), u32(n), u32(delta));
    var keys = []; samples.forEach(function(s, i){ if(s.key) keys.push(i + 1); });
    var stss = full('stss', 0, 0, u32(keys.length), cat(keys.map(function(k){ return u32(k); })));
    var stsc = full('stsc', 0, 0, u32(1), u32(1), u32(n), u32(1));            // one chunk holds every sample
    var stsz = full('stsz', 0, 0, u32(0), u32(n), cat(samples.map(function(s){ return u32(s.size); })));
    var stco = full('stco', 0, 0, u32(1), u32(mdatStart));
    var stbl = box('stbl', full('stsd', 0, 0, u32(1), avc1), stts, stss, stsc, stsz, stco);
    var minf = box('minf', full('vmhd', 0, 1, u16(0), u16(0), u16(0), u16(0)), box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))), stbl);
    var mdia = box('mdia', full('mdhd', 0, 0, u32(0), u32(0), u32(scale), u32(durT), u16(0x55c4), u16(0)),
      full('hdlr', 0, 0, u32(0), str('vide'), u32(0), u32(0), u32(0), str('Win chance'), [0]), minf);
    var tkhd = full('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(durMs), u32(0), u32(0), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(w << 16), u32(h << 16));
    var mvhd = full('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(durMs), u32(0x10000), u16(0x100), u16(0), u32(0), u32(0), MATRIX,
      u32(0), u32(0), u32(0), u32(0), u32(0), u32(0), u32(2));
    return box('moov', mvhd, box('trak', tkhd, mdia));
  }
  // datas: Uint8Array per sample (decode order). Index first ("fast start"), so it streams and seeks anywhere.
  function write(w, h, datas, keysArr, avcC, scale, delta){
    var ftyp = box('ftyp', str('isom'), u32(512), str('isomiso2avc1mp41'));
    var samples = datas.map(function(d, i){ return {size: d.length, key: keysArr[i]}; });
    var size = 0; datas.forEach(function(d){ size += d.length; });
    var m = moov(w, h, samples, avcC, scale, delta, 0);
    m = moov(w, h, samples, avcC, scale, delta, ftyp.length + m.length + 8);  // same size, now with the real data offset
    return new Blob([ftyp, m, new Uint8Array(u32(size + 8)), new Uint8Array(str('mdat'))].concat(datas), {type: 'video/mp4'});
  }

  // ---------- Encode with WebCodecs ----------
  var CODECS = ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.640033', 'avc1.42001f'];
  function pick(w, h, fps){
    if(!window.VideoEncoder || !window.VideoFrame || !VideoEncoder.isConfigSupported) return Promise.resolve(null);
    var i = 0;
    function next(){
      if(i >= CODECS.length) return null;
      var cfg = {codec: CODECS[i++], width: w, height: h, bitrate: 6e6, framerate: fps, avc: {format: 'avc'}};
      return VideoEncoder.isConfigSupported(cfg).then(function(r){ return r && r.supported ? cfg : next(); }, next);
    }
    return Promise.resolve(next());
  }
  function supported(w, h, fps){ return pick(w, h, fps).then(function(c){ return !!c; }); }
  // draw(e) paints frame e (0..1) on `canvas`; n frames at fps; progress(f) for 0..1
  function encode(canvas, draw, n, fps, progress, cancelled){
    var w = canvas.width, h = canvas.height;
    return pick(w, h, fps).then(function(cfg){
      if(!cfg) throw 'no-webcodecs';
      return new Promise(function(ok, no){
        var datas = [], keys = [], ts = [], avcC = null, failed = null;
        var enc = new VideoEncoder({
          output: function(chunk, meta){
            if(meta && meta.decoderConfig && meta.decoderConfig.description && !avcC){
              var d = meta.decoderConfig.description;
              avcC = d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
            }
            var b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); datas.push(b); keys.push(chunk.type === 'key'); ts.push(chunk.timestamp);
          },
          error: function(e){ failed = e; }
        });
        enc.configure(cfg);
        var i = 0, step = 1e6 / fps;
        (function more(){
          if(failed){ try { enc.close(); } catch(e){} return no(failed); }
          if(cancelled && cancelled()){ try { enc.close(); } catch(e){} return no('cancelled'); }
          var t0 = performance.now();
          while(i < n && enc.encodeQueueSize < 6 && performance.now() - t0 < 40){ // keep the page responsive
            draw(n > 1 ? i / (n - 1) : 1);
            var f = new VideoFrame(canvas, {timestamp: Math.round(i * step), duration: Math.round(step)});
            enc.encode(f, {keyFrame: i % (fps * 2) === 0}); f.close(); i++;
          }
          if(progress) progress(i / n);
          if(i < n) return setTimeout(more, 0);
          enc.flush().then(function(){
            enc.close();
            if(failed) return no(failed);
            if(!avcC || datas.length !== n) return no('encoder output incomplete');
            for(var k = 1; k < ts.length; k++) if(ts[k] < ts[k - 1]) return no('reordered frames'); // (no B-frames expected)
            ok(write(w, h, datas, keys, avcC, fps * 1000, 1000));
          }, no);
        })();
      });
    });
  }

  // ---------- Repair a fragmented MP4 from MediaRecorder ----------
  function rd32(b, o){ return (b[o] << 24 >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]; }
  function kids(b, s, e){ var out = []; while(s + 8 <= e){ var sz = rd32(b, s), t = String.fromCharCode(b[s + 4], b[s + 5], b[s + 6], b[s + 7]);
    if(sz === 1) sz = rd32(b, s + 12); if(sz < 8 || s + sz > e) sz = e - s; out.push({t: t, s: s, e: s + sz}); s += sz; } return out; }
  function find(b, list, path){ var cur = list; var x = null;
    for(var i = 0; i < path.length; i++){ x = null; for(var j = 0; j < cur.length; j++) if(cur[j].t === path[i]){ x = cur[j]; break; }
      if(!x) return null; if(i < path.length - 1) cur = kids(b, x.s + 8, x.e); } return x; }
  function defrag(buf){
    try {
      var b = new Uint8Array(buf), top = kids(b, 0, b.length);
      var moovB = find(b, top, ['moov']); if(!moovB) return null;
      var mk = kids(b, moovB.s + 8, moovB.e), trak = find(b, mk, ['trak']); if(!trak) return null;
      var tk = kids(b, trak.s + 8, trak.e), mdhd = find(b, tk, ['mdia', 'mdhd']), stsd = find(b, tk, ['mdia', 'minf', 'stbl', 'stsd']);
      if(!mdhd || !stsd) return null;
      var scale = b[mdhd.s + 8] === 1 ? rd32(b, mdhd.s + 28) : rd32(b, mdhd.s + 20);
      var entry = b.subarray(stsd.s + 16, stsd.e); // the avc1 sample entry
      if(String.fromCharCode(entry[4], entry[5], entry[6], entry[7]) !== 'avc1') return null;
      var w = (entry[32] << 8) | entry[33], h = (entry[34] << 8) | entry[35];
      var ac = find(b, kids(b, stsd.s + 16 + 86, stsd.e), ['avcC']); if(!ac) return null;
      var avcC = b.slice(ac.s + 8, ac.e);
      var mvex = find(b, mk, ['mvex', 'trex']), defDur = mvex ? rd32(b, mvex.s + 20) : 0, defSize = mvex ? rd32(b, mvex.s + 24) : 0, defFlags = mvex ? rd32(b, mvex.s + 28) : 0;
      var datas = [], keys = [], durs = [];
      top.forEach(function(m){
        if(m.t !== 'moof') return;
        var traf = find(b, kids(b, m.s + 8, m.e), ['traf']); if(!traf) return;
        var tl = kids(b, traf.s + 8, traf.e), tfhd = find(b, tl, ['tfhd']), trun = find(b, tl, ['trun']); if(!tfhd || !trun) return;
        var tf = rd32(b, tfhd.s + 8) & 0xffffff, p = tfhd.s + 16, base = m.s, dDur = defDur, dSize = defSize, dFlags = defFlags;
        if(tf & 1){ base = rd32(b, p + 4); p += 8; } if(tf & 2) p += 4;
        if(tf & 8){ dDur = rd32(b, p); p += 4; } if(tf & 16){ dSize = rd32(b, p); p += 4; } if(tf & 32){ dFlags = rd32(b, p); p += 4; }
        var fl = rd32(b, trun.s + 8) & 0xffffff, cnt = rd32(b, trun.s + 12), q = trun.s + 16, off = base, first = null;
        if(fl & 1){ off = base + (rd32(b, q) | 0); q += 4; } if(fl & 4){ first = rd32(b, q); q += 4; }
        for(var i = 0; i < cnt; i++){
          var du = dDur, sz = dSize, f = dFlags;
          if(fl & 0x100){ du = rd32(b, q); q += 4; } if(fl & 0x200){ sz = rd32(b, q); q += 4; } if(fl & 0x400){ f = rd32(b, q); q += 4; } if(fl & 0x800) q += 4;
          if(i === 0 && first != null) f = first;
          datas.push(b.slice(off, off + sz)); keys.push(!(f & 0x10000)); durs.push(du); off += sz;
        }
      });
      if(!datas.length) return null;
      var avg = Math.max(1, Math.round(durs.reduce(function(a, c){ return a + c; }, 0) / durs.length));
      return write(w, h, datas, keys, avcC, scale, avg);
    } catch(e){ return null; }
  }
  window.JPAMp4 = {encode: encode, supported: supported, defrag: defrag};
})();
