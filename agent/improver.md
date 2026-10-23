# Improver — strategy for rewriting `agent/solver.js`

## Current state

- The sealed champion is about 45.4–45.5× geomean. Acceptance requires beating the actual measured champion by over 5%, roughly 47.8×. Aim for at least 8% headroom to absorb noise.
- Current holdout speedups: topK 35.6×, dedupe 77.4×, merge 125×, lis 260×, wordFreqTopK 29.9×, twoSumCount 90.1×, matMul 3.18×, primesUpTo 24.1×.
- Current train speedups are 18.9×, 90.7×, 81.1×, 175×, 21.5×, 37.6×, 2.86×, and 19.8× respectively. Forecast with the weaker split, never the best split.
- The notes’ 39.03× champion is stale gen-6 data. The matMul 1.16× and primes 13.9× figures in the old strategy are also stale.
- Read `agent/solver.js`, `agent/notes.md`, the function spec, and the visible harness before changing anything. Do not edit the harness or evaluator.

## Required workflow

1. Copy the current solver to a temporary oracle before editing. Keep its source unchanged outside the final `agent/solver.js`.
2. Run the provided benchmark on the unchanged champion. Establish train and holdout timings with warmup and repeated runs.
3. Profile source-level costs and inspect the visible input shapes. Never assume a holdout size or representation is universal.
4. Develop one isolated candidate at a time. Compare candidate and oracle in the same process, preferably alternating runs to reduce JIT/GC drift; use medians rather than one run.
5. Differential-test before benchmarking. Submit only a candidate whose projected geomean clears the bar robustly.

## Lessons from recent generations

- Gen 2, gen 5, and gen 9 failed the significance bar. Textbook transposes, extra blocking, and bounded two-sum machinery are not automatic wins.
- Gen 5’s 2×4 matMul tile regressed. The proven matMul kernel is transposed B, i-j-k, a 1×4 j-tile, and an 8-way k-unroll.
- Gen 8 lost duplicate-heavy `topK`; gen 10 broke `primesUpTo` on its first call. Those are mandatory regression cases.
- Multiple unrelated rewrites made failures hard to isolate. Keep each change independently testable and verify the combined candidate too.
- Accepted gains came from removing real algorithmic or allocation work, not from cosmetic dispatch changes.

## Acceptance arithmetic

- If changed tasks improve by factors `r1, r2, ...`, the aggregate multiplier is `(r1*r2*...)**(1/8)`.
- Therefore one changed task must improve by at least 1.477×; two tasks need a product above 1.477, e.g. 1.25× and 1.20×; three 1.15× gains also suffice.
- Sole-task targets from current holdout values are: topK 52.6×, dedupe 114.4×, merge 184.7×, lis 384.2×, wordFreqTopK 44.2×, twoSumCount 133.2×, matMul 4.70×, primesUpTo 35.6×.
- Do not submit a projection barely over 5%. If no credible lever reaches the bar, select another lever rather than adding no-op “optimizations.”

## Lever order

1. **primesUpTo and wordFreqTopK:** lowest-risk places for focused wins.
   - For primes, retain the exact proven segmented odd-only kernel. Isolate segment-size, cursor-arithmetic, marking-loop, or allocation changes. Do not reuse gen-10’s template construction without complete boundary tests.
   - For word frequency, isolate direct whitespace scanning, presized counts, cutoff selection, or output allocation while preserving tokenization and tie order exactly.
2. **matMul:** largest numerical headroom, but expensive to improve safely. Keep the proven kernel unless an isolated candidate exceeds 4.70× holdout and 4.26× train. Specialize only by representation or size when semantics are identical, and preserve each output element’s floating-point summation order.
3. **topK:** retain the proven monotonic/selection hybrid. Change only one stage at a time, such as selection, partitioning, or result copying. Test duplicate-heavy and boundary-sized inputs especially carefully.
4. Avoid mergeIntervals, lis, dedupe, and twoSumCount unless profiling exposes obvious removable overhead. They are already fast, and the twoSum experiment failed.

## Correctness gate

- Differential-test random inputs and the complete retained edge-case trace in `agent/notes.md` against the oracle. Never delete a trace case because visible data misses it.
- Include prime squares, segment crossings, final partial segments, and `n < 2`; include duplicate-heavy topK and every `k` boundary.
- For matMul, cover zero/one dimensions, j/k tails, both visible representations, and unchanged accumulation order.
- Check exact output ordering, numeric signs including negative zero, and strict-equality/NaN behavior where relevant.
- Verify arguments are not mutated and every call creates its own working state. No cross-call caching.
- Do not specialize behavior to visible values, encode known answers, or let train-only distributions alter semantics.

## Sandbox rules

- Preserve exactly the required export set.
- No imports, string/template literals, `this`, classes, `typeof`, `eval`, top-level mutable state, `console.*`, or `debugger`.
- Top-level declarations may only be required exported/nonexported functions or numeric/function constants. No top-level calls.
- Use numeric character codes or permitted regex constructs. Do not access hidden evaluator data or modify benchmark files.

## Memory and submission

- Append to `agent/notes.md`: exact algorithm changed, per-task train/holdout factors, projected and measured aggregate, correctness cases run, failed variants, and one concrete next lever.
- Keep the historical record and edge trace; distinguish measured results from projections and replace stale numbers only after a real benchmark.
- Before submitting, confirm: guard compliance, exact exports, no argument mutation, differential tests passed, stable factor measurements, aggregate product over 1.477, and notes updated.
===== END FILE =====
