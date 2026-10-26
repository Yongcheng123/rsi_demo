# Notes — agent memory across generations

## Contract and static constraints
- Export exactly topK, dedupe, mergeIntervals, lis, wordFreqTopK,
  twoSumCount, matMul, and primesUpTo.
- No imports, string/template literals, this, classes, typeof, eval, or top-level
  mutable state.
- Top-level declarations may only be exported/nonexported functions or numeric
  or function constants.
- Every call allocates its own working state and does not mutate arguments.
- `ArrayBuffer.isView` is allowed for cross-realm typed-array detection.

## Latest sealed champion
- Score: 49.1× geometric mean over the holdout split.
- Acceptance requires more than 51.5×.
- Holdout speedups: topK 25.1×, dedupe 65.1×, merge 134×, lis 292×,
  word frequency 21.7×, two-sum 337×, matMul 3.00×, primes 24.0×.
- Train speedups: topK 19.0×, dedupe 82.4×, merge 75.8×, lis 197×,
  word frequency 14.2×, two-sum 347×, matMul 2.80×, primes 19.9×.

## Historical results
- Gen 6 added monotonic topK paths, hybrid selection, and segmented odd sieving.
- Gen 6 was accepted at 39.0346× versus 33.4247×.
- Gen 7 added dense dedupe, cutoff word selection, and segmented odd primes;
  it was accepted at 45.3569× versus 37.5188×.
- Gen 10's prime rewrite had incorrect boundaries.
- Gen 11's bounded two-sum table was correct and accepted.
- Gen 12's broad wheel/prime bundle regressed to 39.0×.
- Gen 13's cosmetic bundle regressed to 45.2×.
- Gen 14 was rejected for incorrect prime boundaries.
- Gen 15 was rejected for incorrect topK output.
- Gen 15's word-frequency result was 20.1× holdout versus the champion's 21.7×;
  its stable-ID and bucket changes were bundled, so the counting change was not
  isolated and the replacement selection was harmful.
- Gen 15's representation-specialized 2x2 matrix kernel measured 4.26× holdout
  versus the champion's 3.00×, a useful 1.42× isolated task signal.
- Gen 5's 2x4 matrix tile regressed and must not be restored.

## Generation 16 candidate
- Only wordFreqTopK and matMul change.
- The other six functions are copied unchanged from the sealed champion.
- wordFreqTopK now maps each distinct token to a stable numeric ID and stores
  frequencies in a packed counter array.
- Repeated tokens therefore require one Map lookup and one array increment,
  rather than a Map lookup followed by a Map write.
- The proven cutoff selection remains intact: count-descending primary order,
  plain lexical secondary order, exact tie cutoff, and unchanged k boundaries.
- The frequency bucket is now sized by maxCount instead of the total token count.
- The final result is assembled in the existing `higher` array rather than
  allocating a concatenation array.
- matMul keeps the transposed-B representation, but uses a 2x2 output tile with
  eight-way k unrolling.
- Plain-array and typed-array left operands use separate kernels so their load
  sites remain monomorphic.
- The typed right operand is always represented by the proven Float64Array
  transpose. `ArrayBuffer.isView` handles typed arrays from another realm.
- Each output accumulates terms in increasing k order, and odd dimension tails
  use explicit scalar paths.
- No gen-16 timing measurement is claimed here.

## Projection
- Using gen 15's measured 1.42× matrix factor and a conservative 1.10× word
  factor gives 1.562× across two tasks, or about 1.057× geometric aggregate.
- The word change removes roughly 6500 repeated Map writes on the train-sized
  input and replaces a 32 KiB frequency allocation with a much smaller one, so
  a larger word factor is plausible.
- The target remains at least 1.477× across the two changed tasks.

## Retained correctness cases
- topK: empty, k<=0, k>=n, negatives, duplicates, equal, ascending, descending.
- dedupe: repeated integers, negative offsets, broad values, strings, mixed
  values, -0/0, and strict NaN behavior.
- mergeIntervals: unsorted, nested, duplicate, touching, giant, and no mutation.
- lis: empty, negatives, equals, descending, nearly sorted, and strictness.
- word frequency: empty/whitespace-only, mixed whitespace runs, exact words,
  count ties, lexical ties, k<=0, and k above vocabulary size.
- two-sum: empty, one item, negatives, all equal, all zeros, duplicate pairs,
  tiny ranges, wide ranges, complements outside the range, and equal halves.
- matMul: n=0/1, odd j and k tails, both input representations, and dense
  output.
- primes: n<2, prime squares, odd composites, partial segments, every base-prime
  crossing, and ascending output through the final odd <= n.

## Next lever
- If this candidate is rejected for performance rather than correctness, compare
  the proven 2x2 kernel with a separately specialized 2x2 plain-B transpose;
  do not revisit topK, native whitespace scanning, or prime cursor rewrites.
