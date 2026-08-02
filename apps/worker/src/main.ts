import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  const application = await NestFactory.createApplicationContext(WorkerModule);

  application.enableShutdownHooks(['SIGINT', 'SIGTERM']);
}

void bootstrap();
