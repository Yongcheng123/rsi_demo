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
  const len = arr.length;
  if (len === 0) return [];

  let min = Infinity;
  let max = -Infinity;
  let packed = true;
  for (let i = 0; i < len; i++) {
    const v = arr[i];
    const iv = v | 0;
    if (iv !== v) {
      packed = false;
      break;
    }
    if (iv < min) min = iv;
    if (iv > max) max = iv;
  }

  const span = max - min + 1;
  if (packed && span <= 131072) {
    const seen = new Uint8Array(span);
    const out = [];
    for (let i = 0; i < len; i++) {
      const index = (arr[i] | 0) - min;
      if (seen[index] === 0) {
        seen[index] = 1;
        out.push(arr[i]);
      }
    }
    return out;
  }

  const seen = new Set();
  const out = [];
  for (let i = 0; i < len; i++) {
    const v = arr[i];
    if (v !== v) {
      out.push(v);
    } else {
      const oldSize = seen.size;
      seen.add(v);
      if (seen.size !== oldSize) out.push(v);
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

  if (k >= counts.size) {
    const entries = [];
    for (const entry of counts) entries.push(entry);
    entries.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return entries;
  }

  const byCount = new Uint32Array(words.length + 1);
  const entries = [];
  let maxCount = 0;
  for (const entry of counts) {
    const count = entry[1];
    entries.push(entry);
    byCount[count]++;
    if (count > maxCount) maxCount = count;
  }

  let cutoff = maxCount;
  let needed = k;
  while (needed > byCount[cutoff]) {
    needed -= byCount[cutoff];
    cutoff--;
  }

  const higher = [];
  const tied = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry[1] > cutoff) higher.push(entry);
    else if (entry[1] === cutoff) tied.push(entry);
  }

  higher.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  tied.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return higher.concat(tied.slice(0, needed));
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

  const root = Math.floor(Math.sqrt(n));
  const baseComposite = new Uint8Array(root + 1);
  const bases = [];
  const nextStarts = [];

  for (let p = 3; p <= root; p += 2) {
    if (baseComposite[p] !== 0) continue;
    const square = p * p;
    if (square <= root) {
      const step = p + p;
      for (let j = square; j <= root; j += step) baseComposite[j] = 1;
    }
    bases.push(p);
    nextStarts.push(Math.floor(square / 2));
  }

  const total = Math.floor((n + 1) / 2);
  const segmentSize = total < 16384 ? total : 16384;
  const segment = new Uint8Array(segmentSize);
  const out = [2];

  for (let low = 0; low < total; low += segmentSize) {
    let high = low + segmentSize;
    if (high > total) high = total;
    const length = high - low;
    segment.fill(0, 0, length);

    for (let pi = 0; pi < bases.length; pi++) {
      const p = bases[pi];
      let offset = nextStarts[pi] - low;
      while (offset < length) {
        segment[offset] = 1;
        offset += p;
      }
      nextStarts[pi] = low + offset;
    }

    const first = low === 0 ? 1 : 0;
    for (let i = first; i < length; i++) {
      if (segment[i] === 0) out.push((low + i) * 2 + 1);
    }
  }
  return out;
}
