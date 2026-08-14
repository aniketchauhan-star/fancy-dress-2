/* ============================================================================
   THE STORY NIGHT — flipbook behaviour.
   Diagnostic first: surface any REAL JavaScript error on screen (a silent error
   would stop the click handlers from ever attaching). Image / video / network
   load failures are ignored — they have no .message and are handled per-element.
   ============================================================================ */
window.addEventListener("error", function (ev) {
  if (!ev || !ev.message) return;                 // ignore resource-load errors
  var b = document.getElementById("__jsErr");
  if (!b) {
    b = document.createElement("div");
    b.id = "__jsErr";
    b.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:100000;" +
      "background:#b00020;color:#fff;font:13px/1.5 monospace;padding:10px;white-space:pre-wrap";
    (document.body || document.documentElement).appendChild(b);
  }
  b.textContent = "⚠ JavaScript error (this is likely why the book won't open):\n" +
    ev.message + "\n" + (ev.filename || "") + " : line " + ev.lineno;
});

// If you can read this line in the console, the script parsed with NO syntax
// error and you are running the CURRENT file (not a cached copy).
console.log("%c✅ [The Story Night] loaded — 3D flipbook · full-bleed pages · speech bubbles.",
            "font-weight:bold;color:#7d5fd0;font-size:13px");

/* ============================================================================
   ██  EDIT YOUR CONTENT HERE  ██
   ----------------------------------------------------------------------------
   Every entry below is ONE page of the book, shown in order after the cover.

     • type   : "video"  → a full-page video (e.g. assets/1.webm)
                "image"  → a full-page picture (e.g. assets/3 page.webp)
     • src    : the media file for that page.
     • delay  : (video only, optional) milliseconds to wait after landing on the
                page before the video starts (e.g. delay: 3000 → starts after 3s).
                Omit / 0 → the video starts instantly.

   Add / remove / reorder pages freely — the flip engine and the "Page X / N"
   counter update automatically.
   ============================================================================ */
// Nine video pages + the embedded Balancing Act game after page 8. Each video
// page has a matching first-frame poster in assets/posters/ so the scene shows
// instantly. Add / remove / reorder pages freely — the flip engine and the
// "Page X / N" counter update automatically.
// Videos are WebM (VP9 + Opus) — plays in Chrome/Edge/Firefox and Safari 14.1+
// (VP9 support arrived in Safari 14.1 desktop / iOS 17.4 in-app). Converted from
// the original H.264 MP4s at ~60% smaller with no visible quality loss.
const pages = [
  { type: "video", src: "assets/1.webm" },   // 1 — opening video
  { type: "video", src: "assets/2.webm" },   // 2
  { type: "video", src: "assets/3.webm" },   // 3
  { type: "video", src: "assets/4.webm" },   // 4
  { type: "video", src: "assets/5.webm" },   // 5
  { type: "video", src: "assets/6.webm" },   // 6
  { type: "video", src: "assets/7.webm" },   // 7
  { type: "video", src: "assets/8.webm" },   // 8
  // 9 — the embedded Balancing Act game (lives in game/, shown via the overlay
  // iframe; the leaf itself shows the game's intro artwork while the page turns).
  { type: "lbd",
    src: "game/index.html",
    poster: "game/assets/img/Generated_Image_March_27__2026_-_1_07PM_1__2_.webp" },
  { type: "video", src: "assets/9.webm" },   // 10
  { type: "end" },                           // 11 — THE END page (cream) + Replay
];

/* ============================================================================
   ██  END OF EDITABLE CONTENT — engine below (no need to change) ██
   ============================================================================ */

