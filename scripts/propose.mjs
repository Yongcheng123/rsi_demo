#!/usr/bin/env node
// scripts/propose.mjs — job ① of the loop: ask the model for a candidate genome.
//
// Holds the API key. Has NO write access to the repository: everything it produces
// goes into --out and travels to the other jobs as a build artifact.
//
//   node scripts/propose.mjs --out candidate [--type auto|L0|L1] [--mock]
//
// L0 = rewrite agent/solver.js using the current agent/improver.md as strategy.
// L1 = first rewrite agent/improver.md (meta level), then immediately use the NEW
//      improver to rewrite the solver. Both files are accepted or rejected together,
//      so an improver change is judged by the solver it produces — no delayed credit.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { guard } from '../arena/guard.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.root || path.resolve(here, '..'));
const OUT = path.resolve(args.out || '.tmp/candidate');
const MOCK = args.mock === 'true';
const MODEL = process.env.RSI_MODEL || 'claude-opus-5';
const EFFORT = process.env.RSI_EFFORT || 'high';
const MAX_TOKENS = Number(process.env.RSI_MAX_TOKENS || 32000);

const PRICES = { // $/MTok input, output — for the cost column on the dashboard
  'claude-opus-5': [5, 25], 'claude-opus-4-8': [5, 25], 'claude-opus-4-7': [5, 25], 'claude-opus-4-6': [5, 25],
  'claude-sonnet-5': [2, 10], 'claude-sonnet-4-6': [3, 15], 'claude-haiku-4-5': [1, 5],
  'claude-fable-5-1': [10, 50], 'claude-fable-5': [10, 50],
};

const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const history = JSON.parse(read('docs/history.json'));
const strategy = JSON.parse(read('agent/strategy.json'));
const spec = read('arena/SPEC.md');
const protocol = read('scripts/protocol.md');
const metaPrompt = read('scripts/meta-prompt.md');
const solver = read('agent/solver.js');
const notes = read('agent/notes.md');
let improver = read('agent/improver.md');

const last = history.generations.at(-1);
const gen = (last?.gen ?? 0) + 1;
let type = args.type || 'auto';
if (type === 'auto') type = strategy.stall >= strategy.force_meta_after_stall ? 'L1' : Math.random() < strategy.p_meta ? 'L1' : 'L0';
const started = Date.now();
const usage = { input_tokens: 0, output_tokens: 0, cache_read: 0, cache_write: 0, cost_usd: 0, calls: 0 };
const meta = { gen, type, model: MODEL, effort: EFFORT, mock: MOCK, started: new Date(started).toISOString(), improver_changed: false, repaired: false, summary: null, error: null };
fs.mkdirSync(OUT, { recursive: true });
log(`gen ${gen} · ${type} · ${MOCK ? 'MOCK' : MODEL + ' @ ' + EFFORT} · stall=${strategy.stall} p_meta=${strategy.p_meta}`);

try {
  if (MOCK) {
    mock();
  } else {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic();
    if (type === 'L1') {
      const r = await ask(client, metaPrompt, metaUser());
      const blocks = parseBlocks(r.text);
      const next = blocks.files['agent/improver.md'];
      if (!next || next.trim().length < 200) throw new Error(`L1 produced no usable improver.md (stop=${r.stop})`);
      improver = next.trim() + '\n';
      meta.improver_changed = true;
      fs.writeFileSync(path.join(OUT, 'improver.md'), improver);
      log(`  improver rewritten (${improver.split('\n').length} lines)`);
    }
    let r = await ask(client, protocol + '\n\n---\n\n' + spec, objectUser());
    let blocks = parseBlocks(r.text);
    let candidate = blocks.files['agent/solver.js'];
    let violations = candidate ? guard(candidate) : ['no agent/solver.js block in the response'];
    if (violations.length) { // one repair round — a guard violation is a wasted generation otherwise
      log(`  guard rejected draft: ${violations.slice(0, 4).join(' | ')}`);
      const repair = `The static guard rejected your agent/solver.js:\n${violations.map((v) => '- ' + v).join('\n')}\n\nFix these and output ALL blocks again (solver.js, notes.md, SUMMARY), complete.`;
      r = await ask(client, protocol + '\n\n---\n\n' + spec, objectUser(), [{ role: 'assistant', content: r.content }, { role: 'user', content: repair }]);
      blocks = parseBlocks(r.text);
      candidate = blocks.files['agent/solver.js'];
      violations = candidate ? guard(candidate) : ['no agent/solver.js block in the response'];
      meta.repaired = true;
    }
    if (!candidate) throw new Error(`model produced no solver.js (stop=${r.stop}${r.stop_details ? ' ' + JSON.stringify(r.stop_details) : ''})`);
    fs.writeFileSync(path.join(OUT, 'solver.js'), candidate.trim() + '\n');
    fs.writeFileSync(path.join(OUT, 'notes.md'), (blocks.files['agent/notes.md'] || notes).trim() + '\n');
    meta.summary = (blocks.summary || '').trim().slice(0, 1200) || null;
    meta.guard_violations = violations; // evaluate will reject; recorded so the reason is visible
    log(`  solver ${candidate.length} bytes · guard ${violations.length ? 'VIOLATIONS: ' + violations[0] : 'clean'}`);
  }
} catch (e) {
  meta.error = String((e && e.message) || e);
  log(`  proposal failed: ${meta.error}`);
}
meta.usage = usage;
meta.duration_ms = Date.now() - started;
fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 2));
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `gen_type=${type}\ngen=${gen}\n`);
log(`  wrote ${OUT} · ${usage.calls} calls · ${usage.input_tokens + usage.output_tokens} tokens · $${usage.cost_usd.toFixed(3)}`);
process.exit(meta.error && !fs.existsSync(path.join(OUT, 'solver.js')) ? 1 : 0);

