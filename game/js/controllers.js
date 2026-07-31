/* controllers.js — line-faithful ports of the three MonoBehaviours + level manager.
   Each level gets its own WeightMeasuringGame + WeightGameTutorialController instance. */
(function (global) {
  "use strict";
  var E = global.Engine;
  var CFG = global.CONFIG;

  var CheckResult = { None: 0, Less: 1, More: 2, Correct: 3 };

  /* ===================================================================
     WeightMeasuringGame
     =================================================================== */
  function WeightMeasuringGame(cfg, tut) {
    this.c = cfg;              // config.game
    this.tut = tut;
    this.correctCubeCount = cfg.correctCubeCount;
    this.bookCorrectCubeCount = cfg.bookCorrectCubeCount;
    this.bagCorrectCubeCount = cfg.bagCorrectCubeCount;
    this.cubeScaleDuration = cfg.cubeScaleDuration || 0.25;
    this.balanceSmoothSpeed = cfg.balanceSmoothSpeed || 3;
    this.targetBalance = -1;
    this.currentBalance = -1;
    this.spawnedCubes = [];
    this.cubeIndex = 0;
    this.firstPlusClicked = false;
    this.isResultChecked = false;
    this.isCubeMoving = false;
    this.isFixingMoreAnswer = false;
    this.lastResult = CheckResult.None;
    this.spawnPointsLen = (cfg.rightSpawnPoints || []).length;
    this.targetPoints = cfg.rightTargetPoints || [];
    this._beam = null;
  }
  WeightMeasuringGame.prototype.start = function () {
    var self = this;
    this.spawnedCubes = new Array(this.spawnPointsLen).fill(null);
    E.onClick(this.c.plusButton, function () { self.addCube(); });
    E.onClick(this.c.minusButton, function () { self.removeCube(); });
    E.onClick(this.c.checkButton, function () { self.checkResult(); });
    E.setActive(this.c.checkButton, false);
    this.disablePlusMinus();
    this.targetBalance = -1; this.currentBalance = -1;
    // hide the pre-placed target-marker cubes (they are position anchors only)
    this.targetPoints.forEach(function (id) { E.setActive(id, false); });
    this._findBeam();
    this._ensurePlateCube(); // permanent sample block on the plate for the whole level
    // drive balance visuals every frame (Update())
    E.onTick(function (dt) { self.update(dt); });
  };
  WeightMeasuringGame.prototype._findBeam = function () {
    var reg = E.getReg(this.c.scaleAnimator); // 'controller' node
    if (!reg) return;
    var el = reg.el;
    // NOTE: the needle is owned by ScaleNeedle (needle-fix.js) — not touched here.
    this._beam = {
      plate: el.querySelector('[data-name="plate"]'),
      left: el.querySelector('[data-name="left "]') || el.querySelector('[data-name="left"]'),
      right: el.querySelector('[data-name="Right"]')
    };
  };
  WeightMeasuringGame.prototype.update = function (dt) {
    if (!this._beam) return;
    // Once the beam has reached its target and been painted, stop touching the DOM every
    // frame. This kills the per-frame style writes on all 4 levels' idle/inactive beams
    // (only the level whose balance is actively changing does any work).
    var settled = Math.abs(this.targetBalance - this.currentBalance) < 0.0005;
    if (settled && this._balanceApplied) return;
    // Mathf.Lerp(current, target, dt*speed)
    this.currentBalance += (this.targetBalance - this.currentBalance) * Math.min(1, dt * this.balanceSmoothSpeed);
    if (settled) this.currentBalance = this.targetBalance;
    this._applyBalance(this.currentBalance);
    this._balanceApplied = settled;
  };
  WeightMeasuringGame.prototype._applyBalance = function (b) {
    if (!this._beam) return;
    var B = this._beam;
    // set the transition once (not every frame) — the transform below is what animates
    if (!this._beamTransitionSet) {
      if (B.plate) { B.plate.style.transition = "transform .08s linear"; B.plate.style.transformOrigin = "50% 50%"; }
      if (B.left) B.left.style.transition = "transform .08s linear";
      if (B.right) B.right.style.transition = "transform .08s linear";
      this._beamTransitionSet = true;
    }
    // seesaw: right(cubes) side goes DOWN as b→+1; left(item) DOWN as b→-1
    var drop = 46 * b;      // px
    var beamAngle = 7 * b;  // deg (screen: positive b tilts right side down)
    if (B.plate) B.plate.style.transform = "rotate(" + beamAngle + "deg)";
    if (B.left) B.left.style.transform = "translateY(" + (-drop) + "px)";
    if (B.right) B.right.style.transform = "translateY(" + (drop) + "px)";
  };
  WeightMeasuringGame.prototype.setButtonVisual = function (btnId, cgId, state) {
    E.setInteractable(btnId, state);
    if (cgId) E.setAlpha(cgId, state ? 1 : (this.c.disabledAlpha != null ? 0.4 : 0.4));
  };
  // Both of this level's item sprites, decoded and ready to paint. Capped at 2.5s so a missing or
  // undecodable file degrades to "show it when it arrives" instead of blocking the level.
  WeightMeasuringGame.prototype.itemArtReady = function () {
    if (!this._artReady) {
      var paths = [this.c.bookSprite && this.c.bookSprite.path, this.c.bagSprite && this.c.bagSprite.path];
      this._artReady = Promise.race([
        E.decodeImages(paths),
        new Promise(function (res) { setTimeout(res, 2500); })
      ]);
    }
    return this._artReady;
  };
  WeightMeasuringGame.prototype.selectBook = function () {
    this.correctCubeCount = this.bookCorrectCubeCount;
    if (this.c.leftBasketItemImage && this.c.bookSprite) {
      E.setSprite(this.c.leftBasketItemImage, this.c.bookSprite.path, true);
      this._seatItem(this.c.leftBasketItemImage, this.c.bookSprite);
    }
    this.startGameplay();
  };
  WeightMeasuringGame.prototype.selectBag = function () {
    this.correctCubeCount = this.bagCorrectCubeCount;
    if (this.c.leftBasketItemImage && this.c.bagSprite) {
      E.setSprite(this.c.leftBasketItemImage, this.c.bagSprite.path, true);
      this._seatItem(this.c.leftBasketItemImage, this.c.bagSprite);
    }
    this.startGameplay();
  };
  // NOTE: the item image node is authored by the scene INSIDE left>Basket>Image, already a
  // descendant of the left pan, so it rides the tilt. We swap its sprite (preserveAspect)
  // and reseat it in the bowl via _seatItem below.
  //
  // Every item is seated from the sprite's PAINTED bounds rather than its box, because the
  // transparent padding around the art differs wildly between sprites (the doll's art fills
  // 31% of its image width, the mug's 84%). Seating by box therefore put each item at a
  // different height in the bowl — one floating above the rim, the next buried in it.
  //
  // `art` = [left, top, width, height] of the opaque pixels as a fraction of the source
  // image (measured off the shipped webp files). `vw` = how wide that painted art should
  // render, in reference px — the authored sizes, which encode how big each object should
  // look relative to the others.
  // `word` is the part of the narration that names this item, used to bounce it on cue.
  WeightMeasuringGame.ITEM_ART = {
    // level 1 — book / pencil box
    "assets/img/ChatGPT_Image_Nov_21__2025__06_10_02_PM_2__1_.webp": { nat: [514, 514], art: [0.2179, 0.2179, 0.5700, 0.5564], vw: 285, word: "book" },
    "assets/img/ChatGPT_Image_Mar_12__2026__03_23_00_PM__1__2.webp": { nat: [277, 277], art: [0.0289, 0.2094, 0.8736, 0.6209], vw: 262, word: "box" },
    // level 2 — bottle / mug
    "assets/img/BTL_1.webp": { nat: [161, 319], art: [0.1429, 0.0815, 0.7267, 0.8527], vw: 99, word: "bottle" },
    "assets/img/MG.webp": { nat: [176, 169], art: [0.0852, 0.0888, 0.8409, 0.8402], vw: 114, word: "mug" },
    // level 3 — teddy bear / doll
    // teddy bear at 0.98 of its authored width (244 -> 239), as requested
    "assets/img/teddy_1.webp": { nat: [289, 331], art: [0.0692, 0.1088, 0.8443, 0.8429], vw: 239, word: "teddy" },
    "assets/img/IMG_5014_1.webp": { nat: [560, 560], art: [0.3429, 0.2679, 0.3143, 0.4643], vw: 160, word: "doll" },
    // level 4 — pumpkin / watermelon
    "assets/img/pumpkin_01_1.webp": { nat: [634, 423], art: [0.3092, 0.2293, 0.3817, 0.5437], vw: 242, word: "pumpkin" },
    "assets/img/water_melon_01.webp": { nat: [634, 423], art: [0.3817, 0.2766, 0.2366, 0.4421], vw: 150, word: "watermelon" }
  };
  // Painted bounds of the pan sprite (The_Fancy_Dress_Competition_-_1__3__2.webp), same
  // fraction form. The bowl art sits inside ~64% of its box, so the box centre is NOT the
  // bowl centre — this is what the seat is measured against.
  WeightMeasuringGame.BOWL_ART = [0.1986, 0.1215, 0.6380, 0.5789];

  // Seat the item in the bowl: painted art centred on the bowl's opening, with its middle on
  // the rim line, so every item shows the same half-in / half-out amount. The node stays a
  // child of the Image container, so it keeps riding the pan tilt.
  //
  // This runs for EVERY item, including ones with no entry in ITEM_ART (those are restored to
  // their authored box). Both matter: the two selection items share ONE image node, so an
  // item that skipped reseating used to inherit the previous item's box — picking the doll
  // and then the teddy bear drew the bear at the doll's 547×508 box, i.e. ~1.9× too big and
  // hanging out of the pan.
  WeightMeasuringGame.prototype._seatItem = function (imgId, sprite) {
    var el = E.get(imgId); if (!el) return;
    if (!el._authoredBox) {
      el._authoredBox = { left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height, transform: el.style.transform };
    }
    var info = sprite && WeightMeasuringGame.ITEM_ART[sprite.path];
    this.itemWord = info ? info.word : null;   // which spoken word bounces this item
    var host = el.parentNode;                    // authored "Image" container
    var basket = host && host.parentNode;        // the pan (bowl sprite)
    if (!info || !basket) {                      // unknown sprite: authored layout, never a stale one
      var a = el._authoredBox;
      el.style.left = a.left; el.style.top = a.top;
      el.style.width = a.width; el.style.height = a.height;
      el.style.transform = a.transform;
      return;
    }
    var B = WeightMeasuringGame.BOWL_ART;
    var bw = parseFloat(basket.style.width) || 569, bh = parseFloat(basket.style.height) || 247;
    var hostLeft = parseFloat(host.style.left) || 0, hostTop = parseFloat(host.style.top) || 0;
    var bowlCX = (B[0] + B[2] / 2) * bw - hostLeft;   // bowl centre, in the container's space
    var bowlRimY = B[1] * bh - hostTop;               // top of the bowl's painted rim
    // Box the node at the sprite's own aspect ratio so background-size:contain maps 1:1
    // (a mismatched box letterboxes the image and silently shifts the art inside it).
    var drawW = info.vw / info.art[2];
    var drawH = drawW * (info.nat[1] / info.nat[0]);
    el.style.width = drawW + "px";
    el.style.height = drawH + "px";
    el.style.left = (bowlCX - (info.art[0] + info.art[2] / 2) * drawW) + "px";
    el.style.top = (bowlRimY - (info.art[1] + info.art[3] / 2) * drawH) + "px";
    el.style.transform = "none";
    el.style.transformOrigin = "50% 50%";
  };
  WeightMeasuringGame.prototype.startGameplay = function () {
    this.cubeIndex = 0; this.targetBalance = -1;
    if (window.ScaleNeedle) window.ScaleNeedle.reset(); // new item starts with zero cubes
    this._ensurePlateCube();
    this.updatePlusMinusState();
  };
  // A persistent sample block sitting on the centre plate between the − / + buttons
  // (matches the reference art). It's a child of the plate, so it shows/hides with the
  // gameplay panel and never interferes with the spawnable cubes in the right pan.
  // Size/position tuned via the live editor (plate-local px), applied identically to EVERY level's
  // plate sample block (all plates are the same 461×224). Deliberately bigger than the blocks in
  // the pan: this one is the sample being offered to the learner, up front on the pedestal, while
  // the pan blocks are sized to fit the bowl.
  WeightMeasuringGame.PLATE_CUBE = { w: 198.99, h: 178.64, left: 140, top: -34 };
  WeightMeasuringGame.prototype._ensurePlateCube = function () {
    var plusEl = E.get(this.c.plusButton); if (!plusEl) return;
    var items = plusEl.parentNode; if (!items) return;
    var plate = items.querySelector('[data-name="Item 1"]') || items;
    var cfg = WeightMeasuringGame.PLATE_CUBE;
    var cube = plate._plateCube;
    if (!cube || !cube.parentNode) {
      cube = document.createElement("div");
      cube.className = "cube plate-sample";
      var sp = this.c.normalCubeSprite;
      if (sp) cube.style.backgroundImage = "url('" + sp.path + "')";
      plate.appendChild(cube);
      plate._plateCube = cube;
    }
    // (re)apply the exact layout every time so it stays strictly consistent
    cube.style.width = cfg.w + "px";
    cube.style.height = cfg.h + "px";
    cube.style.left = cfg.left + "px";
    cube.style.top = cfg.top + "px";
    cube.style.transform = "none";
  };
  /* ---- narration cues ----
     The narration names things ("add blocks to balance the teddy bear"); these bounce the thing
     being named at the moment the word lands, so a learner who cannot read yet still sees which
     object the sentence is about. */
  WeightMeasuringGame.prototype.popItem = function () {
    // bounce from near the base: the item is half-sunk in the pan, so it should grow up out of
    // the bowl rather than sink further into it
    E.pop(this.c.leftBasketItemImage, { origin: "50% 92%" });
  };
  WeightMeasuringGame.prototype.popBlocks = function () {
    var live = this.spawnedCubes.filter(Boolean);
    if (live.length) {
      live.forEach(function (cube, i) { setTimeout(function () { E.pop(cube); }, i * 45); });
      return;
    }
    var plusEl = E.get(this.c.plusButton);          // nothing in the pan yet: bounce the sample
    var plate = plusEl && plusEl.parentNode && plusEl.parentNode.querySelector('[data-name="Item 1"]');
    if (plate && plate._plateCube) E.pop(plate._plateCube);
  };
  // Word -> action for the current item, handed to the voice/text controller with every line.
  WeightMeasuringGame.prototype.narrationCues = function () {
    var self = this, cues = [{ phrase: "block", fire: function () { self.popBlocks(); } }];
    if (this.itemWord) cues.push({ phrase: this.itemWord, fire: function () { self.popItem(); } });
    return cues;
  };

  WeightMeasuringGame.prototype.enablePlusMinus = function () {
    this.setButtonVisual(this.c.plusButton, this.c.plusCanvasGroup, true);
    this.setButtonVisual(this.c.minusButton, this.c.minusCanvasGroup, true);
  };
  WeightMeasuringGame.prototype.disablePlusMinus = function () {
    this.setButtonVisual(this.c.plusButton, this.c.plusCanvasGroup, false);
    this.setButtonVisual(this.c.minusButton, this.c.minusCanvasGroup, false);
  };
  WeightMeasuringGame.prototype.updateScaleDynamically = function () {
    if (this.isResultChecked) return;
    var diff = this.cubeIndex - this.correctCubeCount;
    this.targetBalance = Math.max(-1, Math.min(1, diff / this.correctCubeCount));
    // drive the needle from the cube counts (add / remove cube)
    if (window.ScaleNeedle) window.ScaleNeedle.setFromCounts(this.cubeIndex, this.correctCubeCount);
  };
  /* A tap that lands while a block is still animating used to be thrown away, so a child tapping
     quickly saw fewer blocks than taps. Taps are queued instead — still one block at a time, but
     none is lost — and the queue is bounded by what the pan can hold. */
  WeightMeasuringGame.prototype.addCube = async function () {
    if (this.isCubeMoving) {
      this._pendingAdd = Math.min((this._pendingAdd || 0) + 1, this.spawnPointsLen - this.cubeIndex);
      this.tut.onPlusClicked();
      return;
    }
    this.tut.onPlusClicked();
    if (this.cubeIndex >= this.spawnPointsLen) return;
    this.isCubeMoving = true;
    if (!this.firstPlusClicked) { this.firstPlusClicked = true; this.tut.hideInstructionBar(); }
    var idx = this.cubeIndex;
    var cube = this._spawnCube(idx);
    this.spawnedCubes[idx] = cube;
    this.cubeIndex++;
    this._applyStack(true, cube);   // the row re-centres as it fills; the new block pops in place
    // scale in OutBack
    await E.tween(this.cubeScaleDuration, "OutBack", function (t) { cube.style.transform = "translate(-50%,-50%) scale(" + t + ")"; });
    this.updateScaleDynamically();
    this.isCubeMoving = false;
    this.updatePlusMinusState();
    this.enableCheckButton();
    if (this._pendingAdd > 0) { this._pendingAdd--; this.addCube(); }   // a tap that arrived mid-animation
  };
  /* ---- block stack geometry ----
     The scene ships hand-placed marker points for the blocks. Their gaps drift by up to 20px
     horizontally (64 / 70 / 71) and 19px vertically (64 / 72 / 53), and a partly filled row was
     anchored to the pan's left instead of its centre — which is what made a pan of blocks read as
     a jumbled heap leaning to one side.

     The stack is now built from the block art's own geometry, so it reads as real cubes:

       across  —  of the block: one painted width, so neighbours meet at the side corner
                 of the drawing. Blocks read as separate cubes set against each other, which is the
                 look the game wants (a tighter step overlaps the drawn faces and the pile reads as
                 one mass);
       upward  — `stepYRatio` of the block, tuned the same way, so an upper block sits on the tops
                 of the blocks below with no background showing through the join;
       rows    — the pyramid the markers describe (4-3-2-1, or 3-2-1 on level 1). A row of n-1
                 blocks centred over a row of n lands in its notches, so the pyramid holds
                 together at every count with nothing floating;
       within  — blocks fill left to right, and the row re-centres as it fills, so the stack is
                 both counted in reading order and always centred in the pan.

     Upper rows are drawn in front, because a block resting on top covers part of the top face of
     the blocks under it. The anchor comes from the authored markers, so the stack stays where the
     artist placed it in the pan; BLOCK_SIZE is set so the widest row fits the bowl's painted
     opening (see LevelManager). */
  WeightMeasuringGame.CUBE_ART = [0.1582, 0.1412, 0.6836, 0.7175]; // painted bounds of the block sprite
  WeightMeasuringGame.STACK = { stepXRatio: 0.6836, stepYRatio: 0.485, rowTolerance: 25, slideSeconds: 0.16 };

  // Steps, anchor and row sizes — measured once per level from the markers and the pan.
  WeightMeasuringGame.prototype._stackGeom = function () {
    if (this._geom) return this._geom;
    var S = WeightMeasuringGame.STACK;
    var pts = [], host = null;
    this.targetPoints.forEach(function (id) {
      var reg = E.getReg(id); if (!reg) return;
      var el = reg.el;
      host = host || el.parentNode;
      pts.push({
        cx: (parseFloat(el.style.left) || 0) + (parseFloat(el.style.width) || 0) / 2,
        cy: (parseFloat(el.style.top) || 0) + (parseFloat(el.style.height) || 0) / 2
      });
    });
    if (!pts.length) return (this._geom = { caps: [], anchorX: 0, anchorY: 0, stepX: 0, stepY: 0 });
    // authored rows, bottom first: their sizes are the pyramid, the bottom one is the anchor
    var rows = [];
    pts.slice().sort(function (a, b) { return b.cy - a.cy; }).forEach(function (p) {
      var row = rows[rows.length - 1];
      if (row && Math.abs(row[0].cy - p.cy) <= S.rowTolerance) row.push(p);
      else rows.push([p]);
    });
    var sz = (this.cubePrefab && this.cubePrefab.size) || [218, 218];
    var drawn = Math.min(sz[0], sz[1]);                  // background-size:contain squares it
    var blockW = WeightMeasuringGame.CUBE_ART[2] * drawn;
    var basket = host && host.parentNode;
    var bowlW = WeightMeasuringGame.BOWL_ART[2] * ((basket && parseFloat(basket.style.width)) || 569);
    var stepX = S.stepXRatio * drawn;
    // widest row that still fits the bowl's painted opening: (n-1) steps plus one whole block
    var maxPerRow = Math.max(1, Math.floor((bowlW - blockW) / stepX) + 1);
    var caps = rows.map(function (r) { return Math.min(r.length, maxPerRow); });
    var total = caps.reduce(function (a, b) { return a + b; }, 0);
    while (total < pts.length) {                          // never leave a slot homeless
      caps.push(Math.min(caps[caps.length - 1] || 1, maxPerRow));
      total += caps[caps.length - 1];
    }
    var bottom = rows[0];
    return (this._geom = {
      caps: caps,
      anchorX: bottom.reduce(function (s, p) { return s + p.cx; }, 0) / bottom.length,
      anchorY: bottom[0].cy,
      stepX: stepX,
      stepY: S.stepYRatio * drawn
    });
  };

  // Where the blocks belong for a given count: rows bottom-up, left to right, each row centred.
  WeightMeasuringGame.prototype._stackPositions = function (count) {
    var g = this._stackGeom(), out = [], left = count;
    for (var r = 0; r < g.caps.length && left > 0; r++) {
      var k = Math.min(left, g.caps[r]);
      for (var i = 0; i < k; i++) {
        out.push({ x: g.anchorX + (i - (k - 1) / 2) * g.stepX, y: g.anchorY - r * g.stepY, row: r });
      }
      left -= k;
    }
    return out;
  };

  // Re-seat the blocks already in the pan for the current count. `justSpawned` is placed
  // directly (it should pop into its final spot, not slide in from the previous layout).
  WeightMeasuringGame.prototype._applyStack = function (animate, justSpawned) {
    var pos = this._stackPositions(this.cubeIndex);
    var slide = animate && !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    var secs = WeightMeasuringGame.STACK.slideSeconds;
    for (var i = 0; i < this.cubeIndex; i++) {
      var cube = this.spawnedCubes[i], p = pos[i];
      if (!cube || !p) continue;
      if (cube !== justSpawned) cube.style.transition = slide ? ("left " + secs + "s ease-out, top " + secs + "s ease-out") : "";
      cube.style.left = p.x + "px";
      cube.style.top = p.y + "px";
      cube.style.zIndex = p.row + 1;
    }
  };

  WeightMeasuringGame.prototype._spawnCube = function (idx) {
    var reg = E.getReg(this.targetPoints[idx]);
    var cube = document.createElement("div");
    cube.className = "cube";
    var sz = (this.cubePrefab && this.cubePrefab.size) ? this.cubePrefab.size : [218, 218];
    var tgtEl = reg ? reg.el : null;
    // Spawn in the SAME coordinate space as the target markers (their parent = the cube slot
    // inside the right pan) so the block rides the tilt with the pan.
    var parent = tgtEl ? tgtEl.parentNode : E.get(this.c.rightBasket);
    var slot = this._stackPositions(idx + 1)[idx] || { x: 0, y: 0, row: 0 };
    cube.style.left = slot.x + "px"; cube.style.top = slot.y + "px";
    cube.style.width = sz[0] + "px"; cube.style.height = sz[1] + "px";
    cube.style.marginLeft = "0"; cube.style.marginTop = "0";
    cube.style.zIndex = slot.row + 1;
    cube.style.transform = "translate(-50%,-50%) scale(0)";
    var sp = this.c.normalCubeSprite;
    if (sp) { cube.style.backgroundImage = "url('" + sp.path + "')"; }
    (parent || document.getElementById("stage")).appendChild(cube);
    return cube;
  };
  WeightMeasuringGame.prototype.removeCube = async function () {
    if (this.isCubeMoving) {   // queue the tap rather than dropping it (see addCube)
      this._pendingRemove = Math.min((this._pendingRemove || 0) + 1, this.cubeIndex);
      this.tut.onMinusClicked();
      return;
    }
    this.tut.onMinusClicked();
    if (this.cubeIndex <= 0) return;
    this.isCubeMoving = true;
    var removeIndex = this.cubeIndex - 1;
    var cube = this.spawnedCubes[removeIndex];
    if (!cube) { this.isCubeMoving = false; return; }
    this.cubeIndex--;
    if (this.isFixingMoreAnswer) {
      this.tut.onMinusClicked();
      if (this.cubeIndex > this.correctCubeCount) this.tut.showMinusHint();
      else this.isFixingMoreAnswer = false;
    }
    await E.tween(0.2, "InBack", function (t) { cube.style.transform = "translate(-50%,-50%) scale(" + (1 - t) + ")"; });
    cube.remove();
    this.spawnedCubes[removeIndex] = null;
    this._applyStack(true);          // the row it left re-centres behind it
    this.lastResult = CheckResult.None;
    E.setActive(this.c.checkButton, this.cubeIndex > 0);
    this.updateScaleDynamically();
    this.isCubeMoving = false;
    this.updatePlusMinusState();
    this.enableCheckButton();
    if (this._pendingRemove > 0) { this._pendingRemove--; this.removeCube(); }
  };
  WeightMeasuringGame.prototype.enableCheckButton = function () {
    if (this.cubeIndex > 0 && !this.isResultChecked) {
      E.setActive(this.c.checkButton, true);
      this.tut.startCheckHint();
    }
  };
  WeightMeasuringGame.prototype.checkResult = function () {
    this._pendingAdd = this._pendingRemove = 0;   // nothing queued survives a check
    this.tut.onCheckClicked();
    this.disablePlusMinus();
    if (this.isResultChecked) return;
    this.isResultChecked = true;
    this.tut.hideInstructionBar();
    if (this.cubeIndex === this.correctCubeCount) {
      this.isFixingMoreAnswer = false;
      this.lastResult = CheckResult.Correct;
      E.setActive(this.c.checkButton, false);
      this.disablePlusMinus();
      this.targetBalance = 0;
      if (window.ScaleNeedle) window.ScaleNeedle.setBalance(0); // correct count → balanced
      if (this.c.correctParticle) E.confetti(this.c.correctParticle);
      this.tut.onCorrectMatch();
    } else {
      E.setActive(this.c.checkButton, false);
      this.disablePlusMinus();
      this.highlightWrongCubes();
      if (this.cubeIndex > this.correctCubeCount) { this.lastResult = CheckResult.More; this.tut.onMoreCubes(); }
      else { this.lastResult = CheckResult.Less; this.tut.onLessCubes(); }
    }
  };
  WeightMeasuringGame.prototype.highlightWrongCubes = function () {
    var sp = this.c.wrongCubeSprite;
    for (var i = 0; i < this.cubeIndex; i++) {
      if (this.spawnedCubes[i] && sp) this.spawnedCubes[i].style.backgroundImage = "url('" + sp.path + "')";
    }
  };
  WeightMeasuringGame.prototype.handleTryAgain = function () {
    this.isResultChecked = false;
    if (this.lastResult === CheckResult.Less) {
      this.resetAllCubes();
      this.updatePlusMinusState();
    } else if (this.lastResult === CheckResult.More) {
      this.isFixingMoreAnswer = true;
      this.updatePlusMinusState();
      E.setActive(this.c.checkButton, false);
      this.resetCubeSprites();
      this.tut.showMinusHint();
    }
  };
  WeightMeasuringGame.prototype.resetCubeSprites = function () {
    var sp = this.c.normalCubeSprite;
    for (var i = 0; i < this.cubeIndex; i++)
      if (this.spawnedCubes[i] && sp) this.spawnedCubes[i].style.backgroundImage = "url('" + sp.path + "')";
  };
  WeightMeasuringGame.prototype.updatePlusMinusState = function () {
    this._ensurePlateCube(); // safety net: keep the plate block present the whole game
    var canAdd = this.cubeIndex < this.spawnPointsLen;
    var canRemove = this.cubeIndex > 0;
    if (this.isFixingMoreAnswer) { canAdd = false; canRemove = this.cubeIndex > 0; }
    E.setInteractable(this.c.plusButton, canAdd);
    E.setInteractable(this.c.minusButton, canRemove);
    if (this.c.plusCanvasGroup) E.setAlpha(this.c.plusCanvasGroup, canAdd ? 1 : 0.6);
    if (this.c.minusCanvasGroup) E.setAlpha(this.c.minusCanvasGroup, canRemove ? 1 : 0.6);
    if (this.tut && canAdd && !this.isFixingMoreAnswer) this.tut.restartPlusHint();
  };
  WeightMeasuringGame.prototype.resetGameplay = function () {
    this.resetAllCubes();
    this.isResultChecked = false;
    this.targetBalance = -1;
    if (window.ScaleNeedle) window.ScaleNeedle.reset();
    E.setActive(this.c.checkButton, false);
    this.updatePlusMinusState();
  };
  WeightMeasuringGame.prototype.resetAllCubes = function () {
    this._pendingAdd = this._pendingRemove = 0;
    for (var i = 0; i < this.spawnedCubes.length; i++) {
      if (this.spawnedCubes[i]) { this.spawnedCubes[i].remove(); this.spawnedCubes[i] = null; }
    }
    this.cubeIndex = 0; this.firstPlusClicked = false;
    this.lastResult = CheckResult.None;
    E.setActive(this.c.checkButton, false);
    this.targetBalance = -1;
    if (window.ScaleNeedle) window.ScaleNeedle.reset();
    this.updatePlusMinusState();
  };

  /* ===================================================================
     WeightGameTutorialController
     =================================================================== */
  function Tut(cfg) {
    this.c = cfg;               // config.tut
    this.game = null;
    this.SelectedType = { None: 0, Book: 1, Bag: 2 };
    this.currentSelected = 0;
    this.bookCompleted = false;
    this.bagCompleted = false;
    this.isRetryingFinalTap = false;
    this.isNextProcessing = false;
    this.plusClicked = false;
    this.instruction3Completed = false;
    this.firstGameplayCompleted = false;
    this.leftItemPlaced = false;
    this.minTypingSpeed = cfg.minTypingSpeed || 0.02;
    this.isBookHeavier = !!cfg.isBookHeavier;
    this.isLastLevel = !!cfg.isLastLevel;
    // hint timers
    this._timers = {};
    this._typing = null;
    this._audio = null;
  }
  var TP = Tut.prototype;

  TP.start = function () {
    var c = this.c, self = this;
    E.setActive(c.itemmain, false);
    E.setActive(c.tapPanel, false);
    if (c.completionBar) E.setActive(c.completionBar, false);
    if (c.bookCompletedText) E.setActive(c.bookCompletedText, false);
    if (c.bagCompletedText) E.setActive(c.bagCompletedText, false);
    if (c.gameplayPanel) E.setActive(c.gameplayPanel, false);
    if (c.bottomBar) E.setActive(c.bottomBar, false);
    if (c.correctAnswerMark) E.setActive(c.correctAnswerMark, false);
    if (c.finalTryAgainButton) { E.setActive(c.finalTryAgainButton, false); E.onClick(c.finalTryAgainButton, function () { self.onFinalTryAgainClicked(); }); }
    if (c.bookPassMark) E.setActive(c.bookPassMark, false);
    if (c.bagPassMark) E.setActive(c.bagPassMark, false);
    if (c.bookGlow) E.setActive(c.bookGlow, false);
    if (c.bagGlow) E.setActive(c.bagGlow, false);
    E.setActive(c.instructionBar, true);
    if (c.tryAgainButton) { E.setActive(c.tryAgainButton, false); E.onClick(c.tryAgainButton, function () { self.onTryAgain(); }); }
    this.plusClicked = false; this.instruction3Completed = false;
    E.setActive(c.selectionPanel, false);
    E.onClick(c.bookButton, function () { self.onBookSelected(); });
    E.onClick(c.bagButton, function () { self.onBagSelected(); });
    if (c.finalBookButton) E.onClick(c.finalBookButton, function () { self.onFinalBookClicked(); });
    if (c.finalBagButton) E.onClick(c.finalBagButton, function () { self.onFinalBagClicked(); });
    // Next & finalNext buttons wired by LevelManager via button-events.
    // (Selection cards keep their authored size — the completion text below each card is
    // authored for that size, so leaving it untouched keeps text centred + spaced correctly.)
    // top-bar text colour (requested) — apply to EVERY text that appears in the top
    // instruction / completion / bottom bar so they all read the same brown, never white.
    ["instructionText", "completionText", "bottomBarText"].forEach(function (k) {
      var el = c[k] && E.get(c[k]);
      if (el && el._tmpInner) el._tmpInner.style.color = "#783A0A";
    });
    this.tg = new E.TaskGroup();
    this.startSelectionFlow();
  };

  /* ---- typing / audio ----
     Every instruction / completion / caption line reveals through the ONE shared
     VoiceTextSync controller, so text and narration stay in lock-step and two voices
     can never overlap (no scattered per-line setTimeout loops). The legacy `token`
     ({cancelled}) contract is preserved: flipping it cancels this line. */
  TP._typeInto = function (setFn, message, clipPath, token) {
    var self = this;
    var VO = global.VoiceTextSync;
    message = message || "";
    if (!VO) { // ultra-defensive fallback (controller always present in normal builds)
      setFn(message); return Promise.resolve();
    }
    var session = VO.play({
      text: message,
      audio: clipPath || null,
      setText: setFn,
      revealMode: "type",   // preserve the original per-character type-on feel
      fallbackDuration: Math.max(0.6, message.length * self.minTypingSpeed),
      // bounce the item / the blocks as the narration names them
      cues: this.game ? this.game.narrationCues() : null
    });
    if (token) {
      var iv = setInterval(function () {
        if (session.state === "done" || session.state === "cancelled") { clearInterval(iv); return; }
        if (token.cancelled) { clearInterval(iv); session.cancel(); }
      }, 30);
    }
    return session.promise;
  };
  TP.playInstruction = function (message, clipPath) {
    this.stopCurrentInstruction();
    this.onMinusClicked();
    var self = this; this._typingTok = { cancelled: false };
    this._typing = this._typeInto(function (t) { E.setText(self.c.instructionText, t); }, message || "", clipPath, this._typingTok)
      .then(function () { self._typing = null; });
    return this._typing;
  };
  TP.playInstructionAndWait = function (message, clipPath) { return this.playInstruction(message, clipPath); };
  TP.stopCurrentInstruction = function () {
    if (this._typingTok) this._typingTok.cancelled = true;
    this._typing = null;
    if (global.VoiceTextSync) global.VoiceTextSync.cancelAll();   // immediate, safe cancel
    E.Audio.stop();
  };

  TP.startSelectionFlow = async function () {
    var c = this.c;
    E.setActive(c.selectionPanel, true);
    E.setInteractable(c.bookButton, false);
    E.setInteractable(c.bagButton, false);
    await this.playInstructionAndWait(c.instruction1, c.instruction1Audio_path);
    await E.wait(1);
    await this.playInstructionAndWait(c.instruction2, c.instruction2Audio_path);
    await E.wait(1);
    // A card only becomes tappable once its item's art is decoded and ready to paint, so the item
    // can never arrive after the pan does. In practice the warm-up finished long ago and this
    // resolves in the same frame; the race is capped so a broken file can't lock the screen.
    await this.game.itemArtReady();
    E.setInteractable(c.bookButton, !this.bookCompleted);
    E.setInteractable(c.bagButton, !this.bagCompleted);
    if (c.bookButtonCanvas) E.setAlpha(c.bookButtonCanvas, this.bookCompleted ? 0.4 : 1);
    if (c.bagButtonCanvas) E.setAlpha(c.bagButtonCanvas, this.bagCompleted ? 0.4 : 1);
    this.currentSelected = 0;
    this.startSelectionButtonHint();
  };

  TP.onBookSelected = function () {
    this.hideSelectionHint();
    if (this.bookCompleted) return;
    this.currentSelected = this.SelectedType.Book;
    E.setActive(this.c.selectionPanel, false);
    if (this.c.gameplayPanel) E.setActive(this.c.gameplayPanel, true);
    E.setActive(this.c.itemmain, true);
    this.game.selectBook();
    this.startDirectTutorial(true);
  };
  TP.onBagSelected = function () {
    this.hideSelectionHint();
    if (this.bagCompleted) return;
    this.currentSelected = this.SelectedType.Bag;
    E.setActive(this.c.selectionPanel, false);
    if (this.c.gameplayPanel) E.setActive(this.c.gameplayPanel, true);
    E.setActive(this.c.itemmain, true);
    this.game.selectBag();
    this.startDirectTutorial(false);
  };
  TP.startDirectTutorial = async function (isBook) {
    var c = this.c;
    E.setActive(c.instructionBar, true);
    if (isBook) {
      if (!this.firstGameplayCompleted) await this.playInstructionAndWait(c.bookAddInstruction, c.bookAddInstructionAudio_path);
      else await this.playInstructionAndWait(c.repeatBookInstruction, c.repeatBookInstructionAudio_path);
    } else {
      if (!this.firstGameplayCompleted) await this.playInstructionAndWait(c.bagAddInstruction, c.bagAddInstructionAudio_path);
      else await this.playInstructionAndWait(c.repeatBagInstruction, c.repeatBagInstructionAudio_path);
    }
    this.instruction3Completed = true;
    this.game.updatePlusMinusState();
    this.resetPlusHintState();
  };

  /* ---- check hint ---- */
  TP.startCheckHint = function () { this._hintTimer("check", this.c.checkHintDelay, this.c.checkButtonTarget); };
  TP.onCheckClicked = function () { this._clearHint("check"); };

  /* ---- try again ---- */
  TP.onTryAgain = function () {
    this._clearHint("tryagain");
    this.stopCurrentInstruction();
    E.setActive(this.c.tryAgainButton, false);
    E.setActive(this.c.instructionBar, true);
    var currentResult = this.game.lastResult;
    this.game.handleTryAgain();
    this.plusClicked = false; this.instruction3Completed = true;
    if (currentResult === CheckResult.Less) {
      if (this.currentSelected === this.SelectedType.Book) this.playInstruction(this.c.bookLessInstruction, this.c.bookLessInstructionAudio_path);
      else this.playInstruction(this.c.bagLessInstruction, this.c.bagLessInstructionAudio_path);
      this.game.updatePlusMinusState(); this.resetPlusHintState();
    } else if (currentResult === CheckResult.More) {
      if (this.currentSelected === this.SelectedType.Book) this.playInstruction(this.c.bookMoreInstruction, this.c.bookMoreInstructionAudio_path);
      else this.playInstruction(this.c.bagMoreInstruction, this.c.bagMoreInstructionAudio_path);
      this.game.updatePlusMinusState(); this.resetMinusHintState();
    }
  };

  /* ---- correct match ---- */
  TP.onCorrectMatch = function () { E.setActive(this.c.instructionBar, true); this.correctSequence(); };
  TP.correctSequence = async function () {
    if (this.c.itemmain) E.setActive(this.c.itemmain, false);
    if (this.currentSelected === this.SelectedType.Book)
      await this.playCompletionInstruction(this.c.bookCompleteInstruction, this.c.bookCompleteInstructionAudio_path);
    else
      await this.playCompletionInstruction(this.c.bagCompleteInstruction, this.c.bagCompleteInstructionAudio_path);
    E.setActive(this.c.nextButton, true);
    this._hintTimer("next", this.c.buttonHintDelay, null, this.c.nextButton);
  };
  TP.playCompletionInstruction = function (message, clipPath) {
    var self = this;
    E.setActive(this.c.instructionBar, false);
    E.setActive(this.c.completionBar, true);
    this._compTok = { cancelled: false };
    return this._typeInto(function (t) { E.setText(self.c.completionText, t); }, message || "", clipPath, this._compTok);
  };

  /* ---- next button ---- */
  TP.onNextClicked = function () {
    if (this.isNextProcessing) return;
    this.isNextProcessing = true;
    var c = this.c;
    if (E.isActive(c.tapPanel)) {
      E.setActive(c.nextButton, false);
      this.finalResultSequence().then(() => this.isNextProcessing = false);
      return;
    }
    if (this.bookCompleted && this.bagCompleted) {
      E.setActive(c.nextButton, false);
      if (c.completionBar) E.setActive(c.completionBar, false);
      if (c.instructionBar) E.setActive(c.instructionBar, true);
      E.setActive(c.selectionPanel, false);
      E.setActive(c.tapPanel, true);
      this.startTapActivity().then(() => this.isNextProcessing = false);
      return;
    }
    if (c.completionBar) E.setActive(c.completionBar, false);
    if (c.instructionBar) E.setActive(c.instructionBar, true);
    this._clearHint("next");
    E.setActive(c.nextButton, false);
    if (c.itemmain) E.setActive(c.itemmain, true);
    E.setInteractable(c.bookButton, !this.bookCompleted);
    E.setInteractable(c.bagButton, !this.bagCompleted);
    this.returnToSelectionFlow().then(() => this.isNextProcessing = false);
  };

  TP.returnToSelectionFlow = async function () {
    var c = this.c;
    if (c.gameplayPanel) E.setActive(c.gameplayPanel, false);
    E.setActive(c.itemmain, false);
    this.game.resetGameplay();
    // Lock BOTH selection cards for the whole return sequence (pass-mark tween + the
    // "Select the other balance" narration). Without this the cards stay tappable while
    // the line is still speaking, so a fast tap starts the next item and then the
    // `currentSelected = 0` reset at the end of this function wipes that selection — which
    // left completion untracked and made this "select the other balance" stage repeat and
    // stick. Re-enabled only after the narration (parity with startSelectionFlow).
    E.setInteractable(c.bookButton, false);
    E.setInteractable(c.bagButton, false);
    this.hideSelectionHint();
    if (this.currentSelected === this.SelectedType.Book) {
      this.bookCompleted = true; this.firstGameplayCompleted = true;
      E.setInteractable(c.bookButton, false);
      if (c.bookButtonCanvas) E.setAlpha(c.bookButtonCanvas, 0.4);
      if (c.bookPassMark) { E.setActive(c.bookPassMark, true); E.setScale(c.bookPassMark, 0); await E.tween(0.3, "OutBack", (t) => E.setScale(c.bookPassMark, t)); }
    } else if (this.currentSelected === this.SelectedType.Bag) {
      this.bagCompleted = true; this.firstGameplayCompleted = true;
      E.setInteractable(c.bagButton, false);
      if (c.bagButtonCanvas) E.setAlpha(c.bagButtonCanvas, 0.4);
      if (c.bagPassMark) { E.setActive(c.bagPassMark, true); E.setScale(c.bagPassMark, 0); await E.tween(0.3, "OutBack", (t) => E.setScale(c.bagPassMark, t)); }
    }
    E.setActive(c.selectionPanel, true);
    E.setActive(c.instructionBar, !(this.bookCompleted && this.bagCompleted));
    if (this.bookCompleted && this.bagCompleted) {
      this._applyCompareLayout();
      E.setInteractable(c.bookButton, false); E.setInteractable(c.bagButton, false);
      if (c.bookButtonCanvas) E.setAlpha(c.bookButtonCanvas, 1);
      if (c.bagButtonCanvas) E.setAlpha(c.bagButtonCanvas, 1);
      if (c.bookButtonImage && c.completedBookSprite) E.setSprite(c.bookButtonImage, c.completedBookSprite.path, true);
      if (c.bagButtonImage && c.completedBagSprite) E.setSprite(c.bagButtonImage, c.completedBagSprite.path, true);
      if (c.bookPassMark) E.setActive(c.bookPassMark, false);
      if (c.bagPassMark) E.setActive(c.bagPassMark, false);
      if (c.bookCompletedText) E.setActive(c.bookCompletedText, false);
      if (c.bagCompletedText) E.setActive(c.bagCompletedText, false);
      E.setScale(c.bookButton, 0); E.setScale(c.bagButton, 0);
      await E.tween(0.55, "OutCubic", (t) => E.setScale(c.bookButton, t));
      await E.wait(0.15);
      if (c.bookCompletedText) { var m1 = E.getText(c.bookCompletedText); E.setActive(c.bookCompletedText, true); await this._typeTMP(c.bookCompletedText, m1, c.bookCompleteInstructionAudio_path); }
      await E.wait(0.25);
      await E.tween(0.55, "OutCubic", (t) => E.setScale(c.bagButton, t));
      await E.wait(0.15);
      if (c.bagCompletedText) { var m2 = E.getText(c.bagCompletedText); E.setActive(c.bagCompletedText, true); await this._typeTMP(c.bagCompletedText, m2, c.bagCompleteInstructionAudio_path); }
      await E.wait(0.5);
      E.setActive(c.nextButton, true);
      return;
    }
    await this.playInstructionAndWait(c.instruction7, c.instruction7Audio_path);
    E.setInteractable(c.bookButton, !this.bookCompleted);
    E.setInteractable(c.bagButton, !this.bagCompleted);
    if (c.bookButtonCanvas) E.setAlpha(c.bookButtonCanvas, this.bookCompleted ? 0.4 : 1);
    if (c.bagButtonCanvas) E.setAlpha(c.bagButtonCanvas, this.bagCompleted ? 0.4 : 1);
    this.currentSelected = 0;
    if (!this.bookCompleted || !this.bagCompleted) this.startSelectionButtonHint();
  };

  TP._typeTMP = function (id, msg, clip) {
    var self = this; this._tmpTok = { cancelled: false };
    return this._typeInto(function (t) { E.setText(id, t); }, msg || "", clip, this._tmpTok);
  };

  /* ---- final tap activity ---- */
  // The two answer cards are authored identically (652×402), but on levels 2-4 the left card's
  // art carries a stray 13px vertical offset, so the two items sat on different lines. Centre
  // both in their card so the pair reads as a matched set.
  TP._centreTapArt = function () {
    var c = this.c;
    [[c.finalBookButton, c.finalBookHighlightImage], [c.finalBagButton, c.finalBagHighlightImage]]
      .forEach(function (pair) {
        var card = E.get(pair[0]), art = E.get(pair[1]);
        if (!card || !art) return;
        var cw = parseFloat(card.style.width) || 0, ch = parseFloat(card.style.height) || 0;
        var aw = parseFloat(art.style.width) || 0, ah = parseFloat(art.style.height) || 0;
        art.style.left = ((cw - aw) / 2) + "px";
        art.style.top = ((ch - ah) / 2) + "px";
      });
  };
  TP.startTapActivity = async function () {
    var c = this.c;
    this._centreTapArt();
    // clear any residual completion text so no stray glyph lingers over the tap cards
    if (c.completionText) E.setText(c.completionText, "");
    if (c.bookCompletedText) E.setActive(c.bookCompletedText, false);
    if (c.bagCompletedText) E.setActive(c.bagCompletedText, false);
    E.setActive(c.nextButton, false);
    E.setActive(c.instructionBar, true);
    E.setInteractable(c.finalBookButton, false);
    E.setInteractable(c.finalBagButton, false);
    E.setScale(c.finalBookButton, 0); E.setScale(c.finalBagButton, 0);
    if (c.finalBookHighlightImage && c.defaultBookHighlightSprite) E.setSprite(c.finalBookHighlightImage, c.defaultBookHighlightSprite.path, true);
    if (c.finalBagHighlightImage && c.defaultBagHighlightSprite) E.setSprite(c.finalBagHighlightImage, c.defaultBagHighlightSprite.path, true);
    this.playInstruction(c.tapInstruction, c.tapInstructionAudio_path);
    if (!this.isRetryingFinalTap) {
      await E.tween(0.45, "OutBack", (t) => E.setScale(c.finalBookButton, t));
      await E.wait(0.15);
      await E.tween(0.45, "OutBack", (t) => E.setScale(c.finalBagButton, t));
      await E.wait(0.2);
      // both items glow at the same time (requested), instead of one after the other
      if (c.finalBookHighlightImage && c.highlightBookSprite) E.setSprite(c.finalBookHighlightImage, c.highlightBookSprite.path, true);
      if (c.finalBagHighlightImage && c.highlightBagSprite) E.setSprite(c.finalBagHighlightImage, c.highlightBagSprite.path, true);
      await E.wait(2.0);
      if (c.finalBookHighlightImage && c.defaultBookHighlightSprite) E.setSprite(c.finalBookHighlightImage, c.defaultBookHighlightSprite.path, true);
      if (c.finalBagHighlightImage && c.defaultBagHighlightSprite) E.setSprite(c.finalBagHighlightImage, c.defaultBagHighlightSprite.path, true);
    } else {
      E.setScale(c.finalBookButton, 1); E.setScale(c.finalBagButton, 1);
      this.isRetryingFinalTap = false;
    }
    while (this._typing) await E.wait(0.05);
    E.setInteractable(c.finalBookButton, true);
    E.setInteractable(c.finalBagButton, true);
    this.startFinalAnswerHint();
  };
  TP.onFinalBookClicked = function () { this._clearHint("final"); this.handleFinalAnswer(this.isBookHeavier, this.c.finalBookImage); };
  TP.onFinalBagClicked = function () { this._clearHint("final"); this.handleFinalAnswer(!this.isBookHeavier, this.c.finalBagImage); };
  // Apply correct/wrong/neutral card state.
  // The green/red sprites carry a soft glow halo (native 828×578 / 765×515) whose solid card
  // rect equals the 652×402 card box. A background-image is clipped to the box, which chops
  // the halo into hard rectangular "lines". So for correct/wrong we paint the sprite on an
  // overlay sized to the sprite's NATIVE box, centred on the card and inserted BEHIND the book
  // image — the card's own overflow is visible, so the halo fades out smoothly onto the table.
  TP._setCardState = function (cardId, defaultSpritePath, state) {
    var el = E.get(cardId); if (!el) return;
    if (el._glow) { el._glow.parentNode && el._glow.parentNode.removeChild(el._glow); el._glow = null; }
    el.style.backgroundRepeat = "no-repeat";
    el.style.backgroundPosition = "center";
    var sprite = state === "correct" ? this.c.correctSprite : (state === "wrong" ? this.c.wrongSprite : null);
    if (sprite && sprite.nativeSize) {
      el.style.backgroundImage = "none"; // the overlay carries the full card + glow
      var bw = parseFloat(el.style.width) || el.offsetWidth || 652;
      var bh = parseFloat(el.style.height) || el.offsetHeight || 402;
      var nw = sprite.nativeSize[0], nh = sprite.nativeSize[1];
      var g = document.createElement("div");
      g.style.position = "absolute";
      g.style.pointerEvents = "none";
      g.style.width = nw + "px"; g.style.height = nh + "px";
      g.style.left = ((bw - nw) / 2) + "px";
      g.style.top = ((bh - nh) / 2) + "px";
      g.style.backgroundImage = "url('" + sprite.path + "')";
      g.style.backgroundRepeat = "no-repeat";
      g.style.backgroundSize = "100% 100%"; // box = native size, so no distortion
      el.insertBefore(g, el.firstChild); // behind the book/bag image child
      el._glow = g;
    } else if (defaultSpritePath) {
      el.style.backgroundImage = "url('" + defaultSpritePath + "')";
      el.style.backgroundSize = "100% 100%"; // neutral card fills its box
    }
  };
  TP.handleFinalAnswer = function (isCorrect, imgId) {
    E.setInteractable(this.c.finalBookButton, false);
    E.setInteractable(this.c.finalBagButton, false);
    if (isCorrect) {
      this._setCardState(imgId, null, "correct");
      E.confetti(imgId || this.c.finalBookButton);
      this.correctFinalAnswerFlow();
    } else {
      this._setCardState(imgId, null, "wrong");
      this.wrongFinalAnswerFlow();
    }
  };
  TP.correctFinalAnswerFlow = async function () {
    await this.playInstructionAndWait(this.c.correctAnswerInstruction, this.c.correctAnswerAudio_path);
    E.setActive(this.c.nextButton, true);
  };
  TP.wrongFinalAnswerFlow = async function () {
    await this.playInstructionAndWait(this.c.wrongAnswerInstruction, this.c.wrongAnswerAudio_path);
    E.setActive(this.c.finalTryAgainButton, true);
  };
  TP.onFinalTryAgainClicked = function () {
    var c = this.c;
    E.setActive(c.finalTryAgainButton, false);
    if (c.finalBookImage && c.defaultBookSprite) this._setCardState(c.finalBookImage, c.defaultBookSprite.path, "neutral");
    if (c.finalBagImage && c.defaultBagSprite) this._setCardState(c.finalBagImage, c.defaultBagSprite.path, "neutral");
    E.setInteractable(c.finalBookButton, true);
    E.setInteractable(c.finalBagButton, true);
    this.isRetryingFinalTap = true;
    this.startTapActivity();
  };

  /* ---- less / more cubes ---- */
  TP.onLessCubes = function () { E.setActive(this.c.instructionBar, true); this._lessMoreFlow(); };
  TP.onMoreCubes = function () { E.setActive(this.c.instructionBar, true); this._lessMoreFlow(); };
  TP._lessMoreFlow = function () {
    E.setActive(this.c.instructionBar, false);
    E.setActive(this.c.tryAgainButton, true);
    if (this.c.tryAgainAudio_path) { E.Audio.stop(); E.Audio.playOneShot(this.c.tryAgainAudio_path); }
    this._hintTimer("tryagain", this.c.buttonHintDelay, null, this.c.tryAgainButton);
  };

  /* ---- compare-stage layout (both cards + their "Weight of … = N blocks" text) ----
     Only the comparison views enlarge/space the two cards and re-seat the caption below
     the illustration with padding + no wrap, so the text never touches or overflows the
     card border. The initial "select a balance" stage keeps the authored (smaller) cards. */
  Tut.COMPARE_LAYOUT = {
    bookCard: { left: 40, top: 250, w: 880, h: 560 },
    bagCard:  { left: 1000, top: 250, w: 880, h: 560 },
    bookText: { left: 60, top: 690, w: 840, h: 80, fontSize: 40 },
    bagText:  { left: 1020, top: 690, w: 840, h: 80, fontSize: 40 }
  };
  TP._applyCompareLayout = function () {
    var c = this.c, L = Tut.COMPARE_LAYOUT;
    function card(id, r) { var el = E.get(id); if (!el) return; el.style.left = r.left + "px"; el.style.top = r.top + "px"; el.style.width = r.w + "px"; el.style.height = r.h + "px"; }
    function txt(id, r) {
      var el = E.get(id); if (!el) return;
      el.style.left = r.left + "px"; el.style.top = r.top + "px"; el.style.width = r.w + "px"; el.style.height = r.h + "px";
      if (el._tmpInner) { el._tmpInner.style.fontSize = r.fontSize + "px"; el._tmpInner.style.whiteSpace = "nowrap"; }
    }
    card(c.bookButton, L.bookCard); card(c.bagButton, L.bagCard);
    txt(c.bookCompletedText, L.bookText); txt(c.bagCompletedText, L.bagText);
  };

  /* ---- final result sequence ---- */
  TP.finalResultSequence = async function () {
    var c = this.c;
    this._applyCompareLayout();
    E.setActive(c.tapPanel, false);
    E.setActive(c.selectionPanel, true);
    E.setActive(c.instructionBar, false);
    if (c.finalBookImage) E.setImageAlpha(c.finalBookImage, 1);
    if (c.finalBagImage) E.setImageAlpha(c.finalBagImage, 1);
    E.setActive(c.bookButton, true); E.setActive(c.bagButton, true);
    if (c.bookCompletedText) E.setActive(c.bookCompletedText, false);
    if (c.bagCompletedText) E.setActive(c.bagCompletedText, false);
    E.setScale(c.bookButton, 0); E.setScale(c.bagButton, 0);
    await E.tween(0.55, "OutCubic", (t) => E.setScale(c.bookButton, t));
    await E.wait(0.15);
    if (c.bookCompletedText) { var m1 = E.getText(c.bookCompletedText); E.setActive(c.bookCompletedText, true); await this._typeTMP(c.bookCompletedText, m1, c.bookCompleteInstructionAudio_path); }
    await E.wait(0.25);
    await E.tween(0.55, "OutCubic", (t) => E.setScale(c.bagButton, t));
    await E.wait(0.15);
    if (c.bagCompletedText) { var m2 = E.getText(c.bagCompletedText); E.setActive(c.bagCompletedText, true); await this._typeTMP(c.bagCompletedText, m2, c.bagCompleteInstructionAudio_path); }
    await E.wait(0.35);
    E.setActive(c.instructionBar, false);
    E.setActive(c.bottomBar, true);
    await this._typeBottom(c.compareInstruction, c.compareInstructionAudio_path);
    await E.wait(2);
    E.setActive(c.bottomBar, false);
    if (c.bookCompletedText) E.setActive(c.bookCompletedText, false);
    if (c.bagCompletedText) E.setActive(c.bagCompletedText, false);
    if (c.bookButtonImage && c.defaultFinalBookSprite) E.setSprite(c.bookButtonImage, c.defaultFinalBookSprite.path, true);
    if (c.bagButtonImage && c.defaultFinalBagSprite) E.setSprite(c.bagButtonImage, c.defaultFinalBagSprite.path, true);
    if (this.isBookHeavier) { if (c.bagButtonImage) E.setImageAlpha(c.bagButtonImage, c.wrongAnswerAlpha != null ? c.wrongAnswerAlpha : 0.6); }
    else { if (c.bookButtonImage) E.setImageAlpha(c.bookButtonImage, c.wrongAnswerAlpha != null ? c.wrongAnswerAlpha : 0.6); }
    E.setActive(c.instructionBar, true);
    await this.playInstructionAndWait(c.finalConclusionInstruction, c.finalConclusionAudio_path);
    await E.wait(1);
    if (this.isLastLevel) this.showGameOverFlow();
    else E.setActive(c.finalnextButton, true);
  };
  TP._typeBottom = function (msg, clip) { var self = this; this._botTok = { cancelled: false }; return this._typeInto((t) => E.setText(self.c.bottomBarText, t), msg || "", clip, this._botTok); };

  TP.showGameOverFlow = async function () {
    var c = this.c;
    await E.wait(1.5);
    E.setActive(c.nextButton, false);
    if (c.finalnextButton) E.setActive(c.finalnextButton, false);
    if (c.instructionBar) E.setActive(c.instructionBar, false);
    if (c.completionBar) E.setActive(c.completionBar, false);
    if (c.gameOverPanel) E.setActive(c.gameOverPanel, true);
    E.confetti(c.gameOverPanel || c.selectionPanel);
    if (c.finalVO_path) E.Audio.play(c.finalVO_path);
  };

  /* ---- hints (simplified: pulsing ring highlight on the target) ---- */
  TP._hintTimer = function (key, delaySec, targetId, altId) {
    var self = this; this._clearHint(key);
    var tid = targetId || altId; if (!tid) return;
    this._timers[key] = setTimeout(function () { self._showRing(key, tid); }, (delaySec || 3) * 1000);
  };
  TP._showRing = function (key, targetId) {
    var el = E.get(targetId); if (!el) return;
    this._rings = this._rings || {};
    if (this._rings[key]) return;
    // For interactive buttons (plus / minus / final choice) show an animated hand nudge,
    // positioned just below-right of the button so it never covers the label.
    var hand = document.createElement("div"); hand.className = "hint-hand";
    var w = parseFloat(el.style.width) || el.offsetWidth || 120;
    var h = parseFloat(el.style.height) || el.offsetHeight || 120;
    // Anchor the gif's fingertip (≈ 50% across, 38% down its box) onto a point on the
    // target so the hand sits ON the button pointing up, like the reference art.
    var HAND = 210, FTX = 0.5, FTY = 0.38;
    // Three target shapes, three fingertip anchors:
    //  • round +/- buttons (small)            → point near the top (hand sits on the button)
    //  • the Check bar (wide + short, bottom)  → point high so the hand body stays on-screen
    //  • the big answer cards (wide + tall)    → point near the card bottom, hand hangs below
    var wide = w > 260;
    var shortBar = wide && h < 150;
    var tx = w * 0.5;
    var ty = shortBar ? 0 : (wide ? h * 0.88 : h * 0.20);
    hand.style.left = (tx - FTX * HAND) + "px";
    hand.style.top = (ty - FTY * HAND) + "px";
    // set the size inline too (CSS already sizes it) so tools/editors read a real box, not 0×0
    hand.style.width = HAND + "px";
    hand.style.height = HAND + "px";
    el.appendChild(hand);
    this._rings[key] = hand;
  };
  TP._clearHint = function (key) {
    if (this._timers[key]) { clearTimeout(this._timers[key]); this._timers[key] = null; }
    if (this._rings && this._rings[key]) { this._rings[key].remove(); this._rings[key] = null; }
  };
  TP.startSelectionButtonHint = function () {
    var self = this, c = this.c;
    this._clearHint("selection");
    this._timers["selection"] = setTimeout(function () {
      if (self.currentSelected !== 0) return;
      if (c.bookGlow) E.setActive(c.bookGlow, false);
      if (c.bagGlow) E.setActive(c.bagGlow, false);
      // Highlight the card the learner should tap with BOTH cues, so the selection stage
      // matches every other idle control (+/−/Check/final answer all nudge with a hand):
      //   • the glow sprite highlights the card, and
      //   • the animated hand points at it (anchored on the card itself).
      var glowNode = null, handTarget = null;
      if (!self.bookCompleted) { glowNode = c.bookGlow; handTarget = c.bookButton; }
      else if (!self.bagCompleted) { glowNode = c.bagGlow; handTarget = c.bagButton; }
      if (glowNode) E.setActive(glowNode, true);
      if (handTarget) self._showRing("selection", handTarget);
    }, (c.selectionHintDelay || 12) * 1000);
  };
  TP.hideSelectionHint = function () {
    this._clearHint("selection");
    if (this.c.bookGlow) E.setActive(this.c.bookGlow, false);
    if (this.c.bagGlow) E.setActive(this.c.bagGlow, false);
  };
  TP.startFinalAnswerHint = function () {
    var self = this; this._clearHint("final");
    this._timers["final"] = setTimeout(function () {
      var tgt = self.isBookHeavier ? self.c.finalBookButton : self.c.finalBagButton;
      if (tgt) self._showRing("final", tgt);
    }, (this.c.finalHintDelay || 3) * 1000);
  };
  TP.startPlusHintDelay = TP.resetPlusHintState = function () {
    var self = this; this.plusClicked = false; this._clearHint("plus");
    if (!this.instruction3Completed) return;
    this._timers["plus"] = setTimeout(function () {
      if (self.plusClicked) return;
      if (self.game) self._showRing("plus", self.c.plusButtonTarget || self.game.c.plusButton);
    }, (this.c.plusHintDelay || 3) * 1000);
  };
  TP.restartPlusHint = function () { /* Unity impl is empty */ };
  TP.showMinusHint = TP.resetMinusHintState = function () {
    var self = this; this._clearHint("minus");
    this._timers["minus"] = setTimeout(function () {
      if (self.game) self._showRing("minus", self.c.minusButtonTarget || self.game.c.minusButton);
    }, (this.c.minusHintDelay || 1.5) * 1000);
  };
  TP.onPlusClicked = function () { this.plusClicked = true; this._clearHint("plus"); };
  TP.onMinusClicked = function () { this._clearHint("minus"); };
  TP.hideInstructionBar = function () {
    E.setActive(this.c.instructionBar, false);
    this.stopCurrentInstruction();
    E.setText(this.c.instructionText, "");
  };

  /* ===================================================================
     Level manager + button-event dispatch + ButtonAnimator
     =================================================================== */
  function LevelManager() {
    this.levels = [];         // {node, game, tut, started}
    this.byNode = {};
  }
  LevelManager.prototype.init = function () {
    var self = this;
    CFG.levels.forEach(function (L) {
      var tut = new Tut(L.tut);
      var game = new WeightMeasuringGame(L.game, tut);
      // Weight-block size. Square, so background-size:contain maps the sprite 1:1. Sized so the widest
      // row of the pyramid (4 blocks, one painted width apart) fits the bowl’s painted opening:
      // 4 x 0.6836 x 130 = 355px inside 363px.
      game.cubePrefab = { size: [130, 130] };
      // Use ONE cube art on every level so blocks look identical throughout (levels 2–4 shipped
      // a smaller-drawn 'block_small_*' sprite that made the block appear smaller than level 1).
      game.c.normalCubeSprite = { path: "assets/img/Group_471__1_.webp", nativeSize: [177, 177] };
      game.c.wrongCubeSprite = { path: "assets/img/Group_4712.webp", nativeSize: [177, 177] };
      tut.game = game;
      var entry = { node: L.levelNode, game: game, tut: tut, started: false, cfg: L };
      self.levels.push(entry);
      self.byNode[L.levelNode] = entry;
      // register game/tut fids too for button-event target resolution
      self.byNode[String(L.tutFid)] = entry;
      self.byNode[String(L.gameFid)] = entry;
    });
    this._warmAssets();
    // wire button events (SetActive level swaps, OnNextClicked, intro Play/Stop)
    this._wireButtonEvents();
    // ButtonAnimator (intro Lets go)
    this._buttonAnimator();
    // start level 1 (its GO active in scene? Level1 root is inactive; ButtonAnimator shows it)
    // Level roots are inactive at boot; they start when made active.
    this._watchActivation();
  };

  // Warm every sprite and VO clip a later screen will need, so nothing arrives a beat after
  // the screen that needs it. Two separate cases used to show this:
  //   • the pan item — its sprite is only assigned when the learner picks a card, so on a
  //     cold cache the bowl sat empty for as long as that download took;
  //   • a whole level — a hidden level's background/scale/button art is never fetched until
  //     the level is switched on, so the new level assembled itself piece by piece.
  // Ordered by play order (level 1's art first) so the queue matches what is needed soonest.
  LevelManager.prototype._warmAssets = function () {
    var images = [], audio = [], seen = {};
    function push(v) {
      if (!v || seen[v]) return;
      seen[v] = 1;
      if (/\.(webp|png|jpe?g|gif)$/i.test(v)) images.push(v);
      else if (/\.(ogg|mp3|wav|m4a)$/i.test(v)) audio.push(v);
    }
    function walk(v, depth) {
      if (!v || depth > 6) return;
      if (typeof v === "string") return push(v);
      if (typeof v !== "object") return;
      Object.keys(v).forEach(function (k) { walk(v[k], depth + 1); });
    }
    // The items the learner can pick on the FIRST level are the ones that used to arrive late, so
    // they are fetched and decoded straight away rather than waiting for an idle moment.
    var first = this.levels[0];
    var critical = first ? [first.cfg.game.bookSprite, first.cfg.game.bagSprite]
      .map(function (s) { return s && s.path; }).filter(Boolean) : [];
    critical.forEach(push);
    E.decodeImages(critical);

    this.levels.forEach(function (entry) {
      var root = E.get(entry.node);   // sprites the engine already applied to this level's nodes
      if (root) Array.prototype.forEach.call(root.querySelectorAll("[data-sprite]"), function (el) { push(el.dataset.sprite); });
      walk(entry.cfg, 0);             // plus the sprites/clips that level swaps in at runtime
    });
    walk(CFG, 0);                     // intro + anything not owned by a level
    // Everything else starts once the browser is idle, never during boot: the intro screen's own
    // art must win the connection. The learner still has the intro and two spoken lines to sit
    // through, and each level's cards wait on their own art being decoded (itemArtReady).
    function warm() { E.preloadImages(images); E.preloadAudioMeta(audio); }
    if (global.requestIdleCallback) global.requestIdleCallback(warm, { timeout: 1500 });
    else setTimeout(warm, 1200);
  };

  LevelManager.prototype._ensureStarted = function (entry) {
    if (entry.started) return;
    entry.started = true;
    // Analytics: level start
    var idx = this.levels.indexOf(entry);
    if (typeof window.SendLevelStart === "function") try { window.SendLevelStart(idx, this.levels.length); } catch (e) { }
    entry.tut.start();
    entry.game.start();
  };

  LevelManager.prototype._watchActivation = function () {
    // When a level node becomes visible, start it once.
    var self = this;
    E.onTick(function () {
      self.levels.forEach(function (entry) {
        if (!entry.started && E.isActive(entry.node)) self._ensureStarted(entry);
      });
    });
  };

  // Level switch — instant swap. (The themed "Level Complete → Next Challenge" transition
  // was removed; levels now change immediately.) A rapid second click just re-swaps the same
  // pair harmlessly, and _ensureStarted is idempotent, so no level is ever started twice.
  LevelManager.prototype._runLevelTransition = function (offNode, onNode) {
    var offEntry = this.byNode[offNode], onEntry = this.byNode[onNode];
    var idx = this.levels.indexOf(offEntry);
    if (typeof window.SendLevelComplete === "function") try { window.SendLevelComplete(idx, this.levels.length); } catch (e) { }
    // leaving a screen: nothing from the old one should still be sounding
    if (global.SFX && global.SFX.stop) global.SFX.stop();
    if (offEntry && offEntry.tut) offEntry.tut.stopCurrentInstruction();
    E.setActive(offNode, false);
    E.setActive(onNode, true);
    if (onEntry) this._ensureStarted(onEntry);
  };

  LevelManager.prototype._wireButtonEvents = function () {
    var self = this;
    var BE = CFG.buttonEvents || {};
    Object.keys(BE).forEach(function (hostNode) {
      var be = BE[hostNode];
      // selection Book/Bag are handled by the tutorial's own onClick (skip SelectBook/SelectBag here to avoid double flow)
      var meaningful = be.calls.filter(function (c) { return c.method !== "SelectBook" && c.method !== "SelectBag"; });
      if (!meaningful.length) return;
      // A level-switch (finalNext) fires paired SetActive calls on two level nodes:
      // one OFF (current) + one ON (next). Route those through the themed transition
      // instead of an instant swap.
      var setActives = meaningful.filter(function (c) { return c.method === "SetActive"; });
      var onCall = null, offCall = null;
      setActives.forEach(function (c) {
        if (self.byNode[c.target]) { if (c.bool) onCall = c; else offCall = c; }
      });
      var isLevelSwitch = onCall && offCall && setActives.length === meaningful.length;
      E.onClick(hostNode, function () {
        if (isLevelSwitch) { self._runLevelTransition(offCall.target, onCall.target); return; }
        meaningful.forEach(function (call) { self._dispatch(call); });
      });
    });
  };

  LevelManager.prototype._dispatch = function (call) {
    var self = this;
    if (call.method === "SetActive") {
      E.setActive(call.target, !!call.bool);
      if (call.bool) { var e = this.byNode[call.target]; if (e) this._ensureStarted(e); }
    } else if (call.method === "OnNextClicked") {
      var entry = this.byNode[call.target];
      if (entry) entry.tut.onNextClicked();
    } else if (call.method === "Play") {
      if (CFG.introAudio) E.Audio.play(CFG.introAudio);
    } else if (call.method === "Stop") {
      E.Audio.stop();
    }
  };

  LevelManager.prototype._buttonAnimator = function () {
    var ba = CFG.buttonAnimator; if (!ba) return;
    var self = this;
    // pulse the Go button (scale 0.8<->1 InOutSine yoyo)
    var t0 = performance.now();
    var goId = ba.goButton;
    var pulsing = true;
    E.onTick(function () {
      if (!pulsing) return;
      var t = ((performance.now() - t0) / 1000) % 2 / 2; // 1s each way
      var v = t < 0.5 ? E.ease("InOutSine", t * 2) : E.ease("InOutSine", (1 - t) * 2);
      E.setScale(goId, 0.8 + 0.2 * v);
    });
    E.setActive(ba.gameplayPanel, false); // Level1 hidden until Go
    var introEl = document.querySelector('#stage > [data-name="Intro"]');
    E.onClick(goId, function () {
      if (ba.buttonClickAudio) E.Audio.playOneShot(ba.buttonClickAudio);
      pulsing = false;
      E.setInteractable(goId, false);
      setTimeout(function () {
        E.setActive(goId, false);
        if (introEl) introEl.style.display = "none"; // leave the intro screen entirely
        E.setActive(ba.gameplayPanel, true);   // show Level1 -> triggers its start via watcher
      }, (ba.audioDelayBeforeDisable || 0.3) * 1000);
    });
  };

  global.Game = { LevelManager: LevelManager, WeightMeasuringGame: WeightMeasuringGame, Tut: Tut };
})(window);