/* ---- Build one page face's media (image OR video OR lbd poster) ---------- */
function makeMedia(page) {
  // "lbd" pages show a STILL poster on the leaf itself (seen while the page turns);
  // the live, interactive game is a separate full-screen-capable overlay iframe
  // (see the LBD OVERLAY section below) — it can't live inside the 3D-transformed
  // leaf because CSS transforms trap position:fixed, so true fullscreen would fail.
  if (page.type === "lbd") {
    const img = document.createElement("img");
    img.className = "page-media";
    img.draggable = false;
    img.addEventListener("dragstart", function (e) { e.preventDefault(); });
    img.decoding = "async";
    img.src = page.poster || "";
    img.alt = "Balancing Act — tap Let's Go to play";
    return img;
  }
  const media = page.type === "video"
    ? document.createElement("video")
    : document.createElement("img");
  media.className = "page-media";
  media.draggable = false;                           // never let the image "ghost-drag" out
  media.addEventListener("dragstart", function (e) { e.preventDefault(); });
  media.src = page.src;
  if (page.type === "video") {
    media.loop = false;
    media.playsInline = true;
    media.setAttribute("playsinline", "");            // iOS Safari inline playback
    media.setAttribute("webkit-playsinline", "");
    // FIRST-FRAME POSTER: the page surface (--paper) is deep night-blue, so a video
    // that hasn't painted a frame yet (still buffering, or autoplay was blocked) would
    // show as a BLANK dark-blue page. The poster is that clip's own frame 0, so the
    // scene shows INSTANTLY and — because it equals where playback starts — there's no
    // jump when the video then plays. Posters are tiny (~40KB) and live in assets/posters/.
    media.setAttribute("poster",
      page.src.replace(/^assets\//, "assets/posters/").replace(/\.webm$/i, ".webp"));
    // LAZY: do NOT eager-buffer. With 25 videos, preload="auto" made the browser
    // open + decode every clip on load (huge memory/CPU spike + open lag). We only
    // buffer the page you're on + the next one, on demand (see warmVideo()).
    media.preload = "none";
    // Tap the video to (re)start it WITH sound — a guaranteed user gesture, so
    // browsers that blocked the auto-start's audio will now allow it.
    media.addEventListener("click", function () {
      media.muted = false;
      try { if (media.ended) media.currentTime = 0; } catch (_) {}
      const p = media.play(); if (p && p.catch) p.catch(function () {});
    });
    // When THIS page's video FULLY finishes: mark the page WATCHED (which releases
    // the NEXT gate — permanently, so a revisit never re-locks it) and pulse the
    // forward arrow with a gold glow as a "turn the page" cue. The pulse fires ONCE
    // per page arrival (armBlink) so a short clip won't pulse repeatedly.
    media.addEventListener("ended", function () {
      const isCurrent = leaves[flipped] && leaves[flipped].contains(media);
      if (!isCurrent) return;                    // only the current page
      // Release the gate FIRST and unconditionally — this runs even when the guards
      // below bail out, so a page can never be left permanently un-turnable (the
      // media watchdog and the error path both come through here too).
      watched.add(flipped);
      updateProgress();                          // NEXT appears the instant it's earned
      if (!opened || !ready || lbdFullscreen || flipped >= totalPages - 1) return;
      // PAGE-FLIP TUTORIAL: 5s after THIS page's video finishes, start the hand /
      // ghost-flip nudge (see scheduleHintAfterVideo in the PAGE-TURN HINT section).
      if (typeof scheduleHintAfterVideo === "function") scheduleHintAfterVideo();
      if (!armBlink) return;                     // already pulsed for this visit
      armBlink = false;                          // one pulse per page arrival
      pulseNext();
    });
    // HARDENING — a media error must never strand a media-gated cue:
    //  1) if the preloader's blob: URL fails, revert ONCE to the original file
    //     URL (and file poster) and resume playback;
    //  2) an unrecoverable error releases the "video ended" UI path (arrow
    //     blink + tutorial) as if the clip had finished.
    media.addEventListener("error", function () {
      if (media.dataset.origSrc && /^blob:/.test(media.src || "")) {
        const wasCurrent = leaves[flipped] && leaves[flipped].contains(media);
        if (media.dataset.origPoster != null) media.setAttribute("poster", media.dataset.origPoster);
        media.src = media.dataset.origSrc;
        delete media.dataset.origSrc;
        try { media.load(); } catch (_) {}
        if (wasCurrent && opened && ready) playVideoNow(media);
        return;
      }
      media.dispatchEvent(new Event("ended"));
    });
  } else {
    media.decoding = "async";
    media.alt = page.alt || "story page";
  }
  return media;
}

/* (The two legacy speech-bubble builders — the cropped-PNG "bubble" and the SVG
   "sbub" — were removed: no page config uses them, and the PNG variant's artwork
   files were never shipped, so they could not render even if enabled.) */

/* ---- Build the pages (one CSS 3D "leaf" per entry) ---------------------- */
const flipbookEl  = document.getElementById("flipbook");
const pageStackEl = flipbookEl ? flipbookEl.querySelector(".page-stack") : null;   // right-side page stack
const flipScaleEl = document.getElementById("flipScale");
const coverScene  = document.getElementById("coverScene");
// ONE full 16:9 page per view (single display). page 1 = entry 1. The themed
// book frame forms the left spine/cover edge (always visible when open); pages
// flip normally. No two-page spread.
const totalPages = pages.length;
// Which leaf is the embedded LBD game (-1 if none). Used to show/hide the overlay.
const LBD_INDEX = pages.findIndex(function (p) { return p.type === "lbd"; });

// Each leaf is a full 16:9 page hinged on the LEFT spine:
//   • FRONT = the page's full-bleed image / video (+ its speech bubble, if any).
//   • BACK  = a BLANK parchment sheet (seen edge-on while the page turns).
const leaves = [];
pages.forEach(function (page, i) {
  const leaf = document.createElement("div");
  leaf.className = "leaf";

  const front = document.createElement("div");
  front.className = "face front";
  if (page.type === "end") {
    // THE END — a real final page (cream "paper") with a gold-plum title + Replay.
    front.classList.add("end-page");
    front.innerHTML =
      '<div class="end-page-inner">' +
        '<div class="end-title">THE&nbsp;END</div>' +
        '<button class="replay-btn" id="replayBtn" type="button" aria-label="Replay from the beginning">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true">' +
            '<path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>' +
          '</svg>' +
          '<span>Replay</span>' +
        '</button>' +
      '</div>';
  } else {
    front.appendChild(makeMedia(page));                       // full-bleed image / video
  }
  const curl = document.createElement("div");               // moving page-curl shading
  curl.className = "curl";
  front.appendChild(curl);

  const back = document.createElement("div");
  back.className = "face back";                             // blank reverse side (no content)

  leaf.appendChild(front);
  leaf.appendChild(back);
  flipbookEl.appendChild(leaf);
  leaves.push(leaf);
});

/* ---- State + element references ----------------------------------------- */
const bookStage  = document.getElementById("bookStage");
const book       = document.getElementById("book");
const bookPop    = document.getElementById("bookPop");
const bookFloat  = document.getElementById("bookFloat");
const cover      = document.getElementById("cover");
const hint       = document.getElementById("hint");
const cornerPrev  = document.getElementById("cornerPrev");
const cornerNext  = document.getElementById("cornerNext");
const replayBtn   = document.getElementById("replayBtn");   // lives on the THE END page (built above)
const homeBtn     = document.getElementById("homeBtn");

/* ==========================================================================
   LBD OVERLAY  —  the Stairway Shuffle game embedded as one page.
   The game lives in a body-level iframe (#lbdStage) so it can grow to true
   fullscreen (a transform on .flip-scale would otherwise trap position:fixed).
   • pre-LBD  : the overlay is sized/positioned OVER the current page rectangle,
                so the game's home screen looks like it's printed inside the book.
   • start    : the game posts {source:"lbd", type:"lbd-start"} → we expand the
                overlay to fill the whole screen.
   • end/skip : the game posts {source:"lbd", type:"lbd-complete"} → we shrink the
                overlay back into the page and auto-flip to the next page.
   ========================================================================== */
const lbdStage = document.getElementById("lbdStage");
const lbdFrame = document.getElementById("lbdFrame");
let lbdFullscreen = false;   // is the overlay expanded to full screen right now?
let lbdStarted    = false;   // has the child tapped Start at least once this visit?
let lbdCompleted  = false;   // has the game been FINISHED (or skipped) at least once?
                             // STICKY for the whole read: it's what releases NEXT on the
                             // game page, and coming back must never re-lock it.
let lbdWasOn      = false;   // was the overlay showing on the previous refresh?
let lbdExiting    = false;   // guard so "complete" only advances once

// Show the blurred pre-LBD backdrop inside the frame while the game is loading
// (and while it's unloaded) so there is no dark flash — it matches the game's
// own splash background, so the live home screen fades in seamlessly.
if (lbdFrame && LBD_INDEX >= 0 && pages[LBD_INDEX].poster) {
  lbdFrame.style.background = "#0a0f2d url('" + pages[LBD_INDEX].poster + "') center/cover no-repeat";
}
// Load the game into the iframe. Safe to do while the overlay is hidden: the
// Balancing Act build is SILENT until its "Let's Go" button is tapped (unlike
// the old Stairway Shuffle, which autoplayed its title VO on load), so we warm
// it in the background and landing on the game page is instant.
function ensureLbdLoaded() {
  if (LBD_INDEX < 0 || !lbdFrame || lbdFrame.dataset.loaded) return;
  lbdFrame.src = pages[LBD_INDEX].src;
  lbdFrame.dataset.loaded = "1";
}
// BACKGROUND WARM-UP — boot the iframe during browser idle time. Called by the
// PRELOADER once it finishes (see the PRELOADER section): at that point every
// game file is already in the HTTP cache, so this boot is instant, silent, and
// never double-downloads. The game's own embed-bridge.js then primes its audio
// elements from the same cache. requestIdleCallback where available, setTimeout
// fallback for Safari.
function warmLbdInBackground() {
  if (LBD_INDEX < 0 || !lbdFrame || lbdFrame.dataset.loaded) return;
  if ("requestIdleCallback" in window) requestIdleCallback(ensureLbdLoaded, { timeout: 6000 });
  else setTimeout(ensureLbdLoaded, 2000);
}
// Reset the game so the NEXT visit starts fresh at the pre-LBD home screen.
// Tearing down to about:blank stops all game audio INSTANTLY; re-pointing at the
// game right after re-boots it silently in the background (from the browser's
// cache — every asset was already fetched), so a revisit is instant too.
function resetLbd() {
  if (!lbdFrame) return;
  lbdStarted = false;
  lbdFrame.src = "about:blank";
  lbdFrame.dataset.loaded = "";
  setTimeout(ensureLbdLoaded, 60);
}
/* The book's TARGET on-screen rectangle — computed from --book-scale, NOT read
   off .flip-scale with getBoundingClientRect().
   ⚠ WHY: .flip-scale now EASES between sizes (see the animated re-fit in
   styles.css), so mid-transition its live rect is a half-way value. Anything
   parked from that rect (the game overlay, the page-turn hint) would land in the
   wrong place and then sit there, because nothing re-reads it once the ease ends.
   .flip-scale is absolutely centred in .stage, which is never transformed — so
   its final box is exactly 1280×720 × scale, centred on .stage's centre. */
function bookRect() {
  const host = flipScaleEl.parentElement.getBoundingClientRect();   // .stage — untransformed
  const s = parseFloat(getComputedStyle(flipScaleEl).getPropertyValue("--book-scale")) || 0.5;
  const w = 1280 * s, h = 720 * s;
  return {
    left: host.left + host.width  / 2 - w / 2,
    top:  host.top  + host.height / 2 - h / 2,
    width: w, height: h,
    right: host.left + host.width / 2 + w / 2,
  };
}
// Park the overlay exactly over the on-screen page rectangle (pre-LBD look).
function positionLbdStage() {
  if (!lbdStage) return;
  const r = bookRect();                            // the scaled 1280×720 page area
  lbdStage.style.left   = r.left   + "px";
  lbdStage.style.top    = r.top    + "px";
  lbdStage.style.width  = r.width  + "px";
  lbdStage.style.height = r.height + "px";
}
let lbdAnimTimer = null;
function setLbdFullscreen(on) {
  if (!lbdStage) return;
  lbdFullscreen = on;
  positionLbdStage();                        // make the inline page-rect geometry current
  lbdStage.classList.add("lbd-anim");        // turn the box-morph transition ON for this toggle
  void lbdStage.offsetWidth;                 // commit, so the class change below animates from here
  lbdStage.classList.toggle("fullscreen", on);   // expand to / shrink from full screen
  document.body.classList.toggle("lbd-fullscreen", on);
  updateProgress();                              // the gate just changed → re-evaluate NEXT
  clearTimeout(lbdAnimTimer);
  lbdAnimTimer = setTimeout(function () { lbdStage.classList.remove("lbd-anim"); }, 460);
}
// Show the overlay once we've fully landed on the game page, and reset it the
// moment we leave. The iframe was already warmed in the background (the game is
// silent until "Let's Go" is tapped, so preloading can't leak audio) — landing
// here just reveals the ready-to-play intro screen instantly.
function updateLbdOverlay() {
  if (LBD_INDEX < 0 || !lbdStage) return;
  const onLbd = opened && ready && !animating && flipped === LBD_INDEX;
  if (onLbd) {
    ensureLbdLoaded();                    // safety net — normally already warmed in the background
    if (!lbdFullscreen) positionLbdStage();
    lbdStage.classList.add("visible");
    lbdStage.setAttribute("aria-hidden", "false");
    lbdWasOn = true;
  } else if (!lbdFullscreen) {           // never hide mid-game (we can't leave while fullscreen)
    lbdStage.classList.remove("visible");
    lbdStage.setAttribute("aria-hidden", "true");
    if (lbdWasOn) {
      lbdWasOn = false;
      resetLbd();                         // unload → stops all game audio immediately + fresh next visit
    }
  }
}
// Game finished (or the temporary Skip was tapped): come back into the page, then
// automatically turn to the next page.
function exitLbd() {
  if (lbdExiting) return;
  lbdExiting = true;
  lbdCompleted = true;                    // releases NEXT on the game page, for good
  setLbdFullscreen(false);                // shrink the game back into the page
  setTimeout(function () {
    lbdExiting = false;
    if (flipped === LBD_INDEX) goNext();  // auto-advance to the next story page
  }, 470);                                // just after the shrink transition (.4s)
}
// Listen for the game's messages (start → fullscreen, complete → advance).
window.addEventListener("message", function (e) {
  const d = e && e.data;
  if (!d || d.source !== "lbd") return;
  if (d.type === "lbd-start") { lbdStarted = true; setLbdFullscreen(true); }
  else if (d.type === "lbd-complete") { exitLbd(); }
});

let opened = false;      // has the cover been opened?
let ready  = false;      // has the cover FINISHED opening? (flips allowed only then)
let flipped = 0;         // how many leaves are currently turned to the left
let animating = false;   // guard so a new turn can't start mid-flip
const FLIP_MS = 1150;    // keep in sync with --flip-ms in styles.css
const COVER_OPEN_MS = 6000;  // keep in sync with the coverOpen animation in styles.css
const CLOSE_SETTLE_MS = 560;  // keep in sync with the bookSettle animation in styles.css
const COVER_CLOSE_MS  = 2000; // Home/Replay: cover swings shut (reverse open); sync with coverClose in styles.css
let _openTimer = null;   // pending "cover finished opening" timer
let _homeTimer = null;   // pending "cover finished closing → back to the cover" timer

/* ---- Responsive: scale the FIXED 1280x720 book to fit the viewport --------
   ORIGINAL fit — 96% of width / 84% of height — so the book size and the arrows
   (which stay at the viewport's bottom corners, via CSS) look exactly as before.
   The ONLY addition is a safeguard on SHORT screens: never let the book grow so
   tall that it covers the bottom controls. That safeguard changes nothing on
   normal/large screens (there the 0.84 factor is the smaller of the two); it only
   shrinks the book a little on small screens so the arrows + progress stay visible.
   Only this CSS transform scale changes, so the paper curl is never distorted. */
/* The nav buttons' live box + inset, MIRRORING the CSS clamps in the NAV CONTROL
   SET block of styles.css:
     box   = clamp(84px, 10vw, 124px)
     inset = clamp(12px, 2.5vw, 34px)        ← the wider (arrow) inset of the two
   ⚠ IF THE CSS CLAMPS CHANGE, CHANGE THESE IN THE SAME COMMIT. fitScale() uses
     them to reserve the buttons' horizontal footprint so the artwork can never
     end up sitting underneath a control. */
function navMetrics() {
  const vw = window.innerWidth;
  return {
    btnW: Math.min(124, Math.max(84, vw * 0.10)),    // clamp(84px, 10vw, 124px)
    btnX: Math.min(34,  Math.max(12, vw * 0.025)),   // clamp(12px, 2.5vw, 34px)
  };
}
function fitScale() {
  const CTRL = 64;                                   // min top/bottom room kept for the controls
  const nav = navMetrics();
  // Narrower of: the old 88%-of-width breathing space, and the width left over
  // once BOTH bottom-corner buttons (+6px of clearance) are reserved.
  const availW = Math.min(window.innerWidth * 0.88,
                          window.innerWidth - 2 * (nav.btnW + nav.btnX + 6));
  const availH = Math.min(window.innerHeight * 0.80, window.innerHeight - CTRL * 2);
  const s = Math.min(availW / 1280, availH / 720);
  flipScaleEl.style.setProperty("--book-scale", s.toFixed(4));
  // keep the page-turn hint glued to the forward arrow when the viewport changes
  if (flipHint && flipHint.classList.contains("show")) positionFlipHint();
}

/* ---- Render / stacking for the CSS leaf flip ---------------------------- */
// A TURNED leaf sits to the left (rotateY -180deg, showing its blank back over
// the cover); an UN-turned leaf lies flat on top of the cover. z-index keeps the
// current (top un-turned) page in front, and stacks more-recently turned leaves
// above earlier ones on the left pile.
function updateZ() {
  leaves.forEach(function (leaf, i) {
    leaf.style.zIndex = (i < flipped) ? (200 + i) : (100 - i);
  });
}
function renderLeaves() {
  leaves.forEach(function (leaf, i) {
    if (i < flipped) leaf.classList.add("flipped");
    else             leaf.classList.remove("flipped");
  });
  updateZ();
  windowLeaves();
}
/* GPU WINDOWING — every leaf is a composited 3D layer; with all 11 alive at
   once the GPU texture budget can overflow and the browser EVICTS textures,
   making pages paint blank intermittently on real machines. Only leaves near
   the current spread stay rendered; everything guaranteed-occluded (deep in
   the turned pile on the left or the un-turned stack on the right) releases
   its layer via visibility:hidden + will-change:auto. ±2 keeps the previous
   page, the current one, and the sheet a drag-curl can reveal all live.
   Re-run on every navigation (renderLeaves is called on each turn/reset). */
function windowLeaves() {
  leaves.forEach(function (leaf, i) {
    const near = Math.abs(i - flipped) <= 2;
    leaf.style.visibility = near ? "" : "hidden";
    leaf.style.willChange = near ? "" : "auto";
  });
}

/* ---- Per-page media -----------------------------------------------------
   Play the CURRENT page's video (pause every other), and pop the current page's
   speech bubble in ONCE, only after the page has fully settled. Called after
   each flip completes and once the cover has finished opening. */
let mediaDelayTimer = null;   // pending "start this video after N ms" timer
let mediaDelayIdx = -1;       // which page that pending timer belongs to
let lastMediaIdx = -1;        // last page refreshMedia handled (to arm the blink once)
let armBlink = false;         // allow the video-end arrow blink ONCE per page arrival
let mediaWatchdog = null;     // per-page timer that releases video-gated cues if 'ended' never fires

function playVideoNow(v) {
  try {
    v.preload = "auto";                       // make sure it's buffering before we play
    if (v.ended) v.currentTime = 0;
    v.muted = false;                          // try WITH sound (primed in the Play gesture)
    const p = v.play();
    if (p && p.catch) p.catch(function () { v.muted = true; v.play().catch(function () {}); });
  } catch (_) {}
}

/* Buffer ONE page's video on demand (only the current + next page are ever
   warmed, so we never spin up all 25 decoders at once). */
function warmVideo(i) {
  const leaf = leaves[i];
  if (!leaf) return;
  const v = leaf.querySelector("video.page-media");
  if (v && v.preload !== "auto") { v.preload = "auto"; try { v.load(); } catch (_) {} }
}

/* Unlock ONE page's video for instant, sound-enabled playback: a muted
   play()→pause() done INSIDE a user gesture. We prime only the page being shown
   and the next one — priming all 25 at once was the opening lag. */
function primeVideo(i) {
  const leaf = leaves[i];
  if (!leaf) return;
  const v = leaf.querySelector("video.page-media");
  if (!v || v.dataset.primed) return;
  v.dataset.primed = "1";
  try {
    v.muted = true; v.preload = "auto";
    const p = v.play();                       // start within the gesture → element is "activated"
    if (p && p.catch) p.catch(function () {});
    v.pause();                                // pause synchronously
    v.currentTime = 0;
  } catch (_) {}
}

function refreshMedia() {
  const idx = flipped;                         // the front-most page right now
  if (idx !== lastMediaIdx) { lastMediaIdx = idx; armBlink = true; }   // arm the video-end blink once per page
  // Left the page a delayed video was counting down on? Cancel that countdown.
  if (mediaDelayTimer && mediaDelayIdx !== idx) {
    clearTimeout(mediaDelayTimer); mediaDelayTimer = null; mediaDelayIdx = -1;
  }
  // Buffer + gesture-unlock ONLY this page and the next (so the upcoming flip is
  // instant and keeps sound) — never all 25 videos at once.
  warmVideo(idx); warmVideo(idx + 1); primeVideo(idx + 1);
  // Pause every video that is NOT the current page.
  leaves.forEach(function (leaf, i) {
    if (i === idx) return;
    const v = leaf.querySelector("video.page-media");
    if (v) { try { v.pause(); } catch (_) {} }
  });
  // Start (or schedule) the current page's video.
  const cur = leaves[idx];
  const v = cur && cur.querySelector("video.page-media");
  if (v) {
    const delayMs = (pages[idx] && pages[idx].delay) ? pages[idx].delay : 0;
    if (delayMs > 0) {
      // Already playing this page, or already counting down for it → leave it alone
      // (so the flip-start + flip-end calls don't restart the 3s countdown).
      if (mediaDelayIdx === idx && (mediaDelayTimer || !v.paused)) { /* keep going */ }
      else {
        try { v.pause(); v.currentTime = 0; } catch (_) {}   // hold on the first frame
        mediaDelayIdx = idx;
        mediaDelayTimer = setTimeout(function () {
          mediaDelayTimer = null;
          if (flipped === idx) playVideoNow(v);               // only if still on this page
        }, delayMs);
      }
    } else {
      playVideoNow(v);                          // no delay → instant
    }
  }
  // WATCHDOG (hardening): the arrow blink + tutorial are gated on the video's
  // 'ended' event. Three reveal paths now exist: the event itself, the media
  // 'error' handler, and this timer — media duration + grace, re-armed on every
  // page arrival — so a silently-stalled clip can never strand the cue.
  clearTimeout(mediaWatchdog);
  if (v && flipped < totalPages - 1) {
    const durMs = (isFinite(v.duration) && v.duration > 0) ? v.duration * 1000 : 40000;
    const startDelay = (pages[idx] && pages[idx].delay) ? pages[idx].delay : 0;
    mediaWatchdog = setTimeout(function () {
      if (flipped !== idx || !opened || !ready) return;   // left the page — stand down
      if (!v.ended) v.dispatchEvent(new Event("ended"));  // release the gated cue
    }, startDelay + durMs + 4000);
  }
  updateLbdOverlay();                           // show/hide the embedded LBD game
  // Right-side page stack shrinks toward the end: 3 sheets → … → 0 on the last page.
  if (pageStackEl) pageStackEl.dataset.count = String(Math.max(0, Math.min(3, totalPages - 1 - flipped)));
  // Restart the idle → page-turn-hint countdown for the page we've just landed on
  // (uses the NEW `flipped`, so the delay is right: 5s on page 1, 10s afterwards).
  if (typeof resetIdleHint === "function") resetIdleHint();
}

/* ==========================================================================
   NAVIGATION  —  ONE pair of entry points, goPrev() / goNext().
   The corner buttons, the keyboard, the swipe/drag and every programmatic call
   (e.g. the game's auto-advance) all route through these, so they inherit the
   SAME guards. Do not add a second flip path.
   ========================================================================== */

/* Pages whose video has already run to the end — or was released by the media
   watchdog / error path. FIRST VISIT ONLY: a page in this set never gates NEXT
   again, so turning back shows BOTH arrows immediately and nobody is made to sit
   through the same clip twice. */
const watched = new Set();

/* CONTENT GATE — a page may HOLD the reader until its content releases them.
   Three gates, all of them FIRST-VISIT ONLY:
     • the game while it owns the whole screen (nothing else may run);
     • the game PAGE, until the game has been completed (or skipped) — the reader
       may not read past a game they haven't played;
     • a story page's video, until it has finished once (see `watched`).
   NEXT is both blocked AND hidden while this is true. */
function nextLocked() {
  if (lbdFullscreen) return true;                       // the game owns the screen
  if (LBD_INDEX >= 0 && flipped === LBD_INDEX) return !lbdCompleted;
  if (watched.has(flipped)) return false;               // been here, watched it → free
  const v = pageVideo();
  return !!(v && !v.ended);                             // still playing → hold
}

/* One-shot GOLD GLOW PULSE on the forward arrow, played the moment the video
   ends and NEXT appears: a couple of pulses to catch the eye, then the arrow
   settles back to its normal look. Purely a cue — the class removes itself. */
let _glowTimer = null;
function pulseNext() {
  if (!cornerNext || cornerNext.disabled) return;       // never pulse a hidden arrow
  cornerNext.classList.remove("glow-pulse");
  void cornerNext.offsetWidth;                          // restart the animation cleanly
  cornerNext.classList.add("glow-pulse");
  clearTimeout(_glowTimer);
  _glowTimer = setTimeout(function () { cornerNext.classList.remove("glow-pulse"); }, 2450);
}

/* Is there anywhere to go in `dir` (1 = forward, -1 = back)? This is what the
   BACK/NEXT buttons' VISIBILITY is derived from, so it deliberately ignores the
   transient mid-flip lock — otherwise both buttons would blink out and back on
   every page turn. */
function navAvailable(dir) {
  if (!opened || !ready) return false;                 // not open / cover still swinging
  if (lbdFullscreen) return false;                     // a fullscreen overlay is up
  if (dir === 1) {
    if (nextLocked()) return false;                    // this page's gate is still locked
    return flipped < totalPages - 1;                   // not already on THE END page
  }
  return flipped > 0;                                  // not already on the first page
}

/* The single guard set every turn must pass. */
function canTurn(dir) {
  if (animating) return false;                         // a page is already in flight
  return navAvailable(dir);
}

/* Shared flip visuals + timing. `fromDrag` = the leaf is already sitting at the
   dragged angle under an inline transform; we hand it back to the CSS transition
   so it animates from THERE to its resting angle. */
let _flipTimer = null;
function turnLeaf(leaf, fromDrag) {
  leaf.style.zIndex = 300;               // lift the turning sheet above everything
  leaf.classList.add("flipping");        // enables the moving curl shading
  if (fromDrag) {
    leaf.style.transition = "";          // re-enable the flip transition...
    void leaf.offsetWidth;               // ...and commit the dragged angle as its start
  }
  renderLeaves();
  if (fromDrag) leaf.style.transform = "";   // → animates dragged angle → resting angle
  refreshMedia();                        // START now → the target video plays INSTANTLY
                                          // (as the page is revealed, not after the flip)
  playFlip();
  updateProgress();
  clearTimeout(_flipTimer);
  _flipTimer = setTimeout(function () {
    leaf.classList.remove("flipping");
    leaf.classList.remove("unflipping");   // back-drag finished — re-arm the ghosting guard
    // Drop any inline transform WITHOUT re-animating: the .flipped class already
    // holds the final angle, so killing the transition for this swap stops the
    // leaf briefly swinging back (the "page reappears on the left" glitch).
    leaf.style.transition = "none";
    leaf.style.transform = "";
    void leaf.offsetWidth;                 // commit with no transition
    leaf.style.transition = "";            // restore for the next turn
    animating = false; updateZ(); updateProgress();
    refreshMedia();                      // re-assert once settled (idempotent safety net)
  }, FLIP_MS + 40);
}
function goNext(fromDrag) {
  if (!canTurn(1)) return false;
  animating = true;
  const leaf = leaves[flipped];                  // the page to turn
  flipped++;
  turnLeaf(leaf, fromDrag);
  return true;
}
function goPrev(fromDrag) {
  if (!canTurn(-1)) return false;
  animating = true;
  flipped--;
  turnLeaf(leaves[flipped], fromDrag);
  return true;
}

/* ---- Nav state — ONE owner for all three controls -----------------------
   HIDDEN, NOT GREYED: a dead control is never shown. Both .is-hidden and the
   `disabled` attribute are set, so the button also drops out of the tab order
   and can't be activated by a stray keypress. */
function setNavVisible(btn, visible) {
  if (!btn) return;
  btn.classList.toggle("is-hidden", !visible);
  btn.disabled = !visible;
}
function updateProgress() {
  const onLastPage = flipped >= totalPages - 1;              // THE END (has its own Replay)
  const closing    = document.body.classList.contains("is-closing");
  // HOME appears as soon as the cover OPENS (not after the open finishes) and
  // stays available for the whole read — it is never gated.
  setNavVisible(homeBtn,    opened && !closing && !onLastPage);
  // The arrows show exactly when they'd DO something — same predicate the turn
  // itself is guarded by, so a visible arrow is never a dead one.
  setNavVisible(cornerPrev, navAvailable(-1));
  setNavVisible(cornerNext, navAvailable(1));
}

/* ---- ⚠ NO BROWSER FULLSCREEN ON OPEN — DELIBERATE, DO NOT RE-ADD -----------
   Play used to call requestFullscreen(). That single call was the whole reason
   the open felt broken, and it caused THREE separate defects at once:
     1. The viewport resized the instant the cover started swinging, so fitScale()
        re-scaled the book mid-animation — the book visibly JUMPED size.
     2. The body's fixed-attachment gradient background repainted against the new
        viewport box → a visible FLICKER behind the book.
     3. Every browser overlays its own "Press Esc to exit full screen" /
        "Swipe down to exit" TOAST on entry. That is browser chrome: no web page
        can style, move or suppress it, so it always landed on top of the story.
   None of the three is fixable while the API is being called, so the call is
   gone. The reader can still go fullscreen themselves (F11 / the browser menu),
   and because the re-fit below is animated, that now glides too.
   ------------------------------------------------------------------------- */

/* ---- Open the 3D cover, then hand off to the page-turning book ----------
   Shared by the first open (openBook) AND Replay (replayBook), so the dramatic
   hinge-open + post-open setup are identical both times. */
function runOpenSequence() {
  ready = false;
  document.body.classList.remove("is-closing");
  document.body.classList.add("is-open");
  // The whole open motion IS the cover's own hinge — NO zoom / camera move.
  book.classList.remove("closing");
  book.classList.add("open");          // cover hinges open on the LEFT spine
  bookFloat.classList.add("rest");     // stop the idle bob
  coverScene.classList.remove("parked");
  flipbookEl.style.zIndex = "";        // cover ABOVE the pages while it swings open
  // Reveal the REAL page right away (it sits beneath the cover, masked by it).
  flipbookEl.classList.add("show");
  // A user gesture drives every open, so start audio here.
  soundOn();
  resumeAudio();
  playCoverFlip();
  playBgMusic();                        // start the looping background music
  primeVideo(0); primeVideo(1);         // unlock page 1 + 2 inside the gesture
  refreshMedia();                       // start the page-1 video right away
  // Once the cover has FULLY opened, park it, lift the pages above it, hand over
  // pointer events, and mark the book READY.
  clearTimeout(_openTimer);
  _openTimer = setTimeout(function () {
    coverScene.classList.add("parked");
    flipbookEl.style.zIndex = "5";        // pages now sit ABOVE the parked cover (z3)
    tapCatcher.style.pointerEvents = "none";
    flipbookEl.style.pointerEvents = "auto";
    ready = true;
    updateProgress();
    refreshMedia();
    resetIdleHint();
  }, COVER_OPEN_MS + 50);
  updateProgress();
}
function openBook() {
  console.log("[The Story Night] openBook() called — opened was:", opened);
  if (opened) return;
  if (!preloadDone) return;   // gate EVERY start path (tap, keyboard, programmatic) until 100% preloaded
  opened = true;
  // Land the book on its exact final size BEFORE the cover starts to swing, so
  // nothing can re-scale mid-open. If the viewport drifted while the reader sat on
  // the cover (mobile URL bar, a window resize), this is the one correction, and
  // dropping .scale-ready for a single frame makes it land INSTANTLY — on the
  // still-closed cover, where it's invisible — instead of gliding into the first
  // second of the swing. Everything here stays SYNCHRONOUS inside the click
  // handler: runOpenSequence() unlocks audio and starts the page-1 video, which
  // browsers only allow while the user gesture is still on the stack, so this must
  // never be deferred behind a timer / rAF.
  document.body.classList.remove("scale-ready");
  fitScale();
  void document.body.offsetWidth;               // commit the new scale with no transition
  document.body.classList.add("scale-ready");
  runOpenSequence();
}

/* ---- Reset the whole book to the START SCREEN: the CLOSED FRONT COVER + Play
   button, exactly like a fresh load (so tapping Play reads from the top). Shared
   by Replay and Home (called once the closing swing has finished). --------- */
function resetToStart() {
  // (No exitFullscreen() here on purpose — we never PUT the reader in fullscreen,
  //  so if they chose it themselves via F11 we must not yank them back out.)
  ready = false; opened = false; flipped = 0;
  renderLeaves();
  leaves.forEach(function (leaf) {
    var vv = leaf.querySelector("video.page-media");
    if (vv) { try { vv.pause(); vv.currentTime = 0; } catch (_) {} }
    // Wipe any leftover flip/drag state so a leaf can't come back mid-turn.
    leaf.classList.remove("flipping", "unflipping");
    leaf.style.transition = "none";
    leaf.style.transform = "";
    leaf.style.zIndex = "";
  });
  void flipbookEl.offsetWidth;                 // commit the wipe with no transition
  leaves.forEach(function (leaf) { leaf.style.transition = ""; });
  lastMediaIdx = -1;
  updateLbdOverlay();                          // safety: never leave the game overlay up on the cover
  document.body.classList.remove("is-open", "is-closing");
  book.classList.remove("open", "closing");
  coverScene.classList.remove("parked");
  cover.style.transform = "";                 // cover CLOSED → front cover + Play button showing
  flipbookEl.classList.remove("show");         // pages hidden behind the closed cover
  flipbookEl.style.zIndex = "";
  flipbookEl.style.pointerEvents = "none";
  bookFloat.classList.remove("rest");          // resume the idle bob
  tapCatcher.style.pointerEvents = "auto";     // Play is tappable again
  hideFlipHint(); clearTimeout(idleHintTimer); clearTimeout(nudgeHideTimer);
  stopBgMusic();                               // stop + rewind the music; restarts on Play
  updateProgress();                            // hides all three nav controls (not opened)
}

/* ---- CLOSE THE BOOK: the cover swings SHUT — the exact REVERSE of the opening
   hinge (cover −180 → 0) — and the book lands on the front cover. Shared by HOME
   (while reading) and REPLAY (from THE END page). `afterReset` runs once we're
   back on the cover. ------------------------------------------------------ */
function closeBookToCover(afterReset) {
  ready = false;                               // block flips during the close
  clearTimeout(_openTimer);
  clearTimeout(_homeTimer);
  clearTimeout(_flipTimer);                    // abandon a page turn still in flight
  animating = false;
  hideFlipHint(); clearTimeout(idleHintTimer); clearTimeout(nudgeHideTimer);
  if (cornerNext) cornerNext.classList.remove("blink", "glow-pulse");
  var v = currentVideo(); if (v) { try { v.pause(); } catch (_) {} }
  if (lbdFullscreen) setLbdFullscreen(false);  // never close out from under a fullscreen overlay
  updateLbdOverlay();                          // Home tapped ON the game page → hide + reset the game overlay
  // pages back UNDER the cover, so the closing cover sweeps over them
  flipbookEl.style.zIndex = "";
  flipbookEl.style.pointerEvents = "none";
  tapCatcher.style.pointerEvents = "none";
  coverScene.classList.remove("parked");
  // CLOSE — reverse of the opening hinge (cover swings from -180 back to 0).
  // is-closing keeps the current page bright (hides the dark thickness block) and
  // hides the turned-page pile, so the cover folds cleanly with no stray left page.
  document.body.classList.add("is-closing");
  updateProgress();                            // is-closing → all three controls hide now
  book.classList.remove("open");
  book.classList.add("closing");
  playCoverFlip();
  _homeTimer = setTimeout(function () {
    resetToStart();
    if (typeof afterReset === "function") afterReset();
  }, COVER_CLOSE_MS + 60);
}

/* ---- REPLAY (button on THE END page): close the book with the reverse-of-open
   swing, land on the front cover, and re-arm the title VO for another read. */
function replayBook() {
  if (!opened || animating) return;
  closeBookToCover(function () { _titleVoPlayed = false; playTitleVo(); });
}

/* ---- HOME: close the book (reverse of the opening swing) and land on the front
   cover. Only available while reading. ------------------------------------ */
function goHome() {
  // NEVER gated: HOME stays usable at every moment of the read, including mid-page-turn
  // (closeBookToCover abandons the in-flight flip) and on a gated page.
  if (!opened) return;                                               // nothing to close
  if (!ready) { clearTimeout(_openTimer); resetToStart(); return; }  // tapped mid-open → snap back to the cover
  closeBookToCover();
}

/* ==========================================================================
   INPUT  —  tap PLAY to OPEN the cover; once open, drag + corner arrows +
   keyboard drive the page flip.
   ========================================================================== */
const tapCatcher = document.getElementById("tapCatcher");

// The book opens ONLY from the play button. The tap-catcher still sits on top to
// block page gestures before opening, but it opens the book only when the tap
// lands inside the play button's (breathing) hit-circle — taps elsewhere on the
// cover do nothing.
function tapHitsPlay(e) {
  const r = hint.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const rad = Math.max(r.width, r.height) / 2;
  return Math.hypot(e.clientX - cx, e.clientY - cy) <= rad;
}
if (tapCatcher) tapCatcher.addEventListener("click", function (e) { if (!opened && tapHitsPlay(e)) openBook(); });
// Show the hand (pointer) cursor ONLY when hovering the play button — the sole CTA
// on the cover. Everywhere else on the tap surface stays a normal cursor.
if (tapCatcher) tapCatcher.addEventListener("mousemove", function (e) {
  tapCatcher.style.cursor = (!opened && tapHitsPlay(e)) ? "pointer" : "default";
});

// The play button itself (also covers keyboard: Enter/Space on the focused button).
hint.addEventListener("click", function (e) { e.stopPropagation(); if (!opened) openBook(); });


// Bottom-corner flip arrows (outside the book): back = left, forward = right.
cornerPrev.addEventListener("click", function (e) { e.stopPropagation(); goPrev(); this.blur(); });
cornerNext.addEventListener("click", function (e) { e.stopPropagation(); goNext(); this.blur(); });
if (replayBtn) replayBtn.addEventListener("click", function (e) { e.stopPropagation(); replayBook(); this.blur(); });
if (homeBtn) homeBtn.addEventListener("click", function (e) { e.stopPropagation(); goHome(); this.blur(); });

// Page interaction — DRAG TO TURN: grab the page and it follows your cursor,
// rotating about the spine, then SNAPS to the nearest state when you let go.
//   • drag LEFT  → turn the current page forward (it comes to rest on the cover)
//   • drag RIGHT → turn the previous page back
// A plain tap does nothing; the corner arrows + keyboard still work.
(function () {
  let startX = 0, startY = 0, pw = 1;
  let leaf = null, dir = 0, decided = false, dragging = false, curlEl = null;
  let lastX = 0, lastT = 0, vx = 0;                   // for flick (velocity) detection
  const DECIDE = 6;                                   // px before we commit to a drag
  const FLICK = 0.45;                                 // px/ms — a quick flick completes the turn
  const FINISH_DEG = 45;                              // turned this far (deg) → completes on release

  // how many degrees the drag has turned the page (0..180)
  function degFromDx(dx) { return Math.max(0, Math.min(180, Math.abs(dx) / pw * 180)); }
  // the live angle for the active leaf, given the raw horizontal travel
  function liveAngle(dx) {
    return (dir === 1) ? degFromDx(Math.min(0, dx))          // forward: leftward turns 0→180
                       : 180 - degFromDx(Math.max(0, dx));   // back: starts at 180, rightward → 0
  }

  flipbookEl.addEventListener("pointerdown", function (e) {
    if (!opened || !ready || animating || lbdFullscreen) return;
    startX = e.clientX; startY = e.clientY;
    lastX = e.clientX; lastT = e.timeStamp || performance.now(); vx = 0;
    decided = false; dragging = true; leaf = null; dir = 0; curlEl = null;
    pw = flipbookEl.getBoundingClientRect().width || 1;
  });

  flipbookEl.addEventListener("pointermove", function (e) {
    if (!dragging) return;
    const now = e.timeStamp || performance.now();
    const dt = now - lastT;
    if (dt > 0) vx = (e.clientX - lastX) / dt;         // running horizontal velocity
    lastX = e.clientX; lastT = now;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (!decided) {
      if (Math.abs(dx) < DECIDE || Math.abs(dx) <= Math.abs(dy)) return;   // wait for a clear horizontal drag
      // Same guard set as the buttons and the keyboard — a drag can never reach a
      // page the NEXT/BACK buttons refuse (gate locked, THE END, page 1, …).
      if (dx < 0 && canTurn(1))       { dir = 1;  leaf = leaves[flipped]; }     // turn forward
      else if (dx > 0 && canTurn(-1)) { dir = -1; leaf = leaves[flipped - 1]; } // turn back
      else { dragging = false; return; }                  // nothing to turn that way
      decided = true;
      leaf.style.transition = "none";                     // follow the finger exactly
      leaf.style.zIndex = 300;
      // Turning BACK a flipped leaf: its front-face children are hard-hidden
      // (GPU ghosting fix) — .unflipping re-shows them for the live drag.
      if (dir === -1) leaf.classList.add("unflipping");
      curlEl = leaf.querySelector(".curl");
      try { flipbookEl.setPointerCapture(e.pointerId); } catch (_) {}
    }
    const ang = Math.max(0, Math.min(180, liveAngle(dx)));
    leaf.style.transform = "rotateY(" + (-ang) + "deg)";
    if (curlEl) curlEl.style.opacity = (ang <= 90 ? ang / 90 : (180 - ang) / 90) * 0.9;
  });

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    const L = leaf, D = dir, C = curlEl;
    leaf = null; curlEl = null;
    if (!decided || !L) return;                           // a plain tap → nothing

    const ang = Math.max(0, Math.min(180, liveAngle(e.clientX - startX)));
    // Complete the turn if it's been dragged far enough OR flicked quickly in
    // the turn's direction — no need to drag all the way past halfway.
    const flick = (D === 1) ? (vx < -FLICK) : (vx > FLICK);
    const complete = (D === 1) ? (ang > FINISH_DEG || flick)
                               : (ang < 180 - FINISH_DEG || flick);
    if (C) C.style.opacity = "";

    // A COMPLETED drag is a real navigation, so it goes through the SAME
    // goNext/goPrev the buttons and the keyboard use — no duplicate flip logic,
    // every guard inherited. `true` tells turnLeaf the leaf is already sitting at
    // the dragged angle, so the CSS transition carries on from there.
    if (complete && ((D === 1) ? goNext(true) : goPrev(true))) return;

    // Not far enough (or a guard refused) → SNAP BACK. No page change, so this is
    // a cancelled gesture rather than a navigation: just release the leaf and let
    // the CSS transition carry it from the dragged angle to its resting angle.
    animating = true;
    L.style.transition = "";                              // restore the CSS flip transition
    void L.offsetWidth;                                   // reflow so it animates FROM the dragged angle
    L.classList.add("flipping");                          // curl shading during the snap
    L.style.transform = "";                               // → back to its resting angle
    clearTimeout(_flipTimer);
    _flipTimer = setTimeout(function () {
      L.classList.remove("flipping");
      L.classList.remove("unflipping");   // back-drag finished — re-arm the ghosting guard
      L.style.transition = "none";
      L.style.transform = "";
      void L.offsetWidth;                                 // commit with no transition
      L.style.transition = "";                            // restore for the next turn
      animating = false; updateZ(); updateProgress();
    }, FLIP_MS + 40);
  }
  flipbookEl.addEventListener("pointerup", endDrag);
  flipbookEl.addEventListener("pointercancel", endDrag);
})();

window.addEventListener("keydown", function (e) {
  if (e.key === "ArrowRight") { e.preventDefault(); opened ? goNext() : openBook(); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); goPrev(); }
  else if ((e.key === " " || e.key === "Enter") && !opened) { e.preventDefault(); openBook(); }
});

