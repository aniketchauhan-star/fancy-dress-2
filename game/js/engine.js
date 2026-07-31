/* engine.js — Unity uGUI → DOM runtime for "Fancy Dress 2".
   Reimplements CanvasScaler, RectTransform layout, uGUI Image/TMP, DOTween easing,
   coroutines, audio and simple particle effects. No external deps. */
(function (global) {
  "use strict";

  var CFG = global.CONFIG;
  var REF_W = CFG.canvasScaler.referenceW;   // 1920
  var REF_H = CFG.canvasScaler.referenceH;   // 1080
  var stage, root;
  var nodes = {};        // id -> {node, el, contentEl}
  var scale = 1;

  /* ---------------- easing (DOTween equivalents) ---------------- */
  var Ease = {
    Linear: function (t) { return t; },
    InQuad: function (t) { return t * t; },
    OutQuad: function (t) { return t * (2 - t); },
    InOutQuad: function (t) { return t < .5 ? 2 * t * t : -1 + (4 - 2 * t) * t; },
    InCubic: function (t) { return t * t * t; },
    OutCubic: function (t) { return (--t) * t * t + 1; },
    InOutCubic: function (t) { return t < .5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1; },
    InSine: function (t) { return 1 - Math.cos(t * Math.PI / 2); },
    OutSine: function (t) { return Math.sin(t * Math.PI / 2); },
    InOutSine: function (t) { return -(Math.cos(Math.PI * t) - 1) / 2; },
    OutBack: function (t) { var s = 1.70158; return 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2); },
    InBack: function (t) { var s = 1.70158; return t * t * ((s + 1) * t - s); },
    OutElastic: function (t) {
      if (t === 0 || t === 1) return t;
      var p = 0.3; return Math.pow(2, -10 * t) * Math.sin((t - p / 4) * (2 * Math.PI) / p) + 1;
    }
  };
  function ease(name, t) { var f = Ease[name] || Ease.Linear; return f(Math.max(0, Math.min(1, t))); }

  /* ---------------- rAF tick loop ---------------- */
  var tickers = [];
  var lastT = performance.now();
  function loop(now) {
    var dt = (now - lastT) / 1000; lastT = now;
    if (dt > 0.1) dt = 0.1;
    for (var i = 0; i < tickers.length; i++) { try { tickers[i](dt); } catch (e) { console.error(e); } }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  function onTick(fn) { tickers.push(fn); return fn; }

  /* ---------------- coroutine helpers ---------------- */
  function wait(sec) { return new Promise(function (r) { setTimeout(r, sec * 1000); }); }

  // token-based cancellable task group (replicates StopAllCoroutines / DOTween kill scoping)
  function TaskGroup() { this.token = { cancelled: false }; }
  TaskGroup.prototype.kill = function () { this.token.cancelled = true; this.token = { cancelled: false }; };
  TaskGroup.prototype.run = function (genFn) {
    var tok = this.token;
    return (async function () { try { await genFn(tok); } catch (e) { if (e !== "cancelled") console.error(e); } })();
  };
  function ck(tok) { if (tok && tok.cancelled) throw "cancelled"; }

  // tween: animate 0..1 over duration with ease, call fn(v) each frame. Cancellable via tok.
  function tween(duration, easeName, fn, tok) {
    return new Promise(function (resolve) {
      if (duration <= 0) { fn(1); return resolve(); }
      var start = performance.now();
      function step(now) {
        if (tok && tok.cancelled) return resolve();
        var t = (now - start) / (duration * 1000);
        if (t >= 1) { fn(1); return resolve(); }
        fn(ease(easeName, t));
        requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  }

  /* ---------------- audio ---------------- */
  var audioCache = {};
  function getAudio(src) {
    if (!src) return null;
    if (!audioCache[src]) { var a = new Audio(src); audioCache[src] = a; }
    return audioCache[src];
  }
  var currentVO = null;
  var voMuted = false;   // global voice-over mute (respects the game's sound settings)
  var oneShots = {};     // src -> small pool of elements for repeatable cues
  var AudioMgr = {
    play: function (src) { // like AudioSource.clip=; Play() — single VO channel
      this.stop();
      var a = getAudio(src); if (!a) return null;
      currentVO = a; a.currentTime = 0;
      a.muted = voMuted;
      a.playbackRate = 1; // never let slow-motion debug distort voice pitch
      var p = a.play(); if (p && p.catch) p.catch(function () { });
      return a;
    },
    stop: function () { if (currentVO) { try { currentVO.pause(); currentVO.currentTime = 0; } catch (e) { } currentVO = null; } },
    // Pause / resume the active VO channel WITHOUT resetting its position
    // (used by God Mode pause and by the sync controller).
    pause: function () { if (currentVO && !currentVO.paused) { try { currentVO.pause(); } catch (e) { } } },
    resume: function () { if (currentVO && currentVO.paused && !currentVO.ended) { currentVO.playbackRate = 1; var p = currentVO.play(); if (p && p.catch) p.catch(function () { }); } },
    isPlaying: function () { return currentVO && !currentVO.paused && !currentVO.ended; },
    current: function () { return currentVO; },
    setMuted: function (m) { voMuted = !!m; if (currentVO) currentVO.muted = voMuted; },
    isMuted: function () { return voMuted; },
    // One-shot (button click, "try again"): reuses a small pool per clip instead of cloning a new
    // <audio> element on every play, so repeated taps cannot pile up detached media elements.
    playOneShot: function (src) {
      if (voMuted || !src) return;
      var pool = oneShots[src];
      if (!pool) {
        var base = getAudio(src); if (!base) return;
        pool = oneShots[src] = [base];
      }
      var free = null;
      for (var i = 0; i < pool.length; i++) if (pool[i].paused || pool[i].ended) { free = pool[i]; break; }
      if (!free) {
        if (pool.length >= 3) return;            // already three of the same cue in flight: enough
        free = pool[0].cloneNode();
        pool.push(free);
      }
      free.muted = false;
      try { free.currentTime = 0; } catch (e) { }
      var p = free.play(); if (p && p.catch) p.catch(function () { });
    },
    duration: function (src) {
      return new Promise(function (res) {
        var a = getAudio(src); if (!a) return res(0);
        if (a.readyState >= 1 && a.duration) return res(a.duration);
        var done = false;
        function finish() { if (!done) { done = true; res(a.duration || 0); } }
        a.addEventListener("loadedmetadata", finish, { once: true });
        // A missing / 404 / undecodable clip fires 'error' — resolve at once (fall back to
        // the estimated duration) instead of stalling the typing flow for the full timeout.
        a.addEventListener("error", finish, { once: true });
        if (a !== currentVO) a.load(); // never call load() on the VO that's currently playing (it would abort it)
        setTimeout(finish, 1500); // safety: never hang the typing flow
      });
    }
  };

  /* ---------------- color ---------------- */
  function rgba(c) { return "rgba(" + Math.round(c[0] * 255) + "," + Math.round(c[1] * 255) + "," + Math.round(c[2] * 255) + "," + c[3] + ")"; }
  function isWhite(c) { return c[0] > 0.985 && c[1] > 0.985 && c[2] > 0.985; }

  /* ---------------- layout math ---------------- */
  // Compute one axis. Returns {start, size}. anchored if a0==a1.
  function axis(P, a0, a1, anchoredPos, sizeDelta, pivot, offMaxNeg) {
    if (Math.abs(a0 - a1) < 1e-6) {
      var size = sizeDelta;
      var start = a0 * P + anchoredPos - pivot * size;
      return { start: start, size: size };
    } else {
      // stretched: sizeDelta.x here is offset; anchoredPos is (offsetMin+offsetMax)/2 combined.
      // Unity: offsetMin = anchoredPos - sizeDelta*(pivot); offsetMax = anchoredPos + sizeDelta*(1-pivot)
      var offMin = anchoredPos - sizeDelta * pivot;
      var offMax = anchoredPos + sizeDelta * (1 - pivot);
      var left = a0 * P + offMin;
      var right = a1 * P + offMax;
      return { start: left, size: right - left };
    }
  }

  function layoutNode(node, el, parentW, parentH) {
    var ax = axis(parentW, node.anchorMin[0], node.anchorMax[0], node.anchoredPos[0], node.sizeDelta[0], node.pivot[0]);
    var ay = axis(parentH, node.anchorMin[1], node.anchorMax[1], node.anchoredPos[1], node.sizeDelta[1], node.pivot[1]);
    var w = Math.max(0, ax.size), h = Math.max(0, ay.size);
    var left = ax.start;
    // Y flip: Unity +y up. css top measured from parent top.
    var top = parentH - (ay.start + ay.size);
    el.style.left = left + "px";
    el.style.top = top + "px";
    el.style.width = w + "px";
    el.style.height = h + "px";
    var tf = "";
    if (node.rotZ) tf += "rotate(" + (-node.rotZ) + "deg) ";
    if (node.scale[0] !== 1 || node.scale[1] !== 1) tf += "scale(" + node.scale[0] + "," + node.scale[1] + ") ";
    el.style.transform = tf;
    el.style.transformOrigin = (node.pivot[0] * 100) + "% " + ((1 - node.pivot[1]) * 100) + "%";
    return { w: w, h: h };
  }

  /* ---------------- element build ---------------- */
  function build(node, parentW, parentH) {
    var el = document.createElement("div");
    el.className = "unode";
    el.dataset.id = node.id;
    el.dataset.name = node.name;
    var size = layoutNode(node, el, parentW, parentH);
    var c = node.components || {};

    // active
    if (!node.active) el.style.display = "none";

    // canvas group alpha / interactable
    if (c.canvasGroup) {
      el.style.opacity = c.canvasGroup.alpha;
      if (!c.canvasGroup.blocksRaycasts) el.style.pointerEvents = "none";
    }

    // image
    if (c.image && c.image.sprite && c.image.sprite.path) {
      applyImage(el, c.image);
    } else if (c.image) {
      // colored quad (no sprite) — e.g., containers; usually transparent
      if (!isWhite(c.image.colorSRGB) || c.image.colorSRGB[3] > 0) {
        // only paint if visible color; many are white a=1 with no sprite => leave transparent container
      }
    }

    if (c.image && c.image.raycast === false) el.style.pointerEvents = "none";

    // tmp text
    if (c.tmp) applyTMP(el, c.tmp, size);

    // particles marker
    if (c.particles) el.dataset.particles = "1";

    var reg = { node: node, el: el };
    nodes[node.id] = reg;

    // children
    for (var i = 0; i < node.children.length; i++) {
      var ch = build(node.children[i], size.w, size.h);
      el.appendChild(ch.el);
    }
    return { el: el, w: size.w, h: size.h };
  }

  function applyImage(el, img) {
    var path = img.sprite.path;
    var col = img.colorSRGB || [1, 1, 1, 1];
    el.dataset.sprite = path;
    if (isWhite(col)) {
      el.style.backgroundImage = "url('" + path + "')";
      el.style.backgroundRepeat = "no-repeat";
      el.style.backgroundPosition = "center";
      el.style.backgroundSize = img.preserveAspect ? "contain" : "100% 100%";
    } else {
      // tinted: use mask + solid color
      el.style.webkitMaskImage = "url('" + path + "')";
      el.style.maskImage = "url('" + path + "')";
      el.style.webkitMaskRepeat = el.style.maskRepeat = "no-repeat";
      el.style.webkitMaskPosition = el.style.maskPosition = "center";
      el.style.webkitMaskSize = el.style.maskSize = img.preserveAspect ? "contain" : "100% 100%";
      el.style.backgroundColor = "rgb(" + Math.round(col[0] * 255) + "," + Math.round(col[1] * 255) + "," + Math.round(col[2] * 255) + ")";
    }
    if (col[3] < 1) el.style.opacity = (el.style.opacity ? el.style.opacity * col[3] : col[3]);
  }

  function applyTMP(el, tmp, size) {
    el.classList.add("utext");
    var inner = document.createElement("div");
    inner.className = "utext-inner";
    inner.textContent = tmp.text || "";
    var col = tmp.colorSRGB || [1, 1, 1, 1];
    inner.style.color = rgba(col);
    inner.style.fontSize = (tmp.fontSize || 36) + "px";
    if (tmp.charSpacing) inner.style.letterSpacing = (tmp.charSpacing / 100 * (tmp.fontSize || 36)) * 0.01 + "em";
    // horizontal align: TMP HorizontalAlignmentOptions bit flags: 1 left,2 center,4 right,8 justify
    var jh = "center", ai = "center";
    var h = tmp.alignH;
    if (h === 1) jh = "flex-start"; else if (h === 4) jh = "flex-end"; else if (h === 2) jh = "center"; else jh = "center";
    var v = tmp.alignV; // 256 top,512 middle,1024 bottom
    if (v === 256) ai = "flex-start"; else if (v === 1024) ai = "flex-end"; else ai = "center";
    el.style.justifyContent = jh;
    el.style.alignItems = ai;
    inner.style.textAlign = (jh === "flex-start" ? "left" : jh === "flex-end" ? "right" : "center");
    if (tmp.fontStyle & 1) inner.style.fontWeight = "bold";
    el.appendChild(inner);
    el._tmpInner = inner;
    el._tmp = tmp;
  }

  /* ---------------- node API ---------------- */
  function get(id) { return nodes[id] ? nodes[id].el : null; }
  function getReg(id) { return nodes[id]; }
  function setActive(id, on) { var el = get(id); if (el) el.style.display = on ? "" : "none"; }
  function isActive(id) { var el = get(id); return el && el.style.display !== "none"; }
  function setAlpha(id, a) { var el = get(id); if (el) el.style.opacity = a; }
  function setText(id, t) { var el = get(id); if (el && el._tmpInner) el._tmpInner.textContent = t; }
  function getText(id) { var el = get(id); return el && el._tmpInner ? el._tmpInner.textContent : ""; }
  function setSprite(id, path, preserveAspect) {
    var el = get(id); if (!el || !path) return;
    // reset any tint mask, use plain image
    el.style.webkitMaskImage = el.style.maskImage = "";
    el.style.backgroundColor = "";
    el.style.backgroundImage = "url('" + path + "')";
    el.style.backgroundRepeat = "no-repeat";
    el.style.backgroundPosition = "center";
    el.style.backgroundSize = preserveAspect ? "contain" : "100% 100%";
  }
  function setImageAlpha(id, a) { var el = get(id); if (el) el.style.opacity = a; }
  function setInteractable(id, on) {
    var el = get(id); if (!el) return;
    el.dataset.interactable = on ? "1" : "0";
  }
  function onClick(id, fn) {
    var el = get(id); if (!el) return;
    el.style.cursor = "pointer";
    el.style.pointerEvents = "auto"; /* wired elements capture clicks even under decorative overlays */
    el.addEventListener("pointerdown", function (e) {
      if (el.dataset.interactable === "0") return;
      el.classList.add("pressed");
    });
    el.addEventListener("pointerup", function () { el.classList.remove("pressed"); });
    el.addEventListener("pointerleave", function () { el.classList.remove("pressed"); });
    el.addEventListener("click", function (e) {
      if (el.dataset.interactable === "0") return;
      e.stopPropagation();
      fn(e);
    });
  }
  // scale a node (localScale) preserving pivot origin
  function setScale(id, sx, sy) {
    var reg = nodes[id]; if (!reg) return;
    if (sy === undefined) sy = sx;
    var n = reg.node; var tf = "";
    if (n.rotZ) tf += "rotate(" + (-n.rotZ) + "deg) ";
    tf += "scale(" + sx + "," + sy + ")";
    reg.el.style.transform = tf;
    reg.el._scale = sx;
  }
  function getScale(id) { var reg = nodes[id]; return reg && reg.el._scale != null ? reg.el._scale : (reg && reg.node.scale ? reg.node.scale[0] : 1); }

  // world/screen center of a node in stage coords (unscaled reference space)
  function nodeCenterRef(id) {
    var el = get(id); if (!el) return null;
    var r = el.getBoundingClientRect(); var sr = stage.getBoundingClientRect();
    return { x: (r.left + r.width / 2 - sr.left) / scale, y: (r.top + r.height / 2 - sr.top) / scale };
  }

  /* ---------------- boot / scaling ---------------- */
  function computeScale() {
    var w = window.innerWidth, h = window.innerHeight;
    var sw = w / REF_W, sh = h / REF_H;
    // Fit-to-screen (contain): scale so the entire 1920×1080 stage is always
    // fully visible on any aspect ratio / device, letterboxing with the page
    // background. This replaces Unity's MatchWidthOrHeight (match=0.5), which
    // cropped the stage on non-16:9 screens (e.g. portrait phones).
    scale = Math.min(sw, sh);
    stage.style.transform = "translate(-50%,-50%) scale(" + scale + ")";
  }

  // "Please rotate your device" overlay for touch devices held in portrait.
  // The game is authored landscape-only (16:9); on a phone in portrait it would
  // letterbox down to an unusably small strip, so we prompt for landscape.
  function setupOrientation() {
    var ov = document.createElement("div");
    ov.id = "rotate-overlay";
    ov.innerHTML =
      '<div class="rotate-inner">' +
      '<div class="rotate-phone">📱</div>' +
      '<div class="rotate-text">Please rotate your device</div>' +
      '<div class="rotate-sub">This game plays best in landscape</div>' +
      '</div>';
    document.body.appendChild(ov);

    var mqCoarse = window.matchMedia ? window.matchMedia("(pointer: coarse)") : null;
    function isTouch() {
      return (mqCoarse && mqCoarse.matches) ||
        ("ontouchstart" in window) || navigator.maxTouchPoints > 0;
    }

    var wasShown = false;
    function update() {
      var portrait = window.innerHeight > window.innerWidth;
      var show = portrait && isTouch();
      ov.classList.toggle("show", show);
      if (show !== wasShown) {
        // Pause/resume the voice-over only on the transition so we don't fight
        // God Mode's own pause. AudioMgr.resume() no-ops on ended/unpaused clips.
        try { show ? AudioMgr.pause() : AudioMgr.resume(); } catch (e) { }
        wasShown = show;
      }
    }
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    update();
    global.__updateOrientation = update;
  }

  // A hidden tab stops requestAnimationFrame but not <audio>, so a narration would keep playing
  // while its text sat frozen, and the line would jump on return. Pausing the whole spoken line
  // (voice + reveal together) and resuming it on the way back keeps them in step.
  function setupVisibility() {
    document.addEventListener("visibilitychange", function () {
      var VO = global.VoiceTextSync;
      if (document.hidden) {
        if (VO && VO.pauseAll) VO.pauseAll(); else AudioMgr.pause();
        if (global.SFX && global.SFX.stop) global.SFX.stop();
      } else {
        if (VO && VO.resumeAll) VO.resumeAll(); else AudioMgr.resume();
      }
    });
  }

  function boot(layout) {
    stage = document.getElementById("stage");
    stage.style.width = REF_W + "px";
    stage.style.height = REF_H + "px";
    // Find Canvas root (overlay). Build canvas children directly into stage at reference size.
    var canvas = null;
    for (var i = 0; i < layout.length; i++) if (layout[i].name === "Canvas") canvas = layout[i];
    root = canvas;
    // build canvas children (canvas itself fills the stage)
    for (var j = 0; j < canvas.children.length; j++) {
      var built = build(canvas.children[j], REF_W, REF_H);
      stage.appendChild(built.el);
    }
    computeScale();
    window.addEventListener("resize", computeScale);
    window.addEventListener("orientationchange", computeScale);
    setupOrientation();
    setupVisibility();
  }

  /* ---------------- asset preloading ----------------
     Sprites are swapped in at runtime (the pan item changes with the learner's choice, cards
     flip to their correct/wrong art, blocks turn red). A background-image only starts
     downloading when the style is applied, so on a cold cache the art lands a beat AFTER the
     screen has already changed — the item appeared to "pop in late". Warming every sprite at
     boot removes that. VO clips are fetched metadata-only, which is all the text/voice sync
     needs to read a clip's true length (without it the reveal falls back to an estimate). */
  var warmed = {};
  function preloadImages(paths) {
    (paths || []).forEach(function (p) {
      if (!p || warmed[p]) return;
      var im = new Image(); im.src = p; warmed[p] = im;
    });
  }
  /* Fetch AND decode, resolving when the bitmap is ready to paint — a warmed-but-undecoded image
     still costs a frame the moment it is first shown. Resolves either way; a broken file must not
     hold a screen back (there is a hard cap in _warmAssets' caller). */
  function decodeImages(paths) {
    var jobs = (paths || []).filter(Boolean).map(function (p) {
      var im = warmed[p];
      if (!im || !im.src) { im = new Image(); im.src = p; warmed[p] = im; }
      if (im.decode) return im.decode().catch(function () { });
      if (im.complete) return Promise.resolve();
      return new Promise(function (res) {
        im.addEventListener("load", res, { once: true });
        im.addEventListener("error", res, { once: true });
      });
    });
    return Promise.all(jobs);
  }
  function preloadAudioMeta(paths) {
    (paths || []).forEach(function (p) {
      if (!p || warmed[p]) return;
      var a = getAudio(p); if (!a) return;
      a.preload = "metadata";
      warmed[p] = a;
      try { a.load(); } catch (e) { }
    });
  }

  /* ---------------- pop cue ----------------
     A short bounce on the thing the narration is naming right now (see VoiceTextSync cues).
     `origin` lets a caller bounce from the base — an item half-sunk in a pan should grow
     upward out of the bowl, not in both directions. The node's own inline transform-origin is
     saved and restored, and re-popping mid-bounce restarts cleanly. */
  var POP_MS = 500;
  function pop(idOrEl, opts) {
    var el = typeof idOrEl === "string" ? get(idOrEl) : idOrEl;
    if (!el) return;
    if (global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (el._popTimer) {
      clearTimeout(el._popTimer);
      el.classList.remove("vo-pop");
      void el.offsetWidth;                 // reflow, so the animation restarts
    }
    var origin = opts && opts.origin;
    if (origin) {
      if (el._popOrigin == null) el._popOrigin = el.style.transformOrigin;
      el.style.transformOrigin = origin;
    }
    el.classList.add("vo-pop");
    el._popTimer = setTimeout(function () {
      el.classList.remove("vo-pop");
      if (el._popOrigin != null) { el.style.transformOrigin = el._popOrigin; el._popOrigin = null; }
      el._popTimer = null;
    }, POP_MS + 40);
  }

  /* ---------------- effects ---------------- */
  function confetti(centerId) {
    // Cheer and burst start on the same frame: the sound is asked for here, and the first
    // transform is written in the same animation frame the pieces are added in.
    var cheered = global.SFX && global.SFX.celebrate ? global.SFX.celebrate() : false;
    var c = nodeCenterRef(centerId) || { x: REF_W / 2, y: REF_H / 2 };
    var colors = ["#ffd23f", "#ff6b6b", "#4ecdc4", "#a06cd5", "#3bceac", "#ff922b", "#f9f871"];
    var layer = document.createElement("div"); layer.className = "confetti-layer";
    stage.appendChild(layer);
    var LIFE = 1.6, N = 70, pieces = [];
    for (var i = 0; i < N; i++) {
      var p = document.createElement("div"); p.className = "confetti-piece";
      var ang = Math.random() * Math.PI * 2, spd = 300 + Math.random() * 520;
      p.style.left = c.x + "px"; p.style.top = c.y + "px";
      p.style.background = colors[i % colors.length];
      p.style.width = (8 + Math.random() * 10) + "px"; p.style.height = (10 + Math.random() * 14) + "px";
      layer.appendChild(p);
      pieces.push({ el: p, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd - 350, spin: 480 + Math.random() * 480 });
    }
    // ONE animation loop for the whole burst (it used to be one rAF per piece, i.e. 70 loops),
    // writing only transform and opacity so nothing triggers layout.
    var t0 = performance.now();
    (function step(nowMs) {
      var t = (nowMs - t0) / 1000;
      var fade = 1 - t / LIFE;
      for (var k = 0; k < pieces.length; k++) {
        var q = pieces[k];
        q.el.style.transform = "translate(" + (q.vx * t) + "px," + (q.vy * t + 700 * t * t) + "px) rotate(" + (t * q.spin) + "deg)";
        q.el.style.opacity = fade > 0 ? fade : 0;
      }
      if (t < LIFE) requestAnimationFrame(step);
      else if (layer.parentNode) layer.parentNode.removeChild(layer);   // no stray timer
    })(t0);
    return cheered;
  }

  global.Engine = {
    boot: boot, get: get, getReg: getReg, setActive: setActive, isActive: isActive,
    setAlpha: setAlpha, setText: setText, getText: getText, setSprite: setSprite,
    setImageAlpha: setImageAlpha, setInteractable: setInteractable, onClick: onClick,
    setScale: setScale, getScale: getScale, nodeCenterRef: nodeCenterRef,
    tween: tween, wait: wait, ease: ease, Ease: Ease,
    TaskGroup: TaskGroup, ck: ck, onTick: onTick,
    Audio: AudioMgr, confetti: confetti, pop: pop,
    preloadImages: preloadImages, decodeImages: decodeImages, preloadAudioMeta: preloadAudioMeta,
    nodes: nodes, stageEl: function () { return stage; }, applyImage: applyImage
  };
})(window);
