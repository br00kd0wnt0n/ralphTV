import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';

const sslConfig = process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false };
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: sslConfig });

async function main() {
  const admins = [
    { email: 'brook@ralph.world', password: 'admin123!' },
    { email: 'chris@ralph.world', password: 'admin123!' },
  ];

  for (const admin of admins) {
    const hash = await bcrypt.hash(admin.password, 10);
    await pool.query(
      `insert into users (id, email, password_hash, role)
       values (gen_random_uuid(), $1, $2, 'admin')
       on conflict (email) do update set password_hash=excluded.password_hash`,
      [admin.email, hash]
    );
    console.log('Seeded admin:', admin.email);
  }

  await pool.end();
}

main().catch((e) => {
  console.error('Seed failed', e);
  process.exit(1);
});