// Keep the canvas scaled to fit on resize / rotate.
// The book GLIDES to its new size (the eased transform on .flip-scale) instead of
// snapping, so a rotation, a window resize, the mobile URL bar retracting, or the
// reader hitting F11 all read as one smooth motion rather than a jump-cut.
let _resizeSettle = null;
function onViewportChange() {
  // Suppress the page-turn transitions while the viewport is actively changing, so
  // a rapid resize / resolution change can't make the book LOOK like it's auto-
  // flipping (the leaves re-render during the scale change). Restored once settled.
  document.body.classList.add("is-resizing");
  clearTimeout(_resizeSettle);
  _resizeSettle = setTimeout(function () { document.body.classList.remove("is-resizing"); }, 560);
  fitScale();
  // Re-park the LBD overlay over the (re-scaled) page — unless it's fullscreen,
  // where it already fills the viewport via CSS. .lbd-anim gives the overlay the
  // same easing as the book, so the two move together instead of the game snapping
  // to its new box while the book is still travelling.
  if (lbdStage && lbdStage.classList.contains("visible") && !lbdFullscreen) {
    lbdStage.classList.add("lbd-anim");
    positionLbdStage();                       // bookRect() = the TARGET box, not the in-flight one
    clearTimeout(lbdAnimTimer);
    lbdAnimTimer = setTimeout(function () { lbdStage.classList.remove("lbd-anim"); }, 460);
  }
}
window.addEventListener("resize", onViewportChange);
window.addEventListener("orientationchange", onViewportChange);

