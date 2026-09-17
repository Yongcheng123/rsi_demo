// arena/hash.js — canonical serialisation + FNV-1a hash of task outputs.
//
// PROTECTED. Shared verbatim by the host and the sandbox harness (with `export `
// stripped). It deliberately walks values by index and never calls a method on
// the value itself (no JSON.stringify → no toJSON hook, no toString → no
// valueOf hook), so a lazily-computed or hooked output cannot fool it.
export function makeHasher(S, isView, isArray, imul) {
  function canon(v, depth) {
    const t = typeof v;
    if (t === 'number') return 'n' + S(v);
    if (t === 'string') return 's' + v.length + ':' + v;
    if (t === 'boolean') return v ? 'T' : 'F';
    if (v === null) return 'N';
    if (v === undefined) return 'U';
    if (isArray(v) || isView(v)) {
      if (depth > 6) return 'DEEP';
      let s = '[';
      for (let i = 0; i < v.length; i++) { if (i) s += ','; s += canon(v[i], depth + 1); }
      return s + ']';
    }
    return 'O' + t; // opaque object/function → will never match a reference output
  }
  function fnv(str) {
    let h = 0x811c9dc5 | 0;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = imul(h, 16777619); }
    return h >>> 0;
  }
  return { canon, hash: (v) => fnv(canon(v, 0)) };
}
