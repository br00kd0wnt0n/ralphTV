#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC = path.join(ROOT, 'src');

const SOFT = {
  tsx: parseInt(process.env.SOFT_TSX || '220', 10),
  ts: parseInt(process.env.SOFT_TS || '280', 10),
  css: parseInt(process.env.SOFT_CSS || '320', 10),
};
const HARD = {
  tsx: parseInt(process.env.HARD_TSX || '260', 10),
  ts: parseInt(process.env.HARD_TS || '320', 10),
  css: parseInt(process.env.HARD_CSS || '380', 10),
};

const exts = ['.tsx', '.ts', '.css'];

/** @param {string} dir */
function* walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      yield* walk(full);
    } else if (exts.includes(path.extname(e.name))) {
      yield full;
    }
  }
}

function linesOf(file) {
  const content = fs.readFileSync(file, 'utf8');
  return content.split(/\r?\n/).length;
}

function typeFor(file) {
  const ext = path.extname(file);
  if (ext === '.tsx') return 'tsx';
  if (ext === '.ts') return 'ts';
  if (ext === '.css') return 'css';
  return 'other';
}

const warnings = [];
const errors = [];

for (const file of walk(SRC)) {
  const kind = typeFor(file);
  if (kind === 'other') continue;
  const loc = linesOf(file);
  const soft = SOFT[kind];
  const hard = HARD[kind];
  if (loc > hard) {
    errors.push(`${path.relative(ROOT, file)}: ${loc} LOC exceeds hard limit ${hard}`);
  } else if (loc > soft) {
    warnings.push(`${path.relative(ROOT, file)}: ${loc} LOC exceeds soft limit ${soft}`);
  }
}

if (warnings.length) {
  console.warn('\n[Size warnings]');
  for (const w of warnings) console.warn(' -', w);
}

if (errors.length) {
  console.error('\n[Size errors]');
  for (const e of errors) console.error(' -', e);
  process.exit(1);
}

console.log('Size check passed.');

