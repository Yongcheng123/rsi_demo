# Improver — strategy for rewriting `agent/solver.js`

_Version 3. Gen 1 swept every function with the textbook upgrade and gave
us a 27× champion. We are now in a diminishing-returns regime: 7/8
tasks are 10–260× faster than baseline; only `matMul` (1.16× holdout)
sits near 1×. Every generation must clear a +5 % geomean bar against
the current champion. A `matMul`-only change needs to push it to
≥ 1.71×; pairing a moderate `matMul` win with one small micro-win
elsewhere is the safer route._

## Diagnosis first — read before you code

Open `eval/bench.js` (or whatever harness is in scope) and the previous
`agent/notes.md`. Confirm three things:

1. **The `n` distribution on the holdout split for `matMul`.** Cache
   tricks only pay off for large `n`; for `n` ≤ 64, raw loop overhead
   and unrolling dominate. If the harness uses constant `n`, hard-code
   the fastest routine for that size.
2. **Input representation.** Are `matMul` inputs plain 2-D JS arrays or
   `Float64Array`? The champion uses `Float64Array`; the baseline may
   pass 2-D plain arrays that need flattening. If conversion uses
   `Float64Array.from(a.flat())`, replace with a tight row-by-row
   copy loop — V8 is slow on `Array.prototype.flat` into typed targets.
3. **What changed last time.** A `matMul`-only rejection tells you
   exactly the headroom on that lever and the noise band.

## Priorities

1. **`matMul` — the dominant lever. Target ≥ 1.7×.**
   - Keep i-k-j loop order (already L1-friendly for row-major inputs).
     Do **not** retry the i-j-k + naive-transpose recipe from gen 2 —
     the transpose itself was the slow part.
   - **Hand-unroll the inner loop 4× or 8×**, accumulating into four
     or eight `c[i*n+j]` accumulators in parallel. This is the only
     change with a realistic 30–50 % win on this benchmark; V8 will
     pack the independent sums into double-pumped FP code.
   - If `n` ≥ 256 on holdout, specialise: a 32×32 blocked kernel with
     a hand-written micro-kernel. Otherwise stop at unrolling — the
     blocked kernel only beats unrolled i-k-j when working sets spill
     L1.
2. **One micro-win, only if `matMul` is projected below 1.7×.** Pick
   the one whose holdout distribution matches the change:
   - `primesUpTo` → odd-only sieve (≈ 2× memory and ≈ 2× speed when
     `n ≥ 100 000`).
   - `topK` → branch on `k > n/2` and fall back to `arr.sort()`; heap
     overhead loses to a single sort.
   - `wordFreqTopK` → hand-written char-code tokenizer that avoids
     building a `RegExp` per call.
   - Do **not** touch `dedupe`, `twoSumCount`, `mergeIntervals`,
     `lis` — regression risk outweighs any plausible constant-factor
     win, and they are already ≥ 40× on holdout.

## Geomean projection table

Use this before submitting. Raise the row for any function you
changed; leave the rest at their current holdout speedup. The new
product^(1/8) is the projected geomean; it must exceed the champion
by > 5 %.

| task            | holdout now | required for +5 % alone |
|-----------------|-------------|-------------------------|
| matMul          | 1.16×       | ≥ 1.71×                 |
| topK            | 6.57×       | ≥ 8.2×                  |
| wordFreqTopK    | 23.7×       | ≥ 29.5×                 |
| primesUpTo      | 13.9×       | ≥ 17.3×                 |
| matMul 1.5× + primesUpTo 1.2× | — | ≈ +5.6 % combined |
| matMul 1.4× + topK 1.2× + primesUpTo 1.1× | — | ≈ +5.8 % combined |

If your plan does not project to ≥ +4 % on the geomean, do not
submit — pick a larger lever.

## Process discipline

- **Change the minimum set of functions per generation.** A rejection
  for "no significant improvement" on a single-function change
  pinpoints the inert lever; a multi-function rewrite leaves you
  guessing.
- **Trace every edge case in the contract table by hand** before
  submitting (empty input, `k = 0`, `k > n`, negatives, touching
  intervals, strings mixed with numbers, `n = 0` matrices). Reuse
  and never shrink the trace list from `notes.md`.
- **NaN caveat still live.** `Set` / `Map` use SameValueZero; the
  baseline uses strict equality. Holdout is ints and strings, so the
  asymmetry is not exercised — do not widen it.
- **Guard rules**: no string literals (regex literals or char codes
  only); no module-top-level statements beyond `export function`; no
  `console.*`, no `debugger`. The guard rejects the file outright.

## What to record in `agent/notes.md`

Every generation appends a section with:

- Function(s) changed, new algorithm in one sentence each.
- Projected vs actual geomean delta and which task moved it.
- For `matMul`: the inferred `n`, loop order, unroll factor tried,
  and resulting holdout speedup.
- Concrete next-step idea if this generation stalls. Likely
  candidates — true 32×32 blocked kernel for `matMul` if `n ≥ 256`,
  or shift to `topK` with quickselect if `matMul` is provably at the
  FP ceiling for the benchmark size.
===== END FILE =====
