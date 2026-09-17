// arena/worker.mjs — evaluates ONE solver on ONE task, paired against the frozen baseline. PROTECTED.
//
//   node arena/worker.mjs --solver <file> --task <name> --seed <n> --train-seed <n> [--batches 3] [--calls 24]
//
// Trust boundary, in one paragraph: the solver is untrusted code. It runs in a fresh
// `vm` context that holds only ECMAScript intrinsics — no `process`, no timers, no
// host functions (any host function would leak the host `Function` constructor and
// with it an eval that bypasses the context's code-generation ban). Only primitives
// and the solver's own objects ever cross the boundary. Inputs are generated INSIDE
// the sandbox from a seed by a harness closure the solver cannot reach; the host
// regenerates the same inputs from the same seed for the reference implementation.
// Timing, hashing, verification and the lazy-output check all happen in the host.
// The baseline lives in a second, equally isolated context in the same process, and
// the two are called alternately on identical inputs — so a speedup is a paired ratio
// measured at the same moment on the same core. This process is disposable: run.mjs
// kills it on timeout, and on CI it lives inside `docker --network none`.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { GEN, TASK_NAMES, TRAIN, HOLDOUT, mulberry32, passSeed } from './gen.js';
import { REF } from './reference.mjs';
import { makeHasher } from './hash.js';
import { guard, toSandboxScript } from './guard.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const opts = parseArgs(process.argv.slice(2));
const TASK = opts.task;
const SOLVER = opts.solver;
const BASELINE = opts.baseline || path.join(here, 'baseline.js');
const SEED = (Number(opts.seed) || 1) >>> 0;
const TRAIN_SEED = (Number(opts['train-seed']) || 20260917) >>> 0;
const BATCHES = Number(opts.batches || 3);
const CALLS = Number(opts.calls || 24);       // per side, per batch, per split — a multiple of 12 keeps kinds balanced
const WARMUP = Number(opts.warmup || 3);
const VERIFY_BASE = Number(opts['verify-base'] || 4); // baseline sanity calls verified per batch

if (!TASK_NAMES.includes(TASK)) fail(`unknown task ${TASK}`);
if (!SOLVER || !fs.existsSync(SOLVER)) fail(`solver not found: ${SOLVER}`);
if (!fs.existsSync(BASELINE)) fail(`baseline not found: ${BASELINE}`);

const src = fs.readFileSync(SOLVER, 'utf8');
const violations = guard(src);
if (violations.length) { emit({ task: TASK, solver: SOLVER, violations, splits: {}, edges: null }); process.exit(0); }

// The sandbox harness: gen.js verbatim (exports stripped) + two entry points. It is
// evaluated BEFORE the solver and returned to the host as a closure — nothing global.
const HARNESS_SRC = `(function () {
'use strict';
${fs.readFileSync(path.join(here, 'gen.js'), 'utf8').replace(/^export\s+/gm, '')}
return {
  gen: function (task, seed, splitIdx, batch, pass, n) {
    var g = GEN[task], split = splitIdx === 0 ? TRAIN : HOLDOUT, r = mulberry32(passSeed(seed, splitIdx, batch, pass));
    var out = new Array(n); for (var i = 0; i < n; i++) out[i] = g.gen(r, split, i); return out;
  },
  edges: function (task) { return GEN[task].edges(); }
};
})()`;

const H = makeHasher(String, ArrayBuffer.isView, Array.isArray, Math.imul);
const now = performance.now.bind(performance);
const gopd = Object.getOwnPropertyDescriptor;
const arity = GEN[TASK].arity;
const solverScript = toSandboxScript(src);
const baselineScript = toSandboxScript(fs.readFileSync(BASELINE, 'utf8'));

function freshSandbox(script) {
  const ctx = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
  const h = vm.runInContext(HARNESS_SRC, ctx, { filename: 'harness.js' });
  vm.runInContext(script, ctx, { filename: 'solver.js', timeout: 10000 });
  const f = vm.runInContext(TASK, ctx, { filename: 'lookup.js' });
  if (typeof f !== 'function') throw new Error(`export '${TASK}' is not a function`);
  return { h, f };
}
const call = (f, a) => (arity === 1 ? f(a[0]) : arity === 2 ? f(a[0], a[1]) : f(a[0], a[1], a[2]));

// A sparse or accessor-backed output means work was deferred past the timer. Sampled for big arrays.
function isLazy(v, depth = 0) {
  if (ArrayBuffer.isView(v) || !Array.isArray(v)) return false;
  const n = v.length, step = n > 64 ? Math.floor(n / 32) : 1;
  for (let i = 0; i < n; i += step) {
    const d = gopd(v, i);
    if (!d || !Object.hasOwn(d, 'value')) return true;
    if (depth < 1 && Array.isArray(v[i]) && isLazy(v[i], depth + 1)) return true;
  }
  if (n > 0) { const d = gopd(v, n - 1); if (!d || !Object.hasOwn(d, 'value')) return true; }
  return false;
}
function preview(v) {
  const s = JSON.stringify(v, (k, x) => (ArrayBuffer.isView(x) ? Array.from(x) : x));
  return s.length > 80 ? s.slice(0, 77) + '...' : s;
}
function hostInputs(seedForSplit, splitIdx, batch, pass, n) {
  const g = GEN[TASK], split = splitIdx === 0 ? TRAIN : HOLDOUT, r = mulberry32(passSeed(seedForSplit, splitIdx, batch, pass));
  const out = new Array(n); for (let i = 0; i < n; i++) out[i] = g.gen(r, split, i); return out;
}

