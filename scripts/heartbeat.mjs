#!/usr/bin/env node
// scripts/heartbeat.mjs — records what happened on a run that produced NO generation. PROTECTED.
//
//   node scripts/heartbeat.mjs --status skipped|failed|ok --reason "…" [--stage propose] [--run-url URL]
//
// Why this exists: ③ ratchet commits every generation, accepted or rejected — but only if
// the pipeline reaches it. A run that dies in ① propose (bad secret, API outage, quota) or
// ② evaluate (runner OOM) used to vanish: no commit, no history entry, a dashboard still
// cheerfully showing the last good generation, and GitHub's 60-day no-commit clock quietly
// running down toward disabling the cron. So every run now lands somewhere.
//
// It is deliberately quiet: identical consecutive outcomes are folded into one entry with a
// counter, and it only asks for a commit when the outcome CHANGES or a day has passed. A
// broken loop therefore produces roughly one commit per day, which is both enough to keep
// the schedule alive and few enough to stay readable.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HIST = path.join(root, 'docs/history.json');
const args = parseArgs(process.argv.slice(2));
const status = args.status || 'failed';
const reason = (args.reason || 'unknown').replace(/\s+/g, ' ').trim().slice(0, 400);
const stage = args.stage || null;
const COMMIT_AFTER_H = Number(args['commit-after-hours'] || 20);
const MAX_RUNS = 200;

const hist = JSON.parse(fs.readFileSync(HIST, 'utf8'));
if (!Array.isArray(hist.runs)) hist.runs = [];
const now = new Date().toISOString();

// Did this very run already record a generation? Then the generation IS the record.
const lastGen = hist.generations.at(-1);
const genThisRun = args['run-url'] && lastGen?.run_url === args['run-url'];

const prev = hist.runs.at(-1);
const same = prev && prev.status === status && prev.reason === reason && prev.stage === stage;
if (same) { prev.count = (prev.count || 1) + 1; prev.last_ts = now; prev.last_run_url = args['run-url'] || prev.last_run_url; }
else hist.runs.push({ ts: now, last_ts: now, status, stage, reason, count: 1, run_url: args['run-url'] || null, last_run_url: args['run-url'] || null });
if (hist.runs.length > MAX_RUNS) hist.runs = hist.runs.slice(-MAX_RUNS);

// Commit when the outcome is new, or when the repo has been silent long enough that the
// scheduled workflow is drifting toward GitHub's inactivity cutoff.
const sinceCommit = hist.last_heartbeat_commit ? (Date.now() - Date.parse(hist.last_heartbeat_commit)) / 3600000 : Infinity;
const shouldCommit = !genThisRun && (!same || sinceCommit >= COMMIT_AFTER_H);
if (shouldCommit) hist.last_heartbeat_commit = now;

fs.writeFileSync(HIST, JSON.stringify(hist, null, 2));
const n = same ? prev.count : 1;
const msg = `heartbeat: ${status}${stage ? ` at ${stage}` : ''}${n > 1 ? ` (×${n})` : ''} — ${reason.slice(0, 80)}\n\n${reason}\n\nNo generation was produced. Recorded so the loop's health is visible on the dashboard\nand so the scheduled workflow keeps a live commit history.\n\nCo-Authored-By: rsi-bot <rsi-bot@users.noreply.github.com>`;
if (shouldCommit) { fs.mkdirSync(path.join(root, '.tmp'), { recursive: true }); fs.writeFileSync(path.join(root, '.tmp/commit-msg.txt'), msg); }
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `commit=${shouldCommit}\n`);
console.log(`heartbeat: ${status}${stage ? ' @ ' + stage : ''} ×${n} · ${shouldCommit ? 'committing' : genThisRun ? 'generation already recorded this run' : `folded into previous entry (next commit in ${(COMMIT_AFTER_H - sinceCommit).toFixed(1)}h)`}\n  ${reason}`);

function parseArgs(argv) { const o = {}; for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) { const k = a.slice(2); o[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true'; } } return o; }
