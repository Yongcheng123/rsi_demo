#!/usr/bin/env node
// scripts/propose.mjs — job ① of the loop: ask the model for a candidate genome.
//
// Holds the API key. Has NO write access to the repository: everything it produces
// goes into --out and travels to the other jobs as a build artifact.
//
//   node scripts/propose.mjs --out candidate [--type auto|L0|L1] [--mock]
//
// The model is pluggable. Everything downstream — arena, guard, ratchet, dashboard —
// only ever sees "a solver as a string", so the provider is a detail confined to ask():
//
//   RSI_PROVIDER=anthropic  ANTHROPIC_API_KEY=…                   (default)
//   RSI_PROVIDER=openai     OPENAI_API_KEY=…  OPENAI_BASE_URL=…   any OpenAI-compatible
//       endpoint: OpenAI, DeepSeek, Groq, OpenRouter, a LiteLLM proxy, local Ollama/vLLM
//
// The OpenAI path is raw fetch on purpose: /chat/completions is the one surface every
// compatible server implements, and it costs no dependency.
//
// L0 = rewrite agent/solver.js using the current agent/improver.md as strategy.
// L1 = first rewrite agent/improver.md (meta level), then immediately use the NEW
//      improver to rewrite the solver. Both files are accepted or rejected together,
//      so an improver change is judged by the solver it produces — no delayed credit.
import './env.mjs'; // loads .env.local for local runs; real env vars win
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { guard } from '../arena/guard.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.root || path.resolve(here, '..'));
const OUT = path.resolve(args.out || '.tmp/candidate');
const MOCK = args.mock === 'true';
const PROVIDER = (process.env.RSI_PROVIDER || 'anthropic').toLowerCase();
const MODEL = process.env.RSI_MODEL || (PROVIDER === 'openai' ? 'gpt-5' : 'claude-opus-5');
const EFFORT = process.env.RSI_EFFORT || 'high';
const MAX_TOKENS = Number(process.env.RSI_MAX_TOKENS || 32000);
const TIMEOUT_MS = Number(process.env.RSI_TIMEOUT_MS || 900000); // a local 14B model is slow
// Runaway-reasoning circuit breaker: some reasoning models, given a large prompt, spiral in
// the scratchpad and never start the answer. Measured on minimax-m3: 171,345 reasoning
// characters against 8 characters of content before the upstream gave up, ~10 minutes and
// ~170k tokens burned for nothing. Abort once the ratio is clearly hopeless.
const MAX_REASONING_CHARS = Number(process.env.RSI_MAX_REASONING_CHARS || 120000);
// Accept a base url with or without the /v1 suffix — both spellings are common in the wild.
const RAW_BASE = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const BASE_URL = /\/v\d+$/.test(RAW_BASE) ? RAW_BASE : RAW_BASE + '/v1';

const PRICES = { // $/MTok input, output — only feeds the cost column on the dashboard
  'claude-opus-5': [5, 25], 'claude-opus-4-8': [5, 25], 'claude-opus-4-7': [5, 25], 'claude-opus-4-6': [5, 25],
  'claude-sonnet-5': [2, 10], 'claude-sonnet-4-6': [3, 15], 'claude-haiku-4-5': [1, 5],
  'claude-fable-5-1': [10, 50], 'claude-fable-5': [10, 50],
  'deepseek-chat': [0.28, 0.42], 'deepseek-reasoner': [0.56, 1.68], 'gpt-5': [1.25, 10], 'gpt-5-mini': [0.25, 2],
};
// A model that isn't in the table (a local one, a proxied one, a new release) reports $0.
// Set RSI_PRICE_IN / RSI_PRICE_OUT if you want the dashboard's cost column to mean something.
const PRICE_OVERRIDE = process.env.RSI_PRICE_IN && process.env.RSI_PRICE_OUT
  ? [Number(process.env.RSI_PRICE_IN), Number(process.env.RSI_PRICE_OUT)] : null;

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
const meta = { gen, type, provider: MOCK ? null : PROVIDER, model: MODEL, effort: EFFORT, mock: MOCK, started: new Date(started).toISOString(), improver_changed: false, repaired: false, summary: null, error: null };
fs.mkdirSync(OUT, { recursive: true });
log(`gen ${gen} · ${type} · ${MOCK ? 'MOCK' : `${MODEL} (${PROVIDER === 'openai' ? BASE_URL : 'anthropic @ ' + EFFORT})`} · stall=${strategy.stall} p_meta=${strategy.p_meta}`);

