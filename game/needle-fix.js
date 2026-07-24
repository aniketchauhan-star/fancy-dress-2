(function () {
  "use strict";

  const SELECTOR = '#stage [data-name="needle"]';
  const MAX_ANGLE = 40;
  const SMOOTH_SPEED = 3;

  let needle = null;
  let currentBalance = 0;
  let targetBalance = 0;
  let previousTime = 0;
  let animationFrame = 0;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function getNeedle() {
    // The scene contains one needle per level; only the active level's needle is visible.
    // Always drive the visible one (a plain first-match would target a hidden level).
    const list = document.querySelectorAll(SELECTOR);
    for (let i = 0; i < list.length; i++) {
      if (list[i].offsetParent !== null) {
        needle = list[i];
        return needle;
      }
    }
    needle = list[0] || null; // fallback (e.g. everything hidden at boot)
    return needle;
  }

  function applyLayout() {
    const element = getNeedle();
    if (!element) return false;

    Object.assign(element.style, {
      position: "absolute",
      left: "calc(50% - 43.5px)",
      top: "100px",
      width: "87px",
      height: "97px",
      transformOrigin: "50% 62%",
      willChange: "transform",
      pointerEvents: "none"
    });

    return true;
  }

  function render() {
    const element = getNeedle();
    if (!element) return;

    /*
      Needle points toward the HEAVIER side:
      balance -1 (item heavier, too few blocks) = needle -40deg (leans to item side)
      balance  0 (balanced)                     = needle 0deg
      balance +1 (too many blocks)              = needle +40deg (leans to blocks side)
    */
    const angle = MAX_ANGLE * currentBalance;

    element.style.transform =
      `rotate(${angle.toFixed(3)}deg) scale(1)`;
  }

  function animate(time) {
    if (!previousTime) previousTime = time;

    const deltaSeconds = Math.min(
      (time - previousTime) / 1000,
      0.05
    );

    previousTime = time;

    // Matches Unity:
    // Mathf.Lerp(current, target, Time.deltaTime * 3)
    const amount = Math.min(
      1,
      deltaSeconds * SMOOTH_SPEED
    );

    currentBalance +=
      (targetBalance - currentBalance) * amount;

    if (
      Math.abs(targetBalance - currentBalance) < 0.0005
    ) {
      currentBalance = targetBalance;
      render();

      previousTime = 0;
      animationFrame = 0;
      return;
    }

    render();
    animationFrame = requestAnimationFrame(animate);
  }

  function setBalance(value, immediate = false) {
    applyLayout();

    targetBalance = clamp(Number(value) || 0, -1, 1);

    if (immediate) {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }

      animationFrame = 0;
      previousTime = 0;
      currentBalance = targetBalance;
      render();
      return;
    }

    if (!animationFrame) {
      animationFrame = requestAnimationFrame(animate);
    }
  }

  function setFromCounts(cubeCount, correctCubeCount) {
    const correct = Number(correctCubeCount);

    if (!Number.isFinite(correct) || correct <= 0) {
      console.error(
        "correctCubeCount must be greater than zero."
      );
      return;
    }

    const difference = Number(cubeCount) - correct;

    const balance = clamp(
      difference / correct,
      -1,
      1
    );

    setBalance(balance);
  }

  function reset() {
    // The item begins in the left pan with zero blocks.
    setBalance(-1, true);
  }

  window.ScaleNeedle = {
    applyLayout,
    setBalance,
    setFromCounts,
    reset
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      reset,
      { once: true }
    );
  } else {
    reset();
  }
})();
