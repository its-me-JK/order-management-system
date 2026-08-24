import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { InvalidWorkerConfigurationError, parseWorkerConfiguration } from './worker.configuration';

const databaseEnvironment = {
  DATABASE_PASSWORD: 'database-secret',
} as const;

describe('worker configuration', (): void => {
  it('builds a local RabbitMQ URL from discrete secret-safe settings', (): void => {
    const configuration = parseWorkerConfiguration(
      {
        ...databaseEnvironment,
        RABBITMQ_HOST: '127.0.0.1',
        RABBITMQ_PASSWORD: 'rabbit secret',
        RABBITMQ_USERNAME: 'oms_app',
        RABBITMQ_VHOST: 'oms',
      },
      '/workspace',
    );

    expect(configuration.messaging.url).toBe('amqp://oms_app:rabbit%20secret@127.0.0.1:5672/oms');
  });

  it('reads a file-backed RabbitMQ password', (): void => {
    const directory = mkdtempSync(resolve(tmpdir(), 'oms-worker-config-'));

    try {
      writeFileSync(resolve(directory, 'rabbit-password'), 'file-secret\n');
      const configuration = parseWorkerConfiguration(
        {
          ...databaseEnvironment,
          RABBITMQ_PASSWORD_FILE: 'rabbit-password',
        },
        directory,
      );

      expect(configuration.messaging.url).toContain('file-secret@127.0.0.1:5672/oms');
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it('rejects missing, duplicate, and malformed RabbitMQ credentials', (): void => {
    for (const environment of [
      databaseEnvironment,
      {
        ...databaseEnvironment,
        RABBITMQ_PASSWORD: 'one',
        RABBITMQ_PASSWORD_FILE: 'two',
      },
      { ...databaseEnvironment, RABBITMQ_URL: 'https://not-rabbit.example' },
    ]) {
      expect(() => parseWorkerConfiguration(environment, '/workspace')).toThrow(
        InvalidWorkerConfigurationError,
      );
    }
  });
});
