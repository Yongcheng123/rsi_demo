# Arena specification

You are optimising `agent/solver.js`, an ES module exporting **exactly these eight
pure functions**. Each is benchmarked against a frozen naive baseline
(`arena/baseline.js`, the generation-0 solver) and verified against a hidden
reference implementation on freshly generated inputs.

## Function contracts

| export | signature | contract |
|---|---|---|
| `topK(arr, k)` | `number[], int → number[]` | The `k` largest values of `arr`, **descending**, duplicates kept. `k <= 0` → `[]`. `k >= arr.length` → whole array sorted descending. |
| `dedupe(arr)` | `(number\|string)[] → same[]` | Distinct values in **first-occurrence order**, `===` semantics (`1` and `'1'` are different). |
| `mergeIntervals(iv)` | `[s,e][] → [s,e][]` | Merge overlapping **or touching** closed intervals (`[1,4]` + `[4,5]` → `[1,5]`). Input is unsorted; `s <= e` always. Output sorted by start, each element a plain 2-array. Do not mutate the input. |
| `lis(arr)` | `number[] → int` | Length of the longest **strictly** increasing subsequence. `[]` → `0`. |
| `wordFreqTopK(text, k)` | `string, int → [word, count][]` | Split on whitespace runs (`/\s+/`), ignore empty tokens, count exact words. Sort by count **desc**, then word **asc** (plain `<` comparison). Return the first `k`. `k <= 0` → `[]`. |
| `twoSumCount(arr, target)` | `int[], int → int` | Number of index pairs `i < j` with `arr[i] + arr[j] === target`. Duplicates count separately. |
| `matMul(a, b, n)` | `arraylike, arraylike, int → Float64Array` | Row-major `n×n` product `c[i*n+j] = Σ_k a[i*n+k]·b[k*n+j]`. `a`/`b` may be plain arrays **or** `Float64Array`s. Return any array-like of length `n*n` (a `Float64Array` is expected). Inputs are small integers, so results are exact. |
| `primesUpTo(n)` | `int → int[]` | All primes `p <= n`, ascending. `n < 2` → `[]`. |

Every function must be **pure**: no mutation of arguments, no side effects, same
output for the same input.

## Input scales

| task | train split (fixed seed, reported per task) | holdout split (fresh seed every run, pass/fail only) |
|---|---|---|
| topK | n = 12 000, k = 100, uniform ints | n = 15 000, k ∈ [1, 2000]; uniform / few-unique / ascending / descending |
| dedupe | n = 6 000 ints in [0, 3000) | n = 8 000; mostly-unique ints / 100 distinct ints / **strings** |
| mergeIntervals | 400 intervals, sparse | 500; sparse / dense / pre-sorted / one giant interval |
| lis | n = 3 000 uniform | n = 4 000; uniform / nearly sorted / descending / 30 distinct values |
| wordFreqTopK | 6 000 words, vocab 1 000, k = 20, single spaces | 8 000 words, vocab 1 500, k ∈ [1,100], mixed whitespace (`\n`, `\t`, runs) |
| twoSumCount | n = 4 000 in [-2000, 2000) | n = 5 000; tiny range / huge range / all zeros |
| matMul | n = 96, plain arrays | n ∈ {64, 80, 112, 128}; plain arrays **or** Float64Array |
| primesUpTo | n = 200 000 | n ∈ [100 000, 500 000) |

Plus a fixed list of edge cases per task (empty inputs, `k = 0`, `k > n`,
negative numbers, all-equal, touching intervals, …) that must all pass.

## Scoring

- Per task: `speedup = baseline_time / your_time`, measured as a **paired ratio**
  in the same process, same batch, alternating order, median of 3 batches, each
  batch ≥ 100 ms of calls on brand-new inputs. Clock resolution is 1 ms; the
  harness batches calls so the error stays under ~1 %.
- **Score = geometric mean of the eight holdout speedups.** A 100× win on one task
  and 1× on the rest gives ≈ 1.78×, so breadth beats one heroic function.
- **Correctness is a hard gate**: any wrong output, any thrown exception, any
  mutated input, any sparse/lazy output, any timeout on any task → score 0.
- A candidate is accepted only if its holdout score beats the current champion's
  (re-measured in the same run) by **more than 5 %**.

## Sandbox rules (enforced by a static guard *before* anything runs)

Your file is parsed with acorn. Any violation rejects the whole generation, so
these are worth memorising:

1. **No string or template literals** (`'…'`, `"…"`, `` `…` ``). Regex literals
   (`/\s+/`) are fine. You never need a string literal for these tasks.
2. **No `import`/`require`, no `this`, no `class`, no getters/setters, no
   `async`/generators, no `typeof`, no `eval`/`new Function`.**
3. **Top level may contain only `export function …`, `function …`, and `const NAME = <number | function>`.** No module-level `let`/`var`, no `new Map()` at top level, no IIFEs, no precomputed tables. Every call must start from scratch — there is no cross-call memoisation, and inputs are never repeated anyway.
4. **No assignment to properties of top-level functions/constants or of globals** (`f.cache = …`, `Math.x = …`), and no reassigning a top-level binding.
5. A local variable may not reuse the name of a top-level function or constant.
6. **Allowed free identifiers:** `Math Array Map Set WeakMap WeakSet Number Boolean BigInt Infinity NaN undefined isFinite isNaN parseInt parseFloat Float64Array Float32Array Int32Array Int16Array Int8Array Uint32Array Uint16Array Uint8Array Uint8ClampedArray BigInt64Array BigUint64Array ArrayBuffer DataView`. Everything else (`Object`, `String`, `JSON`, `Symbol`, `Date`, `console`, `Error`, …) is forbidden — as an identifier **or** as a property name. Also forbidden as property names: `constructor prototype __proto__ name toString valueOf toJSON`.
7. The file must stay under 64 KB and export all eight functions by name.

At runtime the module is evaluated as a strict script inside a fresh `vm` context
that contains only ECMAScript intrinsics (no `process`, no timers, no I/O), with
dynamic code generation disabled.
