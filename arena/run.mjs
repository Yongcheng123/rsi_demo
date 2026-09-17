// arena/run.mjs — the arena. PROTECTED.
//
//   node arena/run.mjs --solver champion=agent/solver.js --solver candidate=cand/solver.js [--noise] [--quick] --out scores.json
//
// For every task it spawns one worker per solver. Each worker runs the solver AND
// the frozen baseline, paired and interleaved in one process, and reports the ratio.
// With --noise an extra worker pairs the baseline against itself — the ratio's
// distance from 1.0 is the measurement noise of this very run. Any solver that is
// incorrect on any task scores 0; there is no partial credit for a fast wrong answer.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TASK_NAMES } from './gen.js';
import { guard } from './guard.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const solvers = [];
let out = null, quick = false, noise = false, seed = null, trainSeed = 20260917, only = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--solver') { const [name, file] = argv[++i].split('='); solvers.push({ name, file }); }
  else if (a === '--out') out = argv[++i];
  else if (a === '--seed') seed = Number(argv[++i]);
  else if (a === '--train-seed') trainSeed = Number(argv[++i]);
  else if (a === '--tasks') only = argv[++i].split(',');
  else if (a === '--quick') quick = true;
  else if (a === '--noise') noise = true;
}
if (seed == null) seed = Number(process.env.RSI_RUN_SEED) || Date.now();
seed = seed >>> 0;
if (!solvers.length) { console.error('usage: --solver name=path [...]'); process.exit(2); }
const tasks = only ? TASK_NAMES.filter((t) => only.includes(t)) : TASK_NAMES;
const BASELINE = path.join(here, 'baseline.js');
const workerArgs = quick ? ['--batches', '1', '--calls', '12'] : ['--batches', '5', '--calls', '24'];
const CLAMP = (x) => Math.min(10000, Math.max(0.001, x));
const geomean = (xs) => Math.exp(xs.reduce((s, x) => s + Math.log(x), 0) / xs.length);

const started = Date.now();
const result = {
  seed, train_seed: trainSeed, quick, started: new Date(started).toISOString(),
  runner: { node: process.version, platform: process.platform, arch: process.arch, cpus: os.cpus().length, cpu: os.cpus()[0]?.model || null },
  baseline: { tasks: {}, noise: {} },
  solvers: {},
};

// Static guard once per solver (workers re-check; this just avoids 8 pointless spawns).
for (const s of solvers) {
  const src = fs.existsSync(s.file) ? fs.readFileSync(s.file, 'utf8') : null;
  const violations = src == null ? [`file not found: ${s.file}`] : guard(src);
  result.solvers[s.name] = { file: s.file, violations, tasks: {}, failures: [], correct: violations.length === 0, score: 0, score_train: 0, bytes: src ? Buffer.byteLength(src) : 0 };
}

function runWorker(task, file) {
  const r = spawnSync(process.execPath, ['--max-old-space-size=1536', path.join(here, 'worker.mjs'), '--solver', file, '--task', task, '--seed', String(seed), '--train-seed', String(trainSeed), ...workerArgs],
    { encoding: 'utf8', timeout: quick ? 20000 : 90000, maxBuffer: 64 * 1024 * 1024 });
  if (r.error && r.error.code === 'ETIMEDOUT') return { error: 'timeout' };
  if (r.status !== 0 && !r.stdout) return { error: `crash (exit ${r.status}${r.signal ? ', ' + r.signal : ''}): ${(r.stderr || '').trim().split('\n').slice(-3).join(' | ')}` };
  try { return JSON.parse(r.stdout.trim().split('\n').pop()); } catch { return { error: `unparseable worker output: ${(r.stderr || r.stdout || '').slice(-300)}` }; }
}

const log = (...a) => console.error(...a);
log(`arena · seed=${seed} train_seed=${trainSeed} ${quick ? '(quick)' : ''} · ${tasks.length} tasks · solvers: baseline${solvers.map((s) => ', ' + s.name).join('')}${noise ? ', baseline²' : ''}`);

