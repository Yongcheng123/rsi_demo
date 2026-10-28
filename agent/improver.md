# Improver — strategy for rewriting `agent/solver.js`

## Authoritative baseline

- Trust the bottom “Current champion per-task speedups” table: about 53.3× holdout and 40.8× train. The 49.1× “sealed champion” and unmeasured gen-16 sections in `agent/notes.md` are stale history.
- Acceptance therefore needs roughly 55.94× holdout. Aim for at least 57.0×, preferably 57.5×, to leave noise margin.
- For candidate/champion per-task factors, the aggregate factor is the eighth root of their product. One changed task needs at least `1.477×`; target `1.65×` for about 6.5% aggregate gain and `1.85×` for about 8%.
- The table’s speedups are against the evaluator baseline, not against the current implementation. Measure candidate/champion factors directly; never infer them from those columns.

## What the track record teaches

- Successful changes removed concrete work: gen 7’s dense/cutoff/segmented kernels, gen 11’s bounded two-sum table, and gen 16’s stable-ID word count plus 2×2 matrix kernel.
- Broad bundles are unreliable: gens 12, 13, 17, 18, and 19 missed the threshold. A small aggregate gain is still a failure.
- Correctness failures were concentrated in topK and prime rewrites: gens 8, 10, 14, and 15. Do not spend the next campaign there.
- Gen 17’s word bucket/heap bundle, gen 18’s typed topK sort and prime rewrite, and gen 19’s input packing and ancillary fast paths were not useful.
- Never restore the regressed 2×4 matrix tile, use direct whitespace scanning, repeat prime wheel/cursor experiments, or reinterpret the current two-sum table.
- The current word count already uses stable IDs and packed counters; the current matrix kernel already uses a 2×2 output tile, eight-way `k` unrolling, transposed B, and separate plain/typed left kernels.

## Freeze policy

- Copy the current implementations of topK, dedupe, mergeIntervals, lis, wordFreqTopK, twoSumCount, and primesUpTo unchanged.
- In particular, freeze topK duplicate/tie handling, current prime odd-offset mapping and base-prime boundaries, the two-sum occurrence semantics, and word tokenization, trimming, case handling, and lexical tie order.
- Treat the current 2×2/eight-way matrix structure as the oracle. Change only its representation/layout path unless profiling clearly identifies one arithmetic-only experiment.
- Do not bundle speculative cleanup, extra tasks, or “low-risk” rewrites. A focused matrix proposal has a better correctness and acceptance rate than another broad bundle.

## Active campaign: representation-specific matrix multiplication

- First split matrix time into B-transpose/allocation, A/B loads, and arithmetic. Benchmark plain and typed operands separately; do not assume the visible representation mix matches hidden inputs.
- First candidate: specialize the right plain-B path with a dedicated flat transpose or transpose-free column access, selected from the profile. Keep the proven typed-B path unchanged.
- In that experiment, keep the 2×2 tile, eight-way unrolling, output representation, tails, and increasing-`k` summation order identical. Change only B layout/access.
- If transpose/allocation is small, abandon that path immediately. Test one shared arithmetic-only alternative, preferably 16-way `k` unrolling, with exact order and explicit tails.
- Do not combine layout and arithmetic changes in one candidate. Do not try 2×4 tiling or another broad kernel rewrite.
- Require at least a 1.65× paired matrix-task factor across both train and holdout, with no representation-specific regression. A 1.2–1.5× matrix gain cannot clear the aggregate bar by itself.

## Measurement workflow

1. Copy the unchanged champion to a temporary oracle and edit only the final `agent/solver.js`.
2. Establish fresh champion timings with warmup, repeated rounds, and medians. Alternate oracle/candidate order to reduce JIT, GC, and thermal drift.
3. Run correctness before timing. Discard any semantic mismatch immediately.
4. Measure train and holdout separately and forecast from the weaker split. Reject regressions larger than benchmark noise.
5. Compute the projected aggregate from the product of paired per-task factors. Do not submit a projection close to 1.477; target at least 1.65.
6. Profile the visible harness and generated sizes without specializing behavior to visible values. The final candidate must contain only measured, validated changes.

## Correctness gate

- Differential-test the full solver against the oracle on randomized inputs and retained traces.
- For matrix multiplication, cover plain and typed left/right combinations, cross-realm typed arrays, zero/one dimensions, rectangular shapes, odd tails, NaN, and signed zero.
- Preserve exact per-element accumulation order and argument immutability. Verify output density and representation exactly.
- Run the retained edge traces for every frozen task as a regression check. Copying a frozen implementation is preferable to “improving” it.
- Any mismatch, changed tie order, changed numeric type, or hidden-input assumption rejects the candidate regardless of speed.

## Sandbox and anti-overfitting rules

- Preserve exactly the current export set.
- No imports, string or template literals, `this`, classes, `typeof`, `eval`, `console.*`, or `debugger`.
- Top-level declarations may only be exports, helper functions, or numeric/function constants. No top-level calls or mutable state.
- Every call must allocate independent working state; no cross-call caching.
- Do not modify the harness, access evaluator data, encode known answers, or specialize behavior to visible inputs.
- Keep `ArrayBuffer.isView`-style cross-realm typed-array detection; do not replace it with realm-fragile `instanceof` checks.

## Memory protocol

- First add a status correction to `agent/notes.md`: the bottom champion table supersedes the 49.1× section, and gen 16’s stable-ID/2×2 changes are already in the champion.
- Append the exact algorithm changed, train and holdout candidate/champion factors, absolute timings, projected and measured aggregate, correctness cases, and every rejected variant.
- Clearly distinguish projections from measurements and never copy historical absolute scores into a new projection.
- Preserve historical edge traces. Record one concrete next lever after each experiment, including the exact reason a matrix layout or arithmetic variant was abandoned.
