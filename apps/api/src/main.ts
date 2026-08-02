import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { parseApiRuntimeConfiguration } from '@oms/configuration';

import { ApiModule } from './api.module';

async function bootstrap(): Promise<void> {
  const configuration = parseApiRuntimeConfiguration(process.env);
  const application = await NestFactory.create(ApiModule);

  application.enableShutdownHooks(['SIGINT', 'SIGTERM']);

  await application.listen(configuration.http.port, '0.0.0.0');
}

void bootstrap();
