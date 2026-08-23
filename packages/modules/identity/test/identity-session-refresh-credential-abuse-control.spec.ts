import {
  authenticateIdentityCredentialAbuseDecision,
  createIdentityCredentialAbuseAllowedDecision,
  createIdentityCredentialAbuseDeniedDecision,
  IdentityCredentialAbuseControlError,
  IdentityCredentialAbuseControlUnavailableError,
  MAX_IDENTITY_CREDENTIAL_ABUSE_RETRY_AFTER_SECONDS,
  MIN_IDENTITY_CREDENTIAL_ABUSE_RETRY_AFTER_SECONDS,
  parseIdentityCredentialAbuseRetryAfterSeconds,
  type IdentityCredentialAbuseDecision,
  type IdentityCredentialAbuseRetryAfterSeconds,
  type IdentitySessionRefreshCredentialAbuseAdmission,
  type IdentitySessionRefreshCredentialAbuseControl,
} from '../src/application/identity-session-refresh-credential-abuse-control';
import { createIdentityCredentialAbuseNetworkFromAddressBytes } from '../src/application/identity-credential-abuse-network';
import { parseIdentityRefreshCredentialWireValue } from '../src/application/identity-session-credential-wire.values';
import type {
  // @ts-expect-error Refresh abuse-control ports remain package-internal.
  IdentitySessionRefreshCredentialAbuseControl as LeakedIdentitySessionRefreshCredentialAbuseControl,
  // @ts-expect-error Refresh abuse-control decisions remain package-internal.
  IdentityCredentialAbuseDecision as LeakedIdentityCredentialAbuseDecision,
  // @ts-expect-error Refresh abuse-control errors remain package-internal.
  IdentityCredentialAbuseControlUnavailableError as LeakedIdentityCredentialAbuseControlUnavailableError,
} from '../src';
import * as identityPublicSurface from '../src';

const REFRESH_WIRE_VALUE = 'oms_rt_v1_AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const INTERNAL_ERROR_MESSAGE = 'Identity credential abuse control failed';
const UNAVAILABLE_ERROR_MESSAGE = 'Identity credential abuse control is temporarily unavailable';

type AdmitSessionRefresh = IdentitySessionRefreshCredentialAbuseControl['admitSessionRefresh'];
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

function expectFixedCauseFreeError(
  error: Error,
  ExpectedError: ErrorClass,
  expectedName: string,
  expectedMessage: string,
  rejectedValues: readonly string[] = [],
): void {
  expect(error).toBeInstanceOf(ExpectedError);
  expect(error).toMatchObject({ name: expectedName, message: expectedMessage });
  expect((error as Error & { cause?: unknown }).cause).toBeUndefined();

  for (const rejectedValue of rejectedValues) {
    expect(String(error)).not.toContain(rejectedValue);
    expect(JSON.stringify(error)).not.toContain(rejectedValue);
    expect(error.stack ?? '').not.toContain(rejectedValue);
  }
}

function expectInternalFailure(
  operation: () => unknown,
  rejectedValues: readonly string[] = [],
): Error {
  const error = captureError(operation);
  expectFixedCauseFreeError(
    error,
    IdentityCredentialAbuseControlError,
    'IdentityCredentialAbuseControlError',
    INTERNAL_ERROR_MESSAGE,
    rejectedValues,
  );
  return error;
}

function expectExactFrozenDataProperty(
  value: object,
  key: PropertyKey,
  expectedValue: unknown,
): void {
  expect(Object.getOwnPropertyDescriptor(value, key)).toEqual({
    value: expectedValue,
    configurable: false,
    enumerable: true,
    writable: false,
  });
}

