import { IdentityAccessAuthorityUnavailableError } from './identity-access-authority.errors';
import type { IdentityAccessAuthorityReader } from './identity-access-authority.reader';
import {
  authenticateIdentityAuthenticatedPrincipal,
  type IdentityAuthenticatedPrincipal,
} from './identity-authenticated-principal';
import {
  IdentityBearerResolutionError,
  IdentityBearerResolutionUnavailableError,
} from './identity-bearer-resolution.errors';
import type { IdentitySessionCredentialCrypto } from './identity-session-credential-crypto';
import {
  authenticateIdentityAccessCredentialDigest,
  type IdentityAccessCredentialDigest,
} from './identity-session-credential-digest.values';
import {
  IdentitySessionCredentialCryptoUnavailableError,
  InvalidIdentityAccessCredentialWireValueError,
} from './identity-session-credential.errors';
import {
  parseIdentityAccessCredentialWireValue,
  type IdentityAccessCredentialWireValue,
} from './identity-session-credential-wire.values';

export type IdentityBearerPrincipalResolved = Readonly<{
  kind: 'resolved';
  principal: IdentityAuthenticatedPrincipal;
}>;

export type IdentityBearerPrincipalRejected = Readonly<{
  kind: 'rejected';
}>;

export type IdentityBearerPrincipalResolution =
  IdentityBearerPrincipalRejected | IdentityBearerPrincipalResolved;

type IdentityAccessCredentialDigester = Pick<
  IdentitySessionCredentialCrypto,
  'digestAccessCredential'
>;
type DigestAccessCredential = IdentityAccessCredentialDigester['digestAccessCredential'];
type ResolveByAccessCredentialDigest =
  IdentityAccessAuthorityReader['resolveByAccessCredentialDigest'];
type UnknownDependencyMethod = (...arguments_: never[]) => unknown;
type ResolverDependencies = Readonly<{
  credentialDigester: IdentityAccessCredentialDigester;
  digestAccessCredential: DigestAccessCredential;
  authorityReader: IdentityAccessAuthorityReader;
  resolveByAccessCredentialDigest: ResolveByAccessCredentialDigest;
}>;

const IDENTITY_BEARER_PRINCIPAL_REJECTED: IdentityBearerPrincipalRejected = Object.freeze({
  kind: 'rejected',
});
const REJECTED_AUTHORITY_RESULT_KEYS = Object.freeze(['kind'] as const);
const RESOLVED_AUTHORITY_RESULT_KEYS = Object.freeze(['kind', 'principal'] as const);
const objectPrototype = Object.prototype;
const capturedFreeze = Object.freeze;
const capturedGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const capturedGetPrototypeOf = Object.getPrototypeOf;
const capturedIsArray = Array.isArray;
const capturedIsFrozen = Object.isFrozen;
const capturedOwnKeys = Reflect.ownKeys;
const capturedReflectApply = Reflect.apply;
const capturedReflectGet = Reflect.get;
const invalidWireValueErrorPrototype = InvalidIdentityAccessCredentialWireValueError.prototype;
const cryptoUnavailableErrorPrototype = IdentitySessionCredentialCryptoUnavailableError.prototype;
const authorityUnavailableErrorPrototype = IdentityAccessAuthorityUnavailableError.prototype;
const resolverDependencies = new WeakMap<object, ResolverDependencies>();

function resolutionFailed(): never {
  throw new IdentityBearerResolutionError();
}

function resolutionUnavailable(): never {
  throw new IdentityBearerResolutionUnavailableError();
}

function hasExactPrototype(value: unknown, expectedPrototype: object): boolean {
  try {
    return (
      (typeof value === 'object' || typeof value === 'function') &&
      value !== null &&
      capturedGetPrototypeOf(value) === expectedPrototype
    );
  } catch {
    return false;
  }
}

function isDependencyReceiver(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !capturedIsArray(value);
}

function readDependencyMethod(value: unknown, methodName: string): UnknownDependencyMethod {
  if (!isDependencyReceiver(value)) {
    resolutionFailed();
  }

  const method: unknown = capturedReflectGet(value, methodName);

  if (typeof method !== 'function') {
    resolutionFailed();
  }

  return method as UnknownDependencyMethod;
}

function invoke<TArguments extends readonly unknown[], TResult>(
  operation: (...arguments_: TArguments) => TResult,
  receiver: object,
  arguments_: TArguments,
): TResult {
  return capturedReflectApply(operation, receiver, arguments_);
}

function isExactFrozenAuthorityRecord(
  value: unknown,
  expectedKeys: readonly string[],
): value is Readonly<Record<string, unknown>> {
  if (
    typeof value !== 'object' ||
    value === null ||
    capturedIsArray(value) ||
    capturedGetPrototypeOf(value) !== objectPrototype ||
    !capturedIsFrozen(value)
  ) {
    return false;
  }

  const keys = capturedOwnKeys(value);

  return (
    keys.length === expectedKeys.length &&
    keys.every(
      (key) => typeof key === 'string' && expectedKeys.some((expectedKey) => expectedKey === key),
    )
  );
}

