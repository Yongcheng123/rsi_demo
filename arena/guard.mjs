// arena/guard.mjs — static tripwire for agent/solver.js. PROTECTED.
//
// This is NOT the security boundary (the vm sandbox + sealed container are); it is
// the *integrity* boundary: it rules out every language mechanism we know of that
// would let a solver make its outputs lazy, hook the harness, or carry state
// between calls. The rules are listed for the agent in arena/SPEC.md.
import * as acorn from 'acorn';
import { TASK_NAMES } from './gen.js';

export const MAX_BYTES = 64 * 1024;

// Reaching any of these — as a variable, property name, or key — is a violation.
const HARD_BAN = new Set([
  'process', 'require', 'module', 'exports', 'globalThis', 'window', 'self', 'global',
  'Function', 'eval', 'Object', 'Reflect', 'Proxy', 'Symbol', 'String', 'JSON', 'RegExp',
  'Promise', 'WeakRef', 'FinalizationRegistry', 'Atomics', 'SharedArrayBuffer', 'WebAssembly',
  'Date', 'performance', 'setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask',
  'fetch', 'XMLHttpRequest', 'console', 'Error', 'import',
  'constructor', 'prototype', '__proto__', '__defineGetter__', '__defineSetter__',
  '__lookupGetter__', '__lookupSetter__', 'toJSON', 'arguments', 'caller', 'callee',
  'name', 'toString', 'valueOf', 'toLocaleString',
]);

// The only free identifiers a solver may reference.
const ALLOW_GLOBALS = new Set([
  'Math', 'Array', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Number', 'Boolean', 'BigInt',
  'Infinity', 'NaN', 'undefined', 'isFinite', 'isNaN', 'parseInt', 'parseFloat',
  'Float64Array', 'Float32Array', 'Int32Array', 'Int16Array', 'Int8Array',
  'Uint32Array', 'Uint16Array', 'Uint8Array', 'Uint8ClampedArray',
  'BigInt64Array', 'BigUint64Array', 'ArrayBuffer', 'DataView',
]);

const BANNED_NODES = new Set([
  'ImportDeclaration', 'ImportExpression', 'ExportDefaultDeclaration', 'ExportAllDeclaration',
  'MetaProperty', 'ClassDeclaration', 'ClassExpression', 'ThisExpression', 'Super',
  'AwaitExpression', 'YieldExpression', 'TaggedTemplateExpression', 'TemplateLiteral',
  'WithStatement', 'DebuggerStatement',
]);

function walk(node, fn, parent = null, key = null) {
  if (!node || typeof node.type !== 'string') return;
  fn(node, parent, key);
  for (const k of Object.keys(node)) {
    if (k === 'type' || k === 'start' || k === 'end' || k === 'loc' || k === 'range') continue;
    const v = node[k];
    if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') walk(c, fn, node, k); }
    else if (v && typeof v.type === 'string') walk(v, fn, node, k);
  }
}

function patternNames(p, out) {
  if (!p) return;
  switch (p.type) {
    case 'Identifier': out.add(p.name); break;
    case 'ObjectPattern': for (const pr of p.properties) patternNames(pr.type === 'RestElement' ? pr.argument : pr.value, out); break;
    case 'ArrayPattern': for (const e of p.elements) patternNames(e, out); break;
    case 'RestElement': patternNames(p.argument, out); break;
    case 'AssignmentPattern': patternNames(p.left, out); break;
  }
}

function rootIdentifier(expr) {
  while (expr && expr.type === 'MemberExpression') expr = expr.object;
  return expr && expr.type === 'Identifier' ? expr.name : null;
}

function isAllowedTopLevelInit(init) {
  if (!init) return false;
  if (init.type === 'Literal' && typeof init.value === 'number') return true;
  if (init.type === 'UnaryExpression' && init.operator === '-' && init.argument.type === 'Literal' && typeof init.argument.value === 'number') return true;
  return init.type === 'FunctionExpression' || init.type === 'ArrowFunctionExpression';
}

