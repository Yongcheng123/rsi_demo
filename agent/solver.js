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
  const ids = new Map();
  const idCounts = [];
  const uniqueWords = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word.length === 0) continue;
    let id = ids.get(word);
    if (id === undefined) {
      id = idCounts.length;
      ids.set(word, id);
      idCounts.push(1);
      uniqueWords.push(word);
    } else {
      idCounts[id]++;
    }
  }

  const size = idCounts.length;
  if (size === 0) return [];

  if (k >= size) {
    const entries = [];
    for (let id = 0; id < size; id++) {
      entries.push([uniqueWords[id], idCounts[id]]);
    }
    entries.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return entries;
  }

  let maxCount = 0;
  for (let id = 0; id < size; id++) {
    if (idCounts[id] > maxCount) maxCount = idCounts[id];
  }

  const byCount = new Uint32Array(maxCount + 1);
  const entries = [];
  for (let id = 0; id < size; id++) {
    const count = idCounts[id];
    byCount[count]++;
    entries.push([uniqueWords[id], count]);
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
  for (let i = 0; i < needed; i++) higher.push(tied[i]);
  return higher;
}

export function twoSumCount(arr, target) {
  const len = arr.length;
  if (len < 2) return 0;

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < len; i++) {
    const x = arr[i];
    if (x < min) min = x;
    if (x > max) max = x;
  }

  if (min === max) {
    if (min + min === target) return len * (len - 1) / 2;
    return 0;
  }

  const span = max - min + 1;
  if (span <= len * 4) {
    const table = new Uint32Array(span);
    let result = 0;
    for (let i = 0; i < len; i++) {
      const x = arr[i];
      const complementIndex = target - x - min;
      if (complementIndex >= 0 && complementIndex < span) {
        result += table[complementIndex];
      }
      table[x - min]++;
    }
    return result;
  }

  const counts = new Map();
  let result = 0;
  for (let i = 0; i < len; i++) {
    const x = arr[i];
    const need = target - x;
    const c = counts.get(need);
    if (c !== undefined) result += c;
    counts.set(x, (counts.get(x) || 0) + 1);
  }
  return result;
}

export function matMul(a, b, n) {
  if (n <= 0) return new Float64Array(n * n);

  const fuse = Math.fma !== undefined && fuseSafe(a, b, n);
  const bt = new Float64Array(n * n);
  if (ArrayBuffer.isView(b)) {
    for (let k = 0; k < n; k++) {
      const ko = k * n;
      let dst = k;
      for (let j = 0; j < n; j++) {
        bt[dst] = b[ko + j];
        dst += n;
      }
    }
  } else {
    for (let k = 0; k < n; k++) {
      const ko = k * n;
      let dst = k;
      for (let j = 0; j < n; j++) {
        bt[dst] = b[ko + j];
        dst += n;
      }
    }
  }

  if (ArrayBuffer.isView(a)) return multiply2x2Typed(a, bt, n, fuse);
  return multiply2x2Plain(a, bt, n, fuse);
}

function fuseSafe(a, b, n) {
  const maxExact = 9007199254740992;
  const limit = Math.floor(Math.sqrt(maxExact / n)) - 1;
  const count = n * n;

  for (let i = 0; i < count; i++) {
    const v = a[i];
    if (v !== (v | 0)) return false;
    if (v === 0) {
      if (1 / v < 0) return false;
    } else {
      const av = v < 0 ? -v : v;
      if (av > limit) return false;
    }
  }

  for (let i = 0; i < count; i++) {
    const v = b[i];
    if (v !== (v | 0)) return false;
    if (v === 0) {
      if (1 / v < 0) return false;
    } else {
      const av = v < 0 ? -v : v;
      if (av > limit) return false;
    }
  }

  return true;
}

