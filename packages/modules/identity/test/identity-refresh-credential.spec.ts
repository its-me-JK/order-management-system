import { InvalidIdentityRefreshCredentialStateError } from '../src/domain/identity-refresh-credential.errors';
import {
  IdentityRefreshCredential,
  type IdentityRefreshCredentialSnapshot,
} from '../src/domain/identity-refresh-credential';
import {
  InvalidIdentityRefreshCredentialIdError,
  InvalidIdentityRefreshCredentialSequenceError,
  MAX_IDENTITY_REFRESH_CREDENTIAL_SEQUENCE,
  parseIdentityRefreshCredentialId,
  parseIdentityRefreshCredentialSequence,
  type IdentityRefreshCredentialId,
  type IdentityRefreshCredentialSequence,
} from '../src/domain/identity-refresh-credential.values';

const CREDENTIAL_ID = '01890f3a-8bcd-7def-8abc-0123456789ab';
const SUCCESSOR_ID = '01890f3a-8bcd-7def-9abc-0123456789ab';
const SESSION_ID = '01890f3a-8bcd-7def-aabc-0123456789ab';
const ISSUED_AT = '2026-08-23T10:00:00.000001Z';
const MINIMUM_EXPIRES_AT = '2026-08-23T10:15:00.000001Z';

type RawRefreshCredentialSnapshot = Readonly<{
  id: unknown;
  sessionId: unknown;
  sequence: unknown;
  issuedAt: unknown;
  expiresAt: unknown;
  consumedAt: unknown;
  successorId: unknown;
}>;

type ErrorClass = abstract new (...arguments_: never[]) => Error;

function captureError(operation: () => unknown): Error {
  try {
    operation();
  } catch (error: unknown) {
    if (error instanceof Error) {
      return error;
    }
  }

  throw new Error('Expected the operation to throw an Error');
}

function expectFixedSafeError(
  operation: () => unknown,
  expectedClass: ErrorClass,
  rejectedValues: readonly string[] = [],
): void {
  const error = captureError(operation);

  expect(error).toBeInstanceOf(expectedClass);
  expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
  for (const rejectedValue of rejectedValues) {
    expect(String(error)).not.toContain(rejectedValue);
    expect(JSON.stringify(error)).not.toContain(rejectedValue);
  }
}

function initialCredentialSnapshot(
  overrides: Partial<RawRefreshCredentialSnapshot> = {},
): RawRefreshCredentialSnapshot {
  return {
    id: CREDENTIAL_ID,
    sessionId: SESSION_ID,
    sequence: 1,
    issuedAt: ISSUED_AT,
    expiresAt: MINIMUM_EXPIRES_AT,
    consumedAt: null,
    successorId: null,
    ...overrides,
  };
}

function laterCredentialSnapshot(
  overrides: Partial<RawRefreshCredentialSnapshot> = {},
): RawRefreshCredentialSnapshot {
  return initialCredentialSnapshot({
    sequence: 2,
    expiresAt: '2026-08-23T10:00:01.000002Z',
    ...overrides,
  });
}

function consumedCredentialSnapshot(
  overrides: Partial<RawRefreshCredentialSnapshot> = {},
): RawRefreshCredentialSnapshot {
  return initialCredentialSnapshot({
    consumedAt: ISSUED_AT,
    successorId: SUCCESSOR_ID,
    ...overrides,
  });
}

describe('Identity Refresh Credential values', (): void => {
  it.each([
    '00000000-0000-7000-8000-000000000000',
    CREDENTIAL_ID,
    'ffffffff-ffff-7fff-bfff-ffffffffffff',
  ])('retains canonical lowercase UUIDv7 credential id %s', (credentialId): void => {
    expect(parseIdentityRefreshCredentialId(credentialId)).toBe(credentialId);
  });

  it.each([
    ['uppercase', '01890F3A-8BCD-7DEF-8ABC-0123456789AB'],
    ['UUIDv4', '01890f3a-8bcd-4def-8abc-0123456789ab'],
    ['non-RFC variant', '01890f3a-8bcd-7def-7abc-0123456789ab'],
    ['missing separators', '01890f3a8bcd7def8abc0123456789ab'],
    ['leading whitespace', ` ${CREDENTIAL_ID}`],
    ['trailing whitespace', `${CREDENTIAL_ID} `],
    ['sensitive malformed value', 'refresh-credential-secret'],
    ['number', 7],
    ['null', null],
  ])('rejects credential id with %s without normalization', (_scenario, credentialId): void => {
    expect(() => parseIdentityRefreshCredentialId(credentialId)).toThrow(
      InvalidIdentityRefreshCredentialIdError,
    );
  });

  it.each([1, 2, MAX_IDENTITY_REFRESH_CREDENTIAL_SEQUENCE])(
    'retains supported credential sequence %d',
    (sequence): void => {
      expect(parseIdentityRefreshCredentialSequence(sequence)).toBe(sequence);
    },
  );

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    MAX_IDENTITY_REFRESH_CREDENTIAL_SEQUENCE + 1,
    '1',
    null,
    undefined,
  ])('rejects unsupported credential sequence %p', (sequence): void => {
    expect(() => parseIdentityRefreshCredentialSequence(sequence)).toThrow(
      InvalidIdentityRefreshCredentialSequenceError,
    );
  });

  it('publishes the reserved sequence ceiling and fixed cause-free errors', (): void => {
    expect(MAX_IDENTITY_REFRESH_CREDENTIAL_SEQUENCE).toBe(4_294_967_294);
    expectFixedSafeError(
      () => parseIdentityRefreshCredentialId('refresh-credential-secret'),
      InvalidIdentityRefreshCredentialIdError,
      ['refresh-credential-secret'],
    );
    expectFixedSafeError(
      () => parseIdentityRefreshCredentialSequence('refresh-sequence-secret'),
      InvalidIdentityRefreshCredentialSequenceError,
      ['refresh-sequence-secret'],
    );
  });
});

