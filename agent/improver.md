# Improver — strategy for rewriting `agent/solver.js`

## Objective and current baseline

- The supplied current table implies about 49.1× holdout and 39.9× train. The prose champion figures in `agent/notes.md` and the old strategy are stale; trust fresh paired measurements.
- Acceptance requires more than 5% over the actual measured champion: about 51.6× if the champion remains 49.1×. Target at least 53.0× for noise margin.
- A relative gain of only one task must exceed `1.05^8 = 1.477` to clear the bar. For an 8% aggregate target, one task must exceed `1.08^8 = 1.85`; otherwise the product of independently validated task factors must exceed 1.85.
- Measure speedup relative to the current champion, not an old absolute figure. Relevant current holdout targets include wordFreqTopK 32.0× for a 5% aggregate gain, matMul 4.43×, and primesUpTo 35.4×.

## What the track record actually teaches

- Accepted work removed concrete algorithmic, hashing, or allocation work: matMul tiling, selective topK/prime work, three targeted gen-7 changes, and the gen-11 bounded two-sum table.
- Broad cosmetic bundles repeatedly failed. Gen 12–13 lacked a real gain; gen 14–15 were disqualified by prime/topK correctness regressions.
- Freeze the proven topK, dedupe, mergeIntervals, lis, and twoSumCount implementations. In particular, do not repeat topK duplicate handling or the old two-sum experiment.
- Freeze the current primesUpTo mapping. Gen 10, 12, and 14 show that prime-template or cursor rewrites are high risk.
- Freeze the current 1×4, eight-way-unrolled matMul kernel’s loop structure. The 2×4 tile regressed in gen 5.
- Native `split` is substantially faster than direct whitespace scanning for word frequency; gen 10 proved that scanner path is harmful.

## Preferred next campaign

### 1. Isolate word-frequency hashing

- Preserve the champion’s exact tokenization, trimming, case handling, and output ordering. Do not replace native splitting with a character scanner.
- First candidate: token-to-stable-ID `Map` plus a count array. Look up one ID per token, assign an ID only on first occurrence, and increment the array thereafter. This removes repeated writes to a count map without changing tokenization.
- Keep selection and output semantics unchanged in this first experiment. Reconstruct the same entries from IDs and counts, preserving lexical tie order and every `k` boundary.
- Test count-only first. If it yields a substantial but insufficient gain, test cutoff selection separately; do not bundle both initially. Gen 14–15 attempted stable IDs plus bucket selection, but contamination prevented an isolated measurement.
- Require at least a 1.477× relative factor before adopting this as the sole change; prefer 1.85×. If counting is not visibly improved, abandon it rather than adding cosmetic selection changes.

### 2. If word frequency cannot clear the threshold, analyze matMul alone

- First separate transpose/allocation cost from arithmetic-loop cost using the visible harness.
- Preserve transposed B, i-j-k traversal, the 1×4 j-tile, eight-way k-unroll, output representation, and exact per-element floating-point summation order.
- Test only one arithmetic specialization at a time: a sixteen-way k-unroll, an exact dimension-tail specialization, or a legal representation-specific kernel. Select the family indicated by profiling.
- Never use the regressed 2×4 tile. Verify that every output element receives terms in exactly the original k order.
- Require at least 1.477× relative gain, including tails and both visible representations, before considering it.

### 3. Prime segment sizing is only a fallback

- If and only if profiling shows segment allocation or marking dominates, compare 8, 12, and 16 KiB segments while leaving odd-offset mapping, base-prime cursor updates, and output construction untouched.
- Reject the variant immediately for any boundary mismatch or for a small gain such as less than 1.2×. Segment sizing alone is unlikely to supply a 1.477× task factor.
- Combine independently validated levers only when their measured product robustly clears the target. Never add a rejected marginal rewrite merely to make the proposal look broader.

## Measurement workflow

1. Copy the unchanged solver to a temporary oracle. Edit only the final `agent/solver.js`; never alter the harness or evaluator.
2. Benchmark the unchanged champion with warmup and repeated runs. Establish separate train and holdout factors.
3. Compare one candidate against the oracle in the same process, preferably with alternating runs to reduce JIT/GC drift. Use medians, not a single timing.
4. Profile source-level costs and inspect actual input representations without assuming hidden sizes are universal.
5. Differential-test before timing. A candidate with any semantic mismatch is discarded regardless of speed.
6. Compute the projected aggregate from candidate/champion ratios. Reject projections near 1.477; target robustly above 1.05, preferably 1.08.
7. Forecast using the weaker split when train and holdout disagree. Keep unchanged tasks fixed and reject regressions larger than benchmark noise.

## Correctness gate

- Differential-test the changed function against the oracle on randomized inputs and every retained edge trace in `agent/notes.md`.
- Include duplicate-heavy topK and all `k` boundaries; strict NaN/-0 behavior in dedupe; unsorted, nested, and touching intervals; strict LIS equality cases.
- For word frequency, cover whitespace runs, empty input, repeated words, count ties, lexical ties, and `k <= 0` or `k` above vocabulary size.
- For two-sum, preserve duplicate occurrence semantics and exact `i < j` counting. For matMul, cover zero/one dimensions, j/k tails, both representations, NaN/-0 behavior, and unchanged accumulation order.
- For primes, cover `n < 2`, prime squares, segment crossings, partial segments, and every base-prime boundary.
- Verify exact argument immutability, exact exports, and independent working state on every call. No cross-call caching.

## Sandbox and anti-overfitting rules

- Preserve exactly the required export set.
- No imports, string/template literals, `this`, classes, `typeof`, `eval`, `console.*`, or `debugger`.
- Top-level declarations may only be required exports, helper functions, or numeric/function constants. No top-level calls or mutable state.
- Do not access evaluator data, encode known answers, specialize behavior to visible values, or alter benchmark files.

## Memory protocol

- Append measured results to `agent/notes.md`: exact algorithm changed, train and holdout factors, candidate/champion ratios, projected and measured aggregate, correctness cases, and failed variants.
- Record one concrete next lever after each experiment. Keep historical edge traces and clearly label projections versus measurements.
- Replace stale champion numbers only after a fresh paired benchmark. Explicitly record the gen-12–15 failures so later proposals do not repeat them.
