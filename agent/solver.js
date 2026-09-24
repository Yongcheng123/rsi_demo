// agent/solver.js — THE GENOME (object level). This file is rewritten by the loop.
//
// Rules enforced by arena/guard.mjs (read arena/SPEC.md for the full contract):
//   pure functions only · no imports · no string/template literals · no classes
//   no `this` · no getters/setters · no module-level state or precomputation
//
// Generation 1: every function rewritten to the standard textbook upgrade
// over the naive generation-0 baseline (heap, hash, sieve, patience sort, etc.).

export function topK(arr, k) {
  const n = arr.length;
  if (k <= 0 || n === 0) return [];
  if (k >= n) return arr.slice().sort((a, b) => b - a);
  // Min-heap of size k: root holds the current k-th largest.
  const heap = new Array(k);
  for (let i = 0; i < k; i++) heap[i] = arr[i];
  for (let i = ((k - 2) >> 1); i >= 0; i--) siftDown(heap, i, k);
  for (let i = k; i < n; i++) {
    if (arr[i] > heap[0]) {
      heap[0] = arr[i];
      siftDown(heap, 0, k);
    }
  }
  return heap.sort((a, b) => b - a);
}

function siftDown(heap, i, n) {
  const x = heap[i];
  let cur = i;
  let child = 2 * cur + 1;
  while (child < n) {
    if (child + 1 < n && heap[child + 1] < heap[child]) child++;
    if (heap[child] >= x) break;
    heap[cur] = heap[child];
    cur = child;
    child = 2 * cur + 1;
  }
  heap[cur] = x;
}

export function dedupe(arr) {
  const seen = new Set();
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

export function mergeIntervals(intervals) {
  if (intervals.length === 0) return [];
  const list = new Array(intervals.length);
  for (let i = 0; i < intervals.length; i++) list[i] = [intervals[i][0], intervals[i][1]];
  list.sort((a, b) => a[0] - b[0]);
  const out = [list[0]];
  for (let i = 1; i < list.length; i++) {
    const last = out[out.length - 1];
    if (list[i][0] <= last[1]) {
      // overlap or touch: extend the right endpoint if needed
      if (list[i][1] > last[1]) last[1] = list[i][1];
    } else {
      out.push(list[i]);
    }
  }
  return out;
}

export function lis(arr) {
  const n = arr.length;
  if (n === 0) return 0;
  const tails = [];
  for (let i = 0; i < n; i++) {
    const x = arr[i];
    let lo = 0, hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < x) lo = mid + 1;
      else hi = mid;
    }
    if (lo === tails.length) tails.push(x);
    else tails[lo] = x;
  }
  return tails.length;
}

export function wordFreqTopK(text, k) {
  if (k <= 0) return [];
  const words = text.split(/\s+/);
  const counts = new Map();
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.length === 0) continue;
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  const entries = [];
  for (const e of counts) entries.push(e);
  entries.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return entries.slice(0, k);
}

export function twoSumCount(arr, target) {
  const counts = new Map();
  let result = 0;
  for (let i = 0; i < arr.length; i++) {
    const x = arr[i];
    const need = target - x;
    const c = counts.get(need);
    if (c !== undefined) result += c;
    counts.set(x, (counts.get(x) || 0) + 1);
  }
  return result;
}

export function matMul(a, b, n) {
  const c = new Float64Array(n * n);
  // i-k-j loop order: inner loop walks b and c sequentially (cache friendly),
  // and aik is hoisted into a register so `a` is touched once per (i,k).
  for (let i = 0; i < n; i++) {
    const io = i * n;
    for (let k = 0; k < n; k++) {
      const aik = a[io + k];
      const ko = k * n;
      for (let j = 0; j < n; j++) c[io + j] += aik * b[ko + j];
    }
  }
  return c;
}

export function primesUpTo(n) {
  if (n < 2) return [];
  const sieve = new Uint8Array(n + 1);
  const out = [];
  for (let i = 2; i <= n; i++) {
    if (sieve[i] !== 0) continue;
    out.push(i);
    if (i * i <= n) {
      for (let j = i * i; j <= n; j += i) sieve[j] = 1;
    }
  }
  return out;
}