// ---------------------------------------------------------------- prompts
function championTasks() {
  return last?.accepted ? last.candidate?.tasks : last?.champion_measured?.tasks;
}
function taskTable(tasks) {
  if (!tasks) return '(no measurement yet)';
  const rows = Object.entries(tasks).map(([t, e]) => `| ${t} | ${e.correct === false ? 'FAIL' : fmt(e.speedup_train) + '×'} | ${e.correct === false ? 'FAIL' : fmt(e.speedup) + '×'} | ${fmtUs(e.base_us)} → ${fmtUs(e.us)} |`);
  return ['| task | train speedup | holdout speedup | baseline → this (holdout, per call) |', '|---|---|---|---|', ...rows].join('\n');
}
function recentTrack(n) {
  const gens = history.generations.filter((g) => g.gen > 0).slice(-n);
  if (!gens.length) return '(none yet — this is the first generation)';
  return gens.map((g) => `- gen ${g.gen} [${g.type}] ${g.accepted ? 'ACCEPTED' : 'rejected'} · candidate ${fmt(g.candidate?.score)}× vs champion ${fmt(g.champion_measured?.score)}× · ${g.reason}${g.summary ? `\n  ↳ ${g.summary.slice(0, 300)}` : ''}`).join('\n');
}
function objectUser() {
  const lastRejected = last && last.gen > 0 && !last.accepted ? last : null;
  const champScore = last?.accepted ? last.candidate?.score : last?.champion_measured?.score;
  return `# Generation ${gen} (${type}${meta.improver_changed ? ', improver just rewritten' : ''})

## Strategy — agent/improver.md
${improver}

## Current champion — agent/solver.js
\`\`\`js
${solver}
\`\`\`

## Memory — agent/notes.md
${notes}

## Champion evaluation (most recent run)
Score ${fmt(champScore)}× (geometric mean of holdout speedups). To be accepted you need > ${fmt((champScore || 1) * (1 + (strategy.margin ?? 0.05)))}×.

${taskTable(championTasks())}

## Recent generations
${recentTrack(8)}
${lastRejected ? `
## The previous candidate was rejected — learn from it
Reason: ${lastRejected.reason}
${lastRejected.candidate?.tasks ? taskTable(lastRejected.candidate.tasks) : ''}
${lastRejected.candidate?.failures?.length ? 'Failures:\n' + lastRejected.candidate.failures.map((f) => '- ' + f).join('\n') : ''}
${lastRejected.candidate?.violations?.length ? 'Guard violations:\n' + lastRejected.candidate.violations.map((f) => '- ' + f).join('\n') : ''}
${lastRejected.summary ? 'Its author said: ' + lastRejected.summary : ''}` : ''}

Now produce the three output blocks.`;
}
function metaUser() {
  const gens = history.generations.filter((g) => g.gen > 0);
  const acc = gens.filter((g) => g.accepted).length;
  const reasons = {};
  for (const g of gens.filter((g) => !g.accepted)) { const k = (g.reason || '').split(/[:(]/)[0].trim(); reasons[k] = (reasons[k] || 0) + 1; }
  return `# Meta generation ${gen}

## Current improver — agent/improver.md
${improver}

## Track record under this loop so far
${gens.length} generations, ${acc} accepted (${gens.length ? Math.round((100 * acc) / gens.length) : 0} %). Consecutive rejections right now: ${strategy.stall}.
Rejection reasons: ${Object.entries(reasons).map(([k, v]) => `${k} ×${v}`).join(', ') || 'none'}.

${recentTrack(12)}

## The agent's own notes — agent/notes.md
${notes}

## Current champion per-task speedups
${taskTable(championTasks())}

Rewrite agent/improver.md now.`;
}

// ---------------------------------------------------------------- model call
async function ask(client, system, user, extra = []) {
  const messages = [{ role: 'user', content: user }, ...extra];
  const base = { model: MODEL, max_tokens: MAX_TOKENS, system, messages };
  if (!/haiku/.test(MODEL)) { base.thinking = { type: 'adaptive' }; base.output_config = { effort: EFFORT }; }
  let msg;
  if (/opus-5|fable/.test(MODEL)) { // server-side refusal fallback, per current API guidance
    try { msg = await client.beta.messages.stream({ ...base, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }).finalMessage(); }
    catch (e) { if (e && e.status === 400) msg = await client.messages.stream(base).finalMessage(); else throw e; }
  } else msg = await client.messages.stream(base).finalMessage();
  usage.calls++;
  usage.input_tokens += msg.usage.input_tokens || 0;
  usage.output_tokens += msg.usage.output_tokens || 0;
  usage.cache_read += msg.usage.cache_read_input_tokens || 0;
  usage.cache_write += msg.usage.cache_creation_input_tokens || 0;
  const [pi, po] = PRICES[msg.model] || PRICES[MODEL] || [5, 25];
  usage.cost_usd += ((msg.usage.input_tokens || 0) * pi + (msg.usage.output_tokens || 0) * po + (msg.usage.cache_read_input_tokens || 0) * pi * 0.1 + (msg.usage.cache_creation_input_tokens || 0) * pi * 1.25) / 1e6;
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  if (msg.stop_reason === 'refusal') throw new Error(`model refused: ${JSON.stringify(msg.stop_details)}`);
  if (msg.stop_reason === 'max_tokens') log('  warning: hit max_tokens — output may be truncated');
  return { text, content: msg.content, stop: msg.stop_reason, stop_details: msg.stop_details };
}

// ---------------------------------------------------------------- parsing
function parseBlocks(text) {
  const files = {}; let summary = null;
  const lines = text.split('\n');
  let cur = null, buf = [];
  const flush = () => { if (!cur) return; const body = stripFence(buf.join('\n')); if (cur === 'SUMMARY') summary = body; else files[cur] = body; };
  for (const line of lines) {
    const m = line.match(/^\s*={3,}\s*(FILE:\s*(\S+)|SUMMARY)\s*={3,}\s*$/);
    if (m) { flush(); cur = m[2] ? m[2] : 'SUMMARY'; buf = []; } else if (cur) buf.push(line);
  }
  flush();
  return { files, summary };
}
function stripFence(s) {
  const t = s.replace(/^\s*\n/, '').replace(/\n\s*$/, '');
  const m = t.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n```\s*$/);
  return m ? m[1] : t;
}

// ---------------------------------------------------------------- mock (pipeline tests, CI smoke)
function mock() {
  // A plausible object-level step: replace the O(n·u) dedupe with a Set. If that has
  // already happened, re-emit the champion (→ rejected as "no improvement"), which still
  // exercises every stage of the pipeline.
  const re = /export function dedupe\(arr\) \{[\s\S]*?\n\}\n/;
  const better = `export function dedupe(arr) {
  const seen = new Set();
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (!seen.has(v)) { seen.add(v); out.push(v); }
  }
  return out;
}
`;
  const changed = re.test(solver) && !/new Set\(\)/.test(solver.match(re)[0]);
  const next = changed ? solver.replace(re, better) : solver;
  fs.writeFileSync(path.join(OUT, 'solver.js'), next);
  fs.writeFileSync(path.join(OUT, 'notes.md'), notes.trimEnd() + `\n\n- gen ${gen} (mock): ${changed ? 'dedupe → Set (O(n))' : 'no change'}\n`);
  if (type === 'L1') { improver = improver.trimEnd() + `\n\n<!-- mock L1 edit at gen ${gen} -->\n`; fs.writeFileSync(path.join(OUT, 'improver.md'), improver); meta.improver_changed = true; }
  meta.summary = changed ? 'MOCK: replaced the quadratic dedupe with a Set-based O(n) pass; everything else unchanged.' : 'MOCK: no change (dedupe already optimal in this mock).';
  usage.calls = 0;
}

function fmt(x) { return x == null ? '—' : x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2); }
function fmtUs(us) { return us == null ? '—' : us >= 1000 ? (us / 1000).toFixed(1) + 'ms' : us.toFixed(0) + 'µs'; }
function log(...a) { console.error(...a); }
function parseArgs(argv) { const o = {}; for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) { const k = a.slice(2); o[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true'; } } return o; }