// One timed call: returns { us, out, threw }. The host holds the clock; the sandbox holds nothing.
function timed(f, args) {
  let out, threw = false;
  const t0 = now();
  try { out = call(f, args); } catch { threw = true; }
  const us = (now() - t0) * 1000;
  return { us, out, threw };
}

function evalSplit(splitIdx) {
  const seedForSplit = splitIdx === 0 ? TRAIN_SEED : SEED;
  const side = () => ({ us: [], threw: false, lazy: false, mutated: false, mismatches: [] });
  const S = side(), B = side(), ratios = [];
  for (let b = 0; b < BATCHES; b++) {
    const sb = freshSandbox(solverScript), bb = freshSandbox(baselineScript);
    // untimed warm-up on their own fresh inputs (pass index 1000003 is reserved for this)
    const wS = sb.h.gen(TASK, seedForSplit, splitIdx, b, 1000003, WARMUP), wB = bb.h.gen(TASK, seedForSplit, splitIdx, b, 1000003, WARMUP);
    for (let i = 0; i < WARMUP; i++) { try { call(sb.f, wS[i]); } catch { S.threw = true; } try { call(bb.f, wB[i]); } catch { B.threw = true; } }
    // timed pass: identical inputs generated independently inside each sandbox
    const inS = sb.h.gen(TASK, seedForSplit, splitIdx, b, 0, CALLS), inB = bb.h.gen(TASK, seedForSplit, splitIdx, b, 0, CALLS);
    const pristine = hostInputs(seedForSplit, splitIdx, b, 0, CALLS);
    const batchS = [], batchB = [];
    for (let i = 0; i < CALLS; i++) {
      const first = (i + b) % 2 === 0; // alternate who goes first
      const rB = first ? timed(bb.f, inB[i]) : null;
      const rS = timed(sb.f, inS[i]);
      const rB2 = first ? rB : timed(bb.f, inB[i]);
      batchS.push(rS.us); batchB.push(rB2.us);
      const expected = REF[TASK](...pristine[i]);
      const expHash = H.hash(expected);
      if (rS.threw) S.threw = true;
      else { if (isLazy(rS.out)) S.lazy = true; if (H.hash(rS.out) !== expHash && S.mismatches.length < 3) S.mismatches.push({ call: i, expected: preview(expected) }); }
      if (rB2.threw) B.threw = true;
      else if (i < VERIFY_BASE && H.hash(rB2.out) !== expHash) B.mismatches.push({ call: i, expected: preview(expected) });
    }
    // mutation: what each sandbox's inputs look like now vs. a pristine regeneration
    const pristineHash = H.hash(pristine);
    if (H.hash(inS) !== pristineHash) S.mutated = true;
    if (H.hash(inB) !== pristineHash) B.mutated = true;
    S.us.push(...batchS); B.us.push(...batchB);
    ratios.push(median(batchB) / median(batchS));
  }
  const finish = (x) => ({ us: median(x.us), p25: quantile(x.us, 0.25), p75: quantile(x.us, 0.75), calls: x.us.length, threw: x.threw, lazy: x.lazy, mutated: x.mutated, mismatches: x.mismatches, correct: !x.threw && !x.lazy && !x.mutated && x.mismatches.length === 0 });
  const s = finish(S), bl = finish(B);
  return { ...s, base_us: bl.us, base_correct: bl.correct, ratio: median(ratios), ratios: ratios.map((r) => +r.toFixed(4)) };
}

function evalEdges(script) {
  const { h, f } = freshSandbox(script);
  const inputs = h.edges(TASK), pristine = GEN[TASK].edges();
  const out = { threw: false, lazy: false, mismatches: [] };
  for (let i = 0; i < pristine.length; i++) {
    const r = timed(f, inputs[i]);
    const expected = REF[TASK](...pristine[i]);
    if (r.threw) { out.threw = true; out.mismatches.push({ edge: i, input: preview(pristine[i]), expected: preview(expected), got: 'exception' }); continue; }
    if (isLazy(r.out)) out.lazy = true;
    if (H.hash(r.out) !== H.hash(expected)) out.mismatches.push({ edge: i, input: preview(pristine[i]), expected: preview(expected), got: preview(r.out) });
  }
  out.mutated = H.hash(inputs) !== H.hash(pristine);
  out.correct = !out.threw && !out.lazy && !out.mutated && out.mismatches.length === 0;
  out.mismatches = out.mismatches.slice(0, 5);
  return out;
}

try {
  const edges = evalEdges(solverScript);
  const baseEdges = evalEdges(baselineScript);
  const splits = { train: evalSplit(0), holdout: evalSplit(1) };
  emit({ task: TASK, solver: SOLVER, baseline: BASELINE, violations: [], splits, edges, base_edges_correct: baseEdges.correct });
} catch (e) {
  emit({ task: TASK, solver: SOLVER, violations: [], error: String((e && e.message) || e), splits: {}, edges: null });
}

function median(xs) { return quantile(xs, 0.5); }
function quantile(xs, q) { if (!xs.length) return null; const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; }
function emit(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }
function fail(msg) { emit({ task: TASK, solver: SOLVER, violations: [], error: msg, splits: {}, edges: null }); process.exit(2); }
function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true'; o[k] = v; } }
  return o;
}
