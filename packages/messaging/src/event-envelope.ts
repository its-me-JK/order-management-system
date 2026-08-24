const EVENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u;
const MAX_EVENT_TYPE_LENGTH = 100;
const MAX_EVENT_BYTES = 256 * 1_024;
const ENVELOPE_KEYS = new Set(['id', 'type', 'occurredAt', 'payload']);

export type JsonValue =
  boolean | number | string | null | readonly JsonValue[] | Readonly<{ [key: string]: JsonValue }>;

export interface EventEnvelope {
  readonly id: string;
  readonly type: string;
  readonly occurredAt: string;
  readonly payload: JsonValue;
}

export class InvalidEventEnvelopeError extends Error {
  public constructor() {
    super('Invalid event envelope');
    this.name = 'InvalidEventEnvelopeError';
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  if (!isPlainRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    return false;
  }

  return Object.values(value).every(isJsonValue);
}

function isCanonicalInstant(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  const instant = new Date(value);

  return !Number.isNaN(instant.valueOf()) && instant.toISOString() === value;
}

function validateEnvelope(value: unknown): EventEnvelope {
  if (!isPlainRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new InvalidEventEnvelopeError();
  }

  const keys = Object.keys(value);

  if (keys.length !== ENVELOPE_KEYS.size || keys.some((key) => !ENVELOPE_KEYS.has(key))) {
    throw new InvalidEventEnvelopeError();
  }

  if (
    typeof value['id'] !== 'string' ||
    !EVENT_ID_PATTERN.test(value['id']) ||
    typeof value['type'] !== 'string' ||
    value['type'].length > MAX_EVENT_TYPE_LENGTH ||
    !EVENT_TYPE_PATTERN.test(value['type']) ||
    !isCanonicalInstant(value['occurredAt']) ||
    !isJsonValue(value['payload'])
  ) {
    throw new InvalidEventEnvelopeError();
  }

  return Object.freeze({
    id: value['id'],
    type: value['type'],
    occurredAt: value['occurredAt'],
    payload: value['payload'],
  });
}

export function createEventEnvelope(value: unknown): EventEnvelope {
  try {
    return validateEnvelope(value);
  } catch {
    throw new InvalidEventEnvelopeError();
  }
}

export function serializeEventEnvelope(value: EventEnvelope): Buffer {
  try {
    const serialized = JSON.stringify(validateEnvelope(value));
    const content = Buffer.from(serialized, 'utf8');

    if (content.byteLength > MAX_EVENT_BYTES) {
      throw new InvalidEventEnvelopeError();
    }

    return content;
  } catch {
    throw new InvalidEventEnvelopeError();
  }
}

export function parseEventEnvelope(content: Buffer): EventEnvelope {
  try {
    if (content.byteLength === 0 || content.byteLength > MAX_EVENT_BYTES) {
      throw new InvalidEventEnvelopeError();
    }

    return validateEnvelope(JSON.parse(content.toString('utf8')) as unknown);
  } catch {
    throw new InvalidEventEnvelopeError();
  }
}