/* ---- Block ALL zoom (pinch, double-tap, ctrl+wheel, ctrl +/-) ------------
   The book is fixed-layout, so zoom would only break it. */
(function () {
  // Never let anything (esp. page images) start a native HTML5 drag — that was
  // showing a "ghost" of the image following the cursor during a page-flip drag.
  document.addEventListener("dragstart", function (e) { e.preventDefault(); });
  ["gesturestart", "gesturechange", "gestureend"].forEach(function (t) {   // iOS pinch
    document.addEventListener(t, function (e) { e.preventDefault(); }, { passive: false });
  });
  window.addEventListener("wheel", function (e) {                          // desktop ctrl+wheel
    if (e.ctrlKey) e.preventDefault();
  }, { passive: false });
  window.addEventListener("keydown", function (e) {                        // ctrl/⌘ +/-/0
    if ((e.ctrlKey || e.metaKey) && ["+", "-", "=", "0"].indexOf(e.key) !== -1) e.preventDefault();
    // Block "Save page" (Ctrl/⌘+S) — a casual way to grab the media.
    if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) e.preventDefault();
  });
  document.addEventListener("touchmove", function (e) {                    // 2-finger pinch
    if (e.touches && e.touches.length > 1) e.preventDefault();
  }, { passive: false });

  // NOTE: the right-click / context menu is intentionally LEFT ENABLED (so "Inspect"
  // and dev tools work). Casual image protection still stands via CSS — no drag,
  // no text-selection, no iOS long-press "Save Image" callout — plus Ctrl+S is blocked.
})();

