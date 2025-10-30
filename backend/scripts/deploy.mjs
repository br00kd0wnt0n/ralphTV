import 'dotenv/config';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

function run(command, args = []) {
  return new Promise((resolve, reject) => {
    console.log(`Running: ${command} ${args.join(' ')}`);
    const proc = spawn(command, args, {
      cwd: rootDir,
      stdio: 'inherit',
      shell: true,
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed with code ${code}`));
    });
  });
}

async function main() {
  try {
    // Run migrations
    console.log('🔄 Running database migrations...');
    await run('node', ['scripts/migrate.mjs']);
    console.log('✅ Migrations completed');

    // Seed admin if credentials provided
    if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
      console.log('🔄 Seeding admin user...');
      await run('node', ['scripts/seed-admin.mjs']);
      console.log('✅ Admin user seeded');
    } else {
      console.log('ℹ️  Skipping admin seed (ADMIN_EMAIL/ADMIN_PASSWORD not set)');
    }

    console.log('🚀 Starting server...');
    await run('node', ['src/index.js']);
  } catch (error) {
    console.error('❌ Deploy failed:', error);
    process.exit(1);
  }
}

main();