/** Returns a list of human-readable violations; empty list = clean. */
export function guard(src) {
  const v = [];
  if (Buffer.byteLength(src, 'utf8') > MAX_BYTES) v.push(`solver.js exceeds ${MAX_BYTES} bytes`);
  let ast;
  try { ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' }); }
  catch (e) { return [`parse error: ${e.message}`]; }

  const declared = new Set();
  const declCount = new Map();
  const bump = (set) => { for (const n of set) declCount.set(n, (declCount.get(n) || 0) + 1); };
  const topLevel = new Set();
  const exported = new Set();
  const loc = (n) => `line ${acorn.getLineInfo(src, n.start).line}`;

  // ---- top-level shape: only function declarations and constant/function consts
  for (const st of ast.body) {
    let decl = st;
    if (st.type === 'ExportNamedDeclaration') {
      if (!st.declaration) { v.push(`${loc(st)}: only 'export function' / 'export const' forms are allowed`); continue; }
      decl = st.declaration;
    }
    if (decl.type === 'FunctionDeclaration') {
      topLevel.add(decl.id.name);
      if (st.type === 'ExportNamedDeclaration') exported.add(decl.id.name);
    } else if (decl.type === 'VariableDeclaration') {
      if (decl.kind !== 'const') { v.push(`${loc(decl)}: top-level '${decl.kind}' is not allowed (no module-level state)`); }
      for (const d of decl.declarations) {
        if (d.id.type !== 'Identifier') { v.push(`${loc(d)}: top-level destructuring is not allowed`); continue; }
        topLevel.add(d.id.name);
        if (st.type === 'ExportNamedDeclaration') exported.add(d.id.name);
        if (!isAllowedTopLevelInit(d.init)) v.push(`${loc(d)}: top-level const '${d.id.name}' must be a number literal or a function (no precomputation)`);
      }
    } else {
      v.push(`${loc(st)}: top-level ${st.type} is not allowed — only function/const declarations`);
    }
  }
  for (const name of TASK_NAMES) if (!exported.has(name)) v.push(`missing export: function ${name}`);

  // ---- collect declarations (approximate scope: file-wide)
  walk(ast, (n) => {
    const here = new Set();
    if (n.type === 'VariableDeclarator') patternNames(n.id, here);
    else if (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression') {
      if (n.id) here.add(n.id.name);
      for (const p of n.params) patternNames(p, here);
    } else if (n.type === 'CatchClause' && n.param) patternNames(n.param, here);
    for (const name of here) declared.add(name);
    bump(here);
  });
  // A local may not reuse a top-level name: keeps the no-reassignment rule sound without scope analysis.
  for (const name of topLevel) if ((declCount.get(name) || 0) > 1) v.push(`'${name}' is declared at top level and again as a local — rename the local`);

  // ---- node-level rules
  walk(ast, (n, parent, key) => {
    if (BANNED_NODES.has(n.type)) { v.push(`${loc(n)}: ${n.type} is not allowed`); return; }
    if ((n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression') && (n.async || n.generator)) v.push(`${loc(n)}: async/generator functions are not allowed`);
    if (n.type === 'Property' && (n.kind === 'get' || n.kind === 'set')) v.push(`${loc(n)}: getters/setters are not allowed`);
    if (n.type === 'MethodDefinition') v.push(`${loc(n)}: methods/classes are not allowed`);
    if (n.type === 'Literal' && typeof n.value === 'string') v.push(`${loc(n)}: string literals are not allowed`);
    if (n.type === 'UnaryExpression' && n.operator === 'typeof') v.push(`${loc(n)}: typeof is not allowed`);
    if (n.type === 'Identifier') {
      if (HARD_BAN.has(n.name)) v.push(`${loc(n)}: forbidden identifier '${n.name}'`);
      const isPropName = (parent?.type === 'MemberExpression' && key === 'property' && !parent.computed)
        || (parent?.type === 'Property' && key === 'key' && !parent.computed)
        || parent?.type === 'LabeledStatement' || parent?.type === 'BreakStatement' || parent?.type === 'ContinueStatement';
      if (!isPropName && !declared.has(n.name) && !ALLOW_GLOBALS.has(n.name) && !HARD_BAN.has(n.name)) v.push(`${loc(n)}: unknown global '${n.name}'`);
    }
    // No writes to functions / constants / globals: `f.cache = …`, `Math.x = …`
    if (n.type === 'AssignmentExpression' || n.type === 'UpdateExpression') {
      const target = n.type === 'AssignmentExpression' ? n.left : n.argument;
      if (target.type === 'MemberExpression') {
        const root = rootIdentifier(target);
        if (root && (topLevel.has(root) || ALLOW_GLOBALS.has(root))) v.push(`${loc(n)}: cannot assign to a property of '${root}' (no cross-call state)`);
      } else if (target.type === 'Identifier' && topLevel.has(target.name)) v.push(`${loc(n)}: cannot reassign top-level '${target.name}'`);
    }
  });

  return [...new Set(v)];
}

/** Turn the (already guarded) ESM source into a strict script for the sandbox. */
export function toSandboxScript(src) {
  return "'use strict';\n" + src.replace(/^\s*export\s+/gm, '');
}