/* ==========================================================================
   SOUND  —  one-shot SFX in sfx/: Page flip.ogg (every page flip) and
   cover page flip.ogg (the cover opening). Muted until the book is opened
   (a user gesture).
   (The old title voice-over "the story night.ogg" and looping "BG Music.mp3"
   referenced files that were never shipped — every load fired two 404s and
   played nothing. That dead code has been removed; playTitleVo/playBgMusic/
   stopBgMusic remain as no-ops so existing call sites stay valid.)
   ========================================================================== */
let muted = true;
let _titleVoPlayed = false;      // kept for the Replay flow's reset
function playTitleVo() {}        // no-op: title VO asset was never shipped
function playBgMusic() {}        // no-op: BG music asset was never shipped
// Paired with playBgMusic() and called by the Home / Replay teardown. If music is
// ever shipped, implement the stop + rewind HERE — resetToStart already calls it.
function stopBgMusic() {}        // no-op: BG music asset was never shipped

/* ---- Pause ALL audio when the tab / window goes to the background -----------
   Background music AND the current page's video (its voice-over) must stop the
   moment the reader switches tab or app, and resume when they come back — they
   were continuing to play in the background. Covers visibilitychange (tab switch),
   blur (other window), and pagehide (mobile app switch / bfcache). */
let _bgWasPlaying = false;
function currentVideo() {
  const leaf = leaves[flipped];
  return leaf ? leaf.querySelector("video.page-media") : null;
}
function pauseAllAudioFB() {
  const v = currentVideo();
  if (v && !v.paused) { v.dataset.wasPlaying = "1"; try { v.pause(); } catch (_) {} }
  if (audioCtx && audioCtx.state === "running") { try { audioCtx.suspend(); } catch (_) {} }
}
function resumeAllAudioFB() {
  if (document.hidden || !document.hasFocus()) return;   // only when truly back in front
  if (!opened) return;                                   // nothing plays before the book opens
  if (audioCtx && audioCtx.state === "suspended") { try { audioCtx.resume(); } catch (_) {} }
  const v = currentVideo();
  if (v && v.dataset.wasPlaying && !v.ended) { delete v.dataset.wasPlaying; const p = v.play(); if (p && p.catch) p.catch(function () {}); }
}
document.addEventListener("visibilitychange", function () {
  if (document.hidden) pauseAllAudioFB(); else resumeAllAudioFB();
});
window.addEventListener("blur", pauseAllAudioFB);
window.addEventListener("focus", resumeAllAudioFB);
window.addEventListener("pagehide", pauseAllAudioFB);

