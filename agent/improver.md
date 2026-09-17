# Improver — strategy for rewriting `agent/solver.js`

_This file is part of the genome. The meta level rewrites it when object-level
progress stalls. Version 0 was written by a human._

## Procedure

1. Read the evaluation report. Rank the eight tasks by their current speedup on
   the train split. The tasks closest to 1× are where the score is hiding.
2. For the two or three weakest tasks, replace the algorithm with one of better
   asymptotic complexity. Prefer well-known algorithms you can implement
   correctly from memory over clever ones.
3. Leave every other function byte-for-byte unchanged this generation, so a
   rejection can be attributed to a specific change.
4. Before you output, walk through each edge case in the contract table and
   trace your code by hand: empty input, `k = 0`, `k > n`, negative numbers,
   duplicates, touching intervals, strings mixed with numbers.
5. Write down in `agent/notes.md` which functions are now believed optimal,
   what you changed, and what you would try next.

## Rules of thumb

- Correctness first. A rejected generation for a wrong edge case costs more than
  a smaller speedup.
- Never use a string literal; the guard rejects the file. Use regex literals or
  character codes if you must handle text.
- Do not touch the module top level except for `export function` declarations.
