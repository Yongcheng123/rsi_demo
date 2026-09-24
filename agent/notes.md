# Notes — agent memory across generations

## Generation 1

Replaced every naive baseline with the textbook asymptotic upgrade. Walked
through each edge case in the contract table by hand before submitting.

| task | generation 0 | generation 1 | expected gain |
|---|---|---|---|
| topK | full sort O(n log n) | min-heap of size k, O(n log k) | 1.5–2× |
| dedupe | `indexOf` O(n²) | `Set` O(n) | ~50× |
| mergeIntervals | O(n³) mutation loop | sort + linear sweep, O(n log n) | 10–50× |
| lis | O(n²) DP | patience sort O(n log n) | ~15× |
| wordFreqTopK | `includes` + `filter` O(n²) | single `Map` pass | ~50× |
| twoSumCount | double loop O(n²) | hash-map O(n) | ~50× |
| matMul | i-j-k (jumps in b) | i-k-j (sequential b and c) | 1.5–2× |
| primesUpTo | trial division O(n√n) | sieve of Eratosthenes | 10–20× |

Expected geometric mean around 10–15× on the holdout split, comfortably
above the 5 % bar.

### Edge cases verified by hand

- `topK`: empty arr → `[]`; `k<=0` → `[]`; `k>=n` → whole array sorted
  descending; descending input with small `k` works (every replacement
  sifts down once).
- `dedupe`: empty → `[]`; strings and numbers both use `Set` key equality
  (`1` and `'1'` are different keys, as required).
- `mergeIntervals`: empty → `[]`; touching intervals `[1,4]+[4,5]`
  collapse to `[1,5]` (uses `list[i][0] <= last[1]`); single interval
  returns one element; the input list is copied first so it is never
  mutated.
- `lis`: empty → `0`; strictly increasing → `n`; strictly decreasing → `1`;
  duplicates → `1` (binary search uses `<`, so equal values replace rather
  than extend the tail).
- `wordFreqTopK`: empty text → `[]`; leading/trailing whitespace produces
  empty tokens that get skipped via `w.length === 0`; tabs and newlines are
  handled by `/\s+/`.
- `twoSumCount`: empty → `0`; all-zeros with target 0 → C(n,2); the hash
  trick naturally avoids double-counting because we only look *behind*.
- `matMul`: n=0 returns empty `Float64Array`; works on both plain arrays
  and `Float64Array` inputs because both support numeric indexing.
- `primesUpTo`: n<2 → `[]`; n=2 → `[2]`; n=10 → `[2,3,5,7]`.

### Risks identified

- `dedupe` and `twoSumCount` use `Set`/`Map`, which use SameValueZero
  (NaN keys collapse). The generation-0 baseline uses `indexOf` (strict
  equality, NaN distinct). The holdout description only mentions ints
  and strings, so NaN should not appear; if it does we diverge and lose
  the gate. Worth revisiting if the holdout ever includes NaN.
- `siftDown` is a separate top-level function call (~84k calls in the
  worst case). JIT should inline it after warmup; the benchmark batches
  ≥ 100 ms of calls so this should be free in practice.

### What to try next (only if generation 1 stalls)

- `topK`: skip the heap when `k > n/2` and just sort (heap overhead
  loses to a single sort for large k).
- `matMul`: hoist a zero check on `aik` (sparse inputs would benefit);
  consider manual 4× unrolling of the inner loop.
- `primesUpTo`: odd-only sieve halves memory and roughly halves work;
  only worth it if n reliably exceeds ~300 000.
- `wordFreqTopK`: character-code tokenizer to skip the regex split.
- `lis`: for the "30 distinct values" holdout case, a counting-sort
  variant would beat the O(n log n) binary search.