/* ---- One-shot SFX via Web Audio (glitch-free, zero-latency) --------------
   An <audio> element pays a real first-play init cost and can stutter on short
   one-shots — that was the cover-flip "lag/glitch". Instead we decode each SFX
   ONCE into an AudioBuffer and play it through a BufferSource: sample-accurate,
   no start latency. Any leading silence baked into the mp3 is auto-skipped (we
   start on the first audible sample). Buffers come from base64 data URIs
   (window.SFX_DATA in sfx-data.js) so they decode even on file://, where fetch()
   of a plain path is blocked. If Web Audio is unavailable we fall back to plain
   <audio> elements (the old behaviour). */
let audioCtx = null;
const sfxBuf = {};                          // name -> { buffer, offset (seconds) }

// Fallback <audio> elements — used ONLY if Web Audio fails to init or decode.
// preload="none": these rarely-used fallbacks must not download on every visit;
// the primary path decodes the inlined base64 (sfx-data.js) via Web Audio.
const flipSound = new Audio("sfx/Page%20flip.ogg");
flipSound.preload = "none";
const coverFlipSound = new Audio("sfx/cover%20page%20flip.ogg");
coverFlipSound.preload = "none";
coverFlipSound.volume = 0.35;

(function initSfx() {
  const AC = window.AudioContext || window.webkitAudioContext;
  const DATA = window.SFX_DATA || {};
  if (!AC || !DATA.cover) return;           // no Web Audio / no inlined data → fallback
  try { audioCtx = new AC(); } catch (_) { audioCtx = null; return; }
  function decode(name, uri) {
    fetch(uri).then(function (r) { return r.arrayBuffer(); })
      .then(function (a) { return audioCtx.decodeAudioData(a); })
      .then(function (buf) {
        // Skip any leading silence so playback starts right on the transient.
        const ch = buf.getChannelData(0), sr = buf.sampleRate, thr = 0.008;
        let first = 0;
        for (let i = 0; i < ch.length; i++) { if (Math.abs(ch[i]) > thr) { first = i; break; } }
        sfxBuf[name] = { buffer: buf, offset: Math.max(0, first / sr - 0.004) };
      })
      .catch(function () {});               // leave name unset → falls back to <audio>
  }
  decode("cover", DATA.cover);
  decode("flip", DATA.flip);
})();

// The audio context starts suspended until a user gesture. Resume it on the first
// pointer press (fires just BEFORE the open click) so the cover-flip sound, played
// a moment later, is instant. Capture phase, not once (cheap + always safe).
function resumeAudio() {
  if (audioCtx && audioCtx.state === "suspended") { try { audioCtx.resume(); } catch (_) {} }
}
document.addEventListener("pointerdown", resumeAudio, { capture: true });

// Play a decoded SFX buffer; returns false if Web Audio isn't ready (→ caller
// falls back to the <audio> element).
function playSfx(name, vol, rate) {
  const entry = sfxBuf[name];
  if (!audioCtx || !entry) return false;
  try {
    if (audioCtx.state === "suspended") audioCtx.resume();
    const src = audioCtx.createBufferSource();
    src.buffer = entry.buffer;
    if (rate) src.playbackRate.value = rate;
    const g = audioCtx.createGain();
    g.gain.value = (vol == null ? 1 : vol);
    src.connect(g).connect(audioCtx.destination);
    src.start(0, entry.offset || 0);        // start on the first audible sample
    return true;
  } catch (_) { return false; }
}

// Page-flip sound — snappy 1.5× on every ordinary flip.
function playFlip() {
  if (muted) return;                        // sound turns on when the book opens
  if (playSfx("flip", 1.0, 1.5)) return;    // Web Audio path
  try {                                     // fallback
    flipSound.currentTime = 0; flipSound.playbackRate = 1.5;
    const p = flipSound.play(); if (p && p.catch) p.catch(function () {});
  } catch (_) {}
}
// COVER-page flip sound — played ONLY when the cover opens (never on page flips).
function playCoverFlip() {
  if (muted) return;
  if (playSfx("cover", 0.35)) return;       // Web Audio path
  try {                                     // fallback
    coverFlipSound.currentTime = 0;
    const p = coverFlipSound.play(); if (p && p.catch) p.catch(function () {});
  } catch (_) {}
}
// Turn sound ON when the book is opened (a clear user gesture). Safe to call
// repeatedly.
function soundOn() {
  muted = false;                     // opening the book turns sound on
}


/* ==========================================================================
   PAGE-TURN HINT  —  guidance for readers who don't know how to turn the page.
   When idle, two cues fire together: a hand taps the forward arrow AND the page
   itself does a "ghost" half-flip (lifts toward the next page, then falls back).
   Timing: the tutorial appears 5s AFTER the page's video finishes playing; it then
   repeats every 9s while idle and is cancelled by any tap / key / flip. On pages
   with no video it falls back to an idle delay. Never on the last page or while the
   LBD game is open.
   ========================================================================== */
// The nudge is a HAND on the RIGHT side of the book — the emoji hand, built
// directly. (It used to try assets/hand-nudge.png first, but that art was never
// shipped, so every load fired a guaranteed 404 before swapping to the emoji.)
let flipHint = document.createElement("div");
flipHint.className = "flip-hint flip-hint--emoji";
flipHint.setAttribute("aria-hidden", "true");
flipHint.textContent = "👆";
document.body.appendChild(flipHint);

// Guidance timing: the tutorial's FIRST appearance is 5s after the page video
// ENDS (AFTER_VIDEO_MS). It then plays ONCE, disappears, and comes back every 9s.
// Any interaction resets it. idleDelay() is only the FALLBACK for pages with no
// video (the hint can't wait on a video that never plays).
const AFTER_VIDEO_MS = 5000;   // wait after the video finishes before the tutorial
function idleDelay() { return flipped === 0 ? 5000 : 10000; }
const NUDGE_SHOW_MS = 2000;    // how long one nudge stays on screen
const NUDGE_GAP_MS  = 9000;    // gap after it disappears before it plays again
let idleHintTimer = null;
let nudgeHideTimer = null;
let peeking = false;
let peekTimers = [];

function canShowHint() {
  if (!(opened && ready && !animating && !lbdFullscreen &&
        flipped < totalPages - 1 && flipped !== LBD_INDEX && !document.hidden)) return false;
  // Only guide AFTER the page's video finishes — never before it starts or while it
  // is still playing (also stops the hint firing mid-replay). See scheduleHintAfterVideo.
  const v = pageVideo();
  if (v && !v.ended) return false;
  return true;
}
function positionFlipHint() {
  if (!flipScaleEl) return;
  const r = bookRect();                                    // the book's on-screen rect
  const w = flipHint.offsetWidth || 80, h = flipHint.offsetHeight || 80;
  // Park the hand against the book's RIGHT edge, vertically centred — the side the
  // ghost flip lifts. The swipe animation moves it right→left from here.
  flipHint.style.left = Math.round(r.right - w - r.width * 0.05) + "px";
  flipHint.style.top  = Math.round(r.top + r.height * 0.5 - h / 2) + "px";
}
function showFlipHint() {
  if (!canShowHint()) return;
  positionFlipHint();
  flipHint.classList.add("show");
}
function hideFlipHint() {
  flipHint.classList.remove("show");
}

/* ---- GHOST PAGE-FLIP -------------------------------------------------------
   Lift the current page about halfway toward the next one, then let it fall back
   — a live demo that the page turns. Purely visual; cancelled the instant the
   reader interacts, so a real drag/flip takes over cleanly. */
function cancelPeek() {
  peekTimers.forEach(clearTimeout);
  peekTimers = [];
  if (!peeking) return;
  peeking = false;
  const leaf = leaves[flipped];
  if (leaf) {
    leaf.style.transition = ""; leaf.style.transform = ""; leaf.style.zIndex = "";
    const c = leaf.querySelector(".curl"); if (c) c.style.opacity = "";
  }
  updateZ();
}
function peekFlip() {
  if (peeking || !canShowHint()) return;
  const leaf = leaves[flipped];
  if (!leaf) return;
  peeking = true;
  const curl = leaf.querySelector(".curl");
  leaf.style.zIndex = 300;                               // lift above the rest while peeking
  leaf.style.transition = "transform 720ms cubic-bezier(0.33, 0, 0.2, 1)";
  void leaf.offsetWidth;                                 // commit so the lift animates from flat
  leaf.style.transform = "rotateY(-52deg)";              // turn toward the next page (~halfway)
  if (curl) curl.style.opacity = "0.85";                 // page-curl shading during the lift
  peekTimers.push(setTimeout(function () {               // ...then ease it back down
    leaf.style.transform = "rotateY(0deg)";
    if (curl) curl.style.opacity = "";
  }, 760));
  peekTimers.push(setTimeout(function () {               // clean up once settled
    leaf.style.transition = ""; leaf.style.transform = ""; leaf.style.zIndex = "";
    peeking = false; updateZ();
  }, 760 + 760));
}

