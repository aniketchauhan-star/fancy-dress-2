/* embed-bridge.js — flipbook ⇄ game handshake + idle-time asset preloader.
   Loaded LAST (after main.js). Two jobs:

   1. postMessage bridge (only when running inside the flipbook's iframe):
        • learner taps the intro "Let's Go" button → {source:"lbd", type:"lbd-start"}
          → the flipbook expands the game overlay to true fullscreen.
        • the last level's game-over flow finishes (final VO ends) →
          {source:"lbd", type:"lbd-complete"} → the flipbook shrinks the overlay
          back into the page and auto-turns to the next story page.

   2. Idle-time preloader (embedded AND standalone): the engine paints sprites as
      CSS background-images, and browsers do NOT fetch a background-image while
      its node is display:none — so every still-hidden level's art (and all VO
      clips, which the engine only creates on first play) would otherwise hit the
      network mid-gameplay. While the learner is still on the intro screen we walk
      LAYOUT + CONFIG for every "assets/…" path and warm them in small chunks via
      requestIdleCallback (setTimeout fallback for Safari), so spare browser
      cycles do the loading and gameplay never waits on the network. */
(function () {
  "use strict";

  var EMBEDDED = (function () {
    try { return window.parent && window.parent !== window; } catch (e) { return true; }
  })();
  function post(type) {
    if (!EMBEDDED) return;
    try { window.parent.postMessage({ source: "lbd", type: type }, "*"); } catch (e) {}
  }

  /* ---- 1a. "Let's Go" tap → lbd-start (flipbook goes fullscreen) ---------- */
  function hookStart() {
    var ba = (window.CONFIG && window.CONFIG.buttonAnimator) || {};
    var el = window.Engine && window.Engine.get && window.Engine.get(ba.goButton);
    if (!el) return;
    var started = false;
    // CAPTURE phase: the game's own click handler (registered earlier, bubble
    // phase) disables the button synchronously — by the time a bubble-phase
    // listener ran, dataset.interactable would already read "0" and the real
    // first tap would look disabled. Capture runs BEFORE that mutation, so the
    // guard sees the button's true pre-click state.
    el.addEventListener("click", function () {
      if (started || el.dataset.interactable === "0") return;
      started = true;
      post("lbd-start");
    }, true);
  }

  /* ---- 1b. game over → wait for the final VO → lbd-complete --------------- */
  function hookComplete() {
    if (!window.Game || !window.Game.Tut) return;
    var proto = window.Game.Tut.prototype;
    var orig = proto.showGameOverFlow;
    if (!orig) return;
    proto.showGameOverFlow = function () {
      var self = this, args = arguments;
      return Promise.resolve(orig.apply(self, args)).then(function () {
        // orig's last act is E.Audio.play(finalVO) — that clip is now "current".
        var done = false;
        function finish() {
          if (done) return; done = true;
          setTimeout(function () { post("lbd-complete"); }, 1200); // let the confetti land
        }
        var vo = window.Engine && window.Engine.Audio && window.Engine.Audio.current();
        if (vo && !vo.ended) {
          vo.addEventListener("ended", finish, { once: true });
          vo.addEventListener("error", finish, { once: true });
          setTimeout(finish, 20000);          // safety: never strand the learner
        } else {
          setTimeout(finish, 5000);           // VO missing / blocked → still return
        }
      });
    };
  }

  /* ---- 2. idle-time asset warmer ------------------------------------------ */
  // The two cube sprites are swapped in from controllers.js (not in data.js),
  // and the drag-hand hint gif comes from css — list those by hand.
  var EXTRA_ASSETS = [
    "assets/img/Group_471__1_.webp",
    "assets/img/Group_4712.webp",
    "assets/img/frame_00_delay-0.02s.webp",
    "assets/img/drag-hand.webp"
  ];

  function collectAssets() {
    var seen = {};
    var images = [], audio = [];
    function add(s) {
      if (typeof s !== "string" || s.indexOf("assets/") !== 0 || seen[s]) return;
      seen[s] = 1;
      if (/\.(ogg|mp3|wav|m4a)$/i.test(s)) audio.push(s);
      else if (/\.(webp|png|jpe?g|gif|svg)$/i.test(s)) images.push(s);
    }
    function walk(o, depth) {
      if (!o || depth > 12) return;
      if (typeof o === "string") { add(o); return; }
      if (typeof o !== "object") return;
      for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) walk(o[k], depth + 1);
    }
    walk(window.LAYOUT, 0);
    walk(window.CONFIG, 0);
    EXTRA_ASSETS.forEach(add);
    return { images: images, audio: audio };
  }

  function idle(fn) {
    if ("requestIdleCallback" in window) requestIdleCallback(fn, { timeout: 1500 });
    else setTimeout(fn, 220);                 // Safari fallback — still off the fast path
  }

  function startPreload() {
    var q = collectAssets();
    var imgs = q.images.slice(), clips = q.audio.slice();
    var holds = [];                            // keep Image refs alive until decoded

    function pump() {
      // ~3 images or 2 audio clips per idle slice — never a burst that could
      // compete with a running animation frame or the flipbook's videos.
      var n;
      if (imgs.length) {
        for (n = 0; n < 3 && imgs.length; n++) {
          var im = new Image();
          im.src = imgs.shift();
          holds.push(im);
        }
      } else if (clips.length) {
        for (n = 0; n < 2 && clips.length; n++) {
          var src = clips.shift();
          // duration() seeds the engine's own audioCache element and load()s it,
          // so the exact element that will later play is the one warmed here.
          try { window.Engine.Audio.duration(src); } catch (e) {}
          // Also pull the full file into the HTTP cache (metadata alone isn't
          // the whole clip). Fails harmlessly on file:// — the cached element
          // above still covers most of the gap there.
          try { fetch(src).catch(function () {}); } catch (e) {}
        }
      } else {
        return;                                // everything warmed — stop
      }
      idle(pump);
    }
    idle(pump);
  }

  function boot() {
    hookStart();
    hookComplete();
    // Give the intro screen's own paint + font a head start, then warm the rest.
    setTimeout(startPreload, 800);
  }

  if (document.readyState === "loading") {
    // main.js also boots on DOMContentLoaded and registered first, so the
    // engine is up before we run.
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
