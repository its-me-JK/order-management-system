import { createRequire } from 'node:module';

import type { IdentityAccessCredentialId } from '../../src/domain/identity-access-credential.values';
import { parseIdentityAccessCredentialId } from '../../src/domain/identity-access-credential.values';
import type { IdentityRefreshCredentialId } from '../../src/domain/identity-refresh-credential.values';
import { parseIdentityRefreshCredentialId } from '../../src/domain/identity-refresh-credential.values';
import {
  IdentitySessionRefreshIdentifierIssuanceUnavailableError,
  type IdentitySessionRefreshIdentifiers,
} from '../../src/application/identity-session-refresh-identifiers';
import type { IdentitySecurityEventId } from '../../src/application/identity-security-event.values';
import { parseIdentitySecurityEventId } from '../../src/application/identity-security-event.values';
import {
  createNodeIdentitySessionRefreshIdentifierIssuer,
  createNodeIdentitySessionRefreshIdentifierIssuerWithPrimitives,
  type NodeIdentitySessionRefreshIdentifierPrimitives,
} from '../../src/infrastructure/identifiers/node-identity-session-refresh-identifier-issuer';
import type {
  // @ts-expect-error The deterministic primitive seam is not part of the identifiers subpath.
  createNodeIdentitySessionRefreshIdentifierIssuerWithPrimitives as LeakedSubpathDeterministicFactory,
  // @ts-expect-error The primitive-provider contract is not part of the identifiers subpath.
  NodeIdentitySessionRefreshIdentifierPrimitives as LeakedSubpathPrimitives,
  // @ts-expect-error The application identifier port remains package-internal.
  IdentitySessionRefreshIdentifierIssuer as LeakedSubpathIdentifierIssuer,
  // @ts-expect-error The application identifier bundle remains package-internal.
  IdentitySessionRefreshIdentifiers as LeakedSubpathIdentifiers,
  // @ts-expect-error The application issuance failure remains package-internal.
  IdentitySessionRefreshIdentifierIssuanceUnavailableError as LeakedSubpathUnavailableError,
} from '../../src/infrastructure/identifiers';
import * as identityIdentifierPublicApi from '../../src/infrastructure/identifiers';
import type {
  // @ts-expect-error The production factory belongs only to its infrastructure subpath.
  createNodeIdentitySessionRefreshIdentifierIssuer as LeakedRootProductionFactory,
  // @ts-expect-error The deterministic primitive seam is not part of the package root.
  createNodeIdentitySessionRefreshIdentifierIssuerWithPrimitives as LeakedRootDeterministicFactory,
  // @ts-expect-error The primitive-provider contract is not part of the package root.
  NodeIdentitySessionRefreshIdentifierPrimitives as LeakedRootPrimitives,
  // @ts-expect-error The application identifier port remains package-internal.
  IdentitySessionRefreshIdentifierIssuer as LeakedRootIdentifierIssuer,
  // @ts-expect-error The application identifier bundle remains package-internal.
  IdentitySessionRefreshIdentifiers as LeakedRootIdentifiers,
  // @ts-expect-error The application issuance failure remains package-internal.
  IdentitySessionRefreshIdentifierIssuanceUnavailableError as LeakedRootUnavailableError,
} from '../../src';
import * as identityPublicApi from '../../src';

const SUCCESSOR_REFRESH_CREDENTIAL_ID = '01890f3a-8bcd-7def-8abc-000000000101';
const ISSUED_ACCESS_CREDENTIAL_ID = '01890f3a-8bcd-7def-9abc-000000000102';
const SECURITY_EVENT_ID = '01890f3a-8bcd-7def-aabc-000000000103';
const SHARED_NAMESPACE_ID = '01890f3a-8bcd-7def-babc-000000000104';
const UNAVAILABLE_NAME = 'IdentitySessionRefreshIdentifierIssuanceUnavailableError';
const UNAVAILABLE_MESSAGE =
  'Identity session refresh identifier issuance is temporarily unavailable';
const IDENTIFIER_KEYS = Object.freeze([
  'successorRefreshCredentialId',
  'issuedAccessCredentialId',
  'securityEventId',
] as const);
const requireFromTest = createRequire(__filename);

type RandomUuidV7Primitive = NodeIdentitySessionRefreshIdentifierPrimitives['randomUUIDv7'];