describe('Identity refresh credential abuse decisions', (): void => {
  it('mints one exact frozen runtime-authentic allowed decision', (): void => {
    const first = createIdentityCredentialAbuseAllowedDecision();
    const second = createIdentityCredentialAbuseAllowedDecision();

    expect(first).toBe(second);
    expect(first).toEqual({ kind: 'allowed' });
    expect(Object.getPrototypeOf(first)).toBe(Object.prototype);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Reflect.ownKeys(first)).toEqual(['kind']);
    expectExactFrozenDataProperty(first, 'kind', 'allowed');
    expect(authenticateIdentityCredentialAbuseDecision(first)).toBe(first);
  });

  it.each([
    MIN_IDENTITY_CREDENTIAL_ABUSE_RETRY_AFTER_SECONDS,
    2,
    73,
    MAX_IDENTITY_CREDENTIAL_ABUSE_RETRY_AFTER_SECONDS,
  ])('accepts the bounded whole-second retry value %s', (retryAfterSeconds): void => {
    const parsed: IdentityCredentialAbuseRetryAfterSeconds =
      parseIdentityCredentialAbuseRetryAfterSeconds(retryAfterSeconds);
    const first = createIdentityCredentialAbuseDeniedDecision(parsed);
    const second = createIdentityCredentialAbuseDeniedDecision(retryAfterSeconds);

    expect(parsed).toBe(retryAfterSeconds);
    expect(first).not.toBe(second);
    expect(first).toEqual({ kind: 'denied', retryAfterSeconds });
    expect(Object.getPrototypeOf(first)).toBe(Object.prototype);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Reflect.ownKeys(first)).toEqual(['kind', 'retryAfterSeconds']);
    expectExactFrozenDataProperty(first, 'kind', 'denied');
    expectExactFrozenDataProperty(first, 'retryAfterSeconds', retryAfterSeconds);
    expect(authenticateIdentityCredentialAbuseDecision(first)).toBe(first);
    expect(authenticateIdentityCredentialAbuseDecision(first)).toBe(first);
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['over the maximum', 181],
    ['fractional', 1.5],
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
    ['numeric text', '1'],
    ['bigint', 1n],
    ['boxed number', new Number(1)],
    ['boolean', true],
    ['null', null],
    ['undefined', undefined],
    ['array', [1]],
    ['record', { value: 1 }],
    ['function', (): number => 1],
  ] as const)('rejects a %s retry value without coercion', (_scenario, value): void => {
    const firstError = expectInternalFailure(() =>
      parseIdentityCredentialAbuseRetryAfterSeconds(value),
    );
    const secondError = expectInternalFailure(() =>
      createIdentityCredentialAbuseDeniedDecision(value),
    );

    expect(firstError).not.toBe(secondError);
  });

  it('does not invoke hostile coercion hooks while validating retry values', (): void => {
    const valueOf = jest.fn((): number => 1);
    const toString = jest.fn((): string => '1');
    const candidate = { valueOf, toString };
    const proxy = new Proxy(candidate, {
      get(): never {
        throw new Error('retry-secret');
      },
    });

    expectInternalFailure(() => createIdentityCredentialAbuseDeniedDecision(candidate));
    expectInternalFailure(
      () => createIdentityCredentialAbuseDeniedDecision(proxy),
      ['retry-secret'],
    );
    expect(valueOf).not.toHaveBeenCalled();
    expect(toString).not.toHaveBeenCalled();
  });

  it('rejects structural equivalents, clones, spreads, and proxies', (): void => {
    const allowed = createIdentityCredentialAbuseAllowedDecision();
    const denied = createIdentityCredentialAbuseDeniedDecision(17);
    const allowedPrototype = Object.getPrototypeOf(allowed) as object | null;
    const structuralAllowed = Object.freeze({ kind: 'allowed' as const });
    const structuralDenied = Object.freeze({
      kind: 'denied' as const,
      retryAfterSeconds: 17,
    });
    const candidates: readonly unknown[] = [
      structuralAllowed,
      structuralDenied,
      { ...allowed },
      { ...denied },
      structuredClone(allowed),
      structuredClone(denied),
      new Proxy(allowed, {}),
      new Proxy(denied, {}),
      Object.create(allowedPrototype),
    ];

    for (const candidate of candidates) {
      expectInternalFailure(() => authenticateIdentityCredentialAbuseDecision(candidate));
    }

    expect(authenticateIdentityCredentialAbuseDecision(allowed)).toBe(allowed);
    expect(authenticateIdentityCredentialAbuseDecision(denied)).toBe(denied);
  });

  it('rejects hostile proxies without consulting their traps', (): void => {
    const get = jest.fn((): never => {
      throw new Error('decision-secret');
    });
    const ownKeys = jest.fn((): never => {
      throw new Error('decision-secret');
    });
    const candidate = new Proxy(Object.freeze({ kind: 'allowed' as const }), {
      get,
      ownKeys,
    });

    expectInternalFailure(
      () => authenticateIdentityCredentialAbuseDecision(candidate),
      ['decision-secret'],
    );
    expect(get).not.toHaveBeenCalled();
    expect(ownKeys).not.toHaveBeenCalled();
  });

  it.each([null, undefined, 'allowed', 1, true, Symbol('allowed'), (): void => undefined])(
    'rejects the foreign decision value %p',
    (candidate): void => {
      expectInternalFailure(() => authenticateIdentityCredentialAbuseDecision(candidate));
    },
  );
});

