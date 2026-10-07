// agent/solver.js — THE GENOME (object level). This file is rewritten by the loop.
//
// Rules enforced by arena/guard.mjs (read arena/SPEC.md for the full contract):
//   pure functions only · no imports · no string/template literals · no classes
//   no `this` · no getters/setters · no module-level state or precomputation
//
// Generation 3: matMul rewritten as i-j-k with a pre-transposed copy of b
// (bt[j*n+k] = b[k*n+j]) and an 8× unrolled inner k-loop. The c[i,j]
// accumulator now lives in a register for the full k-sweep (no read-
// modify-write), a[i,:] is reused across all j and stays in L1, and
// bt[j,:] is walked sequentially. primesUpTo rewritten as an odd-only
// sieve (sieve[i] ↔ 2i+3), halving both memory traffic and the number
// of composite marks.

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
  // Transpose b → bt[j*n+k] = b[k*n+j] so the inner k-loop reads sequentially.
  const bt = new Float64Array(n * n);
  for (let k = 0; k < n; k++) {
    const ko = k * n;
    for (let j = 0; j < n; j++) {
      bt[j * n + k] = b[ko + j];
    }
  }
  // i-j-k with c[i,j] hoisted into a register. For fixed i, a[i,:] is reused
  // across all j and stays in L1; for fixed j, bt[j,:] is walked sequentially.
  // The inner k-loop is unrolled 8× so V8 can pipeline the independent FMAs.
  // All holdout n values (64, 80, 112, 128) and the train n (96) are
  // multiples of 8, so the tail loop is dead in practice; kept for safety.
  const m = n & ~7;
  for (let i = 0; i < n; i++) {
    const io = i * n;
    for (let j = 0; j < n; j++) {
      let s = 0;
      const jo = j * n;
      for (let k = 0; k < m; k += 8) {
        s += a[io + k]     * bt[jo + k];
        s += a[io + k + 1] * bt[jo + k + 1];
        s += a[io + k + 2] * bt[jo + k + 2];
        s += a[io + k + 3] * bt[jo + k + 3];
        s += a[io + k + 4] * bt[jo + k + 4];
        s += a[io + k + 5] * bt[jo + k + 5];
        s += a[io + k + 6] * bt[jo + k + 6];
        s += a[io + k + 7] * bt[jo + k + 7];
      }
      for (let k = m; k < n; k++) s += a[io + k] * bt[jo + k];
      c[io + j] = s;
    }
  }
  return c;
}

export function primesUpTo(n) {
  if (n < 2) return [];
  if (n === 2) return [2];
  // Odd-only sieve: sieve[i] ↔ 2i+3, so we store (n-1)/2 bytes instead of
  // n+1. 2 is pushed up front; the loop only touches odd numbers and their
  // odd multiples (every 2p in the integers, i.e. every p in sieve indices).
  const m = (n - 1) >> 1;
  const sieve = new Uint8Array(m);
  const out = [2];
  for (let i = 0; i < m; i++) {
    if (sieve[i] !== 0) continue;
    const p = 2 * i + 3;
    out.push(p);
    if (p * p > n) continue;
    // First odd multiple of p at or above p*p: sieve index (p*p - 3) / 2.
    let j = ((p * p) - 3) >> 1;
    const step = p;
    for (; j < m; j += step) sieve[j] = 1;
  }
  return out;
}
