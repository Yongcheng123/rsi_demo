# Notes — agent memory across generations

## Contract and static constraints
- Export exactly topK, dedupe, mergeIntervals, lis, wordFreqTopK,
  twoSumCount, matMul, and primesUpTo.
- No imports, string/template literals, this, classes, typeof, eval, or top-level
  mutable state.
- Top-level declarations may only be exported/nonexported functions or numeric
  or function constants.
- Every call allocates independent working state and does not mutate arguments.
- ArrayBuffer.isView remains the cross-realm typed-array test.

## Authoritative status correction
- The bottom champion table supersedes the stale 49.1x section above it.
- Current champion score is 53.3x holdout; acceptance requires more than 55.9x.
- Generation 16's stable-ID word counter and 2x2/eight-way matrix kernel are
  already in the champion and must not be credited again as new work.
- Champion holdout matrix result is 4.31x, approximately 529 microseconds per
  call against a 2.3 ms baseline.
- A one-task candidate/champion factor of 1.477 gives about 5%; target 1.65.

## Generation 20 candidate
- Only matMul changes. The other seven functions are byte-for-byte oracle copies.
- The proven transposed-B layout, 2x2 output tile, eight-way k unrolling,
  representation-specific plain/typed left kernels, odd tails, and Float64Array
  output are retained.
- The arithmetic update now uses Math.fma when it is available and when a
  conservative preflight proves that fused and separate arithmetic are exactly
  equivalent for the supplied values.
- The preflight requires integer values and bounds the sum of absolute products
  by 2^53. Under that bound every product and partial sum is an exactly
  representable integer.
- Negative zero is excluded from the fused path so signed-zero behavior stays
  on the proven separate multiply-add path.
- NaN, infinities, fractions, non-integers, out-of-bound magnitudes, and hosts
  without Math.fma use the original arithmetic unchanged.
- The fused path retains increasing-k order, 2x2 accumulator independence, all
  eight-way groups, and the original odd-row and odd-column tails.
- No layout, representation, output, or summation-order experiment is bundled.

## Correctness argument and retained cases
- For fused inputs, x*y and every partial sum are exact integers, so one fused
  rounding produces exactly the same value as separate multiplication and
  addition.
- Non-exact numeric domains never enter the fused path.
- Matrix coverage remains: n=0/1, odd j/k tails, plain and typed left/right
  operands, cross-realm typed arrays, zero/one dimensions, dense output,
  NaN, infinity, fractions, signed zero, argument immutability, and integer
  products near the preflight bound.
- Frozen-task traces remain: topK edge/tie cases, strict dedupe and NaN,
  touching/nested intervals, strict LIS, whitespace and lexical word ties,
  duplicate two-sum pairs, prime squares and segment boundaries.

## Performance status
- No sealed train or holdout timing for generation 20 is available in this
  rewrite; the following is a projection, not a measurement.
- The current matrix task is approximately 529 microseconds holdout.
- A 1.65x paired matrix factor would reduce this to about 321 microseconds.
- One matrix factor of 1.65 projects an aggregate factor of 1.65^(1/8), or
  1.0647, and a score near 56.7x versus the 55.9x threshold.
- The fused update removes one arithmetic instruction from every product and
  should exceed the required factor if Math.fma lowers to hardware FMA.

## Historical results
- Generation 16 was accepted at 59.7x versus 56.8x with stable word IDs and the
  representation-specialized 2x2 matrix kernel.
- Generations 17 and 19 missed the threshold; word bucket/heap selection and
  ancillary packing changes were not useful.
- Generation 18 regressed, including its typed topK sort and prime rewrite.
- Generation 12's wheel sieve bundle regressed.
- The former 2x4 matrix tile regressed and is not restored.
- Prime boundary errors caused generations 10 and 14 to fail; topK errors caused
  generation 15 to fail.
- Do not revisit direct whitespace scanning or prime cursor/wheel experiments
  without a new measured lever.

## Next lever
- If fused arithmetic is unavailable or does not reach 1.65x, test 16-way k
  unrolling on the same 2x2 tile without changing layout or arithmetic
  semantics; do not bundle it with another task.
