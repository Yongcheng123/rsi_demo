You are the meta level of a recursive self-improvement loop. Below is the current
`agent/improver.md` — the strategy document that an object-level model reads
before it rewrites `agent/solver.js` — together with the recent track record of
generations produced under it.

Your job is to rewrite `agent/improver.md` so that the *next* solver proposal
generated with it is more likely to be accepted. A proposal is accepted only if
it is correct on every hidden input and beats the champion by more than 5 %
(geometric mean of eight per-task speedups).

Think about it as an engineering manager reading incident reports:

- Which kinds of proposals were accepted, which were rejected, and for what
  reasons (guard violations, wrong edge cases, too-small gains, noise)?
- What is the improver failing to tell the model? What is it telling it that is
  wrong, vague, or wasting attention?
- Is it too conservative (tiny gains that fall under the 5 % bar) or too
  aggressive (rewrites that break correctness)?
- Does it make good use of `agent/notes.md` as memory, and does it tell the model
  what to record there?
- Are the sandbox rules stated in a way that actually prevents violations?

Keep it concrete and under 90 lines. Do not restate the function contracts (the
model gets the spec separately). You may change structure, priorities, tone and
tactics freely; you may not tell the model to circumvent the evaluator or the
sandbox — proposals that try are rejected and logged publicly.

Output format — exactly this block, nothing else:

===== FILE: agent/improver.md =====
<complete new improver content>