try {
  if (MOCK) {
    mock();
  } else {
    if (type === 'L1') {
      const r = await ask(metaPrompt, metaUser());
      const blocks = parseBlocks(r.text);
      const next = blocks.files['agent/improver.md'];
      if (!next || next.trim().length < 200) throw new Error(`L1 produced no usable improver.md (stop=${r.stop})`);
      improver = next.trim() + '\n';
      meta.improver_changed = true;
      fs.writeFileSync(path.join(OUT, 'improver.md'), improver);
      log(`  improver rewritten (${improver.split('\n').length} lines)`);
    }
    let r = await ask(protocol + '\n\n---\n\n' + spec, objectUser());
    let blocks = parseBlocks(r.text);
    let candidate = blocks.files['agent/solver.js'];
    let violations = candidate ? guard(candidate) : ['no agent/solver.js block in the response'];
    if (violations.length) { // one repair round — a guard violation is a wasted generation otherwise
      log(`  guard rejected draft: ${violations.slice(0, 4).join(' | ')}`);
      const repair = `The static guard rejected your agent/solver.js:\n${violations.map((v) => '- ' + v).join('\n')}\n\nFix these and output ALL blocks again (solver.js, notes.md, SUMMARY), complete.`;
      r = await ask(protocol + '\n\n---\n\n' + spec, objectUser(), { assistant: r, user: repair });
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
// `prior` is the one-shot repair round: { assistant: <previous result>, user: <repair text> }.
// Each provider formats it its own way — Anthropic replays the original content blocks
// (thinking blocks must go back unchanged on the same model); OpenAI takes plain text.
async function ask(system, user, prior = null) {
  const r = PROVIDER === 'openai' ? await askOpenAI(system, user, prior) : await askAnthropic(system, user, prior);
  usage.calls++;
  const [pi, po] = PRICE_OVERRIDE || PRICES[r.billedModel] || PRICES[MODEL] || [0, 0];
  usage.input_tokens += r.u.in;
  usage.output_tokens += r.u.out;
  usage.cache_read += r.u.cacheRead;
  usage.cache_write += r.u.cacheWrite;
  usage.cost_usd += (r.u.in * pi + r.u.out * po + r.u.cacheRead * pi * 0.1 + r.u.cacheWrite * pi * 1.25) / 1e6;
  if (r.truncated) log(`  warning: output hit the token cap — it is probably truncated (raise RSI_MAX_TOKENS, now ${MAX_TOKENS})`);
  return r;
}

async function askAnthropic(system, user, prior) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();
  const messages = [{ role: 'user', content: user }];
  if (prior) messages.push({ role: 'assistant', content: prior.assistant.content }, { role: 'user', content: prior.user });
  const base = { model: MODEL, max_tokens: MAX_TOKENS, system, messages };
  if (!/haiku/.test(MODEL)) { base.thinking = { type: 'adaptive' }; base.output_config = { effort: EFFORT }; }
  let msg;
  if (/opus-5|fable/.test(MODEL)) { // server-side refusal fallback, per current API guidance
    try { msg = await client.beta.messages.stream({ ...base, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }).finalMessage(); }
    catch (e) { if (e && e.status === 400) msg = await client.messages.stream(base).finalMessage(); else throw e; }
  } else msg = await client.messages.stream(base).finalMessage();
  if (msg.stop_reason === 'refusal') throw new Error(`model refused: ${JSON.stringify(msg.stop_details)}`);
  return {
    text: msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n'),
    content: msg.content, stop: msg.stop_reason, billedModel: msg.model,
    truncated: msg.stop_reason === 'max_tokens',
    u: { in: msg.usage.input_tokens || 0, out: msg.usage.output_tokens || 0, cacheRead: msg.usage.cache_read_input_tokens || 0, cacheWrite: msg.usage.cache_creation_input_tokens || 0 },
  };
}

// Raw fetch against /chat/completions — the lowest common denominator every
// OpenAI-compatible server implements. No SDK, so no version skew with odd proxies.
//
// STREAMING IS NOT OPTIONAL HERE. Non-streaming, the server sends no response headers
// until generation finishes, and undici's headersTimeout (300s, which AbortSignal does
// not override) kills the socket first — a reasoning model writing a 4 KB solver blows
// straight through that. Streaming gets headers immediately, so only a genuinely stalled
// stream can time out.
async function askOpenAI(system, user, prior) {
  const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
  if (prior) messages.push({ role: 'assistant', content: prior.assistant.text }, { role: 'user', content: prior.user });
  const body = { model: MODEL, messages, max_tokens: MAX_TOKENS, stream: true, stream_options: { include_usage: true } };
  if (process.env.RSI_TEMPERATURE) body.temperature = Number(process.env.RSI_TEMPERATURE);
  if (process.env.RSI_REASONING_EFFORT) body.reasoning_effort = process.env.RSI_REASONING_EFFORT;

  const key = process.env.OPENAI_API_KEY;
  const payload = JSON.stringify(body);
  let res;
  try {
    res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: payload,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    // Node reports network failures as a bare "fetch failed"; the reason lives in .cause.
    const why = e?.cause ? `${e.cause.code || ''} ${e.cause.message || e.cause}`.trim()
      : e?.name === 'TimeoutError' ? `no response in ${TIMEOUT_MS / 1000}s` : String(e?.message || e);
    throw new Error(`cannot reach ${BASE_URL}/chat/completions (${(payload.length / 1024).toFixed(0)} KB request): ${why}`);
  }
  if (!res.ok) {
    const raw = await res.text();
    let msg = raw;
    try { msg = JSON.parse(raw).error?.message || raw; } catch {}
    throw new Error(`${MODEL} via ${BASE_URL} failed (HTTP ${res.status}): ${String(msg).slice(0, 400)}`);
  }

  let text = '', finish = null, usageObj = null, billed = MODEL, buf = '', reasoningChars = 0, chunks = 0;
  const tick = setInterval(() => log(`    …streaming: ${text.length} chars${reasoningChars ? ` (+${reasoningChars} reasoning)` : ''}`), 30000);
  try {
    const decoder = new TextDecoder();
    for await (const part of res.body) {
      buf += decoder.decode(part, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';            // keep the trailing partial line
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const data = t.slice(5).trim();
        if (data === '[DONE]') continue;
        let ev;
        try { ev = JSON.parse(data); } catch { continue; }   // heartbeats and comments
        if (ev.error) throw new Error(`stream error: ${JSON.stringify(ev.error).slice(0, 300)}`);
        if (ev.model) billed = ev.model;
        if (ev.usage) usageObj = ev.usage;
        const c = ev.choices?.[0];
        if (!c) continue;
        chunks++;
        if (c.delta?.content) text += c.delta.content;
        if (c.delta?.reasoning_content) reasoningChars += c.delta.reasoning_content.length; // counted, not kept
        if (c.finish_reason) finish = c.finish_reason;
        if (reasoningChars > MAX_REASONING_CHARS && text.trim().length < 200) {
          throw new Error(`${MODEL} is stuck in its scratchpad: ${reasoningChars} reasoning characters and only ${text.trim().length} of answer. `
            + `Aborted to stop burning tokens. Try a lower RSI_REASONING_EFFORT, a model that is better at instruction-following, `
            + `or raise RSI_MAX_REASONING_CHARS (now ${MAX_REASONING_CHARS}) if this model genuinely needs that much.`);
        }
      }
    }
  } catch (e) {
    if (e?.name === 'TimeoutError') throw new Error(`the stream stalled after ${text.length} chars (RSI_TIMEOUT_MS=${TIMEOUT_MS})`);
    throw e;
  } finally { clearInterval(tick); }

  if (finish === 'content_filter') throw new Error('request was blocked by a content filter');
  if (!text.trim()) throw new Error(`${MODEL} returned empty content after ${chunks} chunks (finish_reason=${finish}${reasoningChars ? `, ${reasoningChars} reasoning chars` : ''})`);
  const u = usageObj || {};
  return {
    text, content: text, stop: finish, billedModel: billed,
    truncated: finish === 'length',
    u: { in: u.prompt_tokens || 0, out: u.completion_tokens || 0, cacheRead: u.prompt_tokens_details?.cached_tokens || 0, cacheWrite: 0 },
  };
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
