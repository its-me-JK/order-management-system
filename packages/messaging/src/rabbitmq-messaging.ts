import { once } from 'node:events';

import {
  connect,
  type Channel,
  type ChannelModel,
  type ConfirmChannel,
  type ConsumeMessage,
  type Message,
} from 'amqplib';

import { type EventEnvelope, parseEventEnvelope, serializeEventEnvelope } from './event-envelope';

export const OMS_EVENT_EXCHANGE = 'oms.events';
export const OMS_DEAD_LETTER_EXCHANGE = 'oms.events.dlx';
export const OMS_PAYMENT_QUEUE = 'oms.payment';
export const OMS_PAYMENT_DEAD_LETTER_QUEUE = 'oms.payment.dlq';
export const OMS_NOTIFICATION_QUEUE = 'oms.notification';
export const OMS_NOTIFICATION_DEAD_LETTER_QUEUE = 'oms.notification.dlq';

const JSON_CONTENT_TYPE = 'application/json';
const PAYMENT_CONSUMER_TAG = 'oms-payment-worker';
const NOTIFICATION_CONSUMER_TAG = 'oms-notification-worker';

export type MessageDisposition = 'ack' | 'dead-letter' | 'retry';
export type EventHandler = (event: EventEnvelope) => Promise<MessageDisposition>;

export interface RabbitMqMessagingOptions {
  readonly connectionTimeoutMilliseconds: number;
  readonly prefetch: number;
  readonly url: string;
}

export interface MessagingRuntime {
  close(): Promise<void>;
  consumeNotifications(handler: EventHandler): Promise<void>;
  consumePayments(handler: EventHandler): Promise<void>;
  publish(event: EventEnvelope): Promise<void>;
}

export class MessagingConnectionError extends Error {
  public constructor() {
    super('Messaging connection failed');
    this.name = 'MessagingConnectionError';
  }
}

export class MessagingOperationError extends Error {
  public constructor() {
    super('Messaging operation failed');
    this.name = 'MessagingOperationError';
  }
}

interface ConsumerRegistration {
  readonly channel: Channel;
  readonly consumerTag: string;
}

function installErrorListener(emitter: ChannelModel | Channel): void {
  emitter.on('error', (): void => {
    // Operations surface fixed errors to their callers. The listener prevents an
    // EventEmitter error from terminating the process before graceful shutdown.
  });
}

async function declareTopology(channel: Channel): Promise<void> {
  await channel.assertExchange(OMS_EVENT_EXCHANGE, 'topic', {
    autoDelete: false,
    durable: true,
  });
  await channel.assertExchange(OMS_DEAD_LETTER_EXCHANGE, 'topic', {
    autoDelete: false,
    durable: true,
  });

  await channel.assertQueue(OMS_PAYMENT_DEAD_LETTER_QUEUE, {
    autoDelete: false,
    durable: true,
  });
  await channel.bindQueue(
    OMS_PAYMENT_DEAD_LETTER_QUEUE,
    OMS_DEAD_LETTER_EXCHANGE,
    OMS_PAYMENT_DEAD_LETTER_QUEUE,
  );
  await channel.assertQueue(OMS_PAYMENT_QUEUE, {
    autoDelete: false,
    deadLetterExchange: OMS_DEAD_LETTER_EXCHANGE,
    deadLetterRoutingKey: OMS_PAYMENT_DEAD_LETTER_QUEUE,
    durable: true,
  });
  await channel.bindQueue(OMS_PAYMENT_QUEUE, OMS_EVENT_EXCHANGE, 'order.created');

  await channel.assertQueue(OMS_NOTIFICATION_DEAD_LETTER_QUEUE, {
    autoDelete: false,
    durable: true,
  });
  await channel.bindQueue(
    OMS_NOTIFICATION_DEAD_LETTER_QUEUE,
    OMS_DEAD_LETTER_EXCHANGE,
    OMS_NOTIFICATION_DEAD_LETTER_QUEUE,
  );
  await channel.assertQueue(OMS_NOTIFICATION_QUEUE, {
    autoDelete: false,
    deadLetterExchange: OMS_DEAD_LETTER_EXCHANGE,
    deadLetterRoutingKey: OMS_NOTIFICATION_DEAD_LETTER_QUEUE,
    durable: true,
  });
  await channel.bindQueue(OMS_NOTIFICATION_QUEUE, OMS_EVENT_EXCHANGE, 'order.*');
  await channel.bindQueue(OMS_NOTIFICATION_QUEUE, OMS_EVENT_EXCHANGE, 'payment.*');
}

