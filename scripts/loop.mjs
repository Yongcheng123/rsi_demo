#!/usr/bin/env node
// scripts/loop.mjs — run the whole RSI loop locally, visibly, one generation at a time.
//
//   node scripts/loop.mjs --gens 3 --mock        # no API key needed; exercises every stage
//   node scripts/loop.mjs --gens 3               # real: reads ANTHROPIC_API_KEY from the env
//   node scripts/loop.mjs --gens 1 --live        # write into the real repo instead of the sandbox
//   node scripts/loop.mjs --gens 5 --keep        # continue the existing sandbox instead of resetting it
//
// By default it works in a SANDBOX (.tmp/local/): a copy of agent/ and docs/ with the
// protected directories symlinked in. Nothing tracked by git is touched, so you can run it
// as often as you like; `--live` opts into mutating the real agent/ and docs/history.json.
//
// This is the same three stages CI runs, in the same order, with the same scripts — the only
// things CI adds are the permission split between jobs and the sealed container.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..');
const args = parseArgs(process.argv.slice(2));
const GENS = Number(args.gens || 1);
const MOCK = args.mock === 'true';
const LIVE = args.live === 'true';
const QUICK = args.quick === 'true';
const KEEP = args.keep === 'true';
const TYPE = args.type || 'auto';
const SANDBOX = path.join(REPO, '.tmp/local');
const ROOT = LIVE ? REPO : SANDBOX;

