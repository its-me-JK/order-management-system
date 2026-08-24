import type { JsonValue } from '@oms/messaging';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface OrderEventPayload {
  readonly orderId: string;
  readonly userId?: string;
}

export class InvalidWorkerMessageError extends Error {
  public constructor() {
    super('Invalid worker message');
    this.name = 'InvalidWorkerMessageError';
  }
}

export function parseOrderEventPayload(payload: JsonValue): OrderEventPayload {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new InvalidWorkerMessageError();
  }

  const record = payload as Readonly<Record<string, JsonValue | undefined>>;
  const orderId = record['orderId'];
  const userId = record['userId'];

  if (
    typeof orderId !== 'string' ||
    !UUID_PATTERN.test(orderId) ||
    (userId !== undefined && (typeof userId !== 'string' || !UUID_PATTERN.test(userId)))
  ) {
    throw new InvalidWorkerMessageError();
  }

  return Object.freeze({
    orderId,
    ...(userId === undefined ? {} : { userId }),
  });
}