class RabbitMqMessagingRuntime implements MessagingRuntime {
  private readonly consumers: ConsumerRegistration[] = [];
  private readonly inFlightDeliveries = new Set<Promise<void>>();
  private publishTail: Promise<void> = Promise.resolve();
  private closing = false;
  private closed = false;

  public constructor(
    private readonly connection: ChannelModel,
    private readonly publisher: ConfirmChannel,
    private readonly paymentChannel: Channel,
    private readonly notificationChannel: Channel,
  ) {}

  public publish(event: EventEnvelope): Promise<void> {
    if (this.closing || this.closed) {
      return Promise.reject(new MessagingOperationError());
    }

    let content: Buffer;

    try {
      // Capture caller-owned payloads before publication waits behind an earlier
      // confirm. The queued operation never observes later object mutation.
      content = serializeEventEnvelope(event);
    } catch {
      return Promise.reject(new MessagingOperationError());
    }

    const operation = this.publishTail.then(async (): Promise<void> => {
      try {
        await this.publishConfirmed(event, content);
      } catch {
        throw new MessagingOperationError();
      }
    });

    this.publishTail = operation.catch((): void => undefined);
    return operation;
  }

  public consumePayments(handler: EventHandler): Promise<void> {
    return this.registerConsumer(
      this.paymentChannel,
      OMS_PAYMENT_QUEUE,
      PAYMENT_CONSUMER_TAG,
      handler,
    );
  }

  public consumeNotifications(handler: EventHandler): Promise<void> {
    return this.registerConsumer(
      this.notificationChannel,
      OMS_NOTIFICATION_QUEUE,
      NOTIFICATION_CONSUMER_TAG,
      handler,
    );
  }

  public async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closing = true;
    let failed = false;

    for (const consumer of this.consumers.splice(0)) {
      try {
        await consumer.channel.cancel(consumer.consumerTag);
      } catch {
        failed = true;
      }
    }

    await Promise.allSettled([...this.inFlightDeliveries]);
    await this.publishTail;

    for (const channel of [this.paymentChannel, this.notificationChannel, this.publisher]) {
      try {
        await channel.close();
      } catch {
        failed = true;
      }
    }

    try {
      await this.connection.close();
    } catch {
      failed = true;
    }

    this.closed = true;

