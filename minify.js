#!/usr/bin/env node
// Dependency-free fallback minifier: strips comments and collapses
// insignificant whitespace, without touching strings/template
// literals/regex bodies. Doesn't rename anything or alter structure —
// it's a stopgap for when javascript-obfuscator can't be installed, not a
// replacement for it.
'use strict';
const fs = require('fs');
const [,, inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: node minify.js <in.js> <out.js>');
  process.exit(1);
}
const src = fs.readFileSync(inPath, 'utf8');

function minify(s) {
  let out = '';
  let i = 0;
  const n = s.length;
  // char just before the current position in `out`, ignoring whitespace we dropped
  const lastSig = () => {
    for (let k = out.length - 1; k >= 0; k--) {
      const c = out[k];
      if (!/\s/.test(c)) return c;
    }
    return '';
  };
  while (i < n) {
    const c = s[i];
    // line comment
    if (c === '/' && s[i + 1] === '/') {
      i += 2;
      while (i < n && s[i] !== '\n') i++;
      continue;
    }
    // block comment
    if (c === '/' && s[i + 1] === '*') {
      i += 2;
      while (i < n && !(s[i] === '*' && s[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    // strings
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      let j = i + 1;
      let buf = c;
      while (j < n) {
        if (s[j] === '\\') { buf += s[j] + (s[j + 1] || ''); j += 2; continue; }
        if (quote === '`' && s[j] === '$' && s[j + 1] === '{') {
          // template expression: copy verbatim (may itself contain strings/comments; keep simple and safe)
          let depth = 1; buf += s[j] + s[j + 1]; j += 2;
          while (j < n && depth > 0) {
            if (s[j] === '{') depth++;
            else if (s[j] === '}') depth--;
            buf += s[j]; j++;
          }
          continue;
        }
        buf += s[j];
        if (s[j] === quote) { j++; break; }
        j++;
      }
      out += buf;
      i = j;
      continue;
    }
    // regex literal (heuristic: '/' not preceded by an identifier/number/closer)
    if (c === '/' && !/[\w$)\]]/.test(lastSig())) {
      let j = i + 1, inClass = false, buf = c;
      while (j < n) {
        const ch = s[j];
        buf += ch;
        if (ch === '\\') { j++; buf += s[j] || ''; j++; continue; }
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) { j++; break; }
        else if (ch === '\n') break; // not actually a regex; bail
        j++;
      }
      // trailing flags
      while (j < n && /[a-z]/i.test(s[j])) { buf += s[j]; j++; }
      out += buf;
      i = j;
      continue;
    }
    // whitespace: collapse, and drop around most punctuation
    if (/\s/.test(c)) {
      let j = i;
      let sawNL = false;
      while (j < n && /\s/.test(s[j])) { if (s[j] === '\n') sawNL = true; j++; }
      const prev = lastSig();
      const next = s[j] || '';
      const needSpace = /[\w$]/.test(prev) && /[\w$]/.test(next);
      if (needSpace) out += ' ';
      else if (sawNL && /[\w$)\]"'`]/.test(prev) && !/[;,{}()[\]]/.test(next)) out += '\n'; // keep ASI-safety on risky boundaries
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

fs.writeFileSync(outPath, minify(src));
