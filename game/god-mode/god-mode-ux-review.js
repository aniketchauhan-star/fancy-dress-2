/* god-mode-ux-review.js — UI/UX Review for the Balancing Act God Mode suite.
   Kid-focused heuristics. Highlights offending elements on screen (uxIssue /
   uxWarning / uxGood) and writes a plain-language report into #uxOutput.
   All size checks run in STAGE space so the fit-to-viewport scale can't fake a fail. */
(function (global) {
  "use strict";
  var U = global.GodModeUtils;

  function UX(game) {
    this.game = game;
    this.panel = null;
    this.out = null;
    this._marked = [];
  }
  var P = UX.prototype;

  P.init = function () {
    if (!this.game) {
      if (global.__buildBalancingGodAdapter) global.__buildBalancingGodAdapter();
      this.game = global.balancingGame || null;
    }
    this._build();
  };
  P._g = function () { return this.game || global.balancingGame || null; };

  P._build = function () {
    if (document.getElementById("uxPanel")) { this.panel = document.getElementById("uxPanel"); this.out = document.getElementById("uxOutput"); return; }
    var p = document.createElement("div");
    p.id = "uxPanel";
    p.style.display = "none";
    var h = document.createElement("div");
    h.className = "uxHeader";
    h.innerHTML = "<span>UI / UX Review</span>";
    var x = document.createElement("button");
    x.className = "uxClose"; x.textContent = "×";
    var self = this;
    x.addEventListener("click", function () { self.clear(); });
    h.appendChild(x);
    var o = document.createElement("div");
    o.id = "uxOutput";
    p.appendChild(h); p.appendChild(o);
    document.body.appendChild(p);
    this.panel = p; this.out = o;
  };

  /* ---------- output ---------- */
  P._show = function () { if (this.panel) this.panel.style.display = ""; };
  P._head = function (t) { this._line("info", "— " + t + " —", true); };
  P._line = function (kind, text, isHeader) {
    if (!this.out) return;
    var d = document.createElement("div");
    d.className = "ux-line ux-" + kind + (isHeader ? " ux-header" : "");
    d.textContent = text;
    this.out.appendChild(d);
    this.out.scrollTop = this.out.scrollHeight;
  };
  P._issue = function (t, el) { this._line("issue", "✗ " + t); this._mark(el, "uxIssue"); };
  P._warn = function (t, el) { this._line("warn", "▲ " + t); this._mark(el, "uxWarning"); };
  P._good = function (t, el) { this._line("good", "✓ " + t); this._mark(el, "uxGood"); };
  P._infoLine = function (t) { this._line("info", t); };
  P._mark = function (el, cls) { if (!el || !cls) return; el.classList.add(cls); this._marked.push([el, cls]); };
  P._guard = function (fn) { try { fn.call(this); } catch (e) { this._line("issue", "✗ check error: " + (e && e.message ? e.message : e)); } };

  /* ---------- checks ---------- */
  P.checkTapTargets = function () {
    var self = this; this._show(); this._head("Tap Targets (min 80×80)");
    this._guard(function () {
      var g = self._g(); if (!g) { self._issue("game not ready"); return; }
      var a = g.active(); if (!a) { self._infoLine("no active level"); return; }
      var items = [];
      var gc = a.game.c, tc = a.tut.c;
      [["+ button", gc.plusButton], ["− button", gc.minusButton], ["check button", gc.checkButton],
       ["book button", tc.bookButton], ["bag button", tc.bagButton],
       ["final book", tc.finalBookButton], ["final bag", tc.finalBagButton],
       ["next button", tc.nextButton]].forEach(function (p) { items.push(p); });
      var ba = global.CONFIG && global.CONFIG.buttonAnimator;
      if (ba && ba.goButton) items.push(["Let's Go", ba.goButton]);
      items.forEach(function (pair) {
        var el = global.Engine.get(pair[1]);
        if (!el || !U.isVisible(el)) { self._infoLine("· " + pair[0] + " — hidden/absent (skipped)"); return; }
        var r = U.stageRectOf(el);
        var ok = r.w >= 80 && r.h >= 80;
        var msg = pair[0] + " " + Math.round(r.w) + "×" + Math.round(r.h);
        if (ok) self._good(msg, el); else self._issue(msg + " (too small for kids)", el);
      });
    });
  };

  P.checkText = function () {
    var self = this; this._show(); this._head("Text Readability (min 24px)");
    this._guard(function () {
      var nodes = U.qsa("#stage .utext"), passed = 0, tested = 0;
      nodes.forEach(function (el) {
        if (!U.isVisible(el)) return;
        var inner = el._tmpInner; if (!inner) return;
        var txt = inner.textContent || "";
        if (!txt.trim()) return;
        tested++;
        var fs = (el._tmp && el._tmp.fontSize) || parseFloat(getComputedStyle(inner).fontSize) || 0;
        var flagged = false;
        if (fs < 24) { self._warn("small text " + Math.round(fs) + "px: \"" + txt.slice(0, 28) + "\"", el); flagged = true; }
        if (txt.length > 120) { self._warn("long string (" + txt.length + " chars) for young kids", el); flagged = true; }
        if (inner.scrollWidth > el.clientWidth + 2 || inner.scrollHeight > el.clientHeight + 2) { self._issue("text overflow: \"" + txt.slice(0, 24) + "\"", el); flagged = true; }
        if (!flagged) passed++;
      });
      if (!tested) self._infoLine("no visible text right now");
      else self._good(passed + "/" + tested + " text nodes read cleanly");
    });
  };

  P.checkHierarchy = function () {
    var self = this; this._show(); this._head("Visual Hierarchy");
    this._guard(function () {
      var g = self._g(); if (!g) { self._issue("game not ready"); return; }
      var a = g.active(); if (!a) { self._infoLine("no active level"); return; }
      var item = global.Engine.get(a.game.c.leftBasketItemImage);
      if (item && U.isVisible(item)) {
        var r = U.stageRectOf(item);
        self._good("weighed item is the focus — " + Math.round(r.w) + "×" + Math.round(r.h) + "px", item);
      } else {
        self._infoLine("no item selected yet (selection screen)");
      }
      var ib = global.Engine.get(a.tut.c.instructionBar);
      if (ib && U.isVisible(ib)) {
        var ir = U.stageRectOf(ib);
        if (ir.w > U.REF_W * 0.55) self._infoLine("instruction bar spans " + Math.round(ir.w) + "px — modal teaching cue (expected)");
      }
      var cubes = U.qsa("#stage .cube").filter(U.isVisible);
      self._infoLine(cubes.length + " weight block(s) on the scale");
    });
  };

  P.checkClutter = function () {
    var self = this; this._show(); this._head("Clutter");
    this._guard(function () {
      var g = self._g(); if (!g) { self._issue("game not ready"); return; }
      var active = 0; g.levels().forEach(function (e) { if (global.Engine.isActive(e.node)) active++; });
      if (active > 1) self._issue(active + " levels visible at once"); else self._good("one level visible at a time");
      var a = g.active(); if (!a) return;
      var tc = a.tut.c, vis = function (k) { return tc[k] && global.Engine.isActive(tc[k]) && U.isVisible(global.Engine.get(tc[k])); };
      if (vis("selectionPanel") && vis("gameplayPanel")) self._issue("selection + gameplay panels overlap", global.Engine.get(tc.gameplayPanel));
      if (vis("gameplayPanel") && vis("gameOverPanel")) self._issue("gameplay + game-over overlap");
      if (vis("gameplayPanel") && vis("tapPanel")) self._issue("gameplay + final-tap overlap");
      var cubes = U.qsa("#stage .cube").filter(U.isVisible).length;
      var cap = a.game.spawnPointsLen || 8;
      if (cubes > cap) self._warn(cubes + " blocks exceed the " + cap + " slot cap"); else self._good("block count within slot cap (" + cubes + "/" + cap + ")");
    });
  };

  P.checkKidFriendly = function () {
    var self = this; this._show(); this._head("Kid-Friendly Language");
    this._guard(function () {
      var g = self._g(); if (!g) { self._issue("game not ready"); return; }
      var a = g.active();
      var texts = [];
      if (a) { var it = global.Engine.get(a.tut.c.instructionText); if (it && it._tmpInner) texts.push([it, it._tmpInner.textContent || ""]); }
      U.qsa("#stage .utext").forEach(function (el) { if (U.isVisible(el) && el._tmpInner) texts.push([el, el._tmpInner.textContent || ""]); });
      var bad = /(\{|\}|__|\bTODO\b|\bLorem\b|\bipsum\b)/i;
      var ok = true;
      var ibVisible = a && global.Engine.isActive(a.tut.c.instructionBar) && U.isVisible(global.Engine.get(a.tut.c.instructionBar));
      if (ibVisible && a) { var itEl = global.Engine.get(a.tut.c.instructionText); if (itEl && itEl._tmpInner && !(itEl._tmpInner.textContent || "").trim()) { self._warn("instruction bar visible but empty", itEl); ok = false; } }
      texts.forEach(function (pair) {
        var t = pair[1];
        if (bad.test(t)) { self._issue("placeholder/template token in \"" + t.slice(0, 30) + "\"", pair[0]); ok = false; }
        else if (t.length > 160) { self._warn("very long string (" + t.length + " chars)", pair[0]); ok = false; }
      });
      if (ok) self._good("language looks kid-appropriate (numbers are fine — this teaches counting)");
    });
  };

  P.startReview = function () {
    this.clear(true);
    this._show();
    this.checkTapTargets();
    this.checkText();
    this.checkHierarchy();
    this.checkClutter();
    this.checkKidFriendly();
  };

  P.clear = function (keepOpen) {
    this._marked.forEach(function (pair) { try { pair[0].classList.remove(pair[1]); } catch (e) {} });
    this._marked = [];
    if (this.out) this.out.innerHTML = "";
    if (this.panel && !keepOpen) this.panel.style.display = "none";
  };

  global.GodModeUXReview = UX;
})(window);