describe('Identity refresh credential abuse-control contract', (): void => {
  it('declares the narrow network and refresh-wire input shape', async (): Promise<void> => {
    const decision: IdentityCredentialAbuseDecision =
      createIdentityCredentialAbuseAllowedDecision();
    const admitSessionRefresh = jest.fn<
      ReturnType<AdmitSessionRefresh>,
      Parameters<AdmitSessionRefresh>
    >();
    const control: IdentitySessionRefreshCredentialAbuseControl = {
      admitSessionRefresh,
    };
    const admission: IdentitySessionRefreshCredentialAbuseAdmission = Object.freeze({
      network: createIdentityCredentialAbuseNetworkFromAddressBytes(
        'ipv4',
        Uint8Array.of(203, 0, 113, 29),
      ),
      presentedRefreshCredential: parseIdentityRefreshCredentialWireValue(REFRESH_WIRE_VALUE),
    });

    admitSessionRefresh.mockResolvedValue(decision);

    await expect(control.admitSessionRefresh(admission)).resolves.toBe(decision);
    expect(admitSessionRefresh).toHaveBeenCalledTimes(1);
    expect(admitSessionRefresh).toHaveBeenCalledWith(admission);
    expect(admitSessionRefresh.mock.contexts[0]).toBe(control);
    expect(Reflect.ownKeys(admission)).toEqual(['network', 'presentedRefreshCredential']);
    expect(Object.isFrozen(admission)).toBe(true);
  });

  it('creates fresh fixed cause-free unavailable and internal errors', (): void => {
    const firstUnavailable = new IdentityCredentialAbuseControlUnavailableError();
    const secondUnavailable = new IdentityCredentialAbuseControlUnavailableError();
    const firstInternal = new IdentityCredentialAbuseControlError();
    const secondInternal = expectInternalFailure(() =>
      authenticateIdentityCredentialAbuseDecision({ kind: 'allowed' }),
    );

    expectFixedCauseFreeError(
      firstUnavailable,
      IdentityCredentialAbuseControlUnavailableError,
      'IdentityCredentialAbuseControlUnavailableError',
      UNAVAILABLE_ERROR_MESSAGE,
    );
    expectFixedCauseFreeError(
      secondUnavailable,
      IdentityCredentialAbuseControlUnavailableError,
      'IdentityCredentialAbuseControlUnavailableError',
      UNAVAILABLE_ERROR_MESSAGE,
    );
    expectFixedCauseFreeError(
      firstInternal,
      IdentityCredentialAbuseControlError,
      'IdentityCredentialAbuseControlError',
      INTERNAL_ERROR_MESSAGE,
    );
    expect(firstUnavailable).not.toBe(secondUnavailable);
    expect(firstInternal).not.toBe(secondInternal);
  });

  it('does not expose the abuse-control authority from the package root', (): void => {
    for (const internalName of [
      'IdentitySessionRefreshCredentialAbuseControl',
      'IdentitySessionRefreshCredentialAbuseAdmission',
      'IdentityCredentialAbuseDecision',
      'IdentityCredentialAbuseRetryAfterSeconds',
      'createIdentityCredentialAbuseAllowedDecision',
      'createIdentityCredentialAbuseDeniedDecision',
      'authenticateIdentityCredentialAbuseDecision',
      'IdentityCredentialAbuseControlUnavailableError',
      'IdentityCredentialAbuseControlError',
    ]) {
      expect(identityPublicSurface).not.toHaveProperty(internalName);
    }
  });
});

export type _LeakedIdentitySessionRefreshCredentialAbuseControl =
  LeakedIdentitySessionRefreshCredentialAbuseControl;
export type _LeakedIdentityCredentialAbuseDecision = LeakedIdentityCredentialAbuseDecision;
export type _LeakedIdentityCredentialAbuseControlUnavailableError =
  LeakedIdentityCredentialAbuseControlUnavailableError;
