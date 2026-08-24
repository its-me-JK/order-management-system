import type { EventEnvelope, JsonValue, MessagingRuntime } from '@oms/messaging';
import type { PrismaClient } from '@oms/database/prisma';

export interface OutboxPublisherOptions {
  readonly batchSize: number;
  readonly initialBackoffMilliseconds: number;
  readonly maximumAttempts: number;
  readonly maximumBackoffMilliseconds: number;
}

export class OutboxPublisherError extends Error {
  public constructor() {
    super('Outbox publication failed');
    this.name = 'OutboxPublisherError';
  }
}

export function outboxBackoffMilliseconds(
  failedAttempt: number,
  initialBackoffMilliseconds: number,
  maximumBackoffMilliseconds: number,
): number {
  const exponent = Math.min(Math.max(failedAttempt - 1, 0), 30);
  return Math.min(initialBackoffMilliseconds * 2 ** exponent, maximumBackoffMilliseconds);
}

export class OutboxPublisher {
  public constructor(
    private readonly client: PrismaClient,
    private readonly messaging: MessagingRuntime,
    private readonly options: OutboxPublisherOptions,
  ) {}

  public async publishBatch(now = new Date()): Promise<number> {
    const records = await this.client.outboxEventRecord.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: this.options.batchSize,
      where: {
        attempts: { lt: this.options.maximumAttempts },
        nextAttemptAt: { lte: now },
        publishedAt: null,
      },
    });
    let published = 0;

    for (const record of records) {
      const event: EventEnvelope = {
        id: record.id,
        occurredAt: record.createdAt.toISOString(),
        payload: record.payload as JsonValue,
        type: record.eventType,
      };

      try {
        await this.messaging.publish(event);
        const result = await this.client.outboxEventRecord.updateMany({
          data: { lastError: null, publishedAt: new Date() },
          where: { id: record.id, publishedAt: null },
        });

        if (result.count > 0) {
          published += 1;
        }
      } catch {
        const failedAttempt = record.attempts + 1;
        const delay = outboxBackoffMilliseconds(
          failedAttempt,
          this.options.initialBackoffMilliseconds,
          this.options.maximumBackoffMilliseconds,
        );

        try {
          await this.client.outboxEventRecord.updateMany({
            data: {
              attempts: { increment: 1 },
              lastError: 'Messaging publish failed',
              nextAttemptAt: new Date(now.valueOf() + delay),
            },
            where: {
              attempts: record.attempts,
              id: record.id,
              publishedAt: null,
            },
          });
        } catch {
          throw new OutboxPublisherError();
        }
      }
    }

    return published;
  }
}
