// arena/reference.mjs — the correctness oracle. PROTECTED.
// Runs only in the host process, never in the sandbox. Must be correct; speed is secondary.
export const REF = {
  topK(arr, k) {
    if (k <= 0 || arr.length === 0) return [];
    const a = arr.slice().sort((x, y) => y - x);
    return a.slice(0, Math.min(k, a.length));
  },
  dedupe(arr) {
    const seen = new Set(); const out = [];
    for (const v of arr) if (!seen.has(v)) { seen.add(v); out.push(v); }
    return out;
  },
  mergeIntervals(iv) {
    if (iv.length === 0) return [];
    const a = iv.map((p) => [p[0], p[1]]).sort((x, y) => x[0] - y[0]);
    const out = [a[0]];
    for (let i = 1; i < a.length; i++) {
      const cur = out[out.length - 1];
      if (a[i][0] <= cur[1]) { if (a[i][1] > cur[1]) cur[1] = a[i][1]; } else out.push(a[i]);
    }
    return out;
  },
  lis(arr) {
    const tails = [];
    for (const v of arr) {
      let lo = 0, hi = tails.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (tails[m] < v) lo = m + 1; else hi = m; }
      tails[lo] = v;
    }
    return tails.length;
  },
  wordFreqTopK(text, k) {
    if (k <= 0) return [];
    const m = new Map();
    for (const w of text.split(/\s+/)) if (w) m.set(w, (m.get(w) || 0) + 1);
    const arr = [...m];
    arr.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return arr.slice(0, k);
  },
  twoSumCount(arr, target) {
    const m = new Map(); let c = 0;
    for (const v of arr) { const cnt = m.get(target - v); if (cnt) c += cnt; m.set(v, (m.get(v) || 0) + 1); }
    return c;
  },
  matMul(a, b, n) {
    const c = new Float64Array(n * n);
    for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) {
      const aik = a[i * n + k]; if (aik === 0) continue;
      for (let j = 0; j < n; j++) c[i * n + j] += aik * b[k * n + j];
    }
    return c;
  },
  primesUpTo(n) {
    if (n < 2) return [];
    const sieve = new Uint8Array(n + 1); const out = [];
    for (let i = 2; i <= n; i++) if (!sieve[i]) { out.push(i); for (let j = i * i; j <= n; j += i) sieve[j] = 1; }
    return out;
  },
};
