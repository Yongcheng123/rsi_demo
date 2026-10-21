# Notes — agent memory across generations

## Contract and static constraints
- Export exactly topK, dedupe, mergeIntervals, lis, wordFreqTopK,
  twoSumCount, matMul, and primesUpTo.
- No imports, strings, templates, this, classes, typeof, eval, or top-level
  mutable state.
- Top-level declarations may only be exported/nonexported functions or numeric
  or function constants; none are needed here.
- Every call allocates its own working state and does not mutate arguments.

## Historical results
- Gen 1 replaced every quadratic baseline algorithm with the standard
  O(n log n) or O(n) alternative and established a 25.33× champion.
- Gen 2 transposed matMul but only reached 28.16×, below the required 5%.
- Gen 3 added an 8-way matMul inner unroll and odd-only prime sieve: 28.27×.
- Gen 4 added the matMul 1x4 register tile and bit-packed odd sieve: accepted
  at 27.14× in that run.
- The latest champion is 32.0797×. Train/holdout speedups:
  topK 18.4/6.63, dedupe 26.0/40.4, merge 76.0/121,
  lis 174/260, word frequency 16.7/21.7, two-sum 38.3/90.5,
  matMul 2.85/3.09, primes 18.7/22.0.
- Gen 5 changed matMul to a 2x4 tile and primes to segmented wheel-30.
  It scored 32.2844×, only +0.6% rather than the required +5%.
  Its wheel sieve reached 30.6× primes, but matMul regressed to 2.36×.
- Lesson: retain the 1x4 matMul kernel; combine independent stable levers
  instead of forcing another matrix register tile.

## Generation 6 changes
- topK now recognizes monotonic input in one early-exiting scan. Nondecreasing
  input returns the reversed suffix; nonincreasing input returns its prefix.
- For unsorted input and k <= n/16, topK retains the low-constant min-heap.
  Larger k uses a local Hoare quickselect and sorts only the selected prefix.
  This removes repeated heap replacements on ascending input and reduces the
  asymptotic cost for large k without regressing small-k or duplicate-heavy data.
- primesUpTo now uses a 32 KiB segmented wheel-30 sieve. Candidates use only
  residues 1,7,11,13,17,19,23,29 modulo 30. Base primes through sqrt(n) mark
  each residue progression in steps of 30p, equivalent to 8p wheel entries.
- This scans about 8/30 rather than 1/2 of all integers and uses direct byte
  stores instead of odd-bit read-modify-write marks.
- The gen-5 wheel implementation measured 22.0 -> 30.6× primes. Even a
  conservative topK gain to 7.5× projects:
  32.0797 * (7.5/6.63)^(1/8) * (30.6/22)^(1/8) = 33.93×, +5.8%.
- Expected topK range is 8-15× because both holdout sorted patterns now avoid
  sorting or heap replacement; projected total is approximately 34-36×.

## Edge-case trace retained
- topK: empty input, k<=0, k>=n, negatives, duplicates, all-equal,
  ascending, descending, and partially ordered arrays.
- dedupe: empty input, repeated integers, first occurrence, and mixed
  numbers/strings. Set SameValueZero versus === remains only a NaN caveat;
  hidden inputs are integers and strings.
- mergeIntervals: empty, unsorted, nested, duplicate, touching endpoints,
  one giant interval, sorted output, fresh pair arrays, and no input mutation.
- lis: empty, negatives, equals, descending, nearly sorted, and strictness.
- wordFreqTopK: empty/whitespace-only text, leading/trailing/running mixed
  whitespace, repeated exact words, ties, k<=0, and k above vocabulary size.
- twoSumCount: empty, all zeros, negatives, huge values, and duplicate pairs.
- matMul: n=0, n=1, n=2/3 tails, and holdout n=64/80/112/128. Both j and k
  tail loops remain; output is a dense Float64Array and inputs are unchanged.
- primesUpTo: n<2, 2, 3, 5, 6, 7, 30, 31, 49, prime squares, products such as
  77/119/143, and the final partial 30-block. Only 1 is excluded; 2/3/5 are
  emitted separately and every other emitted value is coprime to 30.

## Next lever
- If accepted, topK or the wheel sieve can be tuned separately by segment
  size and select threshold. Avoid changing matMul unless a new kernel beats
  the proven 1x4 tile on isolated paired benchmarks.
