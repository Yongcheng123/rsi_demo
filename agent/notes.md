# Notes — agent memory across generations

## Contract and static constraints
- Export exactly topK, dedupe, mergeIntervals, lis, wordFreqTopK,
  twoSumCount, matMul, and primesUpTo.
- No imports, string/template literals, this, classes, typeof, eval, or top-level
  mutable state.
- Top-level declarations may only be exported/nonexported functions or numeric
  or function constants.
- Every call allocates its own working state and does not mutate arguments.

## Historical results
- Gen 1 established the standard fast algorithms and a roughly 25× champion.
- Gen 2's transposed matMul and Gen 3's unroll were insufficient alone.
- Gen 4 established the useful 1x4 matMul register tile and odd-only sieve.
- Gen 5's 2x4 matMul tile regressed matMul from about 3.09× to 2.36×.
- Gen 6 added topK monotonic paths, hybrid selection, and segmented sieving.
- Gen 6 was accepted at 39.0346× versus 33.4247×.
- Gen 7 added dense dedupe, cutoff word-frequency selection, and segmented odd
  primes; it was accepted at 45.3569× versus 37.5188×.
- Gen 8 was rejected because its topK change lost duplicate-heavy inputs.
- Gen 9's isolated two-sum experiment did not clear the significance threshold.
- Gen 10 was rejected because its new prime template produced wrong boundaries.
  Its two-sum path itself was correct and measured 321× train and 359× holdout.

## Latest sealed champion
- Score: 45.5× geometric mean.
- Holdout speedups: topK 35.6×, dedupe 77.4×, merge 125×, lis 260×,
  word frequency 29.9×, two-sum 90.1×, matMul 3.18×, primes 24.1×.
- Train speedups: topK 18.9×, dedupe 90.7×, merge 81.1×, lis 175×,
  word frequency 21.5×, two-sum 37.6×, matMul 2.86×, primes 19.8×.
- Acceptance requires more than 47.8× in the paired holdout run.

## Generation 11 candidate
- Only twoSumCount changes; all seven proven champion kernels are retained.
- A first pass obtains the minimum and maximum value.
- An all-equal input is answered directly: choose(len, 2) exactly when twice the
  value equals the target, otherwise zero.
- When the complete numeric span is at most four times the input length, a
  Uint32Array frequency table replaces Map hashing. A second pass queries the
  already-seen complement before incrementing the current value, so each i<j
  pair is counted exactly once and duplicate occurrences remain distinct.
- Sparse or very wide integer ranges retain the proven Map implementation.
- The rejected gen-10 run measured this bounded-table strategy at 321× train
  and 359× holdout, versus 37.6× and 90.1× for the champion. Those correspond
  to factors of about 8.54× and 3.98×.
- With every other task unchanged, the measured holdout factor projects the
  aggregate to about 54.1×: 45.5×3.98^(1/8). Even a conservative 2× two-sum
  improvement would project to about 49.0×, above the 47.8× acceptance bar.

## Correctness reasoning retained
- topK: empty, k<=0, k>=n, negatives, duplicates, equal, ascending, descending.
- dedupe: empty, repeated integers, negative offsets, broad/nonintegral values,
  strings, mixed number/string arrays, -0/0, and strict NaN behavior.
- mergeIntervals: unsorted, nested, duplicate, touching, giant, and no mutation.
- lis: empty, negatives, equals, descending, nearly sorted, and strictness.
- word frequency: empty/whitespace-only, mixed whitespace runs, exact words,
  count ties, lexical ties, k<=0, and k above vocabulary size.
- two-sum: empty, one item, negatives, all equal, all zeros, duplicate pairs,
  tiny ranges, wide ranges, complements outside the range, and equal halves.
- matMul: n=0/1, j and k tails, both input representations, dense output.
- primes: n<2, 2/3/5, prime squares, odd composites, partial odd segments,
  all base-prime crossings, and ascending output through the final odd <= n.

## Failed variants and next lever
- Do not restore gen-10's prime template; its boundary mapping was incorrect.
- Do not use direct JavaScript whitespace scanning; gen 10 regressed word
  frequency from 29.9× to 6.86× because native split is substantially faster.
- Keep the proven 1x4, 8-way-unrolled matMul kernel unless an isolated variant
  exceeds 4.70× holdout and 4.26× train.
- Next isolated lever: tune the proven odd-prime segment size between 8 KiB
  and 16 KiB without changing its cursor arithmetic or boundary handling.
