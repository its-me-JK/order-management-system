import { canonicalizeOperationalHealthFailureResponse } from './operational-health-response';

const EXPECTED_RESPONSE = {
  status: 'error',
  info: {},
  error: { database: { status: 'down' } },
  details: { database: { status: 'down' } },
} as const;

describe('Unavailable operational health response', (): void => {
  it('reconstructs the exact known readiness failure without retaining its input', (): void => {
    const input = {
      status: 'error',
      info: {},
      error: { database: { status: 'down' } },
      details: { database: { status: 'down' } },
    };
    const result = canonicalizeOperationalHealthFailureResponse(input, 'ready');

    expect(result).toEqual(EXPECTED_RESPONSE);
    expect(result).not.toBe(input);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result?.error)).toBe(true);
    expect(Object.isFrozen(result?.error['database'])).toBe(true);
  });

  it.each([
    null,
    [],
    'error',
    { ...EXPECTED_RESPONSE, secret: 'must-not-pass' },
    { ...EXPECTED_RESPONSE, info: { database: { status: 'up' } } },
    { ...EXPECTED_RESPONSE, error: { redis: { status: 'down' } } },
    { ...EXPECTED_RESPONSE, error: { database: { status: 'up' } } },
    { ...EXPECTED_RESPONSE, error: { database: { status: 'down', reason: 'private' } } },
    { ...EXPECTED_RESPONSE, details: {} },
  ])('rejects a response outside the exact operational contract', (candidate): void => {
    expect(canonicalizeOperationalHealthFailureResponse(candidate, 'ready')).toBeUndefined();
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

  it('rejects accessor properties without invoking them', (): void => {
    const statusGetter = jest.fn((): string => 'error');
    const candidate: Record<string, unknown> = {
      status: 'error',
      info: {},
      error: { database: { status: 'down' } },
      details: { database: { status: 'down' } },
    };

    Object.defineProperty(candidate, 'status', {
      enumerable: true,
      get: statusGetter,
    });

    expect(canonicalizeOperationalHealthFailureResponse(candidate, 'ready')).toBeUndefined();
    expect(statusGetter).not.toHaveBeenCalled();
  });

  it.each([
    [
      'live',
      {
        status: 'shutting_down',
        info: {},
        error: {},
        details: {},
      },
    ],
    [
      'ready',
      {
        status: 'shutting_down',
        info: { database: { status: 'up' } },
        error: {},
        details: { database: { status: 'up' } },
      },
    ],
    [
      'ready',
      {
        status: 'shutting_down',
        info: {},
        error: { database: { status: 'down' } },
        details: { database: { status: 'down' } },
      },
    ],
  ] as const)('reconstructs the exact %s shutdown response', (endpoint, candidate): void => {
    const result = canonicalizeOperationalHealthFailureResponse(candidate, endpoint);

    expect(result).toEqual(candidate);
    expect(result).not.toBe(candidate);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('rejects a liveness shape on the readiness endpoint', (): void => {
    expect(
      canonicalizeOperationalHealthFailureResponse(
        {
          status: 'shutting_down',
          info: {},
          error: {},
          details: {},
        },
        'ready',
      ),
    ).toBeUndefined();
  });
});