    if (failed) {
      throw new MessagingOperationError();
    }
  }

  private async publishConfirmed(event: EventEnvelope, content: Buffer): Promise<void> {
    let rejectReturned: (error: Error) => void = (): void => undefined;
    const returned = new Promise<never>((_resolve, reject): void => {
      rejectReturned = reject;
    });
    const onReturn = (message: Message): void => {
      if (message.properties.messageId === event.id) {
        rejectReturned(new MessagingOperationError());
      }
    };

    this.publisher.on('return', onReturn);

    try {
      let settleConfirm: (() => void) | undefined;
      let rejectConfirm: (() => void) | undefined;
      const confirmed = new Promise<void>((resolve, reject): void => {
        settleConfirm = resolve;
        rejectConfirm = (): void => {
          reject(new MessagingOperationError());
        };
      });
      const writable = this.publisher.publish(
        OMS_EVENT_EXCHANGE,
        event.type,
        content,
        {
          appId: 'oms-worker',
          contentType: JSON_CONTENT_TYPE,
          mandatory: true,
          messageId: event.id,
          persistent: true,
          timestamp: Math.floor(new Date(event.occurredAt).valueOf() / 1_000),
          type: event.type,
        },
        (error): void => {
          if (error === null || error === undefined) {
            settleConfirm?.();
            return;
          }

          rejectConfirm?.();
        },
      );

      await Promise.race([
        Promise.all([confirmed, writable ? Promise.resolve() : once(this.publisher, 'drain')]).then(
          (): void => undefined,
        ),
        returned,
      ]);
    } finally {
      this.publisher.off('return', onReturn);
    }
  }

  private async registerConsumer(
    channel: Channel,
    queue: string,
    consumerTag: string,
    handler: EventHandler,
  ): Promise<void> {
    if (this.closing || this.closed || this.consumers.some((item) => item.channel === channel)) {
      throw new MessagingOperationError();
    }

    try {
      const reply = await channel.consume(
        queue,
        (message): void => {
          if (message === null) {
            return;
          }

          const delivery = this.deliver(channel, message, handler);

          this.inFlightDeliveries.add(delivery);
          void delivery.finally((): void => {
            this.inFlightDeliveries.delete(delivery);
          });
        },
        { consumerTag, noAck: false },
      );

      this.consumers.push({ channel, consumerTag: reply.consumerTag });
    } catch {
      throw new MessagingOperationError();
    }
  }

  private async deliver(
    channel: Channel,
    message: ConsumeMessage,
    handler: EventHandler,
  ): Promise<void> {
    if (message.properties.contentType !== JSON_CONTENT_TYPE) {
      channel.nack(message, false, false);
      return;
    }

    let event: EventEnvelope;

    try {
      event = parseEventEnvelope(message.content);

      if (message.properties.messageId !== event.id || message.properties.type !== event.type) {
        channel.nack(message, false, false);
        return;
      }
    } catch {
      channel.nack(message, false, false);
      return;
    }

    let disposition: MessageDisposition;

    try {
      disposition = await handler(event);
    } catch {
      disposition = 'retry';
    }

    try {
      if (disposition === 'ack') {
        channel.ack(message);
        return;
      }

      channel.nack(message, false, disposition === 'retry');
    } catch {
      // Channel loss makes acknowledgement ambiguous. RabbitMQ will redeliver
      // unacknowledged messages when the connection is recovered or replaced.
    }
  }
}

function validateOptions(options: RabbitMqMessagingOptions): void {
  let url: URL;

  try {
    url = new URL(options.url);
  } catch {
    throw new MessagingConnectionError();
  }

  if (
    (url.protocol !== 'amqp:' && url.protocol !== 'amqps:') ||
    url.hostname === '' ||
    !Number.isInteger(options.prefetch) ||
    options.prefetch < 1 ||
    options.prefetch > 1_000 ||
    !Number.isInteger(options.connectionTimeoutMilliseconds) ||
    options.connectionTimeoutMilliseconds < 100 ||
    options.connectionTimeoutMilliseconds > 60_000
  ) {
    throw new MessagingConnectionError();
  }
}

export async function createRabbitMqMessaging(
  options: RabbitMqMessagingOptions,
): Promise<MessagingRuntime> {
  validateOptions(options);
  let connection: ChannelModel | undefined;
  let publisher: ConfirmChannel | undefined;
  let paymentChannel: Channel | undefined;
  let notificationChannel: Channel | undefined;

  try {
    connection = await connect(options.url, {
      noDelay: true,
      timeout: options.connectionTimeoutMilliseconds,
    });
    installErrorListener(connection);

    publisher = await connection.createConfirmChannel();
    paymentChannel = await connection.createChannel();
    notificationChannel = await connection.createChannel();
    installErrorListener(publisher);
    installErrorListener(paymentChannel);
    installErrorListener(notificationChannel);

    await declareTopology(publisher);
    await paymentChannel.prefetch(options.prefetch, false);
    await notificationChannel.prefetch(options.prefetch, false);

    return new RabbitMqMessagingRuntime(connection, publisher, paymentChannel, notificationChannel);
  } catch {
    for (const channel of [paymentChannel, notificationChannel, publisher]) {
      try {
        await channel?.close();
      } catch {
        // Preserve the fixed construction failure.
      }
    }

    try {
      await connection?.close();
    } catch {
      // Preserve the fixed construction failure.
    }

    throw new MessagingConnectionError();
  }
}
