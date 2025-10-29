import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const MIGRATIONS_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'migrations');

async function ensureTable() {
  await pool.query(`
    create table if not exists migrations (
      id serial primary key,
      name text unique not null,
      applied_at timestamptz not null default now()
    );
  `);
}

async function applied() {
  const { rows } = await pool.query('select name from migrations order by id asc');
  return new Set(rows.map((r) => r.name));
}

async function applyOne(file) {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(sql);
    await client.query('insert into migrations (name) values ($1)', [file]);
    await client.query('commit');
    console.log('Applied', file);
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

async function main() {
  await ensureTable();
  const done = await applied();
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    await applyOne(f);
  }
  await pool.end();
}

main().catch((e) => {
  console.error('Migration failed', e);
  process.exit(1);
});