function readFrozenDataProperty(
  value: Readonly<Record<string, unknown>>,
  property: 'kind' | 'principal',
): unknown {
  const descriptor = capturedGetOwnPropertyDescriptor(value, property);

  if (
    descriptor === undefined ||
    !('value' in descriptor) ||
    descriptor.configurable !== false ||
    descriptor.enumerable !== true ||
    descriptor.writable !== false
  ) {
    resolutionFailed();
  }

  return (descriptor as Readonly<{ value: unknown }>).value;
}

function mapAuthorityResult(value: unknown): IdentityBearerPrincipalResolution {
  try {
    if (
      isExactFrozenAuthorityRecord(value, REJECTED_AUTHORITY_RESULT_KEYS) &&
      readFrozenDataProperty(value, 'kind') === 'rejected'
    ) {
      return IDENTITY_BEARER_PRINCIPAL_REJECTED;
    }

    if (!isExactFrozenAuthorityRecord(value, RESOLVED_AUTHORITY_RESULT_KEYS)) {
      resolutionFailed();
    }

    if (readFrozenDataProperty(value, 'kind') !== 'resolved') {
      resolutionFailed();
    }

    const principal = authenticateIdentityAuthenticatedPrincipal(
      readFrozenDataProperty(value, 'principal'),
    );

    return capturedFreeze({
      kind: 'resolved' as const,
      principal,
    });
  } catch {
    resolutionFailed();
  }
}

function translateCryptoFailure(error: unknown): never {
  if (hasExactPrototype(error, cryptoUnavailableErrorPrototype)) {
    resolutionUnavailable();
  }

  resolutionFailed();
}

function translateAuthorityFailure(error: unknown): never {
  if (hasExactPrototype(error, authorityUnavailableErrorPrototype)) {
    resolutionUnavailable();
  }

  resolutionFailed();
}

async function digestCanonicalAccessCredential(
  dependencies: ResolverDependencies,
  wireValue: IdentityAccessCredentialWireValue,
): Promise<IdentityAccessCredentialDigest> {
  let digestValue: unknown;

  try {
    digestValue = await invoke(
      dependencies.digestAccessCredential,
      dependencies.credentialDigester,
      [wireValue],
    );
  } catch (error: unknown) {
    translateCryptoFailure(error);
  }

  try {
    return authenticateIdentityAccessCredentialDigest(digestValue);
  } catch {
    resolutionFailed();
  }
}

async function resolveDigestedAccessCredential(
  dependencies: ResolverDependencies,
  digestPromise: Promise<IdentityAccessCredentialDigest>,
): Promise<IdentityBearerPrincipalResolution> {
  const accessCredentialDigest = await digestPromise;

  let authorityResult: unknown;

  try {
    authorityResult = await invoke(
      dependencies.resolveByAccessCredentialDigest,
      dependencies.authorityReader,
      [accessCredentialDigest],
    );
  } catch (error: unknown) {
    translateAuthorityFailure(error);
  }

  return mapAuthorityResult(authorityResult);
}

/**
 * Resolves one already-extracted opaque access credential against current Identity authority.
 * HTTP Authorization parsing and request association remain delivery concerns.
 */
export class ResolveIdentityBearerPrincipal {
  public constructor(
    credentialDigester: IdentityAccessCredentialDigester,
    authorityReader: IdentityAccessAuthorityReader,
  ) {
    try {
      const digestAccessCredential = readDependencyMethod(
        credentialDigester,
        'digestAccessCredential',
      ) as DigestAccessCredential;
      const resolveByAccessCredentialDigest = readDependencyMethod(
        authorityReader,
        'resolveByAccessCredentialDigest',
      ) as ResolveByAccessCredentialDigest;

      resolverDependencies.set(
        this,
        capturedFreeze({
          credentialDigester,
          digestAccessCredential,
          authorityReader,
          resolveByAccessCredentialDigest,
        }),
      );
      capturedFreeze(this);
    } catch {
      resolutionFailed();
    }
  }

  public execute(bearerValue: unknown): Promise<IdentityBearerPrincipalResolution> {
    const dependencies = resolverDependencies.get(this);

    if (dependencies === undefined) {
      return Promise.reject(new IdentityBearerResolutionError());
    }

    if (typeof bearerValue !== 'string') {
      return Promise.resolve(IDENTITY_BEARER_PRINCIPAL_REJECTED);
    }

    let wireValue: IdentityAccessCredentialWireValue;

    try {
      wireValue = parseIdentityAccessCredentialWireValue(bearerValue);
    } catch (error: unknown) {
      if (hasExactPrototype(error, invalidWireValueErrorPrototype)) {
        return Promise.resolve(IDENTITY_BEARER_PRINCIPAL_REJECTED);
      }

      return Promise.reject(new IdentityBearerResolutionError());
    }

    const digestPromise = digestCanonicalAccessCredential(dependencies, wireValue);

    return resolveDigestedAccessCredential(dependencies, digestPromise);
  }
}