for (const task of tasks) {
  const t0 = Date.now();
  const line = [`  ${task.padEnd(15)}`];
  for (const s of solvers) {
    const S = result.solvers[s.name];
    if (S.violations.length) continue;
    const w = runWorker(task, s.file);
    const reasons = [];
    let entry;
    if (w.error) { reasons.push(w.error); entry = { correct: false, reasons }; }
    else if (w.violations?.length) { reasons.push(...w.violations); entry = { correct: false, reasons }; }
    else {
      if (w.base_edges_correct === false || w.splits.train?.base_correct === false || w.splits.holdout?.base_correct === false) {
        result.arena_error = `baseline failed on ${task} (arena bug, not a solver problem)`;
      }
      for (const sp of ['train', 'holdout']) {
        const r = w.splits[sp];
        if (!r) { reasons.push(`${sp}: missing`); continue; }
        if (r.threw) reasons.push(`${sp}: threw an exception`);
        if (r.lazy) reasons.push(`${sp}: sparse/lazy output`);
        if (r.mutated) reasons.push(`${sp}: mutated its input`);
        for (const m of r.mismatches) reasons.push(`${sp}: wrong output (call ${m.call}; expected ${m.expected})`);
      }
      if (w.edges) {
        if (w.edges.threw) reasons.push('edge: threw an exception');
        if (w.edges.lazy) reasons.push('edge: sparse/lazy output');
        if (w.edges.mutated) reasons.push('edge: mutated its input');
        for (const m of w.edges.mismatches) reasons.push(`edge: ${m.input} → expected ${m.expected}`);
      }
      const ok = reasons.length === 0;
      if (!result.baseline.tasks[task] && w.splits.train?.base_us) result.baseline.tasks[task] = { us_train: w.splits.train.base_us, us_holdout: w.splits.holdout?.base_us ?? null };
      entry = {
        correct: ok,
        us_train: w.splits.train?.us ?? null, us_holdout: w.splits.holdout?.us ?? null,
        base_us_train: w.splits.train?.base_us ?? null, base_us_holdout: w.splits.holdout?.base_us ?? null,
        speedup_train: ok && w.splits.train?.ratio ? CLAMP(w.splits.train.ratio) : null,
        speedup: ok && w.splits.holdout?.ratio ? CLAMP(w.splits.holdout.ratio) : null,
        ratios_holdout: w.splits.holdout?.ratios ?? [],
        p25_us: w.splits.holdout?.p25 ?? null, p75_us: w.splits.holdout?.p75 ?? null,
        reasons,
      };
    }
    S.tasks[task] = entry;
    if (!entry.correct) { S.correct = false; S.failures.push(...reasons.map((r) => `${task}: ${r}`)); }
    line.push(`${s.name} ${entry.correct ? `${fmt(entry.speedup_train)}×/${fmt(entry.speedup)}× (${fmtUs(entry.base_us_holdout)}→${fmtUs(entry.us_holdout)})` : 'FAIL'}`);
  }
  if (noise) {
    const b2 = runWorker(task, BASELINE);
    if (!b2.error && b2.splits?.holdout?.ratio) {
      result.baseline.noise[task] = +b2.splits.holdout.ratio.toFixed(4);
      line.push(`noise ${(100 * Math.abs(b2.splits.holdout.ratio - 1)).toFixed(1)}%`);
    }
  }
  log(line.join(' · ') + `  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  if (result.arena_error) { log(`  !! ${result.arena_error}`); break; }
}

for (const s of solvers) {
  const S = result.solvers[s.name];
  const entries = tasks.map((t) => S.tasks[t]).filter(Boolean);
  if (S.correct && entries.length === tasks.length && entries.every((e) => e.correct)) {
    S.score = +geomean(entries.map((e) => e.speedup)).toFixed(4);
    S.score_train = +geomean(entries.map((e) => e.speedup_train)).toFixed(4);
  } else { S.correct = false; S.score = 0; S.score_train = 0; }
  // Measurement noise of THIS run: how far the per-batch paired ratios stray from their median.
  const devs = [];
  for (const e of entries) if (e.ratios_holdout?.length > 1) { const m = e.ratios_holdout.slice().sort((a, b) => a - b)[Math.floor(e.ratios_holdout.length / 2)]; for (const x of e.ratios_holdout) devs.push(100 * Math.abs(x / m - 1)); }
  S.noise_pct = devs.length ? +Math.max(...devs).toFixed(2) : null;
  log(`${s.name}: ${S.correct ? `score ${S.score} (train ${S.score_train}) · batch noise ≤ ${S.noise_pct}%` : `INCORRECT — ${S.failures[0] || S.violations[0] || 'see report'}`}`);
}
const noiseVals = Object.values(result.baseline.noise);
if (noiseVals.length) result.baseline.max_noise_pct = +Math.max(...noiseVals.map((r) => 100 * Math.abs(r - 1))).toFixed(2);
result.duration_ms = Date.now() - started;
if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(result, null, 2)); log(`wrote ${out} (${(result.duration_ms / 1000).toFixed(1)}s)`); }
else process.stdout.write(JSON.stringify(result, null, 2) + '\n');
if (result.arena_error) process.exit(3);

function fmt(x) { return x == null ? '—' : x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2); }
function fmtUs(us) { return us == null ? '—' : us >= 1000 ? (us / 1000).toFixed(1) + 'ms' : us.toFixed(0) + 'µs'; }
