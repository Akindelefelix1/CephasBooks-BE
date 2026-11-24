import { spawn } from 'node:child_process';
import { join } from 'node:path';

const maxAttempts = 6;
const retryDelayMs = 15_000;
const prismaExecutable = join(
  process.cwd(),
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'prisma.cmd' : 'prisma',
);

function run(command, args, captureOutput = false, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: captureOutput ? ['inherit', 'pipe', 'pipe'] : 'inherit',
    });
    let output = '';
    if (captureOutput) {
      child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        output += text;
        process.stdout.write(text);
      });
      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        output += text;
        process.stderr.write(text);
      });
    }
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code: code ?? 1, signal, output }));
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function migrationDatabaseUrl() {
  if (process.env.DIRECT_URL) return process.env.DIRECT_URL;
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required to run migrations.');

  const url = new URL(process.env.DATABASE_URL);
  if (url.hostname.includes('-pooler')) {
    url.hostname = url.hostname.replace(/-pooler(?=\.|$)/, '');
    console.warn('DIRECT_URL is not set; using the unpooled Neon endpoint for migrations.');
    return url.toString();
  }
  return process.env.DATABASE_URL;
}

async function deployMigrations() {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    console.log(`Running database migrations (attempt ${attempt}/${maxAttempts})...`);
    const migrationEnv = { ...process.env, DATABASE_URL: migrationDatabaseUrl() };
    const result = await run(prismaExecutable, ['migrate', 'deploy'], true, migrationEnv);
    if (result.code === 0) return;

    const advisoryLockTimeout =
      result.output.includes('P1002') && result.output.includes('advisory lock');
    if (!advisoryLockTimeout || attempt === maxAttempts) {
      throw new Error(`Database migration failed with exit code ${result.code}.`);
    }

    console.warn(`Migration lock is held by another deploy; retrying in ${retryDelayMs / 1000}s.`);
    await wait(retryDelayMs);
  }
}

await deployMigrations();

const server = spawn(process.execPath, ['dist/main.js'], { env: process.env, stdio: 'inherit' });
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => server.kill(signal));
}
const serverResult = await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.once('exit', (code, signal) => resolve({ code: code ?? 1, signal }));
});
if (serverResult.signal) console.error(`Server stopped by signal ${serverResult.signal}.`);
process.exitCode = serverResult.code;
