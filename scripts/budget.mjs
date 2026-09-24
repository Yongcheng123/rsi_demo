#!/usr/bin/env node
// scripts/budget.mjs — preflight: configuration check, kill switch, daily budget.
// Prints `skip=true|false` and `reason=…` (also to $GITHUB_OUTPUT). Dependency-free.
//
// A missing API key is a CLEAN SKIP, not a crash. An unattended loop must distinguish
// "deliberately not running" from "broken": 26 identical red failures carry no more
// information than one, and they bury a real regression when it eventually happens.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_GENS = Number(process.env.MAX_GENS_PER_DAY || 4);
const MAX_COST = Number(process.env.MAX_COST_USD_PER_DAY || 0); // 0 = unlimited
let skip = false, reason = 'ok';

if (fs.existsSync(path.join(root, 'PAUSED'))) { skip = true; reason = 'PAUSED file present (kill switch)'; }
else if (!process.env.ANTHROPIC_API_KEY) { skip = true; reason = 'ANTHROPIC_API_KEY secret is not set — the loop cannot propose'; }
else {
  const hist = JSON.parse(fs.readFileSync(path.join(root, 'docs/history.json'), 'utf8'));
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  const recent = hist.generations.filter((g) => g.gen > 0 && Date.parse(g.ts) > dayAgo);
  const cost = recent.reduce((s, g) => s + (g.usage?.cost_usd || 0), 0);
  if (recent.length >= MAX_GENS) { skip = true; reason = `${recent.length} generations in the last 24h ≥ MAX_GENS_PER_DAY=${MAX_GENS}`; }
  else if (MAX_COST > 0 && cost >= MAX_COST) { skip = true; reason = `$${cost.toFixed(2)} spent in the last 24h ≥ MAX_COST_USD_PER_DAY=${MAX_COST}`; }
  else reason = `${recent.length}/${MAX_GENS} generations and $${cost.toFixed(2)} in the last 24h`;
}
console.log(`skip=${skip}\nreason=${reason}`);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `skip=${skip}\nreason=${reason}\n`);
