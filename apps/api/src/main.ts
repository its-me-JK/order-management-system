import 'reflect-metadata';

import { resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createDatabaseRuntime } from '@oms/database';
import { createRedisRuntime } from '@oms/redis';
import { Logger } from 'nestjs-pino';

import { configureApiApplication, createApiExpressAdapter } from './api.application';
import { ApiModule } from './api.module';
import { reportBootstrapFailure } from './bootstrap.failure';
import {
  findRuntimeBaseDirectory,
  loadLocalEnvironment,
  parseBootstrapConfiguration,
} from './bootstrap.configuration';

async function bootstrap(): Promise<void> {
  let application: NestExpressApplication | undefined;

  try {
    const runtimeBaseDirectory = findRuntimeBaseDirectory(process.cwd());

    loadLocalEnvironment(runtimeBaseDirectory);

    const configuration = parseBootstrapConfiguration(process.env, runtimeBaseDirectory);
    application = await NestFactory.create<NestExpressApplication>(
      ApiModule.register({
        createDatabaseRuntime: () => createDatabaseRuntime(configuration.database),
        createRedisRuntime: () => createRedisRuntime(configuration.redis),
        observability: {
          deploymentEnvironment: configuration.api.deploymentEnvironment,
          level: configuration.api.logging.level,
        },
      }),
      createApiExpressAdapter(),
      { abortOnError: false, bodyParser: false, bufferLogs: true },
    );

    application.useLogger(application.get(Logger));
    configureApiApplication(application, {
      corsOrigin: configuration.api.corsOrigin,
      staticDirectory: resolve(
        runtimeBaseDirectory,
        process.env['WEB_STATIC_DIR'] ?? 'apps/web/out',
      ),
    });
    application.enableShutdownHooks(['SIGINT', 'SIGTERM']);

    await application.listen(configuration.api.http.port, '0.0.0.0');
  } catch (error: unknown) {
    if (application !== undefined) {
      try {
        await application.close();
      } catch {
        // The original bootstrap failure remains authoritative and is reported below.
      }
    }

    throw error;
  }
}

void bootstrap().catch(reportBootstrapFailure);
