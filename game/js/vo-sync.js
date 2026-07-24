/* vo-sync.js — VoiceTextSyncController.
   ONE reusable voice-over ↔ text synchronisation controller for the whole game.
   Keeps a spoken clip and its on-screen text in lock-step and guarantees only one
   narration is ever audible.

   Public API (see GOD-MODE.md → "VO sync"):

     var session = VoiceTextSync.play({
       audio,            // src string OR HTMLAudioElement (optional)
       textElement,      // DOM node to reveal into (optional if setText given)
       setText,          // fn(str) custom writer (optional; used by the level typing system)
       text,             // full spoken sentence — visible text MUST equal the narration
       wordTimings,      // optional [{ text, start }] (seconds) for word-level sync
       fallbackDuration, // seconds to use when audio is muted / missing / fails to load
       revealMode,       // "word" | "type"  (default: word if wordTimings else type)
       muted,            // force silent (still advances text by duration)
       holdAfter,        // extra seconds to keep the finished line on screen (default 0)
       signal            // AbortSignal — abort() cancels the session
     });

   session → { promise, pause(), resume(), cancel(), skip(),
               getDuration(), getCurrentTime(), getRevealProgress(),
               getAudioProgress(), getSyncDiffMs(), state }

   Only ONE session runs at a time: play() safely cancels the previous one first,
   so rapid Next-button clicks can never stack two voices. */
