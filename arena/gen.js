// arena/gen.js — seeded input generators for every task.
//
// PROTECTED. This file is (a) imported by the host and (b) evaluated *inside the
// sandbox* with the `export ` keywords stripped, so it must stay dependency-free
// and deterministic: identical seed → identical inputs on both sides. That is
// what lets the host verify sandbox outputs it never saw the inputs of.

export const TRAIN = 'train';
export const HOLDOUT = 'holdout';
export const TASK_NAMES = ['topK', 'dedupe', 'mergeIntervals', 'lis', 'wordFreqTopK', 'twoSumCount', 'matMul', 'primesUpTo'];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// gen(r, split, i): `i` is the call index inside a pass. Holdout generators cycle input
// *kinds* by `i` (not by chance) so every block of 12 calls has the same mix — the ratio
// between two sides then measures speed, not luck of the draw.
// Every timing pass gets its own PRNG stream so no input content is ever reused.
export function passSeed(seed, splitIdx, batch, pass) {
  return (seed ^ Math.imul(splitIdx + 1, 0x9e3779b9) ^ Math.imul(batch + 1, 0x85ebca6b) ^ Math.imul(pass + 1, 0xc2b2ae35)) >>> 0;
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
function ints(r, n, lo, hi) { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = lo + Math.floor(r() * (hi - lo)); return a; }
function pick(r, arr) { return arr[Math.floor(r() * arr.length)]; }
function word(r, len) { let s = ''; for (let i = 0; i < len; i++) s += LETTERS[Math.floor(r() * 26)]; return s; }
function vocab(r, size) { const v = new Array(size); for (let i = 0; i < size; i++) v[i] = word(r, 3 + Math.floor(r() * 6)); return v; }
function ascending(r, n, step) { const a = new Array(n); let v = -Math.floor(n * step / 2); for (let i = 0; i < n; i++) { v += Math.floor(r() * step); a[i] = v; } return a; }
function descending(r, n, step) { const a = ascending(r, n, step); a.reverse(); return a; }

export const GEN = {
  topK: {
    arity: 2,
    gen(r, split, i) {
      if (split === TRAIN) return [ints(r, 12000, -1000000, 1000000), 100];
      const kind = i % 4;
      const a = kind === 1 ? ints(r, 15000, 0, 50) : kind === 2 ? ascending(r, 15000, 100) : kind === 3 ? descending(r, 15000, 100) : ints(r, 15000, -1000000, 1000000);
      return [a, [1, 50, 500, 2000][(i >> 2) % 4]];
    },
    edges() {
      return [[[], 0], [[], 5], [[7], 1], [[7], 0], [[7], 3], [[3, 1, 2], 5], [[1, 1, 1], 2], [[-1, -5, 0], 2], [[2, 2, 1, 1], 2], [[5, 4, 3], -1]];
    },
  },
  dedupe: {
    arity: 1,
    gen(r, split, i) {
      if (split === TRAIN) return [ints(r, 6000, 0, 3000)];
      const kind = i % 3;
      if (kind === 0) return [ints(r, 8000, 0, 8000)];
      if (kind === 1) return [ints(r, 8000, 0, 100)];
      const v = vocab(r, 2000); const a = new Array(8000);
      for (let i = 0; i < 8000; i++) a[i] = v[Math.floor(r() * v.length)];
      return [a];
    },
    edges() {
      return [[[]], [[1]], [[1, 1, 1]], [[1, 2, 1, 3, 2]], [['a', 'b', 'a']], [[0, 1, 0]], [[1, '1', 1]], [[2, 1, 2, 1]]];
    },
  },
  mergeIntervals: {
    arity: 1,
    gen(r, split, i) {
      const mk = (n, range, maxLen) => { const out = new Array(n); for (let i = 0; i < n; i++) { const s = Math.floor(r() * range); out[i] = [s, s + 1 + Math.floor(r() * maxLen)]; } return out; };
      if (split === TRAIN) return [mk(400, 50000, 300)];
      const kind = i % 4;
      if (kind === 0) return [mk(500, 60000, 300)];
      if (kind === 1) return [mk(500, 5000, 200)];
      if (kind === 2) return [mk(500, 60000, 300).sort((x, y) => x[0] - y[0])];
      const base = mk(500, 200000, 40); base[0] = [0, 250000]; return [base];
    },
    edges() {
      return [[[]], [[[1, 3]]], [[[1, 3], [2, 6], [8, 10], [15, 18]]], [[[1, 4], [4, 5]]], [[[5, 7], [1, 3]]], [[[1, 10], [2, 3], [4, 5]]], [[[1, 1], [1, 1]]], [[[3, 4], [1, 2]]]];
    },
  },
  lis: {
    arity: 1,
    gen(r, split, i) {
      if (split === TRAIN) return [ints(r, 3000, 0, 100000)];
      const kind = i % 4;
      if (kind === 0) return [ints(r, 4000, 0, 100000)];
      if (kind === 1) { const a = ascending(r, 4000, 50); for (let i = 0; i < 200; i++) a[Math.floor(r() * 4000)] = Math.floor(r() * 100000); return [a]; }
      if (kind === 2) return [descending(r, 4000, 50)];
      return [ints(r, 4000, 0, 30)];
    },
    edges() {
      return [[[]], [[5]], [[1, 2, 3]], [[3, 2, 1]], [[10, 9, 2, 5, 3, 7, 101, 18]], [[1, 1, 1]], [[0, 1, 0, 3, 2, 3]], [[7, 7, 8]]];
    },
  },
  wordFreqTopK: {
    arity: 2,
    gen(r, split, i) {
      const v = vocab(r, split === TRAIN ? 1000 : 1500);
      const n = split === TRAIN ? 6000 : 8000;
      const seps = split === TRAIN ? [' '] : [' ', '  ', '\n', '\t', ' \n ', '   '];
      let s = '';
      for (let i = 0; i < n; i++) { s += v[Math.floor(v.length * r() * r())]; s += seps[Math.floor(r() * seps.length)]; }
      return [s, split === TRAIN ? 20 : [1, 10, 50, 100][i % 4]];
    },
    edges() {
      return [['', 3], ['a a b', 1], ['b a', 2], ['  x  y  x ', 5], ['a b c', 0], ['z\ty\nz z', 2], ['solo', 10]];
    },
  },
  twoSumCount: {
    arity: 2,
    gen(r, split, i) {
      if (split === TRAIN) return [ints(r, 4000, -2000, 2000), Math.floor(r() * 1000) - 500];
      const kind = i % 3;
      if (kind === 0) return [ints(r, 5000, -20, 20), Math.floor(r() * 20) - 10];
      if (kind === 1) return [ints(r, 5000, -100000, 100000), Math.floor(r() * 2000) - 1000];
      return [ints(r, 5000, 0, 1), 0];
    },
    edges() {
      return [[[], 0], [[1, 1], 2], [[1, 1, 1], 2], [[0, 0, 0, 0], 0], [[1, 2, 3], 7], [[-1, 1, 0], 0], [[5], 10], [[3, 3, 4, 4], 7]];
    },
  },
  matMul: {
    arity: 3,
    gen(r, split, i) {
      if (split === TRAIN) { const n = 96; return [ints(r, n * n, -4, 5), ints(r, n * n, -4, 5), n]; }
      const n = [64, 80, 112, 128][i % 4];
      const typed = ((i >> 2) & 1) === 1;
      const a = ints(r, n * n, -8, 9), b = ints(r, n * n, -8, 9);
      return typed ? [new Float64Array(a), new Float64Array(b), n] : [a, b, n];
    },
    edges() {
      return [[[], [], 0], [[2], [3], 1], [[1, 2, 3, 4], [5, 6, 7, 8], 2], [[1, 0, 0, 1], [9, 8, 7, 6], 2], [[0, 0, 0, 0], [1, 2, 3, 4], 2]];
    },
  },
  primesUpTo: {
    arity: 1,
    gen(r, split, i) {
      if (split === TRAIN) return [200000];
      return [[120000, 220000, 330000, 450000][i % 4]];
    },
    edges() {
      return [[0], [1], [2], [3], [4], [10], [30], [97], [100]];
    },
  },
};