function multiply2x2Typed(a, bt, n, fuse) {
  const c = new Float64Array(n * n);
  const even = n & ~1;

  for (let i = 0; i < even; i += 2) {
    const io0 = i * n;
    const io1 = io0 + n;
    for (let j = 0; j < even; j += 2) {
      const o0 = j * n;
      const o1 = o0 + n;
      let s00 = 0;
      let s01 = 0;
      let s10 = 0;
      let s11 = 0;
      let k = 0;

      if (fuse) {
        for (; k + 7 < n; k += 8) {
          let x0 = a[io0 + k];
          let x1 = a[io1 + k];
          let y0 = bt[o0 + k];
          let y1 = bt[o1 + k];
          s00 = Math.fma(x0, y0, s00);
          s01 = Math.fma(x0, y1, s01);
          s10 = Math.fma(x1, y0, s10);
          s11 = Math.fma(x1, y1, s11);

          x0 = a[io0 + k + 1];
          x1 = a[io1 + k + 1];
          y0 = bt[o0 + k + 1];
          y1 = bt[o1 + k + 1];
          s00 = Math.fma(x0, y0, s00);
          s01 = Math.fma(x0, y1, s01);
          s10 = Math.fma(x1, y0, s10);
          s11 = Math.fma(x1, y1, s11);

          x0 = a[io0 + k + 2];
          x1 = a[io1 + k + 2];
          y0 = bt[o0 + k + 2];
          y1 = bt[o1 + k + 2];
          s00 = Math.fma(x0, y0, s00);
          s01 = Math.fma(x0, y1, s01);
          s10 = Math.fma(x1, y0, s10);
          s11 = Math.fma(x1, y1, s11);

          x0 = a[io0 + k + 3];
          x1 = a[io1 + k + 3];
          y0 = bt[o0 + k + 3];
          y1 = bt[o1 + k + 3];
          s00 = Math.fma(x0, y0, s00);
          s01 = Math.fma(x0, y1, s01);
          s10 = Math.fma(x1, y0, s10);
          s11 = Math.fma(x1, y1, s11);

          x0 = a[io0 + k + 4];
          x1 = a[io1 + k + 4];
          y0 = bt[o0 + k + 4];
          y1 = bt[o1 + k + 4];
          s00 = Math.fma(x0, y0, s00);
          s01 = Math.fma(x0, y1, s01);
          s10 = Math.fma(x1, y0, s10);
          s11 = Math.fma(x1, y1, s11);

          x0 = a[io0 + k + 5];
          x1 = a[io1 + k + 5];
          y0 = bt[o0 + k + 5];
          y1 = bt[o1 + k + 5];
          s00 = Math.fma(x0, y0, s00);
          s01 = Math.fma(x0, y1, s01);
          s10 = Math.fma(x1, y0, s10);
          s11 = Math.fma(x1, y1, s11);

          x0 = a[io0 + k + 6];
          x1 = a[io1 + k + 6];
          y0 = bt[o0 + k + 6];
          y1 = bt[o1 + k + 6];
          s00 = Math.fma(x0, y0, s00);
          s01 = Math.fma(x0, y1, s01);
          s10 = Math.fma(x1, y0, s10);
          s11 = Math.fma(x1, y1, s11);

          x0 = a[io0 + k + 7];
          x1 = a[io1 + k + 7];
          y0 = bt[o0 + k + 7];
          y1 = bt[o1 + k + 7];
          s00 = Math.fma(x0, y0, s00);
          s01 = Math.fma(x0, y1, s01);
          s10 = Math.fma(x1, y0, s10);
          s11 = Math.fma(x1, y1, s11);
        }

        for (; k < n; k++) {
          const x0 = a[io0 + k];
          const x1 = a[io1 + k];
          const y0 = bt[o0 + k];
          const y1 = bt[o1 + k];
          s00 = Math.fma(x0, y0, s00);
          s01 = Math.fma(x0, y1, s01);
          s10 = Math.fma(x1, y0, s10);
          s11 = Math.fma(x1, y1, s11);
        }
      } else {
        for (; k + 7 < n; k += 8) {
          let x0 = a[io0 + k];
          let x1 = a[io1 + k];
          let y0 = bt[o0 + k];
          let y1 = bt[o1 + k];
          s00 += x0 * y0;
          s01 += x0 * y1;
          s10 += x1 * y0;
          s11 += x1 * y1;

          x0 = a[io0 + k + 1];
          x1 = a[io1 + k + 1];
          y0 = bt[o0 + k + 1];
          y1 = bt[o1 + k + 1];
          s00 += x0 * y0;
          s01 += x0 * y1;
          s10 += x1 * y0;
          s11 += x1 * y1;

          x0 = a[io0 + k + 2];
          x1 = a[io1 + k + 2];
          y0 = bt[o0 + k + 2];
          y1 = bt[o1 + k + 2];
          s00 += x0 * y0;
          s01 += x0 * y1;
          s10 += x1 * y0;
          s11 += x1 * y1;

          x0 = a[io0 + k + 3];
          x1 = a[io1 + k + 3];
          y0 = bt[o0 + k + 3];
          y1 = bt[o1 + k + 3];
          s00 += x0 * y0;
          s01 += x0 * y1;
          s10 += x1 * y0;
          s11 += x1 * y1;

          x0 = a[io0 + k + 4];
          x1 = a[io1 + k + 4];
          y0 = bt[o0 + k + 4];
          y1 = bt[o1 + k + 4];
          s00 += x0 * y0;
          s01 += x0 * y1;
          s10 += x1 * y0;
          s11 += x1 * y1;

          x0 = a[io0 + k + 5];
          x1 = a[io1 + k + 5];
          y0 = bt[o0 + k + 5];
          y1 = bt[o1 + k + 5];
          s00 += x0 * y0;
          s01 += x0 * y1;
          s10 += x1 * y0;
          s11 += x1 * y1;

          x0 = a[io0 + k + 6];
          x1 = a[io1 + k + 6];
          y0 = bt[o0 + k + 6];
          y1 = bt[o1 + k + 6];
          s00 += x0 * y0;
          s01 += x0 * y1;
          s10 += x1 * y0;
          s11 += x1 * y1;

          x0 = a[io0 + k + 7];
          x1 = a[io1 + k + 7];
          y0 = bt[o0 + k + 7];
          y1 = bt[o1 + k + 7];
          s00 += x0 * y0;
          s01 += x0 * y1;
          s10 += x1 * y0;
          s11 += x1 * y1;
        }

        for (; k < n; k++) {
          const x0 = a[io0 + k];
          const x1 = a[io1 + k];
          const y0 = bt[o0 + k];
          const y1 = bt[o1 + k];
          s00 += x0 * y0;
          s01 += x0 * y1;
          s10 += x1 * y0;
          s11 += x1 * y1;
        }
      }

      const oj = io0 + j;
      c[oj] = s00;
      c[oj + 1] = s01;
      c[oj + n] = s10;
      c[oj + n + 1] = s11;
    }
  }

  if ((n & 1) !== 0) {
    const last = even;
    const oo = last * n;
    const lo = last * n;

    if (fuse) {
      for (let i = 0; i < even; i += 2) {
        const io0 = i * n;
        const io1 = io0 + n;
        let s0 = 0;
        let s1 = 0;
        for (let k = 0; k < n; k++) {
          const x0 = a[io0 + k];
          const x1 = a[io1 + k];
          const y = bt[oo + k];
          s0 = Math.fma(x0, y, s0);
          s1 = Math.fma(x1, y, s1);
        }
        c[io0 + last] = s0;
        c[io1 + last] = s1;
      }

      for (let j = 0; j < n; j++) {
        const oj = j * n;
        let s = 0;
        for (let k = 0; k < n; k++) s = Math.fma(a[lo + k], bt[oj + k], s);
        c[lo + j] = s;
      }
    } else {
      for (let i = 0; i < even; i += 2) {
        const io0 = i * n;
        const io1 = io0 + n;
        let s0 = 0;
        let s1 = 0;
        for (let k = 0; k < n; k++) {
          const x0 = a[io0 + k];
          const x1 = a[io1 + k];
          const y = bt[oo + k];
          s0 += x0 * y;
          s1 += x1 * y;
        }
        c[io0 + last] = s0;
        c[io1 + last] = s1;
      }

      for (let j = 0; j < n; j++) {
        const oj = j * n;
        let s = 0;
        for (let k = 0; k < n; k++) s += a[lo + k] * bt[oj + k];
        c[lo + j] = s;
      }
    }
  }

  return c;
}

