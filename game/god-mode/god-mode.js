/* god-mode.js — main controller for the Balancing Act God Mode suite.
   Owns activation (Shift+G), the debug panel, global shortcuts, screen flow,
   animation speed, visual debug; instantiates the Live Editor, QA, UX Review and
   (optional) Animation Ideas bar. Exposes window.BalancingGodMode.

   Fully removable: delete the god-mode <link>/<script> tags from index.html and
   the learner build is byte-identical. Toggling off tears down every affordance. */
(function (global) {
  "use strict";

  var PANEL_URL = "god-mode/god-mode-panel.html";
  // inline fallback (EMBEDDED_PANEL) is used when fetch fails (e.g. file://)

  function GodMode(game) {
    this.game = game;
    this.on = false;
    this.root = null;
    this.panel = null;
    this.badge = null;
    this.editor = null;
    this.qa = null;
    this.ux = null;
    this.animBar = null;
    this.vo = null;
    this.speed = 1;
    this._drag = null;
  }
  var P = GodMode.prototype;

  P.init = function () {
    var self = this;
    this._injectRoot(function () {
      self.editor = global.GodModeLiveEditor ? new global.GodModeLiveEditor(self.game) : null;
      self.qa = global.GodModeQA ? new global.GodModeQA(self.game) : null;
      self.ux = global.GodModeUXReview ? new global.GodModeUXReview(self.game) : null;
      self.animBar = global.GodModeAnimationBar ? new global.GodModeAnimationBar(self.game) : null;
      self.vo = global.GodModeVODebug ? new global.GodModeVODebug(self.game) : null;
      [self.editor, self.qa, self.ux, self.animBar, self.vo].forEach(function (m) { if (m && m.init) try { m.init(); } catch (e) { console.warn("[GodMode] module init", e); } });
      self._wirePanel();
      self._makeDraggable();
      self._bindKeys();
      self._buildBadge();
      console.log("%c⚡ God Mode ready — press Shift+G", "color:#3DF5C4;font-weight:bold");
    });
  };

  /* ---------------- DOM root / panel ---------------- */
  P._injectRoot = function (done) {
    var root = document.getElementById("godModeRoot");
    if (!root) { root = document.createElement("div"); root.id = "godModeRoot"; document.body.appendChild(root); }
    this.root = root;
    var self = this;
    function inject(html) { root.innerHTML = html; self.panel = document.getElementById("godPanel"); if (self.panel) self.panel.style.display = "none"; done(); }
    fetch(PANEL_URL).then(function (r) { if (!r.ok) throw 0; return r.text(); })
      .then(function (html) { inject(html); })
      .catch(function () { inject(EMBEDDED_PANEL()); });
  };

  P._wirePanel = function () {
    if (!this.panel) return;
    var self = this;
    this.panel.addEventListener("click", function (e) {
      var t = e.target;
      var act = t.getAttribute && t.getAttribute("data-god-action");
      if (act) { self._dispatch(act, t); return; }
      if (t.id === "godMinBtn") { self.panel.classList.toggle("godMin"); }
    });
    this.panel.addEventListener("change", function (e) {
      var tog = e.target.getAttribute && e.target.getAttribute("data-god-toggle");
      if (tog) { document.body.classList.toggle(tog, e.target.checked); if (tog === "godShowSafeArea") {} }
    });
  };

  P._dispatch = function (act, btn) {
    var g = this.game || global.balancingGame; if (!g && act.indexOf("qa:") !== 0 && act.indexOf("ux:") !== 0) { this._buildGame(); g = this.game; }
    var p = act.split(":"), kind = p[0], arg = p[1];
    try {
      if (kind === "screen") g.showScreen(arg);
      else if (kind === "level") { if (arg === "prev") g.prevLevel(); else if (arg === "next") g.nextLevel(); else g.restartLevel(); }
      else if (kind === "cube") { if (arg === "add") g.addCube(); else if (arg === "remove") g.removeCube(); else if (arg === "solve") g.autoSolve(); else g.check(); }
      else if (kind === "item") { if (arg === "book") g.selectBook(); else g.selectBag(); }
      else if (kind === "speed") this.setSpeed(parseFloat(arg), btn);
      else if (kind === "qa") this._qa(arg);
      else if (kind === "ux") this._ux(arg);
      else if (kind === "vo") { if (this.vo) this.vo.dispatch(arg, btn); }
      else if (kind === "tool" && arg === "editor") { if (this.editor) { if (this.editor.panel && this.editor.panel.style.display === "none") this.editor.show(); else this.editor.hide(); } }
    } catch (e) { console.warn("[GodMode] action " + act, e); }
  };

  P._qa = function (arg) {
    if (!this.qa) return;
    if (arg === "smoke") { this.qa._clear(); this.qa.runSmoke(); }
    else if (arg === "level") { this.qa._clear(); this.qa.runLevelData(); }
    else if (arg === "flow") { this.qa._clear(); this.qa.runScreenFlow(); }
    else if (arg === "interaction") { this.qa._clear(); this.qa.runInteraction(); }
    else if (arg === "balance") { this.qa._clear(); this.qa.runBalance(); }
    else if (arg === "all") this.qa.runAll();
    else if (arg === "copy") this.qa.copyReport();
  };
  P._ux = function (arg) {
    if (!this.ux) return;
    if (arg === "start") this.ux.startReview();
    else if (arg === "kid") this.ux.checkKidFriendly();
    else if (arg === "clear") this.ux.clear();
  };

  P._buildGame = function () {
    if (this.game) return;
    if (global.__buildBalancingGodAdapter) global.__buildBalancingGodAdapter();
    this.game = global.balancingGame || null;
    [this.editor, this.qa, this.ux, this.vo].forEach(function (m) { if (m) m.game = global.balancingGame; });
  };

  /* ---------------- activation ---------------- */
  P.toggle = function () { this.on ? this.off_() : this.on_(); };
  P.on_ = function () {
    this._buildGame();
    this.on = true;
    document.body.classList.add("godMode");
    if (this.panel) this.panel.style.display = "";
    if (this.badge) this.badge.style.display = "";
    if (this.game && this.game.setGodMode) this.game.setGodMode(true);
  };
  P.off_ = function () {
    this.on = false;
    document.body.classList.remove("godMode");
    if (this.panel) this.panel.style.display = "none";
    if (this.badge) this.badge.style.display = "none";
    // full teardown
    this.setSpeed(1);
    ["godShowBounds", "godShowSafeArea", "godShowSlots", "godShowTextBoxes"].forEach(function (c) { document.body.classList.remove(c); });
    if (this.panel) this.panel.querySelectorAll("input[type=checkbox]").forEach(function (cb) { cb.checked = false; });
    if (this.editor) { this.editor.resetAll(); this.editor.hide(); }
    if (this.ux) this.ux.clear();
    if (this.animBar) this.animBar.clearAll();
    if (this.game && this.game.setGodMode) this.game.setGodMode(false);
  };

  /* ---------------- animation speed ---------------- */
  P.setSpeed = function (v, btn) {
    this.speed = v;
    document.documentElement.style.setProperty("--god-animation-speed", v);
    try { (document.getAnimations ? document.getAnimations() : []).forEach(function (a) { try { a.playbackRate = v || 0.0001; } catch (e) {} }); } catch (e) {}
    document.body.classList.toggle("godPauseAnimations", v === 0);
    if (this.panel) {
      this.panel.querySelectorAll('#godSpeedBtns button').forEach(function (b) { b.classList.remove("on"); });
      var target = btn || (this.panel.querySelector('[data-god-action="speed:' + v + '"]'));
      if (target) target.classList.add("on");
    }
  };

  /* ---------------- badge ---------------- */
  P._buildBadge = function () {
    var b = document.createElement("div"); b.id = "godBadge"; b.textContent = "⚡ GOD MODE"; b.style.display = "none";
    document.body.appendChild(b); this.badge = b;
    var self = this; b.addEventListener("click", function () { self.toggle(); });
  };

  /* ---------------- draggable panel ---------------- */
  P._makeDraggable = function () {
    if (!this.panel) return;
    var head = document.getElementById("godPanelHeader"); if (!head) return;
    var self = this;
    head.addEventListener("mousedown", function (e) {
      if (e.target.id === "godMinBtn") return;
      var r = self.panel.getBoundingClientRect();
      self._drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      function mm(ev) {
        if (!self._drag) return;
        var x = Math.max(0, Math.min(window.innerWidth - 60, ev.clientX - self._drag.dx));
        var y = Math.max(0, Math.min(window.innerHeight - 30, ev.clientY - self._drag.dy));
        self.panel.style.left = x + "px"; self.panel.style.top = y + "px"; self.panel.style.right = "auto";
      }
      function mu() { self._drag = null; document.removeEventListener("mousemove", mm); document.removeEventListener("mouseup", mu); }
      document.addEventListener("mousemove", mm); document.addEventListener("mouseup", mu);
      e.preventDefault();
    });
  };

  /* ---------------- keyboard ---------------- */
  P._bindKeys = function () {
    var self = this, U = global.GodModeUtils;
    window.addEventListener("keydown", function (e) {
      if ((e.key === "G" || e.key === "g") && e.shiftKey) { self.toggle(); e.preventDefault(); return; }
      if (!self.on) return;
      if (U.isTypingInField(e)) return;
      var g = self.game || global.balancingGame;
      var k = e.key;
      var map = {
        "n": function () { g.nextLevel(); }, "p": function () { g.prevLevel(); }, "r": function () { g.restartLevel(); },
        "a": function () { g.addCube(); }, "d": function () { g.removeCube(); },
        " ": function () { g.check(); }, "b": function () { self._toggleDebug("godShowBounds"); },
        "q": function () { self.qa && (self.qa._clear(), self.qa.runSmoke()); },
        "l": function () { self.qa && (self.qa._clear(), self.qa.runLevelData()); },
        "v": function () { self.ux && self.ux.startReview(); }, "k": function () { self.ux && self.ux.checkKidFriendly(); },
        "x": function () { self.ux && self.ux.clear(); }, "f": function () { g.forceFinalTap(); },
        "1": function () { self.setSpeed(0); }, "2": function () { self.setSpeed(0.5); },
        "3": function () { self.setSpeed(1); }, "4": function () { self.setSpeed(1.5); }, "5": function () { self.setSpeed(2); }
      };
      var fn = map[k.toLowerCase && k.toLowerCase()] || map[k];
      if (fn && g) { try { fn(); } catch (err) { console.warn(err); } e.preventDefault(); }
    });
  };
  P._toggleDebug = function (cls) {
    var on = !document.body.classList.contains(cls);
    document.body.classList.toggle(cls, on);
    if (this.panel) { var cb = this.panel.querySelector('[data-god-toggle="' + cls + '"]'); if (cb) cb.checked = on; }
  };

  /* ---------------- embedded panel fallback ---------------- */
  function EMBEDDED_PANEL() {
    return '' +
'<div id="godPanel"><div id="godPanelHeader"><span class="godTitle">⚡ God Mode — Balancing Act</span><button id="godMinBtn" title="Minimize">–</button></div><div id="godPanelBody">' +
'<section class="godSec"><h4>Screen Flow</h4><div class="godBtns">' +
'<button data-god-action="screen:intro">Intro</button><button data-god-action="screen:selection">Selection</button><button data-god-action="screen:gameplay">Gameplay</button><button data-god-action="screen:feedback">Wrong Feedback</button><button data-god-action="screen:correct">Correct</button><button data-god-action="screen:finaltap">Final Tap</button><button data-god-action="screen:compare">Compare</button><button data-god-action="screen:gameover">Game Over</button></div></section>' +
'<section class="godSec"><h4>Level Testing</h4><div class="godBtns"><button data-god-action="level:prev">◀ Prev</button><button data-god-action="level:next">Next ▶</button><button data-god-action="level:restart">Restart</button></div>' +
'<div class="godBtns"><button data-god-action="cube:add">+ Cube</button><button data-god-action="cube:remove">− Cube</button><button data-god-action="cube:solve">Auto-Solve</button><button data-god-action="cube:check">Check</button></div></section>' +
'<section class="godSec"><h4>Item</h4><div class="godBtns"><button data-god-action="item:book">Select Book</button><button data-god-action="item:bag">Select Bag</button></div></section>' +
'<section class="godSec"><h4>Animation Speed</h4><div class="godBtns" id="godSpeedBtns"><button data-god-action="speed:0">Pause</button><button data-god-action="speed:0.5">0.5×</button><button data-god-action="speed:1" class="on">1×</button><button data-god-action="speed:1.5">1.5×</button><button data-god-action="speed:2">2×</button></div></section>' +
'<section class="godSec"><h4>Visual Debug</h4><div class="godChks"><label><input type="checkbox" data-god-toggle="godShowBounds"> Show Bounds</label><label><input type="checkbox" data-god-toggle="godShowSafeArea"> Safe Area</label><label><input type="checkbox" data-god-toggle="godShowSlots"> Mark Cube Slots</label><label><input type="checkbox" data-god-toggle="godShowTextBoxes"> Text Boxes</label></div></section>' +
'<section class="godSec"><h4>QA Test Mode</h4><div class="godBtns"><button data-god-action="qa:smoke">Smoke</button><button data-god-action="qa:level">Level Data</button><button data-god-action="qa:flow">Flow</button><button data-god-action="qa:interaction">Interaction</button><button data-god-action="qa:balance">Balance</button></div><div class="godBtns"><button data-god-action="qa:all" class="godPrimary">Run All</button><button data-god-action="qa:copy">Copy Report</button></div><div id="qaOutput"></div></section>' +
'<section class="godSec"><h4>Voice-Over Sync (VO)</h4><div class="godBtns"><button data-god-action="vo:preview" class="godPrimary">▶ Preview Transition VO + Text</button><button data-god-action="vo:instruction">▶ Preview Next-Level Instruction</button></div><div class="godBtns"><button data-god-action="vo:pause">⏸ Pause</button><button data-god-action="vo:resume">▶ Resume</button><button data-god-action="vo:restart">↻ Restart</button><button data-god-action="vo:skip">⏭ Skip Line</button><button data-god-action="vo:mute">🔊 Mute VO Preview</button></div><div id="voOutput"></div></section>' +
'<section class="godSec"><h4>UI / UX Review</h4><div class="godBtns"><button data-god-action="ux:start" class="godPrimary">Start Review</button><button data-god-action="ux:kid">Kid Check</button><button data-god-action="ux:clear">Clear</button></div></section>' +
'<section class="godSec"><h4>Tools</h4><div class="godBtns"><button data-god-action="tool:editor">Live Layout Editor</button></div><p class="godHint">Shift+G toggles · N/P levels · R restart · A/D +/− cube · Space check · 1-5 speed · B bounds · Q/L QA · V UX · F final tap</p></section>' +
'</div></div>';
  }

  /* ---------------- bootstrap ---------------- */
  function boot() {
    if (global.__buildBalancingGodAdapter) global.__buildBalancingGodAdapter();
    var game = global.balancingGame || null;
    if (!game && !global.__LM) console.warn("[GodMode] no game instance yet — will resolve lazily on first use.");
    var gm = new GodMode(game);
    global.BalancingGodMode = gm;
    gm.init();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window);
