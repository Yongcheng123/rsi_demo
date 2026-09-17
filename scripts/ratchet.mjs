#!/usr/bin/env node
// scripts/ratchet.mjs — job ③ of the loop: decide, apply, record. PROTECTED.
//
// Runs with write access to the repository and therefore executes NO agent code: it
// reads two JSON files, does arithmetic, copies at most three files into agent/, and
// appends to docs/history.json. Dependency-free on purpose.
//
//   node scripts/ratchet.mjs --scores out/scores.json --candidate candidate [--run-url URL] [--dry-run]
//   node scripts/ratchet.mjs --init --scores .tmp/scores.json        # write generation 0
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const args = parseArgs(process.argv.slice(2));
const DRY = args['dry-run'] === 'true';
const HIST = path.join(root, 'docs/history.json');
const STRAT = path.join(root, 'agent/strategy.json');
const scores = JSON.parse(fs.readFileSync(path.resolve(args.scores || '.tmp/scores.json'), 'utf8'));
const strategy = JSON.parse(fs.readFileSync(STRAT, 'utf8'));
const compact = (S) => S && { score: S.score, score_train: S.score_train, correct: S.correct, noise_pct: S.noise_pct ?? null, bytes: S.bytes ?? null,
  tasks: Object.fromEntries(Object.entries(S.tasks || {}).map(([t, e]) => [t, { speedup: r4(e.speedup), speedup_train: r4(e.speedup_train), us: r1(e.us_holdout), base_us: r1(e.base_us_holdout), correct: e.correct }])),
  failures: (S.failures || []).slice(0, 6), violations: (S.violations || []).slice(0, 6) };

if (args.init === 'true') {
  const champ = scores.solvers.champion;
  if (!champ?.correct) die('init: champion must be correct');
  const improver = fs.readFileSync(path.join(root, 'agent/improver.md'), 'utf8');
  const hist = { version: 1, created: new Date().toISOString(), repo: args.repo || null, generations: [{
    gen: 0, ts: scores.started, type: 'init', model: null, accepted: true, reason: 'initial genome — solver.js is byte-identical to the frozen baseline, so its score is 1.0 by definition (measured here for honesty)',
    delta: 0, candidate: compact(champ), champion_measured: compact(champ), noise_pct: champ.noise_pct ?? null, seed: scores.seed, runner: scores.runner, arena_ms: scores.duration_ms,
    usage: null, summary: 'Eight deliberately naive but correct implementations, and improver v0 written by a human.', run_url: null, improver_changed: true, improver_md: improver, notes_changed: false,
  }] };
  fs.writeFileSync(HIST, JSON.stringify(hist, null, 2));
  console.log(`wrote ${HIST} with generation 0 (score ${champ.score})`);
  process.exit(0);
}

const candDir = path.resolve(args.candidate || 'candidate');
const meta = readJson(path.join(candDir, 'meta.json')) || { gen: null, type: '?', model: null, usage: null, summary: null, error: 'meta.json missing' };
const hist = JSON.parse(fs.readFileSync(HIST, 'utf8'));
const gen = (hist.generations.at(-1)?.gen ?? 0) + 1;
const cand = scores.solvers.candidate || { correct: false, score: 0, score_train: 0, tasks: {}, violations: [meta.error || 'candidate missing'], failures: [] };
const champ = scores.solvers.champion || { correct: false, score: 0, score_train: 0, tasks: {} };
const margin = strategy.margin ?? 0.05;

let accepted = false, reason;
const champScore = champ.correct ? champ.score : 0;
if (scores.arena_error) reason = `arena error: ${scores.arena_error}`;
else if (meta.error && !cand.tasks) reason = `proposal failed: ${meta.error}`;
else if (cand.violations?.length) reason = `guard violation: ${cand.violations[0]}${cand.violations.length > 1 ? ` (+${cand.violations.length - 1} more)` : ''}`;
else if (!cand.correct) reason = `incorrect: ${cand.failures[0] || 'unknown failure'}${cand.failures.length > 1 ? ` (+${cand.failures.length - 1} more)` : ''}`;
else if (!champ.correct) { accepted = true; reason = `accepted: champion FAILED on this run's fresh holdout (${(champ.failures || [])[0] || 'unknown'}) and the candidate is correct at ${cand.score}×`; }
else if (cand.score <= champScore * (1 + margin)) reason = `no significant improvement: ${cand.score}× vs champion ${champScore}× (needs > ${(champScore * (1 + margin)).toFixed(3)}×, i.e. +${Math.round(margin * 100)}%)`;
else { accepted = true; reason = `accepted: ${cand.score}× vs champion ${champScore}× (+${((cand.score / champScore - 1) * 100).toFixed(1)}%)`; }
const delta = cand.correct && champScore > 0 ? +(cand.score / champScore - 1).toFixed(4) : null;