function multiply2x2Plain(a, bt, n, fuse) {
  const c = new Float64Array(n * n);
  const even = n & ~1;

  for (let i = 0; i < even; i += 2) {
    const io0 = i * n;
    const io1 = io0 + n;
    for (let j = 0; j < even; j += 2) {
      const o0 = j * n;
      const o1 = o0 + n;
      let s00 = 0;
      let s01 = 0;
      let s10 = 0;
      let s11 = 0;
      let k = 0;

      if (fuse) {
        for (; k + 7 < n; k += 8) {
          let x0 = a[io0 + k];
          let x1 = a[io1 + k];
          let y0 = bt[o0 + k];
          let y1 = bt[o1 + k];
          s00 = Math.fma(x0, y0, s00);
          s01 = Math.fma(x0, y1, s01);
          s10 = Math.fma(x1, y0, s10);
          s11 = Math.fma(x1, y1, s11);

          x0 = a[io0 + k + 1];
          x1 = a[io1 + k + 1];
          y0 = bt[o0 + k + 1];
          y1 = bt[o1 + k + 1];
          s00 = Math.fma(x0, y0, s00);
          s01 = Math.fma(x0, y1, s01);
          s10 = Math.fma(x1, y0, s10);
          s11 = Math.fma(x1, y1, s11);

          x0 = a[io0 + k + 2];
          x1 = a[io1 + k + 2];
          y0 = bt[o0 + k + 2];
          y1 = bt[o1 + k + 2];
          s00 = Math.fma(x0, y0, s00);
          s01 = Math.fma(x0, y1, s01);
          s10 = Math.fma(x1, y0, s10);
          s11 = Math.fma(x1, y1, s11);

          x0 = a[io0 + k + 3];
          x1 = a[io1 + k + 3];
          y0 = bt[o0 + k + 3];
          y1 = bt[o1 + k + 3];
          s00 = Math.fma(x0, y0, s00);
          s01 = Math.fma(x0, y1, s01);
          s10 = Math.fma(x1, y0, s10);
          s11 = Math.fma(x1, y1, s11);

          x0 = a[io0 + k + 4];
          x1 = a[io1 + k + 4];
          y0 = bt[o0 + k + 4];
          y1 = bt[o1 + k + 4];
          s00 = Math.fma(x0, y0, s00);
          s01 = Math.fma(x0, y1, s01);
          s10 = Math.fma(x1, y0, s10);
          s11 = Math.fma(x1, y1, s11);

          x0 = a[io0 + k + 5];
          x1 = a[io1 + k + 5];
          y0 = bt[o0 + k + 5];
          y1 = bt[o1 + k + 5];
          s00 = Math.fma(x0, y0, s00);
          s01 = Math.fma(x0, y1, s01);
          s10 = Math.fma(x1, y0, s10);
          s11 = Math.fma(x1, y1, s11);

          x0 = a[io0 + k + 6];
          x1 = a[io1 + k + 6];
          y0 = bt[o0 + k + 6];
          y1 = bt[o1 + k + 6];
          s00 = Math.fma(x0, y0, s00);
          s01 = Math.fma(x0, y1, s01);
          s10 = Math.fma(x1, y0, s10);
          s11 = Math.fma(x1, y1, s11);

          x0 = a[io0 + k + 7];
          x1 = a[io1 + k + 7];
          y0 = bt[o0 + k + 7];
          y1 = bt[o1 + k + 7];
          s00 = Math.fma(x0, y0, s00);
          s01 = Math.fma(x0, y1, s01);
          s10 = Math.fma(x1, y0, s10);
          s11 = Math.fma(x1, y1, s11);
        }

        for (; k < n; k++) {
          const x0 = a[io0 + k];
          const x1 = a[io1 + k];
          const y0 = bt[o0 + k];
          const y1 = bt[o1 + k];
          s00 = Math.fma(x0, y0, s00);
          s01 = Math.fma(x0, y1, s01);
          s10 = Math.fma(x1, y0, s10);
          s11 = Math.fma(x1, y1, s11);
        }
      } else {
        for (; k + 7 < n; k += 8) {
          let x0 = a[io0 + k];
          let x1 = a[io1 + k];
          let y0 = bt[o0 + k];
          let y1 = bt[o1 + k];
          s00 += x0 * y0;
          s01 += x0 * y1;
          s10 += x1 * y0;
          s11 += x1 * y1;

          x0 = a[io0 + k + 1];
          x1 = a[io1 + k + 1];
          y0 = bt[o0 + k + 1];
          y1 = bt[o1 + k + 1];
          s00 += x0 * y0;
          s01 += x0 * y1;
          s10 += x1 * y0;
          s11 += x1 * y1;

          x0 = a[io0 + k + 2];
          x1 = a[io1 + k + 2];
          y0 = bt[o0 + k + 2];
          y1 = bt[o1 + k + 2];
          s00 += x0 * y0;
          s01 += x0 * y1;
          s10 += x1 * y0;
          s11 += x1 * y1;

          x0 = a[io0 + k + 3];
          x1 = a[io1 + k + 3];
          y0 = bt[o0 + k + 3];
          y1 = bt[o1 + k + 3];
          s00 += x0 * y0;
          s01 += x0 * y1;
          s10 += x1 * y0;
          s11 += x1 * y1;

          x0 = a[io0 + k + 4];
          x1 = a[io1 + k + 4];
          y0 = bt[o0 + k + 4];
          y1 = bt[o1 + k + 4];
          s00 += x0 * y0;
          s01 += x0 * y1;
          s10 += x1 * y0;
          s11 += x1 * y1;

          x0 = a[io0 + k + 5];
          x1 = a[io1 + k + 5];
          y0 = bt[o0 + k + 5];
          y1 = bt[o1 + k + 5];
          s00 += x0 * y0;
          s01 += x0 * y1;
          s10 += x1 * y0;
          s11 += x1 * y1;

          x0 = a[io0 + k + 6];
          x1 = a[io1 + k + 6];
          y0 = bt[o0 + k + 6];
          y1 = bt[o1 + k + 6];
          s00 += x0 * y0;
          s01 += x0 * y1;
          s10 += x1 * y0;
          s11 += x1 * y1;

          x0 = a[io0 + k + 7];
          x1 = a[io1 + k + 7];
          y0 = bt[o0 + k + 7];
          y1 = bt[o1 + k + 7];
          s00 += x0 * y0;
          s01 += x0 * y1;
          s10 += x1 * y0;
          s11 += x1 * y1;
        }

        for (; k < n; k++) {
          const x0 = a[io0 + k];
          const x1 = a[io1 + k];
          const y0 = bt[o0 + k];
          const y1 = bt[o1 + k];
          s00 += x0 * y0;
          s01 += x0 * y1;
          s10 += x1 * y0;
          s11 += x1 * y1;
        }
      }

      const oj = io0 + j;
      c[oj] = s00;
      c[oj + 1] = s01;
      c[oj + n] = s10;
      c[oj + n + 1] = s11;
    }
  }

  if ((n & 1) !== 0) {
    const last = even;
    const oo = last * n;
    const lo = last * n;

    if (fuse) {
      for (let i = 0; i < even; i += 2) {
        const io0 = i * n;
        const io1 = io0 + n;
        let s0 = 0;
        let s1 = 0;
        for (let k = 0; k < n; k++) {
          const x0 = a[io0 + k];
          const x1 = a[io1 + k];
          const y = bt[oo + k];
          s0 = Math.fma(x0, y, s0);
          s1 = Math.fma(x1, y, s1);
        }
        c[io0 + last] = s0;
        c[io1 + last] = s1;
      }

      for (let j = 0; j < n; j++) {
        const oj = j * n;
        let s = 0;
        for (let k = 0; k < n; k++) s = Math.fma(a[lo + k], bt[oj + k], s);
        c[lo + j] = s;
      }
    } else {
      for (let i = 0; i < even; i += 2) {
        const io0 = i * n;
        const io1 = io0 + n;
        let s0 = 0;
        let s1 = 0;
        for (let k = 0; k < n; k++) {
          const x0 = a[io0 + k];
          const x1 = a[io1 + k];
          const y = bt[oo + k];
          s0 += x0 * y;
          s1 += x1 * y;
        }
        c[io0 + last] = s0;
        c[io1 + last] = s1;
      }

      for (let j = 0; j < n; j++) {
        const oj = j * n;
        let s = 0;
        for (let k = 0; k < n; k++) s += a[lo + k] * bt[oj + k];
        c[lo + j] = s;
      }
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
