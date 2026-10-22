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
- Gen 6 added topK monotonic and hybrid selection paths and segmented wheel-30.
- Gen 6 was accepted at 39.0346× after a 33.4247× comparison champion.

## Latest champion measurements
- Holdout speedups: topK 33.6×, dedupe 42.4×, merge 132×, lis 261×,
  word frequency 26.6×, two-sum 90.6×, matMul 3.16×, primes 14.5×.
- Acceptance therefore requires more than 40.99× in the paired run.
- Despite an isolated gen-5 wheel measurement of 30.6×, the sealed gen-6 run
  measured the wheel at only 14.5× holdout and 13.1× train.

## Generation 7 changes
- dedupe now recognizes signed 32-bit integer runs and sparse integer ranges.
  A min/max pass selects a Uint8Array stamp table, and the output pass preserves
  first occurrence while avoiding all Map/Set hashing.
- The general dedupe fallback now performs one Set probe per value instead of
  has followed by add. NaN is emitted separately because the contract uses ===.
- wordFreqTopK now histograms word counts, finds the kth frequency, sorts only
  entries above that cutoff plus the lexicographic cutoff group, and avoids
  sorting the whole vocabulary with a compound comparator when k is small.
- primesUpTo now uses a cache-sized segmented odd-only sieve. It advances each
  base-prime cursor across segments, avoiding repeated division and wheel-index
  calculations while retaining a compact working set.
- topK, mergeIntervals, lis, twoSumCount, and matMul are unchanged.

## Performance projection
- Conservative ratios are dedupe 1.50×, word frequency 1.15×, and primes 1.25×.
  Their product is 2.16, corresponding to a 1.105× geomean lift and about
  43.1× overall, roughly 10.5% above the 39.0346× champion.
- Dedupe alone should exceed 1.5×: numeric train inputs have a 3001-wide range,
  while the string fallback avoids two Set hash-table probes per occurrence.
- The prior bit-packed/odd sieve measured 18.7× train and 22.0× holdout before
  the wheel replacement, so restoring an optimized odd sieve should move primes.

## matMul status
- Holdout sizes remain 64, 80, 112, and 128 with plain arrays or Float64Array.
- The unchanged proven kernel transposes B, uses i-j-k order, a 1x4 j-tile,
  and an 8-way k-unroll. Do not replace it without an isolated measured win.

## Edge-case trace retained
- topK: empty, k<=0, k>=n, negatives, duplicates, equal, ascending, descending.
- dedupe: empty, repeated integers, negative offsets, broad/nonintegral values,
  strings, mixed number/string arrays, -0/0, and strict NaN behavior.
- mergeIntervals: unsorted, nested, duplicate, touching, giant, and no mutation.
- lis: empty, negatives, equals, descending, nearly sorted, and strictness.
- word frequency: empty/whitespace-only, mixed whitespace runs, exact words,
  count ties, lexical ties, k<=0, and k above vocabulary size.
- two-sum: empty, negatives, huge ranges, all zeros, and duplicate pairs.
- matMul: n=0/1, j and k tails, both input representations, dense output.
- primes: n<2, 2/3/5, prime squares, odd composites, partial odd segments,
  all base-prime crossings, and ascending output through the final odd <= n.

## Next lever
- If accepted, tune the odd-prime segment between 8 KiB and 16 KiB in isolation.
- Keep matMul stable; its proven tile is already 3.16× and is not needed to pass.
