/* sfx.js — short non-voice sound effects, synthesised with WebAudio.

   The build ships voice-over clips and a button click, and no celebration sound, so the confetti
   burst used to be silent. Rather than add another downloaded asset (one more thing that can 404
   or buffer mid-celebration), the cheer is generated on the fly, so it is always "loaded" and
   always starts on the exact frame the confetti does.

   The cheer is deliberately gentle — a soft pop, paper flutter, sparkles and a small chime — not
   a party cracker. Rules it follows:
     • one cheer per celebration: repeat triggers inside RETRIGGER_MS are ignored, so a
       double-tapped Check or a re-render can never stack two cheers;
     • silent whenever the game's sound is muted (shares Engine.Audio's mute flag);
     • sits under the narration, so a spoken line still reads over it;
     • the audio context and the noise buffer are built on the first user gesture, which both
       satisfies browser autoplay rules and means the first cheer has no setup cost;
     • stop() kills anything still ringing, for level changes and restarts;
     • every WebAudio call is guarded — if audio is unavailable the game simply stays quiet.  */
(function (global) {
  "use strict";

  var RETRIGGER_MS = 700;    // a celebration cannot re-fire faster than this
  var MASTER = 0.95;         // clearly audible over the game, still short of clipping

  var ctx = null;
  var unsupported = false;
  var noiseBuf = null;       // shared flutter/pop noise, built once
  var live = [];             // nodes still sounding, so stop() can cut them
  var lastAt = -1e9;

  function now() { return ctx ? ctx.currentTime : 0; }

  function context() {
    if (ctx || unsupported) return ctx;
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) { unsupported = true; return null; }
    try { ctx = new AC(); } catch (e) { unsupported = true; ctx = null; }
    return ctx;
  }

  function resume() {
    var c = context();
    if (c && c.state === "suspended" && c.resume) { try { c.resume(); } catch (e) { } }
    return c;
  }

  // 0.5s of white noise, reused by the pop and the paper flutter
  function noise(c) {
    if (noiseBuf) return noiseBuf;
    try {
      var len = Math.floor(c.sampleRate * 0.5);
      noiseBuf = c.createBuffer(1, len, c.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { noiseBuf = null; }
    return noiseBuf;
  }

  function muted() {
    var E = global.Engine;
    return !!(E && E.Audio && E.Audio.isMuted && E.Audio.isMuted());
  }

  function track(node) { live.push(node); }

  /* a plucked note: triangle body, fast percussive envelope */
  function note(c, out, freq, at, dur, gain, type) {
    var osc = c.createOscillator(), g = c.createGain();
    osc.type = type || "triangle";
    osc.frequency.setValueAtTime(freq, at);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.014);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g); g.connect(out);
    osc.start(at); osc.stop(at + dur + 0.02);
    track(osc);
  }

  /* the confetti pop: a short noise burst that falls in pitch — closer to a cork than a bang */
  function pop(c, out, at) {
    var buf = noise(c); if (!buf) return;
    var src = c.createBufferSource(); src.buffer = buf;
    var bp = c.createBiquadFilter();
    bp.type = "bandpass"; bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(2400, at);
    bp.frequency.exponentialRampToValueAtTime(500, at + 0.18);
    var g = c.createGain();
    g.gain.setValueAtTime(0.42, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
    src.connect(bp); bp.connect(g); g.connect(out);
    src.start(at, 0, 0.22); track(src);
  }

  /* paper flutter: a handful of soft high noise puffs, like falling streamers */
  function flutter(c, out, at) {
    var buf = noise(c); if (!buf) return;
    for (var i = 0; i < 7; i++) {
      var t = at + 0.06 + i * 0.075 + Math.random() * 0.03;
      var src = c.createBufferSource(); src.buffer = buf;
      src.playbackRate.value = 0.8 + Math.random() * 0.6;
      var bp = c.createBiquadFilter();
      bp.type = "bandpass"; bp.Q.value = 1.6;
      bp.frequency.value = 3200 + Math.random() * 2600;
      var g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.09, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      src.connect(bp); bp.connect(g); g.connect(out);
      src.start(t, Math.random() * 0.2, 0.12); track(src);
    }
  }

  var SFX = {
    /* Warm the audio path on a user gesture: context resumed, noise buffer built, so the first
       cheer starts instantly. Safe to call repeatedly. */
    prime: function () {
      var c = resume();
      if (c) noise(c);
      return !!c;
    },

    /* Celebration cue, fired by the confetti burst. Ignores repeats inside RETRIGGER_MS. */
    celebrate: function () {
      if (muted()) return false;
      var c = resume(); if (!c) return false;
      var t0 = (global.performance && global.performance.now) ? global.performance.now() : Date.now();
      if (t0 - lastAt < RETRIGGER_MS) return false;      // one cheer per celebration
      lastAt = t0;

      try {
        var master = c.createGain();
        master.gain.value = MASTER;
        master.connect(c.destination);
        track(master);

        var t = now();   // schedule on the current audio clock so the cheer lands with the burst
        pop(c, master, t);
        flutter(c, master, t);

        // small celebration chime: C6 - E6 - G6 - C7
        var arp = [1046.50, 1318.51, 1567.98, 2093.00];
        for (var i = 0; i < arp.length; i++) {
          note(c, master, arp[i], t + 0.05 + i * 0.08, 0.42, 0.26);
          note(c, master, arp[i] * 2, t + 0.05 + i * 0.08, 0.22, 0.05, "sine");  // airy top
        }
        // soft bell tail so the cheer resolves instead of stopping dead
        note(c, master, 2093.00, t + 0.4, 0.9, 0.12, "sine");
        note(c, master, 3135.96, t + 0.42, 0.7, 0.05, "sine");

        // sparkles drifting after the chime
        for (var s = 0; s < 4; s++) note(c, master, 2600 + s * 560, t + 0.5 + s * 0.09, 0.24, 0.055, "sine");
      } catch (e) {
        return false;   // audio unavailable: the game just carries on quietly
      }
      // nodes finish on their own; drop the references so the array cannot grow
      setTimeout(function () { live.length = 0; }, 2000);
      return true;
    },

    /* Cut anything still ringing — used on level changes and restarts. */
    stop: function () {
      for (var i = 0; i < live.length; i++) {
        var n = live[i];
        try { if (n.stop) n.stop(0); } catch (e) { }
        try { if (n.disconnect) n.disconnect(); } catch (e) { }
      }
      live.length = 0;
      lastAt = -1e9;
    },

    isReady: function () { return !!ctx && !!noiseBuf; }
  };

  // Autoplay policy: build the audio path on the learner's first touch of the page.
  ["pointerdown", "touchstart", "keydown"].forEach(function (ev) {
    global.addEventListener(ev, function () { SFX.prime(); }, { once: true, passive: true });
  });

  global.SFX = SFX;
})(window);
