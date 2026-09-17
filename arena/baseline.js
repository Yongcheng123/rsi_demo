// arena/baseline.js — FROZEN copy of the generation-0 solver. PROTECTED.
// Every speedup is measured against this file, in the same run, on the same machine.
//
// Rules enforced by arena/guard.mjs (read arena/SPEC.md for the full contract):
//   pure functions only · no imports · no string/template literals · no classes
//   no `this` · no getters/setters · no module-level state or precomputation
//
// Generation 0: deliberately naive implementations. Every one of them is correct.

export function topK(arr, k) {
  if (k <= 0) return [];
  const sorted = arr.slice().sort((a, b) => b - a);
  return sorted.slice(0, k);
}

export function dedupe(arr) {
  const out = [];
  for (let i = 0; i < arr.length; i++) if (out.indexOf(arr[i]) === -1) out.push(arr[i]);
  return out;
}

export function mergeIntervals(intervals) {
  const list = [];
  for (let i = 0; i < intervals.length; i++) list.push([intervals[i][0], intervals[i][1]]);
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < list.length && !merged; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (list[i][0] <= list[j][1] && list[j][0] <= list[i][1]) {
          list[i] = [Math.min(list[i][0], list[j][0]), Math.max(list[i][1], list[j][1])];
          list.splice(j, 1);
          merged = true;
          break;
        }
      }
    }
  }
  return list.sort((a, b) => a[0] - b[0]);
}

export function lis(arr) {
  const n = arr.length;
  if (n === 0) return 0;
  const dp = new Array(n);
  for (let i = 0; i < n; i++) dp[i] = 1;
  let best = 1;
  for (let i = 1; i < n; i++) {
    for (let j = 0; j < i; j++) if (arr[j] < arr[i] && dp[j] + 1 > dp[i]) dp[i] = dp[j] + 1;
    if (dp[i] > best) best = dp[i];
  }
  return best;
}

export function wordFreqTopK(text, k) {
  if (k <= 0) return [];
  const words = text.split(/\s+/).filter(Boolean);
  const uniq = [];
  for (let i = 0; i < words.length; i++) if (!uniq.includes(words[i])) uniq.push(words[i]);
  const counts = [];
  for (let i = 0; i < uniq.length; i++) counts.push([uniq[i], words.filter((w) => w === uniq[i]).length]);
  counts.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return counts.slice(0, k);
}

export function twoSumCount(arr, target) {
  let c = 0;
  for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) if (arr[i] + arr[j] === target) c++;
  return c;
}

export function matMul(a, b, n) {
  const c = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += a[i * n + k] * b[k * n + j];
      c[i * n + j] = s;
    }
  }
  return c;
}

export function primesUpTo(n) {
  const out = [];
  for (let x = 2; x <= n; x++) {
    let isPrime = true;
    for (let d = 2; d * d <= x; d++) if (x % d === 0) { isPrime = false; break; }
    if (isPrime) out.push(x);
  }
  return out;
}
