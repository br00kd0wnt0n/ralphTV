// Create (or update) a login, with a chosen role — same safe pattern as seed-admin.mjs:
// password is only ever taken interactively (stdin) or via env var, hashed locally,
// and never written to disk or committed. Run with DATABASE_URL pointed at the target
// database (e.g. `railway run` against the backend service, or DATABASE_URL=... locally).
//
// Usage:
//   npm run create:user
//   ROLE=viewer USER_EMAIL=someone@example.com node scripts/create-user.mjs
//
// Role notes (see backend/src/index.js `requireWrite`):
//   admin / service -> full write access (schedule, uploads, streamer control, deletes)
//   anything else, e.g. 'viewer' -> read-only. Blocked from every write route with 403,
//     but can still log in and GET the schedule/library/live status (those routes only
//     require authMiddleware, not requireWrite).
//   NOTE: an empty/undefined role is treated as admin-equivalent by requireWrite (a
//   backward-compat allowance for tokens with no role stamped) — always pass an
//   explicit non-empty role for a restricted account. Don't use '', 'admin', 'service'
//   for a viewer.
import 'dotenv/config';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';

const rl = readline.createInterface({ input, output });
const sslConfig = process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false };
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: sslConfig });

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Run this against the target database, e.g.:');
    console.error('  railway run --service backend npm run create:user');
    process.exit(1);
  }

  const email = process.env.USER_EMAIL || (await rl.question('Email: '));
  const password = process.env.USER_PASSWORD || (await rl.question('Password: '));
  let role = process.env.ROLE || (await rl.question("Role [viewer]: "));
  role = role.trim() || 'viewer';

  if (!email || !password) {
    console.error('Email and password are required.');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }
  if (['admin', 'service'].includes(role)) {
    const confirm = await rl.question(
      `Role '${role}' grants FULL WRITE ACCESS (schedule, uploads, streamer control, deletes). Type "yes" to confirm: `
    );
    if (confirm.trim().toLowerCase() !== 'yes') {
      console.log('Aborted.');
      await rl.close();
      await pool.end();
      return;
    }
  }

  const hash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    `insert into users (id, email, password_hash, role)
     values (gen_random_uuid(), $1, $2, $3)
     on conflict (email) do update set password_hash=excluded.password_hash, role=excluded.role
     returning email, role`,
    [email, hash, role]
  );
  console.log(`Created/updated user: ${rows[0].email} (role: ${rows[0].role})`);
  await rl.close();
  await pool.end();
}

main().catch((e) => {
  console.error('create-user failed', e);
  process.exit(1);
});
