import 'dotenv/config';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';

const rl = readline.createInterface({ input, output });
const sslConfig = process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false };
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: sslConfig });

async function main() {
  const email = process.env.ADMIN_EMAIL || (await rl.question('Admin email: '));
  const password = process.env.ADMIN_PASSWORD || (await rl.question('Admin password: '));
  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    `insert into users (id, email, password_hash, role)
     values (gen_random_uuid(), $1, $2, 'admin')
     on conflict (email) do update set password_hash=excluded.password_hash`,
    [email, hash]
  );
  console.log('Seeded admin:', email);
  await rl.close();
  await pool.end();
}

main().catch((e) => {
  console.error('Seed failed', e);
  process.exit(1);
});

