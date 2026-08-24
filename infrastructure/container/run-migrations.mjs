import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

function required(name, value) {
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing ${name}`);
  }

  return value.trim();
}

function oneTerminalNewline(value) {
  if (value.endsWith('\r\n')) {
    return value.slice(0, -2);
  }

  return value.endsWith('\n') ? value.slice(0, -1) : value;
}

function migrationUrl(environment) {
  if (environment.DATABASE_MIGRATION_URL?.trim()) {
    return environment.DATABASE_MIGRATION_URL.trim();
  }

  const passwordPath = required(
    'DATABASE_MIGRATION_PASSWORD_FILE or DATABASE_MIGRATION_URL',
    environment.DATABASE_MIGRATION_PASSWORD_FILE,
  );
  const password = oneTerminalNewline(readFileSync(passwordPath, 'utf8'));

  if (password === '') {
    throw new Error('The migration database password is empty');
  }

  const url = new URL('mysql://localhost');
  url.hostname = required('DATABASE_HOST', environment.DATABASE_HOST);
  url.port = required('DATABASE_PORT', environment.DATABASE_PORT ?? '3306');
  url.username = required('DATABASE_MIGRATION_USER', environment.DATABASE_MIGRATION_USER ?? 'root');
  url.password = password;
  url.pathname = `/${required('DATABASE_NAME', environment.DATABASE_NAME)}`;

  return url.toString();
}

function run(command, arguments_, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd: repositoryRoot,
      env: environment,
      stdio: 'inherit',
    });

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Migration command failed (${signal ?? String(code)})`));
    });
  });
}

export async function deployMigrations(environment = process.env) {
  const prismaExecutable = resolve(repositoryRoot, 'packages/database/node_modules/.bin/prisma');
  const prismaConfiguration = resolve(repositoryRoot, 'packages/database/prisma.config.ts');

  await run(prismaExecutable, ['migrate', 'deploy', '--config', prismaConfiguration], {
    ...environment,
    DATABASE_MIGRATION_URL: migrationUrl(environment),
  });
}

if (process.argv[1] !== undefined && import.meta.url === new URL(process.argv[1], 'file:').href) {
  deployMigrations().catch(() => {
    process.stderr.write(
      `${JSON.stringify({ event: 'database.migration_failed', level: 'error' })}\n`,
    );
    process.exitCode = 1;
  });
}