// Play the nudge ONCE — hand swipe on the book's right + ghost page-flip + the
// right arrow blinks — hold ~2s, then hide and come back 9s later. Repeats while idle.
function triggerHint() {
  if (!canShowHint()) { idleHintTimer = setTimeout(triggerHint, NUDGE_GAP_MS); return; }
  showFlipHint();
  peekFlip();
  if (cornerNext) cornerNext.classList.add("blink");
  clearTimeout(nudgeHideTimer);
  nudgeHideTimer = setTimeout(function () {
    hideFlipHint();
    if (cornerNext) cornerNext.classList.remove("blink");
    idleHintTimer = setTimeout(triggerHint, NUDGE_GAP_MS);   // ...then again after 9s
  }, NUDGE_SHOW_MS);
}
// The <video> on the page we're currently reading (null on image / end pages).
function pageVideo() {
  const leaf = leaves[flipped];
  return leaf ? leaf.querySelector("video.page-media") : null;
}
// Called from a page video's "ended" event: (re)start the 5s countdown to the
// tutorial. Fires for replays too, so the hint always trails the video's end.
function scheduleHintAfterVideo() {
  hideFlipHint();
  cancelPeek();
  if (cornerNext) cornerNext.classList.remove("blink");
  clearTimeout(idleHintTimer);
  clearTimeout(nudgeHideTimer);
  idleHintTimer = setTimeout(triggerHint, AFTER_VIDEO_MS);
}
function resetIdleHint() {
  hideFlipHint();
  cancelPeek();
  if (cornerNext) cornerNext.classList.remove("blink");
  clearTimeout(idleHintTimer);
  clearTimeout(nudgeHideTimer);
  const v = pageVideo();
  // While this page's video is still playing, DON'T start a countdown — the tutorial
  // is armed by the video's "ended" event (5s after it finishes). If the video has
  // already finished, re-arm 5s from now. Pages with NO video fall back to idleDelay.
  if (v && !v.ended) return;
  idleHintTimer = setTimeout(triggerHint, v ? AFTER_VIDEO_MS : idleDelay());
}
// Any interaction cancels the nudge + restarts the countdown.
["pointerdown", "keydown", "wheel", "touchstart"].forEach(function (evt) {
  document.addEventListener(evt, resetIdleHint, { passive: true, capture: true });
});

/* ==========================================================================
   PRELOADER — fetch 100% of the experience (book videos, posters, art, SFX and
   the ENTIRE embedded game incl. its ?v= cache-busted files) behind a themed
   loading bar shown in the Play button's spot. The Play button pops in only
   when everything is local, so nothing ever buffers or lags mid-story.
   • Streaming readers → byte-accurate progress, weighted by real on-disk sizes
     (the manifest below is generated from the actual files) and refined with
     Content-Length. The bar only ever moves forward (monotonic).
   • Smallest-first queue (cover art + posters land in the first seconds),
     concurrency-limited to 5 so nothing starves.
   • FAILURE NEVER BLOCKS: a failed / stalled / aborted fetch (or file:// where
     fetch is blocked) counts as done and the element keeps its original src.
     Every transfer has an abort timeout.
   • Book videos + posters are swapped to blob: URLs (truly local); game files
     are fetched purely to warm the HTTP cache the iframe then boots from.
   ========================================================================== */
// [url, bytes, kind, pageNo] — generated from the deployed files' real sizes.
const PRELOAD_MANIFEST = [["assets/1.webm",2752430,"video",1],["assets/2.webm",619472,"video",2],["assets/3.webm",867799,"video",3],["assets/4.webm",636904,"video",4],["assets/5.webm",1669145,"video",5],["assets/6.webm",1789349,"video",6],["assets/7.webm",1297683,"video",7],["assets/8.webm",1201982,"video",8],["assets/9.webm",2782216,"video",9],["assets/posters/1.webp",27766,"poster",1],["assets/posters/2.webp",47972,"poster",2],["assets/posters/3.webp",24240,"poster",3],["assets/posters/4.webp",34160,"poster",4],["assets/posters/5.webp",30960,"poster",5],["assets/posters/6.webp",31096,"poster",6],["assets/posters/7.webp",19670,"poster",7],["assets/posters/8.webp",37566,"poster",8],["assets/posters/9.webp",58374,"poster",9],["assets/cover%20page.webp",87926,"img",0],["assets/play%20button.webp",7092,"img",0],["sfx/Page%20flip.ogg",22494,"audio",0],["sfx/cover%20page%20flip.ogg",8734,"audio",0],["game/index.html",1591,"game",0],["game/assets/fonts/LilitaOne-Regular.ttf",28092,"game",0],["game/css/style.css?v=8",5279,"game",0],["game/needle-fix.css?v=2",588,"game",0],["game/js/data.js",186748,"game",0],["game/js/sfx.js?v=8",7306,"game",0],["game/js/engine.js?v=8",24690,"game",0],["game/js/vo-sync.js?v=8",14636,"game",0],["game/js/controllers.js?v=8",69318,"game",0],["game/js/main.js",795,"game",0],["game/needle-fix.js?v=2",3671,"game",0],["game/js/embed-bridge.js",6669,"game",0],["game/assets/audio/7_blocks_is_more_than_5_blocks.ogg",25965,"game",0],["game/assets/audio/8_blocks_is_more_than_6_blocks.ogg",23901,"game",0],["game/assets/audio/Add_blocks_to_balance_the_book.ogg",19250,"game",0],["game/assets/audio/Add_blocks_to_balance_the_bottle.ogg",23673,"game",0],["game/assets/audio/Add_blocks_to_balance_the_doll.ogg",20802,"game",0],["game/assets/audio/Add_blocks_to_balance_the_mug.ogg",19565,"game",0],["game/assets/audio/Add_blocks_to_balance_the_pencil_box.ogg",25692,"game",0],["game/assets/audio/Add_blocks_to_balance_the_pumpkin.ogg",21415,"game",0],["game/assets/audio/Add_blocks_to_balance_the_teddy_bear.ogg",23134,"game",0],["game/assets/audio/Add_blocks_to_balance_the_watermelon.ogg",22847,"game",0],["game/assets/audio/Five_blocks_is_more_than_three_blocks.ogg",21848,"game",0],["game/assets/audio/Four_blocks_is_more_than_two_blocks.ogg",21638,"game",0],["game/assets/audio/Look_at_the_balance_carefully.ogg",16937,"game",0],["game/assets/audio/Now_add_blocks_to_balance_the_book.ogg",25570,"game",0],["game/assets/audio/Now_add_blocks_to_balance_the_bottel.ogg",25919,"game",0],["game/assets/audio/Now_add_blocks_to_balance_the_doll.ogg",24211,"game",0],["game/assets/audio/Now_add_blocks_to_balance_the_mug.ogg",23036,"game",0],["game/assets/audio/Now_add_blocks_to_balance_the_pencil_box.ogg",23831,"game",0],["game/assets/audio/Now_add_blocks_to_balance_the_pumpkin.ogg",24613,"game",0],["game/assets/audio/Now_add_blocks_to_balance_the_teddy_bear.ogg",26456,"game",0],["game/assets/audio/Now_add_blocks_to_balance_the_watermelon.ogg",26422,"game",0],["game/assets/audio/Oops_that_is_not_correct.ogg",17242,"game",0],["game/assets/audio/Remove_blocks_to_balance_the_book.ogg",18341,"game",0],["game/assets/audio/Remove_blocks_to_balance_the_bottle.ogg",17725,"game",0],["game/assets/audio/Remove_blocks_to_balance_the_doll.ogg",18180,"game",0],["game/assets/audio/Remove_blocks_to_balance_the_mug.ogg",18330,"game",0],["game/assets/audio/Remove_blocks_to_balance_the_pencil_box.ogg",21475,"game",0],["game/assets/audio/Remove_blocks_to_balance_the_pump-kin.ogg",19783,"game",0],["game/assets/audio/Remove_blocks_to_balance_the_teddy_bear.ogg",20209,"game",0],["game/assets/audio/Remove_blocks_to_balance_the_watermelon.ogg",21220,"game",0],["game/assets/audio/Select_a_balance.ogg",13235,"game",0],["game/assets/audio/Select_the_other_balance.ogg",15432,"game",0],["game/assets/audio/So__the_bottle_is_heavier_than_the_mug.ogg",25954,"game",0],["game/assets/audio/So_the_book_is_heavier_than_the_box.ogg",21123,"game",0],["game/assets/audio/So_the_pumpkin_is_heavier_than_the_watermelon.ogg",25221,"game",0],["game/assets/audio/So_the_teddy_bear_is_heavier_than_the_doll.ogg",23828,"game",0],["game/assets/audio/Tap_on_the_heavier_item.ogg",15263,"game",0],["game/assets/audio/That_is_correct.ogg",15043,"game",0],["game/assets/audio/The_Balancing_game__1_.ogg",23805,"game",0],["game/assets/audio/Try_again.ogg",13901,"game",0],["game/assets/audio/Weight_of_Pumpkin_is_equal_to_weight_of_8_blocks.ogg",30204,"game",0],["game/assets/audio/Weight_of_book_is_equal_to_weight_of_5_blocks.ogg",28775,"game",0],["game/assets/audio/Weight_of_bottle_is_equal_to_weight_of_four_blocks.ogg",30135,"game",0],["game/assets/audio/Weight_of_box_is_equal_to_weight_of_3_blocks.ogg",27464,"game",0],["game/assets/audio/Weight_of_mug_is_equal_to_weight_of_two_blocks.ogg",29957,"game",0],["game/assets/audio/Weight_of_teddy_bear_is_equal_to_weight_of_7_blocks.ogg",33294,"game",0],["game/assets/audio/Weight_of_watermelon_is_equal_to_weight_of_six_blocks.ogg",32091,"game",0],["game/assets/audio/btn.ogg",4543,"game",0],["game/assets/audio/weight_of_doll_is_equal_to_weight_of_five_blocks.ogg",31947,"game",0],["game/assets/audio/well_done.ogg",19310,"game",0],["game/assets/fonts/LilitaOne-Regular.ttf",28092,"game",0],["game/assets/img/01.webp",29128,"game",0],["game/assets/img/02.webp",28534,"game",0],["game/assets/img/Aerrow_LetsGo.webp",131010,"game",0],["game/assets/img/Aru_and_pari__Balancing_Act_kjswkdgvj_1.webp",4018,"game",0],["game/assets/img/Aru_and_pari__Balancing_Act_kjswkdgvj_6.webp",2438,"game",0],["game/assets/img/BTL_1.webp",15814,"game",0],["game/assets/img/Button_Blue__5_.webp",9678,"game",0],["game/assets/img/Button_Blue__6_.webp",29264,"game",0],["game/assets/img/Button_Blue__7_.webp",10626,"game",0],["game/assets/img/ChatGPT_Image_Apr_14__2026__03_04_17_PM__1_2.webp",11484,"game",0],["game/assets/img/ChatGPT_Image_Mar_12__2026__03_23_00_PM__1__1.webp",181552,"game",0],["game/assets/img/ChatGPT_Image_Mar_12__2026__03_23_00_PM__1__2.webp",59418,"game",0],["game/assets/img/ChatGPT_Image_Nov_21__2025__06_10_02_PM_2__1_.webp",10586,"game",0],["game/assets/img/Ellipse_43.webp",1074,"game",0],["game/assets/img/Generated_Image_March_24__2026_-_12_34PM_1.webp",28626,"game",0],["game/assets/img/Generated_Image_March_27__2026_-_1_07PM_1__2_.webp",108626,"game",0],["game/assets/img/Group.webp",6838,"game",0],["game/assets/img/Group1.webp",460,"game",0],["game/assets/img/Group_-_Copy.webp",456,"game",0],["game/assets/img/Group_166.webp",9552,"game",0],["game/assets/img/Group_453.webp",4834,"game",0],["game/assets/img/Group_4712.webp",14840,"game",0],["game/assets/img/Group_471__1_.webp",3358,"game",0],["game/assets/img/Group_494.webp",95856,"game",0],["game/assets/img/Group_495.webp",10056,"game",0],["game/assets/img/Group_515_01.webp",228818,"game",0],["game/assets/img/Group_515__1_.webp",25470,"game",0],["game/assets/img/Group_516.webp",32456,"game",0],["game/assets/img/Group_517.webp",32794,"game",0],["game/assets/img/Group_518.webp",233728,"game",0],["game/assets/img/Group_519.webp",34782,"game",0],["game/assets/img/Group_541.webp",8754,"game",0],["game/assets/img/Group_543.webp",235284,"game",0],["game/assets/img/Group_544.webp",37530,"game",0],["game/assets/img/Group_545.webp",34454,"game",0],["game/assets/img/Group_546.webp",28542,"game",0],["game/assets/img/Group_547.webp",27300,"game",0],["game/assets/img/Group_548.webp",28532,"game",0],["game/assets/img/Group_549.webp",55318,"game",0],["game/assets/img/Heavier.webp",758,"game",0],["game/assets/img/IMG_5014_1.webp",18172,"game",0],["game/assets/img/IMG_5017.webp",189850,"game",0],["game/assets/img/Lighter.webp",666,"game",0],["game/assets/img/MG.webp",5896,"game",0],["game/assets/img/Rectangle_90.webp",72786,"game",0],["game/assets/img/Rectangle_91.webp",6204,"game",0],["game/assets/img/Rectangle_91__1_.webp",214876,"game",0],["game/assets/img/Slide_16_9_-_625.webp",19278,"game",0],["game/assets/img/The_Fancy_Dress_Competition_-_1__10__1__1_.webp",23862,"game",0],["game/assets/img/The_Fancy_Dress_Competition_-_1__3__2.webp",4922,"game",0],["game/assets/img/The_picnic_day__Aniket_Chauhan___18__2.webp",13778,"game",0],["game/assets/img/Vector_10.webp",2450,"game",0],["game/assets/img/block_small.webp",4836,"game",0],["game/assets/img/block_small_normal.webp",2402,"game",0],["game/assets/img/book_h9ighlight.webp",44838,"game",0],["game/assets/img/bottle_highlight.webp",40364,"game",0],["game/assets/img/box_highlight.webp",169598,"game",0],["game/assets/img/doll_2_02.webp",221284,"game",0],["game/assets/img/doll_2_03.webp",221580,"game",0],["game/assets/img/doll_h.webp",24490,"game",0],["game/assets/img/doll_hn.webp",83378,"game",0],["game/assets/img/drag-hand.webp",5382,"game",0],["game/assets/img/frame_00_delay-0.02s.webp",3816,"game",0],["game/assets/img/green.webp",239408,"game",0],["game/assets/img/green_01.webp",248796,"game",0],["game/assets/img/green_02.webp",252718,"game",0],["game/assets/img/mug_highlight.webp",23946,"game",0],["game/assets/img/normal.webp",27128,"game",0],["game/assets/img/normal_02.webp",243640,"game",0],["game/assets/img/normal_03.webp",27998,"game",0],["game/assets/img/pumpkin_01.webp",34166,"game",0],["game/assets/img/pumpkin_01_1.webp",9322,"game",0],["game/assets/img/pumpkin_highlight.webp",13080,"game",0],["game/assets/img/teddy.webp",38186,"game",0],["game/assets/img/teddy_1.webp",93110,"game",0],["game/assets/img/teddy_highlight.webp",92938,"game",0],["game/assets/img/water_melon_01.webp",5398,"game",0],["game/assets/img/water_melon_highlight.webp",10044,"game",0],["game/assets/img/watermelon_01.webp",28748,"game",0]];

