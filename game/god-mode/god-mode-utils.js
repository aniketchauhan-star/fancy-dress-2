/* god-mode-utils.js — shared primitives for the Balancing Act God Mode suite.
   Loaded FIRST; every other god-mode module depends on window.GodModeUtils.
   Everything here is read-only / non-destructive and works in stage space
   (the engine's fixed 1920x1080 design grid, scaled to the viewport by #stage). */
(function (global) {
  "use strict";

  var REF_W = 1920, REF_H = 1080;

  function isTypingInField(e) {
    var t = e && (e.target || e.srcElement);
    if (!t) return false;
    var tag = (t.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if (t.isContentEditable) return true;
    return false;
  }

  function copyText(text) {
    text = text == null ? "" : String(text);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () { return fallbackCopy(text); });
    }
    return Promise.resolve(fallbackCopy(text));
  }
  function fallbackCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  function isVisible(el) {
    if (!el) return false;
    var cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    if (parseFloat(cs.opacity) < 0.02) return false;
    // engine hides nodes with style.display = 'none'; also treat that
    if (el.style && el.style.display === "none") return false;
    var r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    return true;
  }

  function getStage() {
    return document.getElementById("stage") || document.body;
  }

  function stageScale() {
    var stage = getStage();
    if (!stage) return 1;
    var w = stage.getBoundingClientRect().width;
    return w > 0 ? w / REF_W : 1;
  }

  function stageRectOf(el) {
    if (!el) return { x: 0, y: 0, w: 0, h: 0 };
    var r = el.getBoundingClientRect();
    var s = getStage().getBoundingClientRect();
    var sc = stageScale() || 1;
    return {
      x: (r.left - s.left) / sc,
      y: (r.top - s.top) / sc,
      w: r.width / sc,
      h: r.height / sc
    };
  }

  function qa(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function fmt(n) { return Math.round(n * 100) / 100; }

  global.GodModeUtils = {
    REF_W: REF_W, REF_H: REF_H,
    isTypingInField: isTypingInField,
    copyText: copyText,
    isVisible: isVisible,
    getStage: getStage,
    stageScale: stageScale,
    stageRectOf: stageRectOf,
    qa: qa, qsa: qsa, fmt: fmt
  };
})(window);
