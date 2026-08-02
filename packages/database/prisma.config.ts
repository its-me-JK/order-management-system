import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { config as loadEnvironment } from 'dotenv';
import { defineConfig } from 'prisma/config';

const repositoryRoot = resolve(__dirname, '../..');

loadEnvironment({
  path: resolve(repositoryRoot, '.env'),
  quiet: true,
});

function optionalEnvironmentValue(name: string): string | undefined {
  const value = process.env[name]?.trim();

  return value === '' ? undefined : value;
}

function resolveLocalMigrationUrl(): string | undefined {
  const configuredUrl = optionalEnvironmentValue('DATABASE_MIGRATION_URL');

  if (configuredUrl !== undefined) {
    return configuredUrl;
  }

  const passwordFile = resolve(
    repositoryRoot,
    optionalEnvironmentValue('MYSQL_ROOT_PASSWORD_FILE') ?? '.local/secrets/mysql-root-password',
  );

  if (!existsSync(passwordFile)) {
    return undefined;
  }

  const password = readFileSync(passwordFile, 'utf8').trim();

  if (password === '') {
    throw new Error('The configured MySQL root password file is empty');
  }

  const url = new URL('mysql://localhost');
  url.username = 'root';
  url.password = password;
  url.hostname = optionalEnvironmentValue('DATABASE_HOST') ?? '127.0.0.1';
  url.port = optionalEnvironmentValue('MYSQL_PORT') ?? '3306';
  url.pathname = `/${optionalEnvironmentValue('MYSQL_DATABASE') ?? 'oms'}`;

  return url.toString();
}

const migrationUrl = resolveLocalMigrationUrl();
const shadowDatabaseUrl = optionalEnvironmentValue('DATABASE_SHADOW_URL');

export default defineConfig({
  schema: resolve(__dirname, 'prisma'),
  migrations: {
    path: resolve(__dirname, 'prisma/migrations'),
  },
  ...(migrationUrl === undefined
    ? {}
    : {
        datasource: {
          url: migrationUrl,
          ...(shadowDatabaseUrl === undefined ? {} : { shadowDatabaseUrl }),
        },
      }),
});
