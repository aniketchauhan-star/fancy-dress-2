/* god-mode-qa.js — QA Test Mode for the Balancing Act God Mode suite.
   Reads the game instance + the real DOM and prints PASS/FAIL/WARN lines into
   #qaOutput and the console. Read-only: never mutates game state. */
(function (global) {
  "use strict";
  var U = global.GodModeUtils;

  function QA(game) {
    this.game = game;
    this.out = null;
    this.lines = [];   // last run, for copyReport
  }
  var P = QA.prototype;

  P.init = function () {
    if (!this.game) {
      if (global.__buildBalancingGodAdapter) global.__buildBalancingGodAdapter();
      this.game = global.balancingGame || null;
    }
    this.out = document.getElementById("qaOutput");
  };
  P._g = function () { return this.game || global.balancingGame || null; };

  /* ---------- output ---------- */
  P._clear = function () { this.lines = []; if (this.out) this.out.innerHTML = ""; };
  P._head = function (t) { this._line("info", "— " + t + " —", true); };
  P._line = function (status, text, isHeader) {
    this.lines.push({ status: status, text: text });
    var tag = status === "pass" ? "[PASS] " : status === "fail" ? "[FAIL] " : status === "warn" ? "[WARN] " : "";
    (status === "fail" ? console.warn : console.log)("[QA] " + tag + text);
    if (!this.out) return;
    var d = document.createElement("div");
    d.className = "qa-line qa-" + status + (isHeader ? " qa-header" : "");
    d.textContent = (isHeader ? "" : tag) + text;
    this.out.appendChild(d);
    this.out.scrollTop = this.out.scrollHeight;
  };
  P._pass = function (t) { this._line("pass", t); };
  P._fail = function (t) { this._line("fail", t); };
  P._warn = function (t) { this._line("warn", t); };
  P._info = function (t) { this._line("info", t); };
  P._assert = function (cond, okMsg, failMsg) { if (cond) this._pass(okMsg); else this._fail(failMsg || okMsg); return !!cond; };

  P._guard = function (fn) {
    try { fn.call(this); } catch (e) { this._fail("exception: " + (e && e.message ? e.message : e)); }
  };

  /* ---------- tests ---------- */
  P.runSmoke = function () {
    var self = this;
    this._head("Smoke Test");
    this._guard(function () {
      self._assert(!!global.Engine, "window.Engine present", "window.Engine MISSING");
      self._assert(!!global.CONFIG, "window.CONFIG present", "window.CONFIG MISSING");
      self._assert(!!global.__LM, "window.__LM (LevelManager) present", "window.__LM MISSING");
      self._assert(!!global.VoiceTextSync && typeof global.VoiceTextSync.play === "function", "VoiceTextSync controller present", "VoiceTextSync MISSING");
      var g = self._g();
      if (!self._assert(!!g, "window.balancingGame adapter present", "balancingGame adapter MISSING — game not ready")) return;
      var ls = g.levels();
      self._assert(ls.length === 4, "exactly 4 levels", "expected 4 levels, found " + ls.length);
      var allHave = ls.every(function (e) { return e && e.game && e.tut; });
      self._assert(allHave, "every level has game + tut", "some level missing game/tut");
      var gm = ["addCube", "removeCube", "checkResult", "selectBook", "selectBag", "resetGameplay", "updatePlusMinusState"];
      var tm = ["start", "onNextClicked", "onCorrectMatch", "startTapActivity"];
      var e0 = ls[0];
      gm.forEach(function (m) { self._assert(e0 && typeof e0.game[m] === "function", "game." + m + "()", "game." + m + " MISSING"); });
      tm.forEach(function (m) { self._assert(e0 && typeof e0.tut[m] === "function", "tut." + m + "()", "tut." + m + " MISSING"); });
      ["plusButton", "minusButton", "checkButton", "leftBasketItemImage"].forEach(function (k) {
        var id = e0.game.c[k];
        self._assert(id && global.Engine.get(id), "game node '" + k + "' resolves", "game node '" + k + "' unresolved");
      });
      ["selectionPanel", "instructionBar", "bookButton", "bagButton"].forEach(function (k) {
        var id = e0.tut.c[k];
        self._assert(id && global.Engine.get(id), "tut node '" + k + "' resolves", "tut node '" + k + "' unresolved");
      });
    });
  };

  P.runLevelData = function () {
    var self = this;
    this._head("Level Data Test");
    this._guard(function () {
      var g = self._g(); if (!g) { self._fail("adapter not ready"); return; }
      var ls = g.levels(), lastCount = 0;
      ls.forEach(function (e, i) {
        var gm = e.game, t = e.tut, n = "L" + (i + 1) + ": ";
        var bc = gm.bookCorrectCubeCount, ac = gm.bagCorrectCubeCount, slots = gm.spawnPointsLen;
        var okB = (bc | 0) === bc && bc >= 1 && bc <= slots;
        var okA = (ac | 0) === ac && ac >= 1 && ac <= slots;
        self._assert(okB, n + "book count " + bc + " valid (1.." + slots + ")", n + "book count " + bc + " out of range (slots=" + slots + ")");
        self._assert(okA, n + "bag count " + ac + " valid (1.." + slots + ")", n + "bag count " + ac + " out of range (slots=" + slots + ")");
        self._assert(gm.c.bookSprite && gm.c.bookSprite.path && gm.c.bookSprite.nativeSize, n + "bookSprite ok", n + "bookSprite malformed");
        self._assert(gm.c.bagSprite && gm.c.bagSprite.path && gm.c.bagSprite.nativeSize, n + "bagSprite ok", n + "bagSprite malformed");
        var tp = (gm.c.rightTargetPoints || []).length;
        self._assert(tp >= Math.max(bc, ac), n + "enough cube slots (" + tp + ")", n + "only " + tp + " cube slots for max count " + Math.max(bc, ac));
        self._assert(typeof t.isBookHeavier === "boolean", n + "isBookHeavier is boolean", n + "isBookHeavier not boolean");
        var invariant = t.isBookHeavier ? bc > ac : bc < ac;
        self._assert(invariant, n + "heavier item needs more cubes", n + "weight/cube invariant broken (isBookHeavier=" + t.isBookHeavier + ", book=" + bc + ", bag=" + ac + ")");
        if (t.isLastLevel) lastCount++;
      });
      self._assert(lastCount === 1, "exactly one level flagged isLastLevel", lastCount + " levels flagged isLastLevel (expected 1)");
    });
  };

  P.runScreenFlow = function () {
    var self = this;
    this._head("Screen Flow Test");
    this._guard(function () {
      var g = self._g(); if (!g) { self._fail("adapter not ready"); return; }
      var activeCount = 0;
      g.levels().forEach(function (e) { if (global.Engine.isActive(e.node)) activeCount++; });
      self._assert(activeCount <= 1, "at most one level active (" + activeCount + ")", activeCount + " levels active at once");
      var fl = g.flowLog || [];
      if (!fl.length) { self._warn("no navigation recorded yet"); return; }
      self._info("last " + Math.min(8, fl.length) + " flow entries:");
      fl.slice(-8).forEach(function (f) { self._info("  · " + f.state + "  L" + f.level + "  sel=" + f.selected); });
    });
  };

  P.runInteraction = function () {
    var self = this;
    this._head("Interaction Test");
    this._guard(function () {
      var g = self._g(); if (!g) { self._fail("adapter not ready"); return; }
      var e0 = g.levels()[0], c = e0.game.c;
      ["plusButton", "minusButton", "checkButton"].forEach(function (k) {
        var el = global.Engine.get(c[k]);
        var wired = el && (el.style.cursor === "pointer" || el.dataset.interactable != null);
        self._assert(wired, k + " is click-wired", k + " not wired for clicks");
      });
      self._assert(typeof e0.game.isCubeMoving !== "undefined", "double-tap guard (isCubeMoving) present", "no isCubeMoving guard");
      self._assert(e0.game.spawnPointsLen > 0, "spawn points defined (" + e0.game.spawnPointsLen + ")", "no spawn points");
      self._assert((c.rightTargetPoints || []).length > 0, "cube target markers defined", "no cube target markers");
      var active = g.active();
      if (active && !global.Engine.isActive(active.tut.c.gameplayPanel)) self._warn("not in gameplay — buttons may be disabled right now (expected outside play)");
    });
  };

  P.runBalance = function () {
    var self = this;
    this._head("Balance Test");
    this._guard(function () {
      var g = self._g(); if (!g) { self._fail("adapter not ready"); return; }
      var a = g.active();
      if (a) {
        var gm = a.game;
        self._assert(gm.targetBalance >= -1 && gm.targetBalance <= 1, "targetBalance in [-1,1] (" + U.fmt(gm.targetBalance) + ")", "targetBalance out of range: " + gm.targetBalance);
        self._assert(gm.currentBalance >= -1.0001 && gm.currentBalance <= 1.0001, "currentBalance in [-1,1] (" + U.fmt(gm.currentBalance) + ")", "currentBalance out of range: " + gm.currentBalance);
      }
      g.levels().forEach(function (e, i) {
        var bc = e.game.bookCorrectCubeCount, ac = e.game.bagCorrectCubeCount;
        self._assert(bc !== ac, "L" + (i + 1) + ": book vs bag weights differ (" + bc + " vs " + ac + ")", "L" + (i + 1) + ": book and bag need the SAME cubes — no puzzle");
      });
    });
  };

  P.runAll = function () {
    this._clear();
    this.runSmoke();
    this.runLevelData();
    this.runScreenFlow();
    this.runInteraction();
    this.runBalance();
    var fails = this.lines.filter(function (l) { return l.status === "fail"; }).length;
    var warns = this.lines.filter(function (l) { return l.status === "warn"; }).length;
    this._line(fails ? "fail" : "pass", "Summary: " + (fails ? fails + " FAILED" : "all passed") + (warns ? ", " + warns + " warning(s)" : ""), true);
  };

  P.copyReport = function () {
    var stamp = new Date().toISOString();
    var body = "Balancing Act QA Report — " + stamp + "\n" +
      this.lines.map(function (l) { return "[" + l.status.toUpperCase() + "] " + l.text; }).join("\n");
    var self = this;
    U.copyText(body).then(function () { self._info("✓ report copied to clipboard"); });
  };

  global.GodModeQA = QA;
})(window);
