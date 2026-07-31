/* god-mode-integration.js — adapts the Balancing Act game (LevelManager +
   WeightMeasuringGame + Tut, exposed as window.__LM) to the public surface the
   God Mode suite drives. Exposes window.balancingGame.

   Design principle from GOD-MODE.md: God Mode only ever touches the game through
   this documented surface — never by hacking private state directly from the
   panels. Everything here is reversible; nothing persists into the learner build. */
(function (global) {
  "use strict";

  var E = global.Engine;

  function Adapter(lm) {
    this.lm = lm;
    this.isGodMode = false;
    this.flowLog = [];           // { state, level, selected }
    this._maxFlow = 40;
  }
  var P = Adapter.prototype;

  /* ---------- level access ---------- */
  P.levels = function () { return this.lm ? this.lm.levels : []; };
  P.count = function () { return this.levels().length; };
  P.activeIndex = function () {
    var ls = this.levels();
    for (var i = 0; i < ls.length; i++) if (E.isActive(ls[i].node)) return i;
    // fall back to the last started level
    for (var j = ls.length - 1; j >= 0; j--) if (ls[j].started) return j;
    return 0;
  };
  P.active = function () { return this.levels()[this.activeIndex()] || null; };
  P.game = function () { var e = this.active(); return e ? e.game : null; };
  P.tut = function () { var e = this.active(); return e ? e.tut : null; };

  P._log = function (state) {
    var t = this.tut();
    this.flowLog.push({
      state: state,
      level: this.activeIndex() + 1,
      selected: t ? t.currentSelected : 0
    });
    if (this.flowLog.length > this._maxFlow) this.flowLog.shift();
  };

  /* ---------- level flow ---------- */
  P.goToLevel = function (i) {
    var ls = this.levels();
    if (i < 0 || i >= ls.length) return;
    var introEl = document.querySelector('#stage > [data-name="Intro"]');
    if (introEl) introEl.style.display = "none";
    ls.forEach(function (e, idx) { E.setActive(e.node, idx === i); });
    var entry = ls[i];
    try { this.lm._ensureStarted(entry); } catch (e) {}
    try { entry.game.resetGameplay(); } catch (e) {}
    // return to that level's selection screen
    this.showScreen("selection");
    this._log("level:" + (i + 1));
  };
  P.nextLevel = function () { this.goToLevel(Math.min(this.count() - 1, this.activeIndex() + 1)); };
  P.prevLevel = function () { this.goToLevel(Math.max(0, this.activeIndex() - 1)); };
  P.restartLevel = function () {
    var g = this.game(); if (g) { try { g.resetGameplay(); } catch (e) {} }
    this.showScreen("selection");
    this._log("restart");
  };

  /* ---------- item selection ---------- */
  P.ensureSelected = function (which) {
    var e = this.active(); if (!e) return;
    var t = e.tut, g = e.game;
    if (t.currentSelected === t.SelectedType.None) {
      E.setActive(t.c.selectionPanel, false);
      if (t.c.gameplayPanel) E.setActive(t.c.gameplayPanel, true);
      E.setActive(t.c.itemmain, true);
      if (which === "book") { t.currentSelected = t.SelectedType.Book; g.selectBook(); }
      else { t.currentSelected = t.SelectedType.Bag; g.selectBag(); }
      t.instruction3Completed = true;
      g.updatePlusMinusState();
    }
  };
  P.selectBook = function () { var t = this.tut(); if (t) { t.currentSelected = t.SelectedType.None; } this.ensureSelected("book"); this._log("select:book"); };
  P.selectBag = function () { var t = this.tut(); if (t) { t.currentSelected = t.SelectedType.None; } this.ensureSelected("bag"); this._log("select:bag"); };

  /* ---------- cubes ---------- */
  P.addCube = function () { this.ensureSelected("bag"); var g = this.game(); if (g) g.addCube(); };
  P.removeCube = function () { var g = this.game(); if (g) g.removeCube(); };
  P.autoSolve = function () {
    this.ensureSelected("bag");
    var g = this.game(); if (!g) return;
    var target = g.correctCubeCount;
    var self = this;
    (function step() {
      if (!g || g.cubeIndex >= target) { self._log("autosolve"); return; }
      g.addCube();
      setTimeout(step, 120);
    })();
  };
  P.check = function () { var g = this.game(); if (g) { g.checkResult(); this._log("check"); } };

  /* ---------- screen jumps (best-effort, never throws) ---------- */
  P.hideOverlays = function () {
    var t = this.tut(); if (!t) return; var c = t.c;
    ["completionBar", "bottomBar", "gameOverPanel", "tapPanel"].forEach(function (k) {
      if (c[k]) E.setActive(c[k], false);
    });
  };
  P.showScreen = function (name) {
    var e = this.active(); if (!e) return;
    var t = e.tut, g = e.game, c = t.c;
    try {
      if (name === "intro") {
        var introEl = document.querySelector('#stage > [data-name="Intro"]');
        this.levels().forEach(function (lv) { E.setActive(lv.node, false); });
        if (introEl) introEl.style.display = "";
        var ba = (global.CONFIG && global.CONFIG.buttonAnimator);
        if (ba && ba.goButton) { E.setActive(ba.goButton, true); E.setInteractable(ba.goButton, true); }
      } else if (name === "selection") {
        this.hideOverlays();
        if (c.gameplayPanel) E.setActive(c.gameplayPanel, false);
        E.setActive(c.itemmain, false);
        E.setActive(c.selectionPanel, true);
        E.setActive(c.instructionBar, true);
        E.setInteractable(c.bookButton, !t.bookCompleted);
        E.setInteractable(c.bagButton, !t.bagCompleted);
        t.currentSelected = t.SelectedType.None;
      } else if (name === "gameplay") {
        this.hideOverlays();
        E.setActive(c.selectionPanel, false);
        if (c.gameplayPanel) E.setActive(c.gameplayPanel, true);
        E.setActive(c.itemmain, true);
        E.setActive(c.instructionBar, true);
        this.ensureSelected("bag");
      } else if (name === "feedback") {
        // exercise the real "too many" flow: solve then add one extra, then check
        this.ensureSelected("bag");
        var over = g.correctCubeCount + 1, self = this;
        (function step() {
          if (g.cubeIndex >= over) { g.checkResult(); return; }
          g.addCube(); setTimeout(step, 100);
        })();
      } else if (name === "correct") {
        this.ensureSelected("bag");
        var tgt = g.correctCubeCount;
        (function step() {
          if (g.cubeIndex >= tgt) { g.checkResult(); return; }
          g.addCube(); setTimeout(step, 100);
        })();
      } else if (name === "finaltap") {
        t.bookCompleted = true; t.bagCompleted = true;
        this.hideOverlays();
        if (c.gameplayPanel) E.setActive(c.gameplayPanel, false);
        E.setActive(c.itemmain, false);
        E.setActive(c.instructionBar, true);
        E.setActive(c.tapPanel, true);
        t.isRetryingFinalTap = true; // skip the intro pop animation on a jump
        t.startTapActivity();
      } else if (name === "compare") {
        // final comparison: both cards + their "Weight of … = N blocks" text + Next
        t.bookCompleted = true; t.bagCompleted = true;
        this.hideOverlays();
        if (c.gameplayPanel) E.setActive(c.gameplayPanel, false);
        E.setActive(c.itemmain, false);
        E.setActive(c.instructionBar, false);
        E.setActive(c.selectionPanel, true);
        if (typeof t._applyCompareLayout === "function") t._applyCompareLayout();
        E.setActive(c.bookButton, true); E.setActive(c.bagButton, true);
        E.setScale(c.bookButton, 1); E.setScale(c.bagButton, 1);
        if (c.bookButtonImage) E.setImageAlpha(c.bookButtonImage, 1);
        if (c.bagButtonImage) E.setImageAlpha(c.bagButtonImage, 1);
        if (c.bookCompletedText) E.setActive(c.bookCompletedText, true);
        if (c.bagCompletedText) E.setActive(c.bagCompletedText, true);
        if (c.nextButton) E.setActive(c.nextButton, true);
      } else if (name === "gameover") {
        this.hideOverlays();
        if (c.gameOverPanel) { E.setActive(c.gameOverPanel, true); if (E.confetti) E.confetti(c.gameOverPanel); }
      }
      this._log("screen:" + name);
    } catch (err) { console.warn("[GodMode] showScreen(" + name + ")", err); }
  };

  /* ---------- forced outcomes ---------- */
  P.forceCorrect = function () { this.showScreen("correct"); };
  P.forceFinalTap = function () { this.showScreen("finaltap"); };
  P.forceGameOver = function () { this.showScreen("gameover"); };

  /* ---------- Noori/hint preview parity (no-op friendly) ---------- */
  P.setGodMode = function (on) { this.isGodMode = !!on; var g = this.game(); if (g) g.isGodMode = !!on; };

  // Build once the LevelManager exists.
  function tryBuild() {
    if (global.balancingGame) return true;
    var lm = global.__LM;
    if (!lm || !lm.levels || !lm.levels.length) return false;
    global.balancingGame = new Adapter(lm);
    return true;
  }
  global.__buildBalancingGodAdapter = tryBuild;
  // attempt immediately + shortly after boot
  if (!tryBuild()) {
    var tries = 0;
    var iv = setInterval(function () {
      if (tryBuild() || ++tries > 40) clearInterval(iv);
    }, 100);
  }
})(window);