describe('IdentityRefreshCredential strict rehydration', (): void => {
  it.each([
    ['initial minimum lifetime', initialCredentialSnapshot()],
    [
      'initial maximum lifetime',
      initialCredentialSnapshot({ expiresAt: '2026-08-24T10:00:00.000001Z' }),
    ],
    ['initial consumed at issuance', consumedCredentialSnapshot()],
    ['later one-second capped shape with different fractions', laterCredentialSnapshot()],
    [
      'later exact maximum lifetime',
      laterCredentialSnapshot({ expiresAt: '2026-08-24T10:00:00.000001Z' }),
    ],
    [
      'later consumed predecessor',
      laterCredentialSnapshot({
        consumedAt: '2026-08-23T10:00:00.500001Z',
        successorId: SUCCESSOR_ID,
      }),
    ],
    [
      'retained expired current row',
      laterCredentialSnapshot({
        issuedAt: '2024-02-29T23:59:58.123456Z',
        expiresAt: '2024-02-29T23:59:59.123456Z',
      }),
    ],
    [
      'maximum unconsumed sequence',
      laterCredentialSnapshot({ sequence: MAX_IDENTITY_REFRESH_CREDENTIAL_SEQUENCE }),
    ],
    [
      'largest consumable sequence',
      laterCredentialSnapshot({
        sequence: MAX_IDENTITY_REFRESH_CREDENTIAL_SEQUENCE - 1,
        consumedAt: ISSUED_AT,
        successorId: SUCCESSOR_ID,
      }),
    ],
  ] as const)('rehydrates a reachable intrinsic %s', (_scenario, raw): void => {
    const credential = IdentityRefreshCredential.rehydrate(raw);

    expect(credential.toSnapshot()).toEqual(raw);
    expect(Object.isFrozen(credential)).toBe(true);
    expect(Object.isFrozen(credential.toSnapshot())).toBe(true);
    expect(Object.keys(credential)).toEqual([]);
    expect(JSON.stringify(credential)).toBe('{}');
  });

  it('copies caller-owned state and exposes only a frozen snapshot', (): void => {
    const raw = { ...initialCredentialSnapshot() };
    const credential = IdentityRefreshCredential.rehydrate(raw);
    raw.sequence = 99;
    raw.expiresAt = 'persistence-mutated-time';

    expect(credential.toSnapshot()).toEqual(initialCredentialSnapshot());
    expect(() => {
      (credential.toSnapshot() as { sequence: number }).sequence = 99;
    }).toThrow(TypeError);
    expect(credential.toSnapshot()).toEqual(initialCredentialSnapshot());
  });

  it.each([
    ['non-object snapshot', null],
    ['array snapshot', []],
    ['missing members', { id: CREDENTIAL_ID }],
    [
      'additional member',
      { ...initialCredentialSnapshot(), internalSecret: 'persistence-refresh-secret' },
    ],
    ['invalid credential id', initialCredentialSnapshot({ id: 'persistence-refresh-secret' })],
    ['invalid session id', initialCredentialSnapshot({ sessionId: 'persistence-session-secret' })],
    ['invalid sequence', initialCredentialSnapshot({ sequence: 0 })],
    [
      'invalid issuance instant',
      initialCredentialSnapshot({ issuedAt: 'persistence-time-secret' }),
    ],
    ['invalid expiry instant', initialCredentialSnapshot({ expiresAt: 'not-an-instant' })],
    ['expiry equal to issuance', laterCredentialSnapshot({ expiresAt: ISSUED_AT })],
    [
      'expiry less than one whole second later',
      laterCredentialSnapshot({ expiresAt: '2026-08-23T10:00:01.000000Z' }),
    ],
    [
      'expiry more than twenty-four hours later',
      laterCredentialSnapshot({ expiresAt: '2026-08-24T10:00:00.000002Z' }),
    ],
    ['consumption without successor', initialCredentialSnapshot({ consumedAt: ISSUED_AT })],
    ['successor without consumption', initialCredentialSnapshot({ successorId: SUCCESSOR_ID })],
    [
      'consumption before issuance',
      consumedCredentialSnapshot({ consumedAt: '2026-08-23T09:59:59.999999Z' }),
    ],
    ['consumption equal to expiry', consumedCredentialSnapshot({ consumedAt: MINIMUM_EXPIRES_AT })],
    ['self successor', consumedCredentialSnapshot({ successorId: CREDENTIAL_ID })],
    [
      'consumed maximum sequence',
      laterCredentialSnapshot({
        sequence: MAX_IDENTITY_REFRESH_CREDENTIAL_SEQUENCE,
        consumedAt: ISSUED_AT,
        successorId: SUCCESSOR_ID,
      }),
    ],
    [
      'sequence-1 lifetime below fifteen minutes',
      initialCredentialSnapshot({ expiresAt: '2026-08-23T10:14:59.000001Z' }),
    ],
    [
      'sequence-1 lifetime above twenty-four hours',
      initialCredentialSnapshot({ expiresAt: '2026-08-24T10:00:01.000001Z' }),
    ],
    [
      'sequence-1 expiry with different fractional digits',
      initialCredentialSnapshot({ expiresAt: '2026-08-23T10:15:00.000002Z' }),
    ],
    ['invalid consumed time', consumedCredentialSnapshot({ consumedAt: 'not-an-instant' })],
    [
      'invalid successor id',
      consumedCredentialSnapshot({ successorId: 'persistence-successor-secret' }),
    ],
  ] as const)(
    'rejects an unreachable intrinsic %s with one fixed safe error',
    (_scenario, raw): void => {
      const error = captureError(() => IdentityRefreshCredential.rehydrate(raw));

      expect(error).toBeInstanceOf(InvalidIdentityRefreshCredentialStateError);
      expect(error).toMatchObject({
        name: 'InvalidIdentityRefreshCredentialStateError',
        message: 'Expected a valid Identity Refresh Credential snapshot',
      });
      expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
      for (const forbidden of [
        'persistence-refresh-secret',
        'persistence-session-secret',
        'persistence-time-secret',
        'persistence-successor-secret',
      ]) {
        expect(String(error)).not.toContain(forbidden);
        expect(JSON.stringify(error)).not.toContain(forbidden);
      }
    },
  );
});

