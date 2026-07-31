/* god-mode-vo-debug.js — Voice-Over ↔ Text sync debugger for the God Mode suite.
   Previews the transition and next-level instruction narration, drives the shared
   VoiceTextSync controls (pause / resume / restart / skip / mute), and shows a live
   readout: audio duration, current playback time, text-reveal progress and the
   text↔voice sync difference in milliseconds. Flags FAIL when the drift exceeds the
   100 ms tolerance at the start or completion of a line. Read-only wrt game state. */
(function (global) {
  "use strict";
  var E = global.Engine;

  function VODebug(game) {
    this.game = game;
    this.out = null;
    this._raf = null;
    this._lastKind = "preview";
    this._maxDiff = 0;
    this._startDiff = null;
    this._endDiff = null;
    this._watched = null;
  }
  var P = VODebug.prototype;

  P.init = function () { this.out = document.getElementById("voOutput"); };
  P._VO = function () { return global.VoiceTextSync; };

  P.dispatch = function (arg, btn) {
    var VO = this._VO();
    if (!VO) { this._render("VoiceTextSync not loaded."); return; }
    switch (arg) {
      case "preview": this._lastKind = "preview"; this._previewTransition("transition"); break;
      case "complete": this._lastKind = "complete"; this._previewTransition("complete"); break;
      case "next": this._lastKind = "next"; this._previewTransition("next"); break;
      case "instruction": this._lastKind = "instruction"; this._previewInstruction(); break;
      case "pause": VO.pauseAll(); break;
      case "resume": VO.resumeAll(); break;
      case "restart": this._restart(); break;
      case "skip": VO.skipCurrent(); break;
      case "mute": this._toggleMute(btn); break;
    }
  };

  P._toggleMute = function (btn) {
    var VO = this._VO();
    var m = !VO.isMuted();
    VO.setMuted(m);
    if (btn) { btn.classList.toggle("on", m); btn.textContent = m ? "🔇 VO Muted" : "🔊 Mute VO Preview"; }
    this._render((m ? "VO muted" : "VO unmuted") + " — text still advances by the stored/estimated duration.");
  };

  P._previewTransition = function (kind) {
    var LT = global.LevelTransition;
    if (!LT) { this._render("LevelTransition not loaded."); return; }
    LT.preview(kind);
    this._startMeter();
  };

  P._previewInstruction = function () {
    var VO = this._VO();
    var g = this.game || global.balancingGame;
    if (!g || !g.tut) { this._render("Game not ready."); return; }
    var t = g.tut(); if (!t) { this._render("No active level."); return; }
    var c = t.c;
    if (c.instructionBar) E.setActive(c.instructionBar, true);
    VO.play({
      text: c.instruction1 || "Look at the balances carefully.",
      audio: c.instruction1Audio_path || null,
      revealMode: "type",
      setText: function (s) { E.setText(c.instructionText, s); }
    });
    this._startMeter();
  };

  P._restart = function () {
    var VO = this._VO(); if (VO) VO.cancelAll();
    var self = this;
    setTimeout(function () { self.dispatch(self._lastKind); }, 60);
  };

  /* ---- live meter ---- */
  P._startMeter = function () {
    var self = this, VO = this._VO();
    this._maxDiff = 0; this._startDiff = null; this._endDiff = null;
    if (this._raf) cancelAnimationFrame(this._raf);
    var t0 = performance.now();
    function frame() {
      var s = VO.current();
      if (s) {
        self._watched = s;
        var diff = s.getSyncDiffMs();
        var absd = Math.abs(diff);
        if (absd > self._maxDiff) self._maxDiff = absd;
        if (self._startDiff === null && (performance.now() - t0) < 250) self._startDiff = diff;
        self._renderMeter(s, diff);
      } else if (self._watched) {
        // session just ended — capture the completion drift + verdict, then stop
        self._endDiff = self._watched.getSyncDiffMs();
        self._renderVerdict();
        self._watched = null;
        return;
      }
      self._raf = requestAnimationFrame(frame);
    }
    this._raf = requestAnimationFrame(frame);
  };

  P._renderMeter = function (s, diff) {
    var TOL = this._VO().TOL_MS;
    var within = Math.abs(diff) <= TOL;
    var lines = [
      '<div class="vo-row"><span>State</span><b>' + s.state + (s.usingAudio ? " (audio)" : " (fallback)") + '</b></div>',
      '<div class="vo-row"><span>Audio Duration</span><b>' + s.getDuration().toFixed(3) + ' s</b></div>',
      '<div class="vo-row"><span>Playback Time</span><b>' + s.getCurrentTime().toFixed(3) + ' s</b></div>',
      '<div class="vo-row"><span>Text Reveal</span><b>' + Math.round(s.getRevealProgress() * 100) + ' %</b></div>',
      '<div class="vo-row ' + (within ? "vo-ok" : "vo-bad") + '"><span>Sync Diff</span><b>' + (diff >= 0 ? "+" : "") + diff + ' ms</b></div>'
    ];
    this._render(lines.join(""));
  };

  P._renderVerdict = function () {
    var TOL = this._VO().TOL_MS;
    var sPass = this._startDiff === null || Math.abs(this._startDiff) <= TOL;
    var ePass = this._endDiff === null || Math.abs(this._endDiff) <= TOL;
    var pass = sPass && ePass && this._maxDiff <= TOL;
    var verdict = pass
      ? '<div class="vo-verdict vo-ok">✓ PASS — text & voice within ' + TOL + ' ms</div>'
      : '<div class="vo-verdict vo-bad">✗ FAIL — drift exceeded ' + TOL + ' ms</div>';
    var lines = [
      verdict,
      '<div class="vo-row"><span>Start Diff</span><b>' + (this._startDiff === null ? "n/a" : this._startDiff + " ms") + '</b></div>',
      '<div class="vo-row"><span>End Diff</span><b>' + (this._endDiff === null ? "n/a" : this._endDiff + " ms") + '</b></div>',
      '<div class="vo-row"><span>Max Drift</span><b>' + this._maxDiff + ' ms</b></div>'
    ];
    var msg = "[VO] " + (pass ? "PASS" : "FAIL") + " start=" + this._startDiff + "ms end=" + this._endDiff + "ms max=" + this._maxDiff + "ms";
    (pass ? console.log : console.warn)(msg);
    this._render(lines.join(""));
  };

  P._render = function (html) { if (this.out) this.out.innerHTML = html; };

  global.GodModeVODebug = VODebug;
})(window);
