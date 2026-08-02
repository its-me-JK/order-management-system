import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { ApiModule } from './api.module';

const DEFAULT_PORT = 3000;

function resolvePort(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_PORT;
  }

  const port = Number(value);

  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  return port;
}

async function bootstrap(): Promise<void> {
  const port = resolvePort(process.env['PORT']);
  const application = await NestFactory.create(ApiModule);

  application.enableShutdownHooks(['SIGINT', 'SIGTERM']);

  await application.listen(port, '0.0.0.0');
}

void bootstrap();
