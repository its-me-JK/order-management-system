import { canonicalizeOperationalHealthFailureResponse } from './operational-health-response';

const DATABASE_FAILURE = {
  status: 'error',
  info: { redis: { status: 'up' } },
  error: { database: { status: 'down' } },
  details: {
    database: { status: 'down' },
    redis: { status: 'up' },
  },
} as const;

describe('Operational health response canonicalization', (): void => {
  it.each([
    DATABASE_FAILURE,
    {
      status: 'error',
      info: { database: { status: 'up' } },
      error: { redis: { status: 'down' } },
      details: {
        database: { status: 'up' },
        redis: { status: 'down' },
      },
    },
    {
      status: 'error',
      info: {},
      error: { database: { status: 'down' }, redis: { status: 'down' } },
      details: { database: { status: 'down' }, redis: { status: 'down' } },
    },
  ] as const)('reconstructs a sanitized dependency failure', (candidate): void => {
    const result = canonicalizeOperationalHealthFailureResponse(candidate, 'ready');

    expect(result).toEqual(candidate);
    expect(result).not.toBe(candidate);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result?.details)).toBe(true);
    expect(Object.isFrozen(result?.details['database'])).toBe(true);
  });

  it.each([
    null,
    [],
    'error',
    { ...DATABASE_FAILURE, secret: 'must-not-pass' },
    { ...DATABASE_FAILURE, details: { database: { status: 'down' } } },
    { ...DATABASE_FAILURE, info: { redis: { status: 'down' } } },
    { ...DATABASE_FAILURE, error: { database: { status: 'down', reason: 'private' } } },
    {
      ...DATABASE_FAILURE,
      info: { database: { status: 'up' }, redis: { status: 'up' } },
    },
  ])('rejects a response outside the dependency contract', (candidate): void => {
    expect(canonicalizeOperationalHealthFailureResponse(candidate, 'ready')).toBeUndefined();
  });

  it.each([
    ['live', { status: 'shutting_down', info: {}, error: {}, details: {} }],
    [
      'ready',
      {
        status: 'shutting_down',
        info: { database: { status: 'up' }, redis: { status: 'up' } },
        error: {},
        details: { database: { status: 'up' }, redis: { status: 'up' } },
      },
    ],
    [
      'ready',
      {
        status: 'shutting_down',
        info: { redis: { status: 'up' } },
        error: { database: { status: 'down' } },
        details: { database: { status: 'down' }, redis: { status: 'up' } },
      },
    ],
  ] as const)('reconstructs the exact %s shutdown response', (endpoint, candidate): void => {
    const result = canonicalizeOperationalHealthFailureResponse(candidate, endpoint);

    expect(result).toEqual(candidate);
    expect(result).not.toBe(candidate);
  });

  it('rejects accessor properties without invoking them', (): void => {
    const statusGetter = jest.fn((): string => 'error');
    const candidate: Record<string, unknown> = { ...DATABASE_FAILURE };

    Object.defineProperty(candidate, 'status', { enumerable: true, get: statusGetter });

    expect(canonicalizeOperationalHealthFailureResponse(candidate, 'ready')).toBeUndefined();
    expect(statusGetter).not.toHaveBeenCalled();
  });

  it('fails closed when a hostile object throws during inspection', (): void => {
    const hostile = new Proxy(
      {},
      {
        ownKeys(): never {
          throw new Error('hostile proxy');
        },
      },
    );

    expect(canonicalizeOperationalHealthFailureResponse(hostile, 'ready')).toBeUndefined();
  });
});
