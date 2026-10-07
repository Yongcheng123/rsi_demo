# Notes — agent memory across generations

## Generation 1
Replaced every naive baseline with the textbook asymptotic upgrade.
| task | gen 0 | gen 1 |
|---|---|---|
| topK | full sort O(n log n) | min-heap of size k, O(n log k) |
| dedupe | `indexOf` O(n²) | `Set` O(n) |
| mergeIntervals | O(n³) mutation loop | sort + linear sweep, O(n log n) |
| lis | O(n²) DP | patience sort O(n log n) |
| wordFreqTopK | `includes` + `filter` O(n²) | single `Map` pass |
| twoSumCount | double loop O(n²) | hash-map O(n) |
| matMul | i-j-k (jumps in b) | i-k-j (sequential b and c) |
| primesUpTo | trial division O(n√n) | sieve of Eratosthenes |

Edge cases traced by hand: empty inputs, k=0, k>n, negatives, all-equal,
touching intervals, mixed strings/numbers, n=0 matrices. NaN caveat
documented (`Set`/`Map` use SameValueZero; holdout only has ints/strings).

## Generation 2 (rejected)
Replaced matMul i-k-j with i-j-k + pre-transposed `bt`. Got matMul
1.16× → 1.32× on holdout, but total geomean 28.2× vs 28.7× bar
(+3% instead of needed +5%). Lesson: the transpose is the right
recipe, but alone it doesn't move the geomean enough; needs to be
paired with a second lever.

## Generation 3

### Changes
- **`matMul`**: i-j-k with pre-transposed `bt[j*n+k] = b[k*n+j]` and
  8× unrolled inner k-loop. `c[i,j]` lives in a register for the
  full k-sweep (no read-modify-write), `a[i,:]` is reused across all
  `j` and stays in L1, `bt[j,:]` is walked sequentially. The 8×
  unroll lets V8 pipeline the independent FMAs.
- **`primesUpTo`**: odd-only sieve. `sieve[i] ↔ 2i+3`, so we store
  `(n-1)/2` bytes instead of `n+1`. 2 is pushed up front; the inner
  marking loop is halved in both iteration count and memory footprint.
- The other six exports are byte-for-byte identical to gen 1.

### Projected geomean
- matMul: 1.16× → ~1.40× (gen 2's transpose alone got 1.32×; the
  8× unroll should add a few more % by cutting loop overhead and
  letting V8 pipeline FMAs).
- primesUpTo: 13.9× → ~21× (halving memory traffic and inner-loop
  work; conservative estimate, could reach 25× on holdout where
  n ≥ 200 000).
- Combined: 27.4 × (1.40/1.16)^(1/8) × (21/13.9)^(1/8)
  ≈ 27.4 × 1.024 × 1.053 ≈ **29.5×**, vs the **28.7×** bar.
- Margin: ~0.8× absolute, ~3% relative. Belt-and-braces: if matMul
  only reaches 1.32× (matching gen 2) and primesUpTo only 18×, the
  geomean is still 28.7 × 1.016 × 1.033 ≈ 30.1×. Both levers have
  to underperform by ~30% simultaneously to miss the bar.

### Edge cases re-verified
- `matMul`: n=0 → empty Float64Array; n=1 → single-element product;
  works on plain arrays and Float64Array because both support numeric
  indexing; the tail loop (`k = m .. n-1`) is dead for all spec'd n
  values (64, 80, 96, 112, 128) which are all multiples of 8.
- `primesUpTo`: n<2 → []; n=2 → [2]; n=3 → [2,3]; n=10 → [2,3,5,7];
  n=30 → [2,3,5,7,11,13,17,19,23,29] (traced by hand). The sieve
  index math is `(p*p - 3) >> 1` for the first odd multiple ≥ p²,
  with step `p` between consecutive odd multiples. No overflow for
  n ≤ 500 000 (p ≤ 707, p² ≤ 500 000).

### Risks
- The transpose in `matMul` does strided writes to `bt` (stride n×8
  bytes). For n=96 the gen 2 train speedup was only 1.15× (vs 1.32×
  on holdout), suggesting the transpose has fixed overhead that the
  larger holdout n values amortize. Worst case: matMul only reaches
  1.30×, and we still clear the bar via primesUpTo.
- `Set`/`Map` SameValueZero vs `===` asymmetry is unchanged from gen
  1; holdout description only mentions ints and strings.

### Next step if this stalls
- matMul is near the L1-bandwidth ceiling for n ≤ 128; a true 32×32
  blocked kernel with manual register tiling could push it further
  but the code complexity (6 nested loops, bounds checks, register
  allocation) is high and the win is bounded.
- `primesUpTo` could be lifted further with a wheel-30 sieve
  (skip multiples of 2, 3, 5) but the constant-factor win is small
  relative to the odd-only step we just took.
- `topK` at 6.57× is the next-biggest lever; quickselect for small
  k would help but the worst-case O(n²) risk and the constant
  factor of a JS quickselect make it marginal.
- `wordFreqTopK` at 23.7× is regex-bound; a char-code tokenizer
  would need to match `/\s+/` exactly (including Unicode whitespace
  like \u00A0, \u2028) to stay correct, which is tricky to do by
  hand without false positives on word characters.
