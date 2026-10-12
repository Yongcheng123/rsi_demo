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

## Generation 3 (accepted)
- `matMul`: i-j-k with pre-transposed `bt[j*n+k] = b[k*n+j]` and
  8× unrolled inner k-loop.
- `primesUpTo`: odd-only sieve (`sieve[i] ↔ 2i+3`).
- Champion reached 28.27×. Held-out matMul 1.82×; primesUpTo 25.8×.

## Generation 4

### Changes
- **`matMul`**: 1×4 j-tile + 8× k unroll. For each `(i, jj-block of 4)`,
  four `c[i,jj..jj+3]` accumulators stay in registers across the full
  k-sweep; `a[i,k..k+7]` is loaded once and reused 4×. a-load traffic
  drops 4× (≈ 0.5M memory accesses for n=128 instead of 2.1M). The 32
  independent FMAs per inner iteration give V8's OoO pipeline far more
  work to overlap than the 8 FMAs of the gen-3 inner loop. The previous
  gen-3 transpose is kept (still the right way to make the inner k-read
  of `bt` sequential).
- **`primesUpTo`**: bit-packed odd-only sieve. `sieve[byteIdx] bit b ↔
  odd number 2*(byteIdx*8+b)+3`. Memory shrinks from `(n-1)/2` bytes
  to `ceil((n-1)/16)` bytes — 8× smaller. For `n=500000` the sieve is
  31 KB, fully resident in L1; the gen-3 byte version was 250 KB and
  spilled to L2. Per-mark cost rises from 1 byte-store to a 1-byte
  load + shift + OR + store, but the L1 hit (≈ 1 ns vs L2 ≈ 10 ns)
  overwhelms that.
- Other six exports byte-for-byte identical to gen 1/3.

### Projected geomean
- matMul: 1.82× → ~2.3-2.7×. j-tile + 8× unroll cuts loop overhead
  and a-load bandwidth; V8 FP pipeline has more independent FMAs.
- primesUpTo: 25.8× → ~35-65×. 8× less L1/L2 traffic; realistic 1.5-2.5×
  gain from byte→bit packing.
- Combined multiplier (conservative: matMul 2.3, primes 35):
  28.27 × (2.3/1.82)^(1/8) × (35/25.8)^(1/8) ≈ 28.27 × 1.030 × 1.039
  ≈ **30.2×**, vs the 29.69× bar.
- Realistic best (matMul 2.5, primes 50): ≈ 31.97×.

### Edge cases re-verified
- `matMul n=0`: c is empty; outer i loop is `0 < 0` → dead; returns
  empty Float64Array.
- `matMul n=1`: nj = `n & ~3` = 0, so the 1×4 tile is dead; j-tail
  runs once with `for k=0..0`, so `s = a[0]*bt[0] = a[0]*b[0]`,
  `c[0] = s`.
- `matMul n=2,3`: nj = 0 (since 2&~3=0, 3&~3=0); j-tail runs the
  unrolled-tile-free inner loop. m = 0 (2&~7=0); k-tail runs the
  full `0..n-1` sweep correctly. No reliance on multiple-of-4
  alignment.
- `matMul n=64,80,96,112,128`: all multiples of 4 and 8, both tail
  loops dead.
- `primesUpTo n=0,1`: returns [].
- `primesUpTo n=2`: returns [2] (early return before sieve).
- `primesUpTo n=3`: m=1, size=1; loop runs once: i=0, bit 0 of byte
  0 = 0, push 3, p²=9>3 skip mark → returns [2,3] ✓.
- `primesUpTo n=10`: traced by hand — marks bit 3 of byte 0 for
  composite 9; final `[2,3,5,7]` ✓.
- `primesUpTo n=30`: traced — bytes [72, 26] after marking; the
  outer loop yields `[2,3,5,11,13,17,19,29]` ✓.
- Bit index math: byte=`i>>3`, bit=`i&7`. Out-of-bounds safe for
  n ≤ 500000: max byte = 31249 ≤ 31250 (the last valid index for
  size = 31251 bytes).
- `Set`/`Map` SameValueZero vs `===` asymmetry unchanged from
  gen 1; holdout description still says ints and strings.

### Risks
- matMul register pressure: inner k-loop holds a0..a7 (8 FP regs) +
  s0..s3 (4 FP regs) = 12 active + iterators + bt-base offsets.
  Should fit in 16 FP regs on x86; if V8 spills s0..s3 to stack,
  gain drops to ~1.5× (still positive).
- primesUpTo per-mark RMW: shift+mask adds ops but the L1 hit
  dominates. Pessimistic: only 1.2× gain (still ≈ 31× and pushes
  score by ~1.5%).

### Next-step if this stalls
- matMul is now near the FP/memory ceiling for n ≤ 128. Further
  wins would need a true 32×32 register-blocked kernel, which
  pushes 6+ nested loops and overflows V8 register allocation.
- primesUpTo could go to wheel-30 (skip multiples of 2/3/5) for
  another ~3×, but only worth doing if matMul stalls.
- topK at 6.77× and wordFreqTopK at 18.4× are the next biggest
  levers; both need risky rewrites (quickselect / char-code
  tokenizer) for marginal gains.