// ---- apply (only these three files can ever change; everything else is structurally out of reach)
let improverChanged = false, notesChanged = false;
if (accepted && !DRY) {
  for (const f of ['solver.js', 'notes.md', 'improver.md']) {
    const src = path.join(candDir, f);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(root, 'agent', f);
    const before = fs.existsSync(dst) ? fs.readFileSync(dst, 'utf8') : '';
    const after = fs.readFileSync(src, 'utf8');
    if (before !== after) { fs.writeFileSync(dst, after); if (f === 'improver.md') improverChanged = true; if (f === 'notes.md') notesChanged = true; }
  }
} else if (accepted && DRY) { improverChanged = fs.existsSync(path.join(candDir, 'improver.md')); notesChanged = true; }

// ---- strategy: escalate to the meta level as object-level rejections pile up
if (accepted) { strategy.stall = 0; strategy.p_meta = strategy.base_p_meta; }
else { strategy.stall += 1; strategy.p_meta = +Math.min(strategy.p_meta_max, strategy.base_p_meta + strategy.p_meta_step * strategy.stall).toFixed(2); }

// ---- history (every generation is recorded, accepted or not — this is also what keeps the cron alive)
const entry = {
  gen, ts: new Date().toISOString(), type: meta.type || '?', model: meta.model, effort: meta.effort ?? null, mock: !!meta.mock, accepted, reason, delta,
  candidate: compact(cand), champion_measured: compact(champ), champion_failed: !champ.correct,
  noise_pct: cand.noise_pct ?? champ.noise_pct ?? null, seed: scores.seed, runner: scores.runner, arena_ms: scores.duration_ms,
  usage: meta.usage || null, summary: meta.summary || null, proposal_error: meta.error || null, repaired: !!meta.repaired, run_url: args['run-url'] || null,
  improver_changed: accepted && !!meta.improver_changed, notes_changed: accepted && notesChanged,
  stall_after: strategy.stall, p_meta_after: strategy.p_meta,
};
if (entry.improver_changed) entry.improver_md = fs.readFileSync(path.join(candDir, 'improver.md'), 'utf8');
hist.generations.push(entry);

const short = (accepted ? (meta.summary || reason) : reason).replace(/\s+/g, ' ').slice(0, 96);
const commitMsg = `gen ${gen}: ${accepted ? `ACCEPT ${delta != null ? (delta >= 0 ? '+' : '') + (delta * 100).toFixed(1) + '%' : ''}` : 'reject'} (${entry.type}${entry.improver_changed ? ', improver rewritten' : ''}) — ${short}\n\n${reason}\n\nCo-Authored-By: rsi-bot <rsi-bot@users.noreply.github.com>`;
if (!DRY) {
  fs.writeFileSync(HIST, JSON.stringify(hist, null, 2));
  fs.writeFileSync(STRAT, JSON.stringify(strategy, null, 2) + '\n');
  fs.mkdirSync(path.join(root, '.tmp'), { recursive: true });
  fs.writeFileSync(path.join(root, '.tmp/commit-msg.txt'), commitMsg);
}
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `accepted=${accepted}\ngen=${gen}\nreason<<EOR\n${reason}\nEOR\n`);
console.log(`gen ${gen} [${entry.type}] → ${accepted ? 'ACCEPTED' : 'rejected'}${DRY ? ' (dry run, nothing written)' : ''}\n  ${reason}\n  candidate ${cand.score}× / champion ${champScore}× · Δ ${delta == null ? '—' : (delta * 100).toFixed(1) + '%'} · stall ${strategy.stall} · p_meta ${strategy.p_meta}${entry.improver_changed ? '\n  improver.md rewritten' : ''}`);

function r4(x) { return x == null ? null : +Number(x).toFixed(4); }
function r1(x) { return x == null ? null : +Number(x).toFixed(1); }
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
function die(m) { console.error(m); process.exit(2); }
function parseArgs(argv) { const o = {}; for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) { const k = a.slice(2); o[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true'; } } return o; }