const C = process.stdout.isTTY ? { d: '\x1b[2m', b: '\x1b[1m', g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', c: '\x1b[36m', x: '\x1b[0m' } : new Proxy({}, { get: () => '' });
const out = (s = '') => process.stdout.write(s + '\n');
const dur = (ms) => (ms < 1000 ? ms + 'ms' : (ms / 1000).toFixed(1) + 's');

const resuming = !LIVE && KEEP && fs.existsSync(path.join(SANDBOX, 'docs/history.json'));
if (!LIVE) {
  if (!resuming) {
    fs.rmSync(SANDBOX, { recursive: true, force: true });
    fs.mkdirSync(SANDBOX, { recursive: true });
    fs.cpSync(path.join(REPO, 'agent'), path.join(SANDBOX, 'agent'), { recursive: true });
    fs.cpSync(path.join(REPO, 'docs'), path.join(SANDBOX, 'docs'), { recursive: true });
  } else {
    fs.cpSync(path.join(REPO, 'docs/index.html'), path.join(SANDBOX, 'docs/index.html')); // keep the UI current
  }
  for (const l of ['arena', 'scripts', 'node_modules', 'package.json']) {
    try { fs.symlinkSync(path.join(REPO, l), path.join(SANDBOX, l)); } catch {}
  }
}
if (!MOCK && !process.env.ANTHROPIC_API_KEY) {
  out(`${C.r}ANTHROPIC_API_KEY is not set in this shell.${C.x}`);
  out(`  export it here and re-run, or add --mock to exercise the pipeline without the model:`);
  out(`  ${C.c}export ANTHROPIC_API_KEY=sk-ant-…  &&  node scripts/loop.mjs --gens ${GENS}${C.x}`);
  process.exit(1);
}

const hist0 = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/history.json'), 'utf8'));
const startGen = (hist0.generations.at(-1)?.gen ?? 0);
out('');
out(`${C.b}RSI loop${C.x} ${C.d}·${C.x} ${GENS} generation${GENS > 1 ? 's' : ''} ${C.d}·${C.x} ${MOCK ? `${C.y}mock${C.x}` : `${C.c}${process.env.RSI_MODEL || 'claude-opus-5'}${C.x}`}${QUICK ? ` ${C.d}· quick arena${C.x}` : ''}`);
out(`${C.d}root   ${ROOT}${LIVE ? `  ${C.y}(LIVE — writes the real agent/ and docs/)${C.x}` : `${C.d}  (sandbox${resuming ? ', resuming' : ', reset'} — nothing tracked by git is touched)`}${C.x}`);
out(`${C.d}watch  npm run watch   →  http://localhost:8787/${LIVE ? 'docs/' : '.tmp/local/docs/'}   (auto-refreshes every 3s)${C.x}`);

let champ = null;
for (let i = 0; i < GENS; i++) {
  const gen = startGen + i + 1;
  const candDir = path.join(ROOT, '.candidate');
  fs.rmSync(candDir, { recursive: true, force: true });
  out('');
  out(`${C.b}┌ gen ${gen}${C.x}`);

  // ── ① propose ────────────────────────────────────────────────────────────
  let t = Date.now();
  const pArgs = ['scripts/propose.mjs', '--root', ROOT, '--out', candDir, '--type', TYPE, ...(MOCK ? ['--mock'] : [])];
  const prop = await run(process.execPath, pArgs, '①');
  const meta = readJson(path.join(candDir, 'meta.json')) || {};
  const solverPath = path.join(candDir, 'solver.js');
  if (prop.code !== 0 && !fs.existsSync(solverPath)) {
    out(`${C.r}└ propose failed — ${meta.error || 'see output above'}${C.x}`);
    break;
  }
  const bytes = fs.existsSync(solverPath) ? fs.statSync(solverPath).size : 0;
  out(`${C.d}│${C.x} ${C.b}① propose ${C.x}${C.d}${dur(Date.now() - t).padStart(7)}${C.x}  ${meta.type || '?'}${meta.improver_changed ? `  ${C.c}improver rewritten${C.x}` : ''}  solver ${(bytes / 1024).toFixed(1)} KB${meta.repaired ? `  ${C.y}(needed a guard repair round)${C.x}` : ''}${meta.usage?.cost_usd ? `  ${C.d}$${meta.usage.cost_usd.toFixed(3)}${C.x}` : ''}`);
  if (meta.summary) out(`${C.d}│    ↳ ${meta.summary.replace(/\s+/g, ' ').slice(0, 120)}${C.x}`);

  // ── ② evaluate ───────────────────────────────────────────────────────────
  t = Date.now();
  const scores = path.join(ROOT, '.scores.json');
  const aArgs = ['arena/run.mjs', '--solver', `champion=${path.join(ROOT, 'agent/solver.js')}`, '--solver', `candidate=${solverPath}`, '--out', scores, ...(QUICK ? ['--quick'] : [])];
  await run(process.execPath, aArgs, '②', true);
  const sc = readJson(scores);
  const cand = sc?.solvers?.candidate, ch = sc?.solvers?.champion;
  out(`${C.d}│${C.x} ${C.b}② evaluate${C.x}${C.d}${dur(Date.now() - t).padStart(7)}${C.x}  candidate ${score(cand)} ${C.d}vs${C.x} champion ${score(ch)}`);

  // ── ③ ratchet ────────────────────────────────────────────────────────────
  t = Date.now();
  const rat = await run(process.execPath, ['scripts/ratchet.mjs', '--root', ROOT, '--scores', scores, '--candidate', candDir], '③');
  const hist = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/history.json'), 'utf8'));
  const e = hist.generations.at(-1);
  champ = e.accepted ? e.candidate?.score : e.champion_measured?.score;
  const verdict = e.accepted ? `${C.g}ACCEPT${C.x} ${e.delta != null ? (e.delta >= 0 ? '+' : '') + (e.delta * 100).toFixed(1) + '%' : ''}` : `${C.r}reject${C.x}`;
  out(`${C.d}│${C.x} ${C.b}③ ratchet ${C.x}${C.d}${dur(Date.now() - t).padStart(7)}${C.x}  ${verdict}`);
  out(`${C.d}│    ↳ ${e.reason.replace(/\s+/g, ' ').slice(0, 130)}${C.x}`);
  out(`${C.b}└ champion ${C.x}${C.b}${champ ? champ.toFixed(3) + '×' : '—'}${C.x}${C.d}  ·  stall ${e.stall_after}  ·  p_meta ${e.p_meta_after}${C.x}`);
}

out('');
out(`${C.b}done${C.x} ${C.d}·${C.x} history: ${path.relative(REPO, path.join(ROOT, 'docs/history.json'))}`);
if (!LIVE) out(`${C.d}nothing tracked by git was modified. Inspect the evolved genome in ${path.relative(REPO, path.join(ROOT, 'agent'))}/${C.x}`);
else out(`${C.y}the real agent/ and docs/history.json were modified — 'git diff' to review, 'git checkout agent docs' to undo.${C.x}`);

// ─────────────────────────────────────────────────────────────────────────────
function run(cmd, argv, tag, passthrough = false) {
  return new Promise((resolve) => {
    const ch = spawn(cmd, argv, { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    ch.stdout.on('data', (d) => { stdout += d; });
    ch.stderr.on('data', (d) => {
      stderr += d;
      if (!passthrough) return;
      for (const line of String(d).split('\n')) {
        const l = line.trimEnd();
        if (l && !/^arena ·|^wrote |^champion:|^candidate:/.test(l.trim())) out(`${C.d}│      ${l.trim()}${C.x}`);
      }
    });
    ch.on('close', (code) => {
      if (code !== 0 && !passthrough) process.stderr.write(stderr.split('\n').filter((l) => l.trim()).slice(-6).join('\n') + '\n');
      resolve({ code, stdout, stderr });
    });
  });
}
function score(s) { return !s ? '—' : s.correct ? `${C.b}${s.score.toFixed(3)}×${C.x}` : `${C.r}0 (${(s.violations?.[0] || s.failures?.[0] || 'incorrect').slice(0, 60)})${C.x}`; }
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
function parseArgs(argv) { const o = {}; for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) { const k = a.slice(2); o[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true'; } } return o; }
