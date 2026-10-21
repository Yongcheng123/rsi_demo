export function topK(arr, k) {
  const n = arr.length;
  if (k <= 0 || n === 0) return [];
  if (k >= n) return arr.slice().sort((a, b) => b - a);

  let rises = false;
  let falls = false;
  for (let i = 1; i < n; i++) {
    const prev = arr[i - 1];
    const curr = arr[i];
    if (curr < prev) falls = true;
    else if (curr > prev) rises = true;
    if (rises && falls) break;
  }
  if (!falls) {
    const out = arr.slice(n - k);
    out.reverse();
    return out;
  }
  if (!rises) return arr.slice(0, k);

  if (k * 16 <= n) {
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

  const work = arr.slice();
  let left = 0;
  let right = n - 1;
  const target = k - 1;
  while (left < right) {
    const mid = (left + right) >> 1;
    const pivot = work[mid];
    let i = left;
    let j = right;
    while (i <= j) {
      while (i <= right && work[i] > pivot) i++;
      while (j >= left && work[j] < pivot) j--;
      if (i <= j) {
        const tmp = work[i];
        work[i] = work[j];
        work[j] = tmp;
        i++;
        j--;
      }
    }
    if (target <= j) right = j;
    else if (target >= i) left = i;
    else break;
  }
  work.length = k;
  return work.sort((a, b) => b - a);
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
    let lo = 0;
    let hi = tails.length;
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
  const bt = new Float64Array(n * n);
  for (let k = 0; k < n; k++) {
    const ko = k * n;
    for (let j = 0; j < n; j++) bt[j * n + k] = b[ko + j];
  }
  const m = n & ~7;
  const nj = n & ~3;
  for (let i = 0; i < n; i++) {
    const io = i * n;
    for (let jj = 0; jj < nj; jj += 4) {
      let s0 = 0;
      let s1 = 0;
      let s2 = 0;
      let s3 = 0;
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
        s0 += a0 * bt[o0 + k] + a1 * bt[o0 + k + 1]
            + a2 * bt[o0 + k + 2] + a3 * bt[o0 + k + 3]
            + a4 * bt[o0 + k + 4] + a5 * bt[o0 + k + 5]
            + a6 * bt[o0 + k + 6] + a7 * bt[o0 + k + 7];
        s1 += a0 * bt[o1 + k] + a1 * bt[o1 + k + 1]
            + a2 * bt[o1 + k + 2] + a3 * bt[o1 + k + 3]
            + a4 * bt[o1 + k + 4] + a5 * bt[o1 + k + 5]
            + a6 * bt[o1 + k + 6] + a7 * bt[o1 + k + 7];
        s2 += a0 * bt[o2 + k] + a1 * bt[o2 + k + 1]
            + a2 * bt[o2 + k + 2] + a3 * bt[o2 + k + 3]
            + a4 * bt[o2 + k + 4] + a5 * bt[o2 + k + 5]
            + a6 * bt[o2 + k + 6] + a7 * bt[o2 + k + 7];
        s3 += a0 * bt[o3 + k] + a1 * bt[o3 + k + 1]
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
      c[io + jj] = s0;
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
  const out = [2];
  if (n < 3) return out;
  out.push(3);
  if (n < 5) return out;
  out.push(5);
  if (n < 7) return out;

  const root = Math.floor(Math.sqrt(n));
  const base = [];
  const mark = new Uint8Array(root + 1);
  for (let p = 2; p <= root; p++) {
    if (mark[p] !== 0) continue;
    if (p >= 7) base.push(p);
    const square = p * p;
    if (square <= root) {
      for (let j = square; j <= root; j += p) mark[j] = 1;
    }
  }

  const residues = [1, 7, 11, 13, 17, 19, 23, 29];
  const blocks = Math.floor(n / 30) + 1;
  const segmentQ = 4096;
  const segment = new Uint8Array(segmentQ * 8);

  for (let qLow = 0; qLow < blocks; qLow += segmentQ) {
    let qHigh = qLow + segmentQ - 1;
    if (qHigh >= blocks) qHigh = blocks - 1;
    const segStart = qLow * 8;
    const length = (qHigh - qLow + 1) * 8;
    const low = qLow * 30 + 1;
    segment.fill(1, 0, length);

    for (let pi = 0; pi < base.length; pi++) {
      const p = base[pi];
      const pBlock = Math.floor(p / 30);
      const pBase = pBlock * 30;
      const pResidue = p - pBase;
      const step = p * 8;
      for (let ri = 0; ri < 8; ri++) {
        const r = residues[ri];
        let m = pBase + r;
        if (r < pResidue) m += 30;
        let x = p * m;
        if (x < low) x += Math.ceil((low - x) / (30 * p)) * 30 * p;
        let idx = wheelIndex(x) - segStart;
        for (; idx < length; idx += step) segment[idx] = 0;
      }
    }

    for (let idx = 0; idx < length; idx++) {
      if (segment[idx] === 0) continue;
      const qBase = qLow + (idx >> 3);
      const value = qBase * 30 + residues[idx & 7];
      if (value > 1 && value <= n) out.push(value);
    }
  }
  return out;
}

function wheelIndex(x) {
  const q = Math.floor(x / 30);
  const r = x - q * 30;
  if (r === 1) return q * 8;
  if (r === 7) return q * 8 + 1;
  if (r === 11) return q * 8 + 2;
  if (r === 13) return q * 8 + 3;
  if (r === 17) return q * 8 + 4;
  if (r === 19) return q * 8 + 5;
  if (r === 23) return q * 8 + 6;
  return q * 8 + 7;
}
