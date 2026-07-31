# Fancy Dress 2 — Balancing Act (HTML/JS port)

A dependency-free, static-site reimplementation of the Unity game **Fancy Dress 2**
(scene `Lbd2.unity`). No Unity, no WebGL build, no frameworks, no build step.

## Run locally
Because everything is embedded (no `fetch`), you can open `index.html` directly
(`file://`), but a tiny static server avoids any browser quirks:

```bash
cd fancy-dress-2-web
python3 -m http.server 8000
# visit http://localhost:8000
```

## Deploy
Drag the folder into Vercel / Netlify, or host anywhere static. No config needed.

> Audio starts on the first user tap (the intro screen). This is intentional —
> browsers block autoplay until a user gesture, and the original plays the intro
> voice-over when the intro is tapped.

## What was ported
- **Scenes/objects:** the full `Canvas` hierarchy — Intro + 4 levels — rendered
  into the DOM with Unity instance IDs kept as `data-id`. 314 nodes.
- **Controllers (line-for-line):**
  - `ButtonAnimator` — pulsing "Let's go" intro button; reveals Level 1 on tap.
  - `WeightMeasuringGame` (×4) — cube add/remove, dynamic balance value, check
    (correct / too-few / too-many), wrong-cube highlighting, try-again logic.
  - `WeightGameTutorialController` (×4) — selection flow, typed instructions with
    synced voice-over, completion flow, return-to-selection, final "which is
    heavier?" tap activity, final result comparison, game-over.
- **Runtime `Instantiate()`:** cubes are spawned at the scene's pre-placed
  target-marker positions and animated in with the exact `OutBack` / `InBack`
  DOTween eases and 0.25s / 0.2s durations.
- **Level flow:** Intro → Level 1 → 2 → 3 → 4 (last), wired from the scene's
  serialized button `OnClick` events (`SetActive` swaps + `OnNextClicked`).
- **CanvasScaler:** Scale-With-Screen-Size, 1920×1080 reference,
  MatchWidthOrHeight = 0.5, reproduced in log space and recomputed on resize.
- **Color space:** the project is **Linear**; every tint is converted
  Linear→sRGB before rendering.
- **Assets:** 81 images, 50 audio clips, and the `Lilita One` font, copied and
  referenced faithfully (no atlas sub-rects or 9-slice borders exist in this
  project, so images render as plain simple/aspect-fit sprites).

### Per-level answers (extracted, not guessed)
| Level | Item A (heavier) | blocks | Item B | blocks |
|------:|------------------|:------:|--------|:------:|
| 1 | Book | 5 | Pencil box | 3 |
| 2 | Bottle | 4 | Mug | 2 |
| 3 | Teddy bear | 7 | Doll | 5 |
| 4 | Pumpkin | 8 | Watermelon | 6 |

## Analytics contract
The original's `TrackingPlugin.jslib` hooks are preserved as `window.*` functions
so an embedding page can override them. `SendLevelStart(levelIndex, levelCount)`
fires when a level becomes active. The other hooks
(`SendLevelComplete`, `cubeStageSubmitted`, `quizAnswerSubmittedString`,
`waterFlowSubmitted`) are defined as no-ops — the C# scripts never actually
invoked them, so they exist only to keep the external contract intact.

## Known approximations (the last few %)
This is a hand-reimplementation in a different renderer, targeting ~95–99%
fidelity. The following are visual approximations rather than mechanical extracts:

1. **Balance scale.** The original tilts via an Animator **blend tree** driven by
   a `BalanceValue` (−1…1) float. Animator curves can't be extracted mechanically,
   so the beam is approximated with CSS: the pointer swings, the beam bar tilts,
   and the two baskets seesaw vertically, all proportional to the same smoothed
   balance value (same `Mathf.Lerp` smoothing, speed = 3). Angles/offsets are
   tuned by eye — send a screenshot of the original at a given cube count and I
   can match it exactly.
2. **Particles.** Unity `ParticleSystem` (confetti / sparkle) is approximated with
   a lightweight CSS/canvas confetti burst on correct answers and game-over.
3. **Hint hands.** The animated hand-prefab hints are approximated with a pulsing
   ring highlight on the target button after the same delay timers.
4. **TMP text metrics.** TextMeshPro uses font-intrinsic metrics; the browser box
   differs slightly, so vertical centering may be off by a pixel or two on some
   labels.

If you spot a specific mismatch against the Unity original, the fastest fix is a
screenshot of the original **and** the HTML at the same state.