function primitives(
  randomUUIDv7: RandomUuidV7Primitive,
): NodeIdentitySessionRefreshIdentifierPrimitives {
  return { randomUUIDv7 };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function captureSynchronousError(operation: () => unknown): Error {
  try {
    operation();
  } catch (error: unknown) {
    if (error instanceof Error) {
      return error;
    }
  }

  throw new Error('Expected the operation to throw an Error synchronously');
}

function expectUnavailable(
  operation: () => unknown,
  rejectedValues: readonly string[] = [],
): Error {
  const error = captureSynchronousError(operation);

  expect(Object.getPrototypeOf(error)).toBe(
    IdentitySessionRefreshIdentifierIssuanceUnavailableError.prototype,
  );
  expect(error).toBeInstanceOf(IdentitySessionRefreshIdentifierIssuanceUnavailableError);
  expect(error).toMatchObject({ name: UNAVAILABLE_NAME, message: UNAVAILABLE_MESSAGE });
  expect(error).not.toHaveProperty('cause');

  for (const rejectedValue of rejectedValues) {
    expect(String(error)).not.toContain(rejectedValue);
    expect(JSON.stringify(error)).not.toContain(rejectedValue);
    expect(error.stack ?? '').not.toContain(rejectedValue);
  }

  return error;
}

function expectExactFrozenIdentifiers(
  identifiers: IdentitySessionRefreshIdentifiers,
  expected: Readonly<{
    successorRefreshCredentialId: string;
    issuedAccessCredentialId: string;
    securityEventId: string;
  }>,
): void {
  expect(Object.getPrototypeOf(identifiers)).toBe(Object.prototype);
  expect(Object.isFrozen(identifiers)).toBe(true);
  expect(Reflect.ownKeys(identifiers)).toEqual(IDENTIFIER_KEYS);
  expect(identifiers).toEqual(expected);

  for (const key of IDENTIFIER_KEYS) {
    expect(Object.getOwnPropertyDescriptor(identifiers, key)).toEqual({
      configurable: false,
      enumerable: true,
      value: expected[key],
      writable: false,
    });
  }
}

describe('Node Identity refresh identifier issuance', (): void => {
  it('uses the real pinned Node API to issue one exact frozen namespace bundle', (): void => {
    const issuer = createNodeIdentitySessionRefreshIdentifierIssuer();
    const identifiers = issuer.issueSessionRefreshIdentifiers();

    const successorRefreshCredentialId: IdentityRefreshCredentialId =
      identifiers.successorRefreshCredentialId;
    const issuedAccessCredentialId: IdentityAccessCredentialId =
      identifiers.issuedAccessCredentialId;
    const securityEventId: IdentitySecurityEventId = identifiers.securityEventId;

    // @ts-expect-error Refresh and access identifiers remain nominally separate.
    const _accessFromRefresh: IdentityAccessCredentialId = successorRefreshCredentialId;
    // @ts-expect-error Access and SecurityEvent identifiers remain nominally separate.
    const _eventFromAccess: IdentitySecurityEventId = issuedAccessCredentialId;
    // @ts-expect-error SecurityEvent and refresh identifiers remain nominally separate.
    const _refreshFromEvent: IdentityRefreshCredentialId = securityEventId;

    void [_accessFromRefresh, _eventFromAccess, _refreshFromEvent];

    expectExactFrozenIdentifiers(identifiers, {
      successorRefreshCredentialId,
      issuedAccessCredentialId,
      securityEventId,
    });
    expect(parseIdentityRefreshCredentialId(successorRefreshCredentialId)).toBe(
      successorRefreshCredentialId,
    );
    expect(parseIdentityAccessCredentialId(issuedAccessCredentialId)).toBe(
      issuedAccessCredentialId,
    );
    expect(parseIdentitySecurityEventId(securityEventId)).toBe(securityEventId);
  });

  it('performs exactly three ordered zero-argument calls with the captured provider receiver', (): void => {
    const values = [
      SUCCESSOR_REFRESH_CREDENTIAL_ID,
      ISSUED_ACCESS_CREDENTIAL_ID,
      SECURITY_EVENT_ID,
    ] as const;
    const trace: Readonly<{ call: number; argumentCount: number; receiver: unknown }>[] = [];
    let callIndex = 0;
    const mutablePrimitives: { randomUUIDv7: RandomUuidV7Primitive } = {
      randomUUIDv7(this: unknown, ...arguments_: unknown[]): unknown {
        callIndex += 1;
        trace.push(
          Object.freeze({
            call: callIndex,
            argumentCount: arguments_.length,
            receiver: this,
          }),
        );
        return values[callIndex - 1];
      },
    };
    const issuer =
      createNodeIdentitySessionRefreshIdentifierIssuerWithPrimitives(mutablePrimitives);
    const methodDescriptor = Object.getOwnPropertyDescriptor(
      issuer,
      'issueSessionRefreshIdentifiers',
    );
    const detachedMethod: unknown = methodDescriptor?.value;

    mutablePrimitives.randomUUIDv7 = (): never => {
      throw new Error('mutated-provider-method-secret');
    };

    if (typeof detachedMethod !== 'function') {
      throw new Error('Expected a detached identifier issuance function');
    }

    const identifiers: unknown = Reflect.apply(
      detachedMethod,
      Object.freeze({ foreign: true }),
      [],
    );

    expectExactFrozenIdentifiers(identifiers as IdentitySessionRefreshIdentifiers, {
      successorRefreshCredentialId: SUCCESSOR_REFRESH_CREDENTIAL_ID,
      issuedAccessCredentialId: ISSUED_ACCESS_CREDENTIAL_ID,
      securityEventId: SECURITY_EVENT_ID,
    });
    expect(trace.map(({ call, argumentCount }) => [call, argumentCount])).toEqual([
      [1, 0],
      [2, 0],
      [3, 0],
    ]);
    expect(trace.every(({ receiver }) => receiver === mutablePrimitives)).toBe(true);
    expect(Object.isFrozen(issuer)).toBe(true);
    expect(Reflect.ownKeys(issuer)).toEqual(['issueSessionRefreshIdentifiers']);
    expect(Object.isFrozen(detachedMethod)).toBe(true);
  });

  it('accepts identical UUID bytes across the three separately branded namespaces', (): void => {
    let calls = 0;
    const issuer = createNodeIdentitySessionRefreshIdentifierIssuerWithPrimitives(
      primitives(function (this: unknown): unknown {
        calls += 1;
        return SHARED_NAMESPACE_ID;
      }),
    );

    const identifiers = issuer.issueSessionRefreshIdentifiers();

    expect(calls).toBe(3);
    expectExactFrozenIdentifiers(identifiers, {
      successorRefreshCredentialId: SHARED_NAMESPACE_ID,
      issuedAccessCredentialId: SHARED_NAMESPACE_ID,
      securityEventId: SHARED_NAMESPACE_ID,
    });
  });
});

describe.each(['throw', 'malformed'] as const)(
  'Node Identity refresh identifier %s failures',
  (failureKind): void => {
    it.each([1, 2, 3] as const)(
      'stops at call %d and returns a fresh exact cause-free unavailable error',
      (failureAt): void => {
        const secret = `${failureKind}-identifier-provider-secret-${String(failureAt)}`;
        let attemptCall = 0;
        let trace: number[] = [];
        const provider = primitives(function (this: unknown): unknown {
          attemptCall += 1;
          trace.push(attemptCall);

          if (attemptCall === failureAt) {
            if (failureKind === 'throw') {
              throw new Error(secret);
            }

            return secret;
          }

          return [SUCCESSOR_REFRESH_CREDENTIAL_ID, ISSUED_ACCESS_CREDENTIAL_ID, SECURITY_EVENT_ID][
            attemptCall - 1
          ];
        });
        const issuer = createNodeIdentitySessionRefreshIdentifierIssuerWithPrimitives(provider);

        const firstError = expectUnavailable(
          (): unknown => issuer.issueSessionRefreshIdentifiers(),
          [secret],
        );

        expect(trace).toEqual(Array.from({ length: failureAt }, (_unused, index) => index + 1));

        attemptCall = 0;
        trace = [];

        const secondError = expectUnavailable(
          (): unknown => issuer.issueSessionRefreshIdentifiers(),
          [secret],
        );

        expect(trace).toEqual(Array.from({ length: failureAt }, (_unused, index) => index + 1));
        expect(secondError).not.toBe(firstError);
      },
    );
  },
);

describe('Node Identity refresh identifier provider boundary', (): void => {
  it.each([
    {
      name: 'UUIDv4',
      value: '01890f3a-8bcd-4def-8abc-000000000101',
    },
    {
      name: 'wrong UUID variant',
      value: '01890f3a-8bcd-7def-7abc-000000000101',
    },
    {
      name: 'uppercase UUIDv7',
      value: '01890F3A-8BCD-7DEF-8ABC-000000000101',
    },
    {
      name: 'surrounding whitespace',
      value: ` ${SUCCESSOR_REFRESH_CREDENTIAL_ID} `,
    },
    { name: 'non-string', value: 1 },
    {
      name: 'boxed string',
      value: Reflect.construct(String, [SUCCESSOR_REFRESH_CREDENTIAL_ID]),
    },
    {
      name: 'proxied value',
      value: new Proxy(Object.freeze({ value: SUCCESSOR_REFRESH_CREDENTIAL_ID }), {}),
    },
  ] as const)('rejects a $name result without a second provider call', ({ value }): void => {
    let calls = 0;
    const issuer = createNodeIdentitySessionRefreshIdentifierIssuerWithPrimitives(
      primitives(function (this: unknown): unknown {
        calls += 1;
        return value;
      }),
    );

    expectUnavailable((): unknown => issuer.issueSessionRefreshIdentifiers());
    expect(calls).toBe(1);
  });

  it.each([
    { name: 'undefined', value: undefined },
    { name: 'null', value: null },
    { name: 'boolean', value: true },
    { name: 'number', value: 1 },
    { name: 'string', value: 'invalid-primitive-contract' },
    { name: 'symbol', value: Symbol('invalid-primitive-contract') },
    { name: 'missing method', value: Object.freeze({}) },
    { name: 'undefined method', value: Object.freeze({ randomUUIDv7: undefined }) },
    { name: 'null method', value: Object.freeze({ randomUUIDv7: null }) },
    { name: 'non-callable method', value: Object.freeze({ randomUUIDv7: 1 }) },
  ] as const)('rejects the $name contract with the fixed error', ({ value }): void => {
    const firstError = expectUnavailable((): unknown =>
      createNodeIdentitySessionRefreshIdentifierIssuerWithPrimitives(value),
    );
    const secondError = expectUnavailable((): unknown =>
      createNodeIdentitySessionRefreshIdentifierIssuerWithPrimitives(value),
    );

    expect(secondError).not.toBe(firstError);
  });

  it('collapses throwing getters and hostile or revoked Proxy reflection without disclosure', (): void => {
    const secret = 'hostile-identifier-primitive-secret';
    let getterCalls = 0;
    let proxyGetCalls = 0;
    const throwingGetter = Object.defineProperty({}, 'randomUUIDv7', {
      enumerable: true,
      get(): never {
        getterCalls += 1;
        throw new Error(secret);
      },
    });
    const hostileProxy = new Proxy(
      {},
      {
        get(): never {
          proxyGetCalls += 1;
          throw new Error(secret);
        },
      },
    );
    const revoked = Proxy.revocable(
      {
        randomUUIDv7(): string {
          return SUCCESSOR_REFRESH_CREDENTIAL_ID;
        },
      },
      {},
    );
    revoked.revoke();

    expectUnavailable(
      (): unknown => createNodeIdentitySessionRefreshIdentifierIssuerWithPrimitives(throwingGetter),
      [secret],
    );
    expectUnavailable(
      (): unknown => createNodeIdentitySessionRefreshIdentifierIssuerWithPrimitives(hostileProxy),
      [secret],
    );
    expectUnavailable(
      (): unknown => createNodeIdentitySessionRefreshIdentifierIssuerWithPrimitives(revoked.proxy),
      [secret],
    );

    expect(getterCalls).toBe(1);
    expect(proxyGetCalls).toBe(1);
  });

  it('collapses a hostile callable Proxy at invocation and stops immediately', (): void => {
    const secret = 'hostile-identifier-call-secret';
    let applyCalls = 0;
    const hostileCallable = new Proxy(
      function randomUuidV7(this: unknown): string {
        return SUCCESSOR_REFRESH_CREDENTIAL_ID;
      },
      {
        apply(): never {
          applyCalls += 1;
          throw new Error(secret);
        },
      },
    );
    const issuer = createNodeIdentitySessionRefreshIdentifierIssuerWithPrimitives(
      primitives(hostileCallable),
    );

    expectUnavailable((): unknown => issuer.issueSessionRefreshIdentifiers(), [secret]);
    expect(applyCalls).toBe(1);
  });
});

describe('Node Identity refresh identifier export and runtime isolation', (): void => {
  it('exports only the production factory from the narrow identifiers subpath', (): void => {
    const packageManifest: unknown = requireFromTest('../../package.json');

    if (!isRecord(packageManifest) || !isRecord(packageManifest['exports'])) {
      throw new Error('Identity package exports are not represented by an object');
    }

    const packageExports = packageManifest['exports'];

    expect(Object.keys(identityIdentifierPublicApi)).toEqual([
      'createNodeIdentitySessionRefreshIdentifierIssuer',
    ]);
    expect(identityIdentifierPublicApi.createNodeIdentitySessionRefreshIdentifierIssuer).toBe(
      createNodeIdentitySessionRefreshIdentifierIssuer,
    );
    expect(identityIdentifierPublicApi).not.toHaveProperty(
      'createNodeIdentitySessionRefreshIdentifierIssuerWithPrimitives',
    );
    expect(identityIdentifierPublicApi).not.toHaveProperty(
      'NodeIdentitySessionRefreshIdentifierPrimitives',
    );
    expect(identityIdentifierPublicApi).not.toHaveProperty(
      'IdentitySessionRefreshIdentifierIssuer',
    );
    expect(identityIdentifierPublicApi).not.toHaveProperty('IdentitySessionRefreshIdentifiers');
    expect(identityIdentifierPublicApi).not.toHaveProperty(
      'IdentitySessionRefreshIdentifierIssuanceUnavailableError',
    );
    expect(identityPublicApi).not.toHaveProperty(
      'createNodeIdentitySessionRefreshIdentifierIssuer',
    );
    expect(identityPublicApi).not.toHaveProperty(
      'createNodeIdentitySessionRefreshIdentifierIssuerWithPrimitives',
    );
    expect(identityPublicApi).not.toHaveProperty(
      'IdentitySessionRefreshIdentifierIssuanceUnavailableError',
    );
    expect(Reflect.ownKeys(packageExports)).toEqual([
      '.',
      './infrastructure/prisma',
      './infrastructure/cryptography',
      './infrastructure/identifiers',
      './infrastructure/redis',
    ]);
    expect(packageExports['./infrastructure/identifiers']).toEqual({
      types: './src/infrastructure/identifiers/index.ts',
      default: './dist/infrastructure/identifiers/index.js',
    });
    expect(packageExports).not.toHaveProperty(
      './infrastructure/identifiers/node-identity-session-refresh-identifier-issuer',
    );
  });

  it('retains the module-evaluation snapshot of the real Node randomUUIDv7 function', (): void => {
    const nodeCryptoModule: unknown = requireFromTest('node:crypto');

    if (!isRecord(nodeCryptoModule)) {
      throw new Error('Expected node:crypto to expose a CommonJS module object');
    }

    const descriptor = Object.getOwnPropertyDescriptor(nodeCryptoModule, 'randomUUIDv7');

    if (descriptor?.configurable !== true || typeof descriptor.value !== 'function') {
      throw new Error('Expected a mutable randomUUIDv7 export in the pinned Node runtime');
    }

    let replacementCalls = 0;

    try {
      Object.defineProperty(nodeCryptoModule, 'randomUUIDv7', {
        ...descriptor,
        value(): never {
          replacementCalls += 1;
          throw new Error('mutated-node-randomUUIDv7-secret');
        },
      });

      const identifiers =
        createNodeIdentitySessionRefreshIdentifierIssuer().issueSessionRefreshIdentifiers();

      expect(parseIdentityRefreshCredentialId(identifiers.successorRefreshCredentialId)).toBe(
        identifiers.successorRefreshCredentialId,
      );
      expect(parseIdentityAccessCredentialId(identifiers.issuedAccessCredentialId)).toBe(
        identifiers.issuedAccessCredentialId,
      );
      expect(parseIdentitySecurityEventId(identifiers.securityEventId)).toBe(
        identifiers.securityEventId,
      );
      expect(replacementCalls).toBe(0);
    } finally {
      Object.defineProperty(nodeCryptoModule, 'randomUUIDv7', descriptor);
    }
  });
});

export type _LeakedSubpathDeterministicFactory = LeakedSubpathDeterministicFactory;
export type _LeakedSubpathPrimitives = LeakedSubpathPrimitives;
export type _LeakedSubpathIdentifierIssuer = LeakedSubpathIdentifierIssuer;
export type _LeakedSubpathIdentifiers = LeakedSubpathIdentifiers;
export type _LeakedSubpathUnavailableError = LeakedSubpathUnavailableError;
export type _LeakedRootProductionFactory = LeakedRootProductionFactory;
export type _LeakedRootDeterministicFactory = LeakedRootDeterministicFactory;
export type _LeakedRootPrimitives = LeakedRootPrimitives;
export type _LeakedRootIdentifierIssuer = LeakedRootIdentifierIssuer;
export type _LeakedRootIdentifiers = LeakedRootIdentifiers;
export type _LeakedRootUnavailableError = LeakedRootUnavailableError;