let preloadDone = false;
const preloadBlobs = {};                 // url -> blob: URL (book media only)

(function preloadAll() {
  const fill = document.getElementById("loadBarFill");
  const text = document.getElementById("loadBarText");
  const barEl = document.getElementById("loadBar");
  const entries = PRELOAD_MANIFEST.slice().sort(function (a, b) { return a[1] - b[1]; }); // smallest first
  let totalBytes = entries.reduce(function (s, e) { return s + e[1]; }, 0);
  let loadedBytes = 0;
  let shownPct = 0;                       // monotonic display value
  const CONCURRENCY = 5;
  const TRANSFER_TIMEOUT_MS = 120000;     // per-file hard abort so a stall can't wedge the bar

  function paint() {
    const real = totalBytes ? (loadedBytes / totalBytes) * 100 : 100;
    shownPct = Math.max(shownPct, Math.min(real, 100));
    const p = Math.floor(shownPct);
    if (fill) fill.style.width = shownPct.toFixed(1) + "%";
    if (text) text.textContent = "Loading… " + p + "%";
    if (barEl) barEl.setAttribute("aria-valuenow", String(p));
  }

  function fetchOne(entry) {
    const url = entry[0], expected = entry[1], kind = entry[2];
    let received = 0;
    const ctrl = ("AbortController" in window) ? new AbortController() : null;
    const killer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TRANSFER_TIMEOUT_MS);
    function settle() {                   // success OR failure: account ALL remaining bytes
      clearTimeout(killer);
      if (received < expected) { loadedBytes += (expected - received); paint(); }
    }
    return fetch(url, ctrl ? { signal: ctrl.signal } : {})
      .then(function (res) {
        if (!res.ok) throw new Error("http " + res.status);
        // Refine this file's weight with the server's real Content-Length.
        const cl = parseInt(res.headers.get("content-length") || "", 10);
        if (cl && cl !== expected) { totalBytes += (cl - expected); entry[1] = cl; }
        const want = entry[1];
        if (!res.body || !res.body.getReader) {
          return res.blob().then(function (b) { received = want; loadedBytes += want; paint(); return b; });
        }
        const reader = res.body.getReader();
        const chunks = [];
        function pump() {
          return reader.read().then(function (r) {
            if (r.done) return new Blob(chunks);
            chunks.push(r.value);
            received += r.value.length;
            loadedBytes += r.value.length;
            paint();
            return pump();
          });
        }
        return pump();
      })
      .then(function (blob) {
        settle();
        // Keep blob URLs only for the book's own media (videos + posters) — the
        // game boots inside its iframe from the now-warm HTTP cache.
        if (blob && (kind === "video" || kind === "poster")) {
          try { preloadBlobs[url] = URL.createObjectURL(blob); } catch (_) {}
        }
      })
      .catch(function () { settle(); });   // failed/aborted/file:// → counts as done, original src stays
  }

  function runQueue() {
    let idx = 0;
    function next() {
      if (idx >= entries.length) return Promise.resolve();
      const entry = entries[idx++];
      return fetchOne(entry).then(next);
    }
    const lanes = [];
    for (let i = 0; i < CONCURRENCY; i++) lanes.push(next());
    return Promise.all(lanes);
  }

  function finish() {
    if (preloadDone) return;
    preloadDone = true;
    shownPct = 100; loadedBytes = totalBytes; paint();
    // Swap the book's videos + posters onto their blob: URLs — "loaded" now truly
    // means local. Originals stay in dataset for the one-time error fallback.
    leaves.forEach(function (leaf, i) {
      const page = pages[i];
      if (!page || page.type !== "video") return;
      const v = leaf.querySelector("video.page-media");
      if (!v) return;
      const vb = preloadBlobs[page.src];
      const posterUrl = page.src.replace(/^assets\//, "assets/posters/").replace(/\.webm$/i, ".webp");
      const pb = preloadBlobs[posterUrl];
      if (pb) { v.dataset.origPoster = v.getAttribute("poster") || ""; v.setAttribute("poster", pb); }
      if (vb) { v.dataset.origSrc = page.src; v.src = vb; }
    });
    // Reveal Play (pop-in) — also unblocks openBook()'s own guard.
    document.body.classList.remove("is-loading");
    document.body.classList.add("is-ready");
    // NOW boot the game iframe: every one of its files is already in the HTTP
    // cache, so this is instant and never double-downloads.
    warmLbdInBackground();
  }

  paint();
  runQueue().then(finish).catch(finish);
  // Belt-and-braces: if something pathological wedges the whole queue, open the
  // gate anyway after 3 minutes — the book must never be unstartable.
  setTimeout(finish, 180000);
})();

/* ---- Boot ---------------------------------------------------------------- */
fitScale();                              // scale the fixed 1280x720 book to fit first
renderLeaves();                          // lay out the leaves (all on page 1 to start)
updateProgress();
// Arm the ANIMATED re-fit only AFTER the first fit has painted — otherwise the
// book would visibly grow from the 0.5 CSS fallback to its real size on load.
requestAnimationFrame(function () {
  requestAnimationFrame(function () { document.body.classList.add("scale-ready"); });
});
