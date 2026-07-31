/* god-mode-live-editor.js — Live Layout Editor for the Balancing Act God Mode
   suite. Select any registered UI element (dropdown or Pick-From-Screen), read
   and edit its live geometry/text, then copy exact values or a CSS rule.

   Values are the element's own inline layout (left/top/width/height in the
   engine's 1920x1080 design px, i.e. parent-relative), so what you copy pastes
   straight back into the layout. Fully reversible: resetAll() restores originals. */
(function (global) {
  "use strict";
  var U = global.GodModeUtils;
  var E = global.Engine;

  var LS_KEY = "balancingGodLayout";

  function byId(id) { return id && E && E.get ? E.get(id) : null; }
  function activeCfg() {
    var g = global.balancingGame; if (!g) return null;
    var a = g.active(); return a ? { game: a.game.c, tut: a.tut.c } : null;
  }

  // registry: each entry {label, sel?, get?()->[els]} — resolved lazily so per-level ids work.
  // Covers every meaningful asset + text node so anything can be selected and drag-aligned.
  function REGISTRY() {
    function gid(kind, key) { var c = activeCfg(); return c ? byId(c[kind][key]) : null; }
    // table of config-resolved nodes: [label, kind, key]
    var T = [
      // ---- scale ----
      ["Scale — beam", "sel", '#stage [data-name="plate"]'],
      ["Scale — needle", "sel", '#stage [data-name="needle"]'],
      ["Scale — left pan", "getLeft"],
      ["Scale — right pan", "sel", '#stage [data-name="Right"]'],
      // ---- gameplay ----
      ["Weighed item image", "game", "leftBasketItemImage"],
      ["Weight blocks (all cubes)", "sel", "#stage .cube"],
      ["Plate sample block", "sel", "#stage .cube.plate-sample"],
      ["+ button", "game", "plusButton"],
      ["− button", "game", "minusButton"],
      ["Check button", "game", "checkButton"],
      ["Items bar (plate + buttons)", "tut", "itemmain"],
      // ---- panels / bars ----
      ["Instruction bar", "tut", "instructionBar"],
      ["Instruction text", "tut", "instructionText"],
      ["Completion bar", "tut", "completionBar"],
      ["Completion text", "tut", "completionText"],
      ["Selection panel", "tut", "selectionPanel"],
      ["Gameplay panel", "tut", "gameplayPanel"],
      ["Final tap panel", "tut", "tapPanel"],
      // ---- selection cards ----
      ["Book card", "tut", "bookButton"],
      ["Bag card", "tut", "bagButton"],
      ["Book completed text", "tut", "bookCompletedText"],
      ["Bag completed text", "tut", "bagCompletedText"],
      ["Book pass mark", "tut", "bookPassMark"],
      ["Bag pass mark", "tut", "bagPassMark"],
      // ---- final tap cards ----
      ["Final book card", "tut", "finalBookButton"],
      ["Final bag card", "tut", "finalBagButton"],
      ["Final book image", "tut", "finalBookHighlightImage"],
      ["Final bag image", "tut", "finalBagHighlightImage"],
      // ---- buttons ----
      ["Next button", "tut", "nextButton"],
      ["Final next button", "tut", "finalnextButton"],
      ["Try again button", "tut", "tryAgainButton"],
      ["Final try again button", "tut", "finalTryAgainButton"],
      // ---- generic catch-alls (select ANY item on screen) ----
      ["◆ All items / elements", "sel", "#stage .unode"],
      ["◆ All images", "sel", "#stage .unode[data-sprite]"],
      ["◆ All text (TMP)", "sel", "#stage .utext"],
      ["◆ Weight blocks (cubes)", "sel", "#stage .cube"],
      ["◆ Hint hand", "sel", ".hint-hand"],
      ["◆ Stage", "stage"]
    ];
    return T.map(function (row) {
      var label = row[0], kind = row[1];
      if (kind === "sel") return { label: label, sel: row[2] };
      if (kind === "stage") return { label: label, get: function () { return [document.getElementById("stage")]; } };
      if (kind === "getLeft") return { label: label, get: function () { return U.qsa('#stage [data-name="left "]').concat(U.qsa('#stage [data-name="left"]')); } };
      var k = row[2];
      return { label: label, get: function () { return [gid(kind, k)]; } };
    });
  }

  function Editor(game) {
    this.game = game;
    this.cursorEdit = false;
    this.snap = false;
    this.locked = false;
    this.mode = "group";       // 'group' | 'single'
    this.targets = [];         // current elements being edited
    this.key = null;           // registry label
    this.selector = "";
    this.box = null;           // selection overlay
    this._orig = {};           // key -> per-element original cssText (group)
    this._origSingle = new Map ? new Map() : null;
    this._ghosts = [];
    this._drag = null;
    this._panelBuilt = false;
  }
  var P = Editor.prototype;

  P.init = function () {
    if (!this.game) { if (global.__buildBalancingGodAdapter) global.__buildBalancingGodAdapter(); this.game = global.balancingGame || null; }
    this._buildPanel();
    this._buildSelectionBox();
    this._bindGlobal();
    this._populateDropdown();
  };

  /* ---------------- panel ---------------- */
  P._buildPanel = function () {
    if (document.getElementById("gmEditPanel")) { this.panel = document.getElementById("gmEditPanel"); this._panelBuilt = true; return; }
    var p = document.createElement("div"); p.id = "gmEditPanel"; p.style.display = "none";
    p.innerHTML =
      '<div class="gmEditHead"><span>Live Layout Editor</span><button class="gmEditClose" data-a="close">×</button></div>' +
      '<div class="gmEditBody">' +
      '  <select id="gmEditSelect" class="gmEditSelect"></select>' +
      '  <div class="gmEditRow2">' +
      '    <button class="gmEditBtn" data-a="pick">Pick From Screen</button>' +
      '    <label class="gmEditChk"><input type="checkbox" data-a="cursor"> Cursor Edit</label>' +
      '    <label class="gmEditChk"><input type="checkbox" data-a="snap"> Snap</label>' +
      '    <label class="gmEditChk"><input type="checkbox" data-a="lock"> Lock</label>' +
      '  </div>' +
      '  <div id="gmEditFields" class="gmEditFields"></div>' +
      '  <textarea id="gmEditText" class="gmEditText" rows="2" placeholder="element text…"></textarea>' +
      '  <div class="gmEditRow2">' +
      '    <button class="gmEditBtn" data-a="applyText">Apply Text</button>' +
      '    <button class="gmEditBtn" data-a="fwd">Bring Fwd</button>' +
      '    <button class="gmEditBtn" data-a="back">Send Back</button>' +
      '    <button class="gmEditBtn" data-a="ghost">Duplicate Ghost</button>' +
      '  </div>' +
      '  <div class="gmEditRow2">' +
      '    <button class="gmEditBtn" data-a="copySel">Copy Selected</button>' +
      '    <button class="gmEditBtn" data-a="copyAll">Copy All</button>' +
      '    <button class="gmEditBtn" data-a="copyCss">Copy CSS</button>' +
      '  </div>' +
      '  <div class="gmEditRow2">' +
      '    <button class="gmEditBtn" data-a="save">Save Temp</button>' +
      '    <button class="gmEditBtn" data-a="load">Load Temp</button>' +
      '    <button class="gmEditBtn" data-a="clearTemp">Clear Temp</button>' +
      '    <button class="gmEditBtn gmEditWarn" data-a="reset">Reset Selected</button>' +
      '  </div>' +
      '  <div id="gmEditMsg" class="gmEditMsg"></div>' +
      '</div>';
    document.body.appendChild(p);
    this.panel = p; this._panelBuilt = true;
    var self = this;
    p.addEventListener("click", function (e) {
      var a = e.target.getAttribute && e.target.getAttribute("data-a"); if (!a) return;
      self._action(a, e.target);
    });
    p.addEventListener("change", function (e) {
      var a = e.target.getAttribute && e.target.getAttribute("data-a");
      if (a === "cursor") self.setCursorEdit(e.target.checked);
      else if (a === "snap") self.snap = e.target.checked;
      else if (a === "lock") self.locked = e.target.checked;
    });
    document.getElementById("gmEditSelect").addEventListener("change", function () {
      self.selectByLabel(this.value);
    });
  };

  P._populateDropdown = function () {
    var sel = document.getElementById("gmEditSelect"); if (!sel) return;
    sel.innerHTML = '<option value="">— pick an element —</option>';
    REGISTRY().forEach(function (r) { var o = document.createElement("option"); o.value = r.label; o.textContent = r.label; sel.appendChild(o); });
  };

  P._action = function (a, btn) {
    if (a === "close") { this.hide(); return; }
    if (a === "pick") { this.setCursorEdit(true); this._msg("Cursor Edit on — click any element"); this._syncChk(); return; }
    if (a === "applyText") return this.applyText();
    if (a === "fwd") return this.nudgeZ(1);
    if (a === "back") return this.nudgeZ(-1);
    if (a === "ghost") return this.duplicateGhost();
    if (a === "copySel") return this.copySelected();
    if (a === "copyAll") return this.copyAll();
    if (a === "copyCss") return this.copyCss();
    if (a === "save") return this.saveTemp();
    if (a === "load") return this.loadTemp();
    if (a === "clearTemp") return this.clearTemp();
    if (a === "reset") return this.resetSelected();
  };
  P._syncChk = function () {
    var c = this.panel.querySelector('[data-a="cursor"]'); if (c) c.checked = this.cursorEdit;
  };

  /* ---------------- selection ---------------- */
  P.selectByLabel = function (label) {
    if (!label) return;
    var entry = REGISTRY().filter(function (r) { return r.label === label; })[0];
    if (!entry) return;
    var els = (entry.get ? entry.get() : U.qsa(entry.sel)).filter(Boolean);
    if (!els.length) { this._msg("no matching element on screen right now"); return; }
    this.mode = "group";
    this.key = label;
    this.selector = entry.sel || "(dynamic)";
    this.targets = els;
    this._captureOriginals();
    this._afterSelect();
  };

  P.pickElement = function (el) {
    // resolve to the most specific registered element; else the raw element
    var reg = REGISTRY(), best = null;
    reg.forEach(function (r) {
      var els = (r.get ? r.get() : U.qsa(r.sel)).filter(Boolean);
      els.forEach(function (e) { if (e === el || e.contains(el)) { if (!best || (best.el !== el && e === el) || (e.contains(best.el))) best = { r: r, el: e }; } });
    });
    this.mode = "single";
    this.key = best ? best.r.label : (el.dataset && el.dataset.name) || el.tagName.toLowerCase();
    this.selector = best ? (best.r.sel || "(dynamic)") : selectorFor(el);
    this.targets = [best ? best.el : el];
    this._captureOriginals();
    this._afterSelect();
  };

  P._captureOriginals = function () {
    var self = this;
    if (this.mode === "single") {
      this.targets.forEach(function (el) { if (self._origSingle && !self._origSingle.has(el)) self._origSingle.set(el, el.style.cssText); });
    } else {
      if (!this._orig[this.key]) this._orig[this.key] = this.targets.map(function (el) { return { el: el, css: el.style.cssText }; });
    }
  };

  P._afterSelect = function () {
    this._renderFields();
    this._updateBox();
    this.show();
    var el = this.targets[0];
    var ta = document.getElementById("gmEditText");
    if (ta) ta.value = el && el._tmpInner ? el._tmpInner.textContent : "";
    // broadcast for the Animation Ideas bar
    try {
      document.dispatchEvent(new CustomEvent("godEditorSelectionChanged", {
        detail: { element: el, key: this.key, label: this.key, selector: this.selector }
      }));
    } catch (e) {}
  };

  /* ---------------- fields ---------------- */
  var FIELDS = [
    ["left", "px"], ["top", "px"], ["width", "px"], ["height", "px"],
    ["scale", ""], ["opacity", ""], ["fontSize", "px"], ["zIndex", ""],
    ["borderRadius", "px"], ["padding", "px"]
  ];
  P._renderFields = function () {
    var box = document.getElementById("gmEditFields"); if (!box) return;
    box.innerHTML = "";
    var el = this.targets[0]; if (!el) return;
    var v = this._read(el), self = this;
    FIELDS.forEach(function (f) {
      var wrap = document.createElement("label"); wrap.className = "gmEditField";
      wrap.innerHTML = "<span>" + f[0] + "</span>";
      var inp = document.createElement("input"); inp.type = "text"; inp.value = v[f[0]] == null ? "" : v[f[0]];
      inp.dataset.prop = f[0];
      inp.addEventListener("change", function () { self._write(f[0], inp.value); });
      wrap.appendChild(inp);
      box.appendChild(wrap);
    });
  };

  P._read = function (el) {
    var s = el.style;
    var scale = 1, m = (s.transform || "").match(/scale\(([-0-9.]+)/); if (m) scale = parseFloat(m[1]);
    var fs = el._tmpInner ? parseFloat(getComputedStyle(el._tmpInner).fontSize) : (el._tmp && el._tmp.fontSize) || "";
    return {
      left: numOr(s.left), top: numOr(s.top), width: numOr(s.width), height: numOr(s.height),
      scale: U.fmt(scale), opacity: s.opacity !== "" ? s.opacity : "1",
      fontSize: fs ? Math.round(fs) : "", zIndex: s.zIndex || "",
      borderRadius: numOr(s.borderRadius), padding: numOr(s.padding)
    };
  };

  P._write = function (prop, val) {
    var self = this;
    this.targets.forEach(function (el) {
      if (prop === "scale") self._setScale(el, parseFloat(val) || 1);
      else if (prop === "opacity") el.style.opacity = val;
      else if (prop === "zIndex") el.style.zIndex = val;
      else if (prop === "fontSize") { if (el._tmpInner) el._tmpInner.style.fontSize = (parseFloat(val) || 0) + "px"; }
      else el.style[prop] = (parseFloat(val) || 0) + "px";
    });
    this._updateBox();
  };
  P._setScale = function (el, s) {
    var t = el.style.transform || "";
    var rot = (t.match(/rotate\([^)]+\)/) || [""])[0];
    el.style.transform = (rot ? rot + " " : "") + "scale(" + s + ")";
  };

  /* ---------------- selection box + cursor edit ---------------- */
  P._buildSelectionBox = function () {
    if (document.getElementById("gmSelBox")) { this.box = document.getElementById("gmSelBox"); return; }
    var b = document.createElement("div"); b.id = "gmSelBox"; b.style.display = "none";
    b.innerHTML = '<div class="gmSelLabel"></div>' +
      ["nw", "n", "ne", "e", "se", "s", "sw", "w"].map(function (h) { return '<i class="gmSelH gmSelH-' + h + '" data-h="' + h + '"></i>'; }).join("");
    document.body.appendChild(b);
    this.box = b;
    var self = this;
    b.addEventListener("mousedown", function (e) {
      var h = e.target.getAttribute && e.target.getAttribute("data-h");
      self._startDrag(e, h || "move");
      e.preventDefault(); e.stopPropagation();
    });
  };

  P._updateBox = function () {
    var el = this.targets[0];
    if (!el || !this.box || this.panel.style.display === "none") { if (this.box) this.box.style.display = "none"; return; }
    var r = el.getBoundingClientRect();
    var b = this.box;
    b.style.display = "";
    b.style.left = r.left + "px"; b.style.top = r.top + "px";
    b.style.width = r.width + "px"; b.style.height = r.height + "px";
    var sr = U.stageRectOf(el);
    b.querySelector(".gmSelLabel").textContent = this.key + "  " + Math.round(sr.w) + "×" + Math.round(sr.h);
  };

  P.setCursorEdit = function (on) {
    this.cursorEdit = !!on;
    this._syncChk();
    if (on && !this._clickCap) {
      var self = this;
      this._clickCap = function (e) {
        if (!self.cursorEdit) return;
        if (self.panel.contains(e.target) || (self.box && self.box.contains(e.target))) return;
        var stage = document.getElementById("stage");
        var el = e.target;
        if (!stage || !stage.contains(el)) return;
        // resolve to nearest .unode / .cube / .hint-hand
        var node = el.closest(".unode, .cube, .hint-hand") || el;
        e.preventDefault(); e.stopPropagation();
        self.pickElement(node);
      };
      document.addEventListener("click", this._clickCap, true);
    }
  };

  P._startDrag = function (e, handle) {
    if (this.locked && handle === "move") { this._msg("selection locked"); return; }
    var el = this.targets[0]; if (!el) return;
    var sc = U.stageScale() || 1;
    this._drag = {
      handle: handle, x0: e.clientX, y0: e.clientY,
      left: numOr(el.style.left), top: numOr(el.style.top),
      w: numOr(el.style.width) || el.offsetWidth, h: numOr(el.style.height) || el.offsetHeight, sc: sc
    };
    var self = this;
    this._mm = function (ev) { self._onDrag(ev); };
    this._mu = function () { document.removeEventListener("mousemove", self._mm); document.removeEventListener("mouseup", self._mu); self._drag = null; self._renderFields(); };
    document.addEventListener("mousemove", this._mm);
    document.addEventListener("mouseup", this._mu);
  };
  P._onDrag = function (e) {
    var d = this._drag; if (!d) return;
    var el = this.targets[0];
    var dx = (e.clientX - d.x0) / d.sc, dy = (e.clientY - d.y0) / d.sc;
    var snap = (this.snap || e.shiftKey) ? function (n) { return Math.round(n / 10) * 10; } : function (n) { return n; };
    var L = d.left, T = d.top, W = d.w, H = d.h;
    var h = d.handle;
    if (h === "move") { L = d.left + dx; T = d.top + dy; }
    else {
      if (h.indexOf("e") >= 0) W = Math.max(40, d.w + dx);
      if (h.indexOf("s") >= 0) H = Math.max(40, d.h + dy);
      if (h.indexOf("w") >= 0) { W = Math.max(40, d.w - dx); L = d.left + dx; }
      if (h.indexOf("n") >= 0) { H = Math.max(40, d.h - dy); T = d.top + dy; }
    }
    el.style.left = snap(L) + "px"; el.style.top = snap(T) + "px";
    if (h !== "move") { el.style.width = snap(W) + "px"; el.style.height = snap(H) + "px"; }
    this._updateBox();
  };

  P.nudge = function (dx, dy) {
    var el = this.targets[0]; if (!el) return;
    el.style.left = (numOr(el.style.left) + dx) + "px";
    el.style.top = (numOr(el.style.top) + dy) + "px";
    this._updateBox(); this._renderFields();
  };
  P.nudgeZ = function (d) { var el = this.targets[0]; if (!el) return; el.style.zIndex = (parseInt(el.style.zIndex || "0", 10) + d); this._renderFields(); };

  /* ---------------- text / ghost ---------------- */
  P.applyText = function () {
    var ta = document.getElementById("gmEditText"); if (!ta) return;
    this.targets.forEach(function (el) { if (el._tmpInner) el._tmpInner.textContent = ta.value; });
    this._msg("text applied to " + this.targets.length + " element(s)");
  };
  P.duplicateGhost = function () {
    var el = this.targets[0]; if (!el) return;
    var g = el.cloneNode(true); g.style.outline = "2px dashed #7C6BFF"; g.style.opacity = "0.6";
    g.style.left = (numOr(el.style.left) + 24) + "px"; g.style.top = (numOr(el.style.top) + 24) + "px";
    (el.parentNode || document.getElementById("stage")).appendChild(g);
    this._ghosts.push(g);
    var self = this;
    setTimeout(function () { var i = self._ghosts.indexOf(g); if (i >= 0) self._ghosts.splice(i, 1); if (g.parentNode) g.parentNode.removeChild(g); }, 8000);
    this._msg("ghost added (auto-removed in 8s)");
  };

  /* ---------------- copy / export ---------------- */
  P._valuesBlock = function (label, els) {
    var el = els[0]; if (!el) return "";
    var v = this._read(el);
    var lines = ["• " + label, "  selector: " + (this.selector || "(dynamic)")];
    FIELDS.forEach(function (f) { lines.push("  " + f[0] + ": " + (v[f[0]] === "" ? "-" : v[f[0]]) + (f[1] && v[f[0]] !== "" ? f[1] : "")); });
    if (el._tmpInner) lines.push("  text: " + (el._tmpInner.textContent || "").slice(0, 120));
    return lines.join("\n");
  };
  P.copySelected = function () {
    if (!this.targets.length) { this._msg("nothing selected"); return; }
    var self = this;
    U.copyText(this._valuesBlock(this.key, this.targets)).then(function () { self._msg("✓ selected values copied"); });
  };
  P.copyAll = function () {
    var self = this, blocks = [];
    REGISTRY().forEach(function (r) {
      var els = (r.get ? r.get() : U.qsa(r.sel)).filter(Boolean);
      if (els.length) { var save = { k: self.key, s: self.selector }; self.key = r.label; self.selector = r.sel || "(dynamic)"; blocks.push(self._valuesBlock(r.label, els)); self.key = save.k; self.selector = save.s; }
    });
    U.copyText(blocks.join("\n\n---\n\n")).then(function () { self._msg("✓ all values copied"); });
  };
  P.copyCss = function () {
    var el = this.targets[0]; if (!el) { this._msg("nothing selected"); return; }
    var v = this._read(el);
    var selc = (this.selector && this.selector !== "(dynamic)") ? this.selector : (el.dataset && el.dataset.name ? '[data-name="' + el.dataset.name + '"]' : "#" + (el.id || "element"));
    var css = selc + " {\n  left: " + v.left + "px;\n  top: " + v.top + "px;\n  width: " + v.width + "px;\n  height: " + v.height + "px;\n  transform: scale(" + v.scale + ");\n  opacity: " + v.opacity + ";\n  z-index: " + (v.zIndex || 0) + ";\n}";
    var self = this;
    U.copyText(css).then(function () { self._msg("✓ CSS copied"); });
  };

  /* ---------------- save / load / reset ---------------- */
  P.saveTemp = function () {
    var data = {};
    for (var k in this._orig) if (this._orig.hasOwnProperty(k)) {
      data[k] = this._orig[k].map(function (o) { return o.el.style.cssText; });
    }
    try { localStorage.setItem(LS_KEY, JSON.stringify(data)); this._msg("✓ layout saved to localStorage"); }
    catch (e) { this._msg("save failed: " + e.message); }
  };
  P.loadTemp = function () {
    try {
      var data = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
      var reg = REGISTRY(), n = 0;
      Object.keys(data).forEach(function (label) {
        var entry = reg.filter(function (r) { return r.label === label; })[0]; if (!entry) return;
        var els = (entry.get ? entry.get() : U.qsa(entry.sel)).filter(Boolean);
        data[label].forEach(function (css, i) { if (els[i]) { els[i].style.cssText = css; n++; } });
      });
      this._msg("✓ loaded " + n + " element(s)");
    } catch (e) { this._msg("load failed: " + e.message); }
  };
  P.clearTemp = function () { try { localStorage.removeItem(LS_KEY); } catch (e) {} this.resetAll(); this._msg("temp cleared + reset"); };

  P.resetSelected = function () {
    var self = this;
    if (this.mode === "single" && this._origSingle) {
      this.targets.forEach(function (el) { if (self._origSingle.has(el)) el.style.cssText = self._origSingle.get(el); });
    } else if (this._orig[this.key]) {
      this._orig[this.key].forEach(function (o) { o.el.style.cssText = o.css; });
    }
    this._renderFields(); this._updateBox(); this._msg("reset");
  };

  P.resetAll = function () {
    for (var k in this._orig) if (this._orig.hasOwnProperty(k)) this._orig[k].forEach(function (o) { o.el.style.cssText = o.css; });
    if (this._origSingle) this._origSingle.forEach(function (css, el) { el.style.cssText = css; });
    this._orig = {}; if (this._origSingle && this._origSingle.clear) this._origSingle.clear();
    this._ghosts.forEach(function (g) { if (g.parentNode) g.parentNode.removeChild(g); }); this._ghosts = [];
    this.setCursorEdit(false);
    this.targets = []; this.key = null;
    if (this.box) this.box.style.display = "none";
  };

  /* ---------------- global keys / show-hide ---------------- */
  P._bindGlobal = function () {
    var self = this;
    window.addEventListener("keydown", function (e) {
      if (!global.BalancingGodMode || !global.BalancingGodMode.on) return;
      if (U.isTypingInField(e)) return;
      if (!self.targets.length) return;
      var step = e.shiftKey ? 10 : 1;
      if (e.key === "ArrowLeft") { self.nudge(-step, 0); e.preventDefault(); }
      else if (e.key === "ArrowRight") { self.nudge(step, 0); e.preventDefault(); }
      else if (e.key === "ArrowUp") { self.nudge(0, -step); e.preventDefault(); }
      else if (e.key === "ArrowDown") { self.nudge(0, step); e.preventDefault(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C")) { self.copySelected(); e.preventDefault(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key === "e" || e.key === "E")) { self.copyAll(); e.preventDefault(); }
    });
    window.addEventListener("scroll", function () { self._updateBox(); }, true);
    window.addEventListener("resize", function () { self._updateBox(); });
  };

  P.show = function () { if (this.panel) this.panel.style.display = ""; this._updateBox(); };
  P.hide = function () { if (this.panel) this.panel.style.display = "none"; if (this.box) this.box.style.display = "none"; };
  P._msg = function (t) { var m = document.getElementById("gmEditMsg"); if (m) { m.textContent = t; } };

  function numOr(v) { var n = parseFloat(v); return isNaN(n) ? 0 : Math.round(n * 100) / 100; }
  function selectorFor(el) {
    if (el.id) return "#" + el.id;
    if (el.dataset && el.dataset.name) return '[data-name="' + el.dataset.name + '"]';
    if (el.className) return "." + String(el.className).split(/\s+/)[0];
    return el.tagName.toLowerCase();
  }

  global.GodModeLiveEditor = Editor;
})(window);
