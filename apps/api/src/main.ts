import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createDatabase } from '@oms/database';

import { configureApiApplication } from './api.application';
import { ApiModule } from './api.module';
import {
  findRuntimeBaseDirectory,
  loadLocalEnvironment,
  parseBootstrapConfiguration,
} from './bootstrap.configuration';

async function bootstrap(): Promise<void> {
  const runtimeBaseDirectory = findRuntimeBaseDirectory(process.cwd());

  loadLocalEnvironment(runtimeBaseDirectory);

  const configuration = parseBootstrapConfiguration(process.env, runtimeBaseDirectory);
  const application = await NestFactory.create<NestExpressApplication>(
    ApiModule.register({
      createDatabaseConnection: () => createDatabase(configuration.database),
    }),
  );

  configureApiApplication(application);
  application.enableShutdownHooks(['SIGINT', 'SIGTERM']);

  await application.listen(configuration.api.http.port, '0.0.0.0');
}

void bootstrap();
