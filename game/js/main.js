/* main.js — boot the game */
(function () {
  "use strict";
  function start() {
    window.Engine.boot(window.LAYOUT);
    // hide the build/version watermark ("vMT_01_03") on the intro screen
    var _v = window.Engine.get("1596235935"); if (_v) _v.style.display = "none";
    var lm = new window.Game.LevelManager();
    lm.init();
    window.__LM = lm;
    // Analytics no-op hooks (preserve external contract from TrackingPlugin.jslib)
    ["quizAnswerSubmittedString", "cubeStageSubmitted", "waterFlowSubmitted",
      "SendLevelStart", "SendLevelComplete"].forEach(function (k) {
        if (typeof window[k] !== "function") window[k] = function () { };
      });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