(function (global) {
  "use strict";
  var E = global.Engine;

  var TOL_MS = 100;              // QA tolerance: |text − voice| must stay under this
  var active = null;            // the single live session (overlap prevention)
  var suspended = false;        // narration gate — hold new sessions until released
  var pending = null;           // the latest session created while suspended

  function nowMs() { return performance.now(); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function splitWords(text) {
    // keep the exact spoken words, spaces rebuilt on join
    return (text || "").split(/\s+/).filter(function (w) { return w.length; });
  }

  // Estimate a spoken duration from the text when no clip / no metadata is available.
  // ~2.6 words/second narration pace, floored so very short lines still read.
  function estimateDuration(text) {
    var words = splitWords(text).length || 1;
    return clamp(words / 2.6 + 0.35, 0.9, 8);
  }

  function Session(opts) {
    this.opts = opts || {};
    this.text = this.opts.text || "";
    this.textEl = this.opts.textElement || null;
    this._writer = this.opts.setText || function (t) { if (this.textEl) this.textEl.textContent = t; }.bind(this);
    this.revealMode = this.opts.revealMode || (this.opts.wordTimings ? "word" : "type");
    this.wordTimings = this.opts.wordTimings || null;
    this.holdAfter = this.opts.holdAfter || 0;
    this.onComplete = this.opts.onComplete || function () { };
    this.muted = !!this.opts.muted || (E && E.Audio && E.Audio.isMuted());
    this.fallbackDuration = this.opts.fallbackDuration || estimateDuration(this.text);

    this.audioSrc = (typeof this.opts.audio === "string") ? this.opts.audio : null;
    this.audioEl = (this.opts.audio && typeof this.opts.audio !== "string") ? this.opts.audio : null;

    this.state = "idle";       // idle | playing | paused | done | cancelled
    this.duration = this.fallbackDuration;
    this.usingAudio = false;   // real audible clip driving the clock?
    this.revealProgress = 0;   // 0..1 fraction of text shown
    this.words = splitWords(this.text);

    // virtual wall-clock (used for muted / no-audio / failed-load reveal)
    this._t0 = 0;
    this._pausedAccum = 0;
    this._pausedAt = 0;

    this._raf = null;
    this._resolve = null;
    this.promise = new Promise(function (res) { this._resolve = res; }.bind(this));
    this._signal = this.opts.signal || null;
    this._onAbort = null;
  }
  var S = Session.prototype;

  S._write = function (t) { try { this._writer(t); } catch (e) { } };

  // Current playback time in seconds (audio time when audible, virtual clock otherwise).
  S.getCurrentTime = function () {
    if (this.usingAudio && this.audioEl) return this.audioEl.currentTime || 0;
    if (this.state === "paused") return (this._pausedAt - this._t0 - this._pausedAccum) / 1000;
    if (!this._t0) return 0;
    return (nowMs() - this._t0 - this._pausedAccum) / 1000;
  };
  S.getDuration = function () { return this.duration || 0; };
  S.getRevealProgress = function () { return this.revealProgress; };
  S.getAudioProgress = function () { var d = this.getDuration(); return d > 0 ? clamp(this.getCurrentTime() / d, 0, 1) : 1; };
  // +ve → text is AHEAD of the voice; −ve → text lags the voice.
  S.getSyncDiffMs = function () { return Math.round((this.getRevealProgress() - this.getAudioProgress()) * this.getDuration() * 1000); };

  // Map a playback time (sec) → how much of the text should be visible (0..1).
  S._revealAt = function (t) {
    var d = this.getDuration();
    if (d <= 0) return 1;
    if (this.revealMode === "word" && this.wordTimings && this.wordTimings.length) {
      // reveal every word whose narration start has passed
      var shown = 0, total = this.wordTimings.length;
      for (var i = 0; i < total; i++) if (t >= (this.wordTimings[i].start || 0)) shown = i + 1; else break;
      return shown / total;
    }
    if (this.revealMode === "word") {
      // even word distribution across the clip; whole words only (never mid-word)
      var n = this.words.length || 1;
      var w = Math.min(n, Math.floor((t / d) * n) + (t > 0 ? 1 : 0));
      return clamp(w / n, 0, 1);
    }
    // smooth character type-on matched to the clip length
    return clamp(t / d, 0, 1);
  };

  S._applyReveal = function (frac) {
    this.revealProgress = frac;
    if (this.wordTimings && this.wordTimings.length) {
      var count = Math.round(frac * this.wordTimings.length);
      this._write(this.wordTimings.slice(0, count).map(function (w) { return w.text; }).join(" "));
    } else if (this.revealMode === "word") {
      var n = this.words.length;
      this._write(this.words.slice(0, Math.round(frac * n)).join(" "));
    } else {
      var chars = Math.round(frac * this.text.length);
      this._write(this.text.slice(0, chars));
    }
  };

  S._finish = function (result) {
    if (this.state === "done" || this.state === "cancelled") return;
    this.state = result;
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    if (this._signal && this._onAbort) this._signal.removeEventListener("abort", this._onAbort);
    if (active === this) active = null;
    if (result === "done") { this.revealProgress = 1; this._write(this.text); try { this.onComplete(this); } catch (e) { } }
    this._resolve(result);
  };

  S._startAudio = function () {
    var self = this;
    if (this.muted) return; // silent: virtual clock drives the reveal
    var src = this.audioSrc;
    if (this.audioEl && !src) {
      // caller supplied a live element
      this.usingAudio = true;
      try { this.audioEl.currentTime = 0; this.audioEl.muted = false; this.audioEl.playbackRate = 1; this.audioEl.play(); } catch (e) { this.usingAudio = false; }
      return;
    }
    if (!src || !E || !E.Audio) return;
    var el = E.Audio.play(src);       // single-channel; auto-stops any prior clip
    if (el) {
      this.audioEl = el;
      this.usingAudio = true;
      el.addEventListener("error", function () { self.usingAudio = false; }, { once: true });
    }
  };

  S.start = function () {
    var self = this;
    this.state = "playing";
    this._write("");

    // resolve duration first (real metadata when available, else fallback), then start
    var proceed = function (dur) {
      if (self.state !== "playing") return;
      if (dur && dur > 0.05) self.duration = dur;         // real clip length
      else self.duration = self.fallbackDuration;          // muted / missing / failed
      self._startAudio();
      self._t0 = nowMs();
      self._tick();
    };

    if (!this.muted && this.audioSrc && E && E.Audio && E.Audio.duration) {
      // read metadata length (never blocks: engine resolves with a safety timeout)
      E.Audio.duration(this.audioSrc).then(proceed, function () { proceed(0); });
    } else if (!this.muted && this.audioEl) {
      var d = this.audioEl.duration;
      proceed(isFinite(d) && d > 0 ? d : 0);
    } else {
      proceed(0);
    }

    // AbortSignal → cancel
    if (this._signal) {
      if (this._signal.aborted) { this.cancel(); return this; }
      this._onAbort = function () { self.cancel(); };
      this._signal.addEventListener("abort", this._onAbort, { once: true });
    }
    return this;
  };

  S._tick = function () {
    var self = this;
    function step() {
      if (self.state !== "playing") return;

      // wall-clock reference (excludes paused time). Used for two safety nets below.
      var wall = self._t0 ? (nowMs() - self._t0 - self._pausedAccum) / 1000 : 0;

      // WATCHDOG 1 — audio that never advances. Blocked autoplay, a muted-by-OS tab, or
      // a stalled / undecodable clip can leave the <audio> element at currentTime 0 while
      // .play() silently rejects (the reject is swallowed in the engine). Without this the
      // reveal clock (audioEl.currentTime) would be pinned at 0 forever and the whole
      // instruction/transition chain would freeze. If the audio clock hasn't moved shortly
      // after start, drop to the virtual clock so the line always progresses.
      if (self.usingAudio && self.audioEl && wall > 0.4 && (self.audioEl.currentTime || 0) < 0.03) {
        self.usingAudio = false;
      }

      var t = self.getCurrentTime();
      self._applyReveal(self._revealAt(t));

      // WATCHDOG 2 — hard cap. Whatever the audio element reports, a line can never outlive
      // its resolved duration plus a small margin. Guarantees every critical sequence has a
      // safe timeout fallback and can never remain locked.
      if (wall >= self.getDuration() + 0.75) { self._applyReveal(1); return self._finish("done"); }

      var audioDone = self.usingAudio && self.audioEl ? (self.audioEl.ended || (self.audioEl.paused && self.getCurrentTime() >= self.getDuration() - 0.05)) : false;
      var clockDone = t >= self.getDuration();
      // finished when: text fully shown AND (audio ended | virtual clock elapsed)
      if (self.revealProgress >= 1 && (audioDone || (!self.usingAudio && clockDone) || (self.usingAudio && clockDone))) {
        if (self.holdAfter > 0) {
          var holdStart = nowMs();
          (function hold() {
            if (self.state !== "playing") return;
            if (nowMs() - holdStart >= self.holdAfter * 1000) return self._finish("done");
            self._raf = requestAnimationFrame(hold);
          })();
          return;
        }
        return self._finish("done");
      }
      self._raf = requestAnimationFrame(step);
    }
    this._raf = requestAnimationFrame(step);
  };

  /* ---- controls ---- */
  S.pause = function () {
    if (this.state !== "playing") return;
    this.state = "paused";
    this._pausedAt = nowMs();
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    if (this.usingAudio && E && E.Audio) E.Audio.pause();
  };
  S.resume = function () {
    if (this.state !== "paused") return;
    this._pausedAccum += nowMs() - this._pausedAt;
    this.state = "playing";
    if (this.usingAudio && E && E.Audio) E.Audio.resume();
    this._tick();
  };
  // Skip: jump to the finished line (full text shown), stop audio, complete normally.
  S.skip = function () {
    if (this.state === "done" || this.state === "cancelled") return;
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    if (this.usingAudio && E && E.Audio) E.Audio.stop();
    this.state = "playing";
    this._finish("done");
  };
  // Cancel: abort silently — stop audio + reveal, do NOT fire completion.
  S.cancel = function () {
    if (this.state === "done" || this.state === "cancelled") return;
    if (this.usingAudio && E && E.Audio) E.Audio.stop();
    this._finish("cancelled");
  };

  /* ---- controller facade ---- */
  var VoiceTextSync = {
    TOL_MS: TOL_MS,
    play: function (opts) {
      if (active) active.cancel();      // never overlap two voices
      var s = new Session(opts);
      active = s;
      if (suspended) { pending = s; return s; } // gated: starts on resume()
      return s.start();
    },
    current: function () { return active; },
    pauseAll: function () { if (active) active.pause(); },
    resumeAll: function () { if (active) active.resume(); },
    cancelAll: function () { if (active) active.cancel(); if (pending) { pending.cancel(); pending = null; } },
    skipCurrent: function () { if (active) active.skip(); },
    // Narration gate: hold any NEW session (e.g. the next level's first instruction)
    // until the transition overlay is gone, then release it to play on a visible screen.
    suspend: function () { suspended = true; },
    resume: function () { suspended = false; if (pending) { var p = pending; pending = null; if (p.state === "idle") p.start(); } },
    isSuspended: function () { return suspended; },
    setMuted: function (m) { if (E && E.Audio) E.Audio.setMuted(m); },
    isMuted: function () { return E && E.Audio ? E.Audio.isMuted() : false; },
    estimateDuration: estimateDuration
  };

  global.VoiceTextSync = VoiceTextSync;
})(window);
