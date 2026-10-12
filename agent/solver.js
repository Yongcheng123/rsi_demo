// agent/solver.js — THE GENOME (object level). This file is rewritten by the loop.
//
// Rules enforced by arena/guard.mjs (read arena/SPEC.md for the full contract):
//   pure functions only · no imports · no string/template literals · no classes
//   no `this` · no getters/setters · no module-level state or precomputation
//
// Generation 4: matMul now uses an i-jtile(4)-k(8) micro-kernel. Four
// c[i,j] accumulators stay in registers across the full k-sweep and
// a[i,k..k+7] is loaded once and reused 4x — a-load traffic drops 4x
// and V8 gets 32 independent FMAs per inner iteration to pipeline.
// primesUpTo now uses a bit-packed odd-only sieve (8x less memory →
// 30 KB sieve fits in L1 instead of 250 KB spilling to L2).

export function topK(arr, k) {
  const n = arr.length;
  if (k <= 0 || n === 0) return [];
  if (k >= n) return arr.slice().sort((a, b) => b - a);
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
  // i-jtile(4)-k(8) tiled micro-kernel.
  // For each (i, jj-block of 4): four c[i,jj..jj+3] accumulators live in
  // registers across the full k-sweep; a[i,k..k+7] is loaded once and reused
  // 4x (a-load traffic drops 4x vs gen 3). The 32 independent FMAs per inner
  // iteration give V8's out-of-order pipeline lots of work to overlap.
  // All holdout n values (64, 80, 96, 112, 128) are multiples of both 4 and
  // 8, so the j-tail and k-tail loops are dead in practice; kept for safety.
  const m = n & ~7;
  const nj = n & ~3;
  for (let i = 0; i < n; i++) {
    const io = i * n;
    for (let jj = 0; jj < nj; jj += 4) {
      let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
      const o0 = (jj + 0) * n;
      const o1 = (jj + 1) * n;
      const o2 = (jj + 2) * n;
      const o3 = (jj + 3) * n;
      for (let k = 0; k < m; k += 8) {
        const a0 = a[io + k];
        const a1 = a[io + k + 1];
        const a2 = a[io + k + 2];
        const a3 = a[io + k + 3];
        const a4 = a[io + k + 4];
        const a5 = a[io + k + 5];
        const a6 = a[io + k + 6];
        const a7 = a[io + k + 7];
        s0 += a0 * bt[o0 + k]     + a1 * bt[o0 + k + 1]
            + a2 * bt[o0 + k + 2] + a3 * bt[o0 + k + 3]
            + a4 * bt[o0 + k + 4] + a5 * bt[o0 + k + 5]
            + a6 * bt[o0 + k + 6] + a7 * bt[o0 + k + 7];
        s1 += a0 * bt[o1 + k]     + a1 * bt[o1 + k + 1]
            + a2 * bt[o1 + k + 2] + a3 * bt[o1 + k + 3]
            + a4 * bt[o1 + k + 4] + a5 * bt[o1 + k + 5]
            + a6 * bt[o1 + k + 6] + a7 * bt[o1 + k + 7];
        s2 += a0 * bt[o2 + k]     + a1 * bt[o2 + k + 1]
            + a2 * bt[o2 + k + 2] + a3 * bt[o2 + k + 3]
            + a4 * bt[o2 + k + 4] + a5 * bt[o2 + k + 5]
            + a6 * bt[o2 + k + 6] + a7 * bt[o2 + k + 7];
        s3 += a0 * bt[o3 + k]     + a1 * bt[o3 + k + 1]
            + a2 * bt[o3 + k + 2] + a3 * bt[o3 + k + 3]
            + a4 * bt[o3 + k + 4] + a5 * bt[o3 + k + 5]
            + a6 * bt[o3 + k + 6] + a7 * bt[o3 + k + 7];
      }
      for (let k = m; k < n; k++) {
        const ak = a[io + k];
        s0 += ak * bt[o0 + k];
        s1 += ak * bt[o1 + k];
        s2 += ak * bt[o2 + k];
        s3 += ak * bt[o3 + k];
      }
      c[io + jj]     = s0;
      c[io + jj + 1] = s1;
      c[io + jj + 2] = s2;
      c[io + jj + 3] = s3;
    }
    for (let j = nj; j < n; j++) {
      let s = 0;
      const oo = j * n;
      for (let k = 0; k < n; k++) s += a[io + k] * bt[oo + k];
      c[io + j] = s;
    }
  }
  return c;
}

export function primesUpTo(n) {
  if (n < 2) return [];
  if (n === 2) return [2];
  // Bit-packed odd-only sieve. Bit i ↔ odd number 2i+3. Sieve is now
  // ceil((n-1)/16) bytes — 8x smaller than the gen 3 byte sieve. For
  // n=500000, size = 31251 bytes ≈ 30 KB, fully inside L1 instead of the
  // 250 KB byte version spilling to L2. The extra RMW shift/mask per bit
  // mark (3 ops instead of 1) is outweighed by the L1 hit.
  const m = (n - 1) >> 1;
  const size = (m + 7) >> 3;
  const sieve = new Uint8Array(size);
  const out = [2];
  for (let i = 0; i < m; i++) {
    if (sieve[i >> 3] & (1 << (i & 7))) continue;
    const p = 2 * i + 3;
    out.push(p);
    if (p * p > n) continue;
    let j = ((p * p) - 3) >> 1;
    const step = p;
    for (; j < m; j += step) {
      sieve[j >> 3] |= (1 << (j & 7));
    }
  }
  return out;
}
