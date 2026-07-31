# Asset Audit — Balancing Act

_Generated during the level-transition + voice-over sync work._

Scope: every asset referenced by level data (`js/data.js` → `CONFIG` + `LAYOUT`),
runtime sprite/audio maps (`js/controllers.js`, `needle-fix.js`), CSS, and the God Mode
suite was cross-checked against the files on disk in `assets/`.

## Summary

| Bucket | Before | After |
|---|---|---|
| Files on disk (`assets/`) | 132 | **130** |
| Referenced-but-missing | 0 | 0 (see VO note) |
| On-disk-but-unreferenced | 0 | 0 |
| Byte-identical duplicates | 2 pairs | **0** |

Every non-duplicate file is bound to a live layout node or a runtime map, so nothing else
is safe to delete without changing the rendered scene. No file was removed on a guess.

## Removed (safe — byte-identical duplicates)

Each redundant copy was **repointed in `js/data.js` to its identical twin** (verified by
MD5 + re-parse of `data.js`), then the orphaned file was deleted:

| Deleted file | Repointed to | Refs moved | Saved |
|---|---|---|---|
| `assets/img/Copy_of_Slide_16_9_-_625.png` | `assets/img/Slide_16_9_-_625.png` | 4 | ~1.4 MB |
| `assets/img/Rectangle_92.png` | `assets/img/Rectangle_91.png` | 8 | ~17 KB |

No visual change: the pairs are identical bytes.

## Voice-Over audit (per the VO cleanup rules — nothing deleted)

- **50 audio clips**, all referenced by level data / runtime maps → **all treated as used**
  across every item and instruction variant. None deleted.
- **Duplicate audio:** none (MD5 compared).
- **Silent / corrupt suspects:** none (no clip < 3 KB).
- **Missing narration (intentional, handled gracefully):**
  - `assets/audio/Level_Complete.ogg`
  - `assets/audio/Next_Challenge.ogg`

  These are the optional clips for the new transition. The project ships **no** matching
  narration for "Level Complete" / "Next Challenge" and does **not** use text-to-speech,
  so `VoiceTextSync` falls back to an estimated duration and reveals the text in time
  (the muted/failed-load path). Drop real clips at those paths later and they play
  automatically — no code change needed. The visible text will always match the spoken
  line, so no mismatched existing clip was substituted.

## Not removed (and why)

- `assets/img/block_small.png`, `block_small_normal.png` — the cube spawn sprite is
  overridden at runtime (`controllers.js` uses `Group_471__1_.png` on every level), but
  these still back **33** authored layout nodes, so deleting them would break those nodes.
- `assets/img/Group1.png` (1013 B), `Group_-_Copy.png` (984 B) — tiny but real, referenced
  sprites; kept.

## How to re-run

```
node scratchpad/audit.js <project-root>        # referenced vs on-disk, unused, missing
node scratchpad/dup.js   <project-root>        # duplicate images + tiny files
node scratchpad/audio-audit.js <project-root>  # duplicate / silent audio
```