describe('IdentityRefreshCredential internal rotation trust boundary', (): void => {
  it('collapses forged, hostile Proxy, and revoked Proxy children to one safe state error', (): void => {
    const validCredential = IdentityRefreshCredential.rehydrate(initialCredentialSnapshot());
    const validSnapshot = validCredential.toSnapshot();
    const hostileSecret = 'hostile-refresh-proxy-secret';
    let hostileTrapCalls = 0;
    const hostileCredential = new Proxy(validCredential, {
      get(): never {
        hostileTrapCalls += 1;
        throw new Error(hostileSecret);
      },
      getPrototypeOf(): never {
        hostileTrapCalls += 1;
        throw new Error(hostileSecret);
      },
    });
    const revokedCredential = Proxy.revocable(validCredential, {});
    revokedCredential.revoke();
    const rotationInput = {
      consumedAt: validSnapshot.issuedAt,
      successorId: parseIdentityRefreshCredentialId(SUCCESSOR_ID),
      successorExpiresAt: validSnapshot.expiresAt,
    };
    const candidates: readonly unknown[] = [
      Object.create(IdentityRefreshCredential.prototype) as unknown,
      hostileCredential,
      revokedCredential.proxy,
    ];

    for (const candidate of candidates) {
      expectFixedSafeError(
        () => IdentityRefreshCredential.rotateForSessionFamily(candidate, rotationInput),
        InvalidIdentityRefreshCredentialStateError,
        [hostileSecret],
      );
    }

    expect(hostileTrapCalls).toBe(0);
    expect(validCredential.toSnapshot()).toBe(validSnapshot);
    expect(validCredential.toSnapshot()).toEqual(initialCredentialSnapshot());
  });
});

const _credentialId: IdentityRefreshCredentialId = parseIdentityRefreshCredentialId(CREDENTIAL_ID);
const _sequence: IdentityRefreshCredentialSequence = parseIdentityRefreshCredentialSequence(1);
const _snapshot: IdentityRefreshCredentialSnapshot = IdentityRefreshCredential.rehydrate(
  initialCredentialSnapshot(),
).toSnapshot();
void _credentialId;
void _sequence;
void _snapshot;
