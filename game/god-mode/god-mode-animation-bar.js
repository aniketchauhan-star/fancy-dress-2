/* god-mode-animation-bar.js — Animation Ideas Bar for the Balancing Act God Mode
   suite. Suggests animations for the selected element (by type + condition),
   previews them live, and exports standalone CSS/JS. Self-contained: injects its
   own keyframes so previews never depend on god-mode.css. Optional module. */
(function (global) {
  "use strict";
  var U = global.GodModeUtils;

  /* ---- base keyframe classes (injected once) ---- */
  var STYLE = [
    "@keyframes gmAnimPop{0%{transform:scale(0)}70%{transform:scale(1.15)}100%{transform:scale(1)}}",
    "@keyframes gmAnimBounce{0%{transform:translateY(0)}30%{transform:translateY(-18px)}55%{transform:translateY(0)}72%{transform:translateY(-8px)}100%{transform:translateY(0)}}",
    "@keyframes gmAnimFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}",
    "@keyframes gmAnimSway{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(3deg)}}",
    "@keyframes gmAnimShake{0%,100%{transform:translateX(0)}20%{transform:translateX(-7px)}40%{transform:translateX(6px)}60%{transform:translateX(-4px)}80%{transform:translateX(3px)}}",
    "@keyframes gmAnimRing{0%{box-shadow:0 0 0 0 rgba(61,245,196,.6)}100%{box-shadow:0 0 0 26px rgba(61,245,196,0)}}",
    "@keyframes gmAnimSquish{0%{transform:scale(1,1)}40%{transform:scale(1.18,.82)}70%{transform:scale(.92,1.08)}100%{transform:scale(1,1)}}",
    "@keyframes gmAnimSpin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}",
    "@keyframes gmAnimFadeRise{0%{opacity:0;transform:translateY(16px)}100%{opacity:1;transform:translateY(0)}}",
    "@keyframes gmAnimDrop{0%{transform:translateY(-30px);opacity:.2}70%{transform:translateY(4px)}100%{transform:translateY(0);opacity:1}}",
    "@keyframes gmAnimHeartbeat{0%,100%{transform:scale(1)}25%{transform:scale(1.12)}50%{transform:scale(1)}}",
    "@keyframes gmAnimGlow{0%,100%{filter:drop-shadow(0 0 2px rgba(255,214,63,.5))}50%{filter:drop-shadow(0 0 14px rgba(255,214,63,.95))}}",
    "@keyframes gmAnimWobble{0%,100%{transform:rotate(0)}25%{transform:rotate(-6deg)}50%{transform:rotate(5deg)}75%{transform:rotate(-3deg)}}",
    "@keyframes gmAnimTick{0%,100%{transform:rotate(0)}50%{transform:rotate(4deg)}}",
    "@keyframes gmAnimRecoil{0%{transform:translateY(0)}30%{transform:translateY(5px) scale(.96)}100%{transform:translateY(0) scale(1)}}",
    ".gmAnim-pop{animation:gmAnimPop .5s cubic-bezier(.2,1.2,.3,1) 1}",
    ".gmAnim-bounce{animation:gmAnimBounce .8s ease 1}",
    ".gmAnim-float{animation:gmAnimFloat 2.4s ease-in-out infinite}",
    ".gmAnim-sway{animation:gmAnimSway 3s ease-in-out infinite}",
    ".gmAnim-shake{animation:gmAnimShake .55s ease 1}",
    ".gmAnim-ring{animation:gmAnimRing .7s ease-out 1}",
    ".gmAnim-squish{animation:gmAnimSquish .5s ease 1}",
    ".gmAnim-spin{animation:gmAnimSpin 1s linear 1}",
    ".gmAnim-fadeRise{animation:gmAnimFadeRise .5s ease 1}",
    ".gmAnim-drop{animation:gmAnimDrop .6s cubic-bezier(.3,1.3,.4,1) 1}",
    ".gmAnim-heartbeat{animation:gmAnimHeartbeat 1.1s ease-in-out infinite}",
    ".gmAnim-glow{animation:gmAnimGlow 1.6s ease-in-out infinite}",
    ".gmAnim-wobble{animation:gmAnimWobble .7s ease 1}",
    ".gmAnim-tick{animation:gmAnimTick 1.2s ease-in-out infinite}",
    ".gmAnim-recoil{animation:gmAnimRecoil .4s ease 1}"
  ].join("\n");

  // ordered keyword -> base class (first match wins)
  var RESOLVER = [
    [/heart|beat/, "heartbeat"], [/tick/, "tick"], [/shake/, "shake"],
    [/ring|ripple/, "ring"], [/squish|squash|boing/, "squish"],
    [/spin|rotate/, "spin"], [/float|drift/, "float"], [/sway/, "sway"],
    [/settle|drop/, "drop"], [/fade|rise/, "fadeRise"], [/glow|shine|shimmer/, "glow"],
    [/wobble/, "wobble"], [/recoil/, "recoil"], [/pop/, "pop"],
    [/bounce|spring|jump/, "bounce"]
  ];
  var LOOPERS = { float: 1, sway: 1, glow: 1, heartbeat: 1, tick: 1 };
  function resolve(label) {
    var s = (label || "").toLowerCase();
    for (var i = 0; i < RESOLVER.length; i++) if (RESOLVER[i][0].test(s)) return RESOLVER[i][1];
    return "bounce";
  }

  /* ---- idea bank: type -> condition -> [labels] ---- */
  var BANK = {
    itemImage: { "On Idle": ["Gentle Float", "Soft Sway", "Breathing Scale"], "On Appear": ["Drop And Settle", "Pop In", "Fade Rise"] },
    cube: { "On Appear": ["Pop In Bounce", "Drop And Settle", "Scale Spring", "Fade Rise"], "On Idle": ["Soft Float"] },
    button: { "On Tap": ["Squash And Stretch", "Boing Press", "Ripple Ring", "Recoil Bounce"], "On Idle": ["Heartbeat Pulse", "Warm Glow"], "On Hover": ["Gentle Pop", "Shine Sweep"] },
    beam: { "On Idle": ["Balance Sway", "Settle Wobble"], "On Level Complete": ["Happy Bounce"] },
    needle: { "On Idle": ["Wobble Settle", "Tick Shake"] },
    hand: { "On Idle": ["Tap Bounce", "Nudge Pulse"] },
    promptText: { "On Appear": ["Fade Rise", "Pop In", "Drop In"], "On Idle": ["Soft Glow"] },
    panel: { "On Appear": ["Fade Rise", "Pop In"], "On Idle": ["Soft Float"] },
    "default": { "On Idle": ["Gentle Float", "Soft Glow"], "On Tap": ["Pop", "Ripple Ring"], "On Appear": ["Fade Rise", "Pop In"] }
  };
  var CONDITIONS = ["On Idle", "On Hover", "On Tap", "On Correct", "On Wrong", "On Appear", "On Level Start", "On Level Complete"];
  var DEFAULT_COND = { itemImage: "On Idle", cube: "On Appear", button: "On Tap", beam: "On Idle", needle: "On Idle", hand: "On Idle", promptText: "On Appear", panel: "On Appear", "default": "On Idle" };

  function classify(el) {
    if (!el) return "default";
    var name = (el.dataset && el.dataset.name || "").toLowerCase();
    var id = (el.id || "").toLowerCase();
    var cls = (el.className || "").toString().toLowerCase();
    if (cls.indexOf("cube") >= 0) return "cube";
    if (cls.indexOf("hint-hand") >= 0) return "hand";
    if (name.indexOf("needle") >= 0) return "needle";
    if (/plate|controller|support|beam/.test(name)) return "beam";
    if (/book|bag|image/.test(name) && cls.indexOf("utext") < 0) return "itemImage";
    if (/button|btn|plus|minus|check|next|go/.test(name + " " + id)) return "button";
    if (cls.indexOf("utext") >= 0 || /instruction|text/.test(name)) return "promptText";
    if (/panel|bar|bg|background/.test(name)) return "panel";
    return "default";
  }

  function kebab(s) { return (s || "idea").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  function camel(s) { var k = kebab(s).split("-"); return k[0] + k.slice(1).map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(""); }
  function pascal(s) { var c = camel(s); return c.charAt(0).toUpperCase() + c.slice(1); }

  function Bar(game) {
    this.game = game;
    this.el = null;
    this.sel = null;         // selected DOM element
    this.selInfo = null;     // {label,key,selector}
    this.cond = null;
    this.previewLabel = null;
    this.touched = [];       // elements we've added anim classes to
    this._codeOpen = false;
  }
  var P = Bar.prototype;

  P.init = function () {
    if (!document.getElementById("gmAnimBarStyles")) {
      var st = document.createElement("style"); st.id = "gmAnimBarStyles"; st.textContent = STYLE;
      document.head.appendChild(st);
    }
    if (!document.getElementById("gmAnimBar")) {
      var d = document.createElement("div"); d.id = "gmAnimBar"; d.style.display = "none";
      document.body.appendChild(d);
      this.el = d;
    } else this.el = document.getElementById("gmAnimBar");
    var self = this;
    document.addEventListener("godEditorSelectionChanged", function (e) {
      var det = e.detail || {};
      self.sel = det.element || null;
      self.selInfo = { label: det.label || "", key: det.key || "", selector: det.selector || "" };
      self.cond = null; self.previewLabel = null; self._codeOpen = false;
      if (self.sel) { self.refresh(); self.show(); }
    });
  };
  P.show = function () { if (this.el) this.el.style.display = ""; };
  P.hide = function () { if (this.el) this.el.style.display = "none"; };

  P._bank = function (type) { return BANK[type] || BANK["default"]; };

  P.refresh = function () {
    if (!this.el) return;
    try { this._render(); } catch (e) { console.warn("[AnimBar]", e); }
  };

  P._render = function () {
    var el = this.el; el.innerHTML = "";
    if (!this.sel) { el.style.display = "none"; return; }
    var type = classify(this.sel);
    var bank = this._bank(type);
    if (!this.cond || !bank[this.cond]) this.cond = DEFAULT_COND[type] && bank[DEFAULT_COND[type]] ? DEFAULT_COND[type] : Object.keys(bank)[0];
    var self = this;

    var name = this.selInfo && this.selInfo.label || (this.sel.dataset && this.sel.dataset.name) || this.sel.tagName.toLowerCase();
    var head = document.createElement("div");
    head.className = "gmAnimRow gmAnimHead";
    head.innerHTML = "<b>Animation Ideas</b> — Selected: <i>" + esc(name) + "</i> · " + type;
    el.appendChild(head);

    // condition select
    var row = document.createElement("div"); row.className = "gmAnimRow";
    var sel = document.createElement("select"); sel.className = "gmAnimSelect";
    CONDITIONS.forEach(function (c) {
      var o = document.createElement("option"); o.value = c; o.textContent = c;
      if (c === self.cond) o.selected = true;
      // dim conditions with no dedicated ideas (still selectable → falls back)
      sel.appendChild(o);
    });
    sel.addEventListener("change", function () { self.cond = sel.value; self._render(); });
    row.appendChild(sel);
    el.appendChild(row);

    // chips
    var chips = document.createElement("div"); chips.className = "gmAnimChips";
    var ideas = bank[this.cond] || BANK["default"][this.cond] || BANK["default"]["On Idle"];
    ideas.forEach(function (label) {
      var b = document.createElement("button");
      b.className = "gmAnimChip" + (self.previewLabel === label ? " previewing" : "");
      if (self.sel && self.sel.getAttribute("data-gm-anim") === (self.cond + ":" + label)) b.className += " applied";
      b.textContent = label;
      b.addEventListener("click", function () { self.preview(label); });
      chips.appendChild(b);
    });
    el.appendChild(chips);

    // action buttons
    var actions = document.createElement("div"); actions.className = "gmAnimRow gmAnimActions";
    actions.appendChild(this._btn("Preview", function () { if (self.previewLabel) self.preview(self.previewLabel); }));
    actions.appendChild(this._btn("Apply", function () { self.apply(); }));
    actions.appendChild(this._btn("Reset", function () { self.resetElement(); }));
    actions.appendChild(this._btn("▸ Copy Code", function () { self._codeOpen = !self._codeOpen; self._render(); }));
    el.appendChild(actions);

    if (this._codeOpen && this.previewLabel) el.appendChild(this._codeBox(this.previewLabel));
  };

  P._btn = function (txt, fn) { var b = document.createElement("button"); b.className = "gmAnimBtn"; b.textContent = txt; b.addEventListener("click", fn); return b; };

  P._baseClass = function (label) { return "gmAnim-" + resolve(label); };

  P.preview = function (label) {
    if (!this.sel) return;
    this.previewLabel = label;
    var cls = this._baseClass(label);
    // strip any prior gmAnim-* then replay
    this._stripAnim(this.sel);
    void this.sel.offsetWidth; // reflow
    this.sel.classList.add(cls);
    this._track(this.sel);
    this._render();
  };

  P.apply = function () {
    if (!this.sel || !this.previewLabel) return;
    this.sel.setAttribute("data-gm-anim", this.cond + ":" + this.previewLabel);
    this._track(this.sel);
    this._render();
  };

  P.resetElement = function () {
    if (!this.sel) return;
    this._stripAnim(this.sel);
    this.sel.removeAttribute("data-gm-anim");
    this.previewLabel = null;
    this._render();
  };

  P._stripAnim = function (el) {
    if (!el || !el.classList) return;
    Array.prototype.slice.call(el.classList).forEach(function (c) { if (c.indexOf("gmAnim-") === 0) el.classList.remove(c); });
  };
  P._track = function (el) { if (this.touched.indexOf(el) < 0) this.touched.push(el); };

  P._codeBox = function (label) {
    var base = resolve(label);
    var cls = "anim-" + kebab(label);
    var kf = camel(label);
    var loop = LOOPERS[base] ? " infinite" : " 1";
    var dur = LOOPERS[base] ? "2s" : ".55s";
    // pull the raw keyframe body from STYLE by mapping base->gmAnim keyframes
    var kfName = "gmAnim" + base.charAt(0).toUpperCase() + base.slice(1);
    var kfBody = extractKeyframes(kfName);
    var css = "@keyframes " + kf + " " + kfBody + "\n." + cls + "{animation:" + kf + " " + dur + " ease" + loop + ";}";
    var js = "function play" + pascal(label) + "(el){\n  el.classList.remove('" + cls + "');\n  void el.offsetWidth;\n  el.classList.add('" + cls + "');\n}";
    var snippet = "el.classList.add('" + cls + "');";

    var box = document.createElement("div"); box.className = "gmAnimCode";
    var pre = document.createElement("pre"); pre.textContent = css + "\n\n" + js; box.appendChild(pre);
    var row = document.createElement("div"); row.className = "gmAnimRow";
    var self = this;
    row.appendChild(this._btn("Copy CSS", function () { copy(css, self); }));
    row.appendChild(this._btn("Copy JS", function () { copy(js, self); }));
    row.appendChild(this._btn("Copy Full", function () { copy(css + "\n\n" + js, self); }));
    row.appendChild(this._btn("Apply Snippet", function () { copy(snippet, self); }));
    box.appendChild(row);
    var toast = document.createElement("div"); toast.className = "gmAnimToast"; toast.id = "gmAnimToast"; box.appendChild(toast);
    return box;
  };

  function copy(text, self) {
    U.copyText(text).then(function () {
      var t = document.getElementById("gmAnimToast");
      if (t) { t.textContent = "✓ copied"; setTimeout(function () { if (t) t.textContent = ""; }, 1400); }
    });
  }

  function extractKeyframes(name) {
    var re = new RegExp("@keyframes\\s+" + name + "\\s*(\\{[\\s\\S]*?\\}\\s*\\})");
    var m = STYLE.match(re);
    return m ? m[1] : "{0%{}100%{}}";
  }

  function esc(s) { return String(s == null ? "" : s).replace(/[<>&]/g, function (c) { return c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"; }); }

  P.clearAll = function () {
    var self = this;
    this.touched.forEach(function (el) { try { self._stripAnim(el); el.removeAttribute("data-gm-anim"); } catch (e) {} });
    this.touched = [];
    this.sel = null; this.selInfo = null; this.cond = null; this.previewLabel = null; this._codeOpen = false;
    if (this.el) { this.el.innerHTML = ""; this.el.style.display = "none"; }
  };

  global.GodModeAnimationBar = Bar;
})(window);
