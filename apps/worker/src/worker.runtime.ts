import { setTimeout as wait } from 'node:timers/promises';

import { createDatabaseRuntime, type DatabaseRuntime } from '@oms/database';
import { createRabbitMqMessaging, type MessagingRuntime } from '@oms/messaging';

import { createWorkerDatabaseServices } from './platform/database/worker-database.services';
import type { WorkerConfiguration } from './worker.configuration';

export class WorkerRuntimeError extends Error {
  public constructor() {
    super('Worker runtime failed');
    this.name = 'WorkerRuntimeError';
  }
}

function writeOperationalEvent(
  level: 'error' | 'info',
  event: string,
  fields: Readonly<Record<string, number | string>> = {},
): void {
  const destination = level === 'error' ? process.stderr : process.stdout;

  destination.write(
    `${JSON.stringify({ event, level, service: 'oms-worker', timestamp: new Date().toISOString(), ...fields })}\n`,
  );
}

export class WorkerRuntime {
  private readonly stopController = new AbortController();
  private polling: Promise<void> | undefined;
  private started = false;
  private closed = false;

  public constructor(
    private readonly database: DatabaseRuntime,
    private readonly messaging: MessagingRuntime,
    private readonly configuration: WorkerConfiguration,
    private readonly services: ReturnType<typeof createWorkerDatabaseServices>,
  ) {}

  public async start(): Promise<void> {
    if (this.started || this.closed) {
      throw new WorkerRuntimeError();
    }

    this.started = true;

    try {
      await this.messaging.consumePayments(this.services.paymentHandler);
      await this.messaging.consumeNotifications(this.services.notificationHandler);
      this.polling = this.pollOutbox();
      writeOperationalEvent('info', 'worker.started');
    } catch {
      try {
        await this.close();
      } catch {
        // Preserve the fixed startup failure.
      }

      throw new WorkerRuntimeError();
    }
  }

  public async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.stopController.abort();
    let failed = false;

    try {
      await this.polling;
    } catch {
      failed = true;
    }

    try {
      await this.messaging.close();
    } catch {
      failed = true;
    }

    try {
      await this.database.close();
    } catch {
      failed = true;
    }

    writeOperationalEvent(failed ? 'error' : 'info', 'worker.stopped');

    if (failed) {
      throw new WorkerRuntimeError();
    }
  }

  private async pollOutbox(): Promise<void> {
    while (!this.stopController.signal.aborted) {
      try {
        const published = await this.services.outboxPublisher.publishBatch();

        if (published > 0) {
          writeOperationalEvent('info', 'outbox.batch_published', { published });
        }
      } catch {
        writeOperationalEvent('error', 'outbox.batch_failed');
      }

      if (this.stopController.signal.aborted) {
        return;
      }

      try {
        await wait(this.configuration.outbox.pollIntervalMilliseconds, undefined, {
          signal: this.stopController.signal,
        });
      } catch {
        return;
      }
    }
  }
}

export async function createWorkerRuntime(
  configuration: WorkerConfiguration,
): Promise<WorkerRuntime> {
  let database: DatabaseRuntime | undefined;
  let messaging: MessagingRuntime | undefined;

  try {
    database = createDatabaseRuntime(configuration.database);
    messaging = await createRabbitMqMessaging(configuration.messaging);
    const services = createWorkerDatabaseServices(database, messaging, configuration.outbox);

    return new WorkerRuntime(database, messaging, configuration, services);
  } catch {
    try {
      await messaging?.close();
    } catch {
      // Preserve the fixed bootstrap error.
    }

    try {
      await database?.close();
    } catch {
      // Preserve the fixed bootstrap error.
    }

    throw new WorkerRuntimeError();
  }
}
