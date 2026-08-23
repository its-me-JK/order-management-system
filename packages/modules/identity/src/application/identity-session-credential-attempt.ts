import type { IdentitySessionCredentialCandidates } from './identity-session-credential-candidates';
import type { IdentitySessionCredentialCrypto } from './identity-session-credential-crypto';
import {
  copyIdentityAccessCredentialDigestBytes,
  copyIdentityRefreshCredentialDigestBytes,
  IDENTITY_SESSION_CREDENTIAL_DIGEST_BYTE_LENGTH,
  type IdentityAccessCredentialDigest,
  type IdentityRefreshCredentialDigest,
} from './identity-session-credential-digest.values';
import {
  IdentitySessionCredentialCryptoUnavailableError,
  InvalidIdentitySessionCredentialCandidatesError,
} from './identity-session-credential.errors';
import {
  IDENTITY_ACCESS_CREDENTIAL_WIRE_PREFIX,
  IDENTITY_REFRESH_CREDENTIAL_WIRE_PREFIX,
  IDENTITY_SESSION_CREDENTIAL_PAYLOAD_LENGTH,
  serializeIdentityAccessCredentialWireValue,
  serializeIdentityRefreshCredentialWireValue,
  type IdentityAccessCredentialWireValue,
  type IdentityRefreshCredentialWireValue,
} from './identity-session-credential-wire.values';

const objectPrototype = Object.prototype;
const capturedFreeze = Object.freeze;
const capturedGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const capturedGetPrototypeOf = Object.getPrototypeOf;
const capturedHasOwn = Object.hasOwn;
const capturedIsFrozen = Object.isFrozen;
const capturedIsArray = Array.isArray;
const capturedOwnKeys = Reflect.ownKeys;
const capturedReflectApply = Reflect.apply;
// eslint-disable-next-line @typescript-eslint/unbound-method
const capturedWeakMapDelete = WeakMap.prototype.delete;
// eslint-disable-next-line @typescript-eslint/unbound-method
const capturedWeakMapGet = WeakMap.prototype.get;
const CANDIDATE_KEYS = capturedFreeze(['wireValue', 'digest'] as const);
const CANDIDATES_KEYS = capturedFreeze(['access', 'refresh'] as const);
const typedArrayPrototype = capturedGetPrototypeOf(Uint8Array.prototype) as object;
const ATTEMPT_CONSTRUCTION_CAPABILITY = capturedFreeze({});

type TypedArrayFill = (this: Uint8Array<ArrayBuffer>, value: number) => Uint8Array<ArrayBuffer>;

function descriptorValue(descriptor: PropertyDescriptor | undefined): unknown {
  return descriptor === undefined
    ? undefined
    : (descriptor as unknown as Readonly<Record<string, unknown>>)['value'];
}

const capturedTypedArrayFill = descriptorValue(
  capturedGetOwnPropertyDescriptor(typedArrayPrototype, 'fill'),
) as TypedArrayFill | undefined;

declare const identitySessionCredentialAttemptBrand: unique symbol;
declare const identitySessionCredentialAttemptDigestViewBrand: unique symbol;

export type IdentitySessionCredentialAttempt = IdentitySessionCredentialAttemptValue &
  Readonly<{
    [identitySessionCredentialAttemptBrand]: true;
  }>;

export type IdentitySessionCredentialAttemptDigestView = Readonly<{
  accessCredentialDigest: IdentityAccessCredentialDigest;
  refreshCredentialDigest: IdentityRefreshCredentialDigest;
  [identitySessionCredentialAttemptDigestViewBrand]: true;
}>;

type AttemptStatus = 'unclaimed' | 'claimed' | 'committed' | 'retired';

interface AttemptState {
  status: AttemptStatus;
  owner: object | undefined;
  digestView: IdentitySessionCredentialAttemptDigestView | undefined;
  candidates: IdentitySessionCredentialCandidates | undefined;
  accessCredentialDigest: IdentityAccessCredentialDigest | undefined;
  refreshCredentialDigest: IdentityRefreshCredentialDigest | undefined;
}

type CapturedCandidates = Readonly<{
  candidates: IdentitySessionCredentialCandidates;
  accessWireValue: IdentityAccessCredentialWireValue;
  accessCredentialDigest: IdentityAccessCredentialDigest;
  refreshWireValue: IdentityRefreshCredentialWireValue;
  refreshCredentialDigest: IdentityRefreshCredentialDigest;
  accessDigestBytes: Uint8Array<ArrayBuffer>;
  refreshDigestBytes: Uint8Array<ArrayBuffer>;
}>;

type CapturedCrypto = Readonly<{
  receiver: object;
  digestAccessCredential: IdentitySessionCredentialCrypto['digestAccessCredential'];
  digestRefreshCredential: IdentitySessionCredentialCrypto['digestRefreshCredential'];
}>;

type VerificationOutcome = 'matched' | 'mismatched' | 'unavailable';

type DigestViewRegistration = Readonly<{
  attempt: object;
  owner: object;
}>;

const attemptStates = new WeakMap<object, AttemptState>();
const digestViewRegistrations = new WeakMap<object, DigestViewRegistration>();

function invalidCandidates(): never {
  throw new InvalidIdentitySessionCredentialCandidatesError();
}

function cryptoUnavailable(): never {
  throw new IdentitySessionCredentialCryptoUnavailableError();
}

function isObject(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function readExactFrozenRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== 'object' ||
    value === null ||
    capturedIsArray(value) ||
    capturedGetPrototypeOf(value) !== objectPrototype ||
    !capturedIsFrozen(value)
  ) {
    invalidCandidates();
  }

  const keys = capturedOwnKeys(value);

  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => typeof key !== 'string' || key !== expectedKeys[index])
  ) {
    invalidCandidates();
  }

  const result: Record<string, unknown> = {};

  for (const key of expectedKeys) {
    const descriptor = capturedGetOwnPropertyDescriptor(value, key);

    if (
      descriptor === undefined ||
      !capturedHasOwn(descriptor, 'value') ||
      descriptor.enumerable !== true ||
      descriptor.configurable !== false ||
      descriptor.writable !== false
    ) {
      invalidCandidates();
    }

    result[key] = descriptor.value;
  }

  return result;
}

function assertAuthenticFrozenWrapper(value: unknown): asserts value is object {
  if (!isObject(value) || !capturedIsFrozen(value) || capturedOwnKeys(value).length !== 0) {
    invalidCandidates();
  }
}

function payloadsAreEqual(accessWireValue: string, refreshWireValue: string): boolean {
  let difference = 0;

  for (let index = 0; index < IDENTITY_SESSION_CREDENTIAL_PAYLOAD_LENGTH; index += 1) {
    difference |=
      accessWireValue.charCodeAt(IDENTITY_ACCESS_CREDENTIAL_WIRE_PREFIX.length + index) ^
      refreshWireValue.charCodeAt(IDENTITY_REFRESH_CREDENTIAL_WIRE_PREFIX.length + index);
  }

  return difference === 0;
}

function digestBytesAreEqual(
  left: Uint8Array<ArrayBuffer>,
  right: Uint8Array<ArrayBuffer>,
): boolean {
  if (
    left.byteLength !== IDENTITY_SESSION_CREDENTIAL_DIGEST_BYTE_LENGTH ||
    right.byteLength !== IDENTITY_SESSION_CREDENTIAL_DIGEST_BYTE_LENGTH
  ) {
    return false;
  }

  let difference = 0;

  for (let index = 0; index < IDENTITY_SESSION_CREDENTIAL_DIGEST_BYTE_LENGTH; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }

  return difference === 0;
}

function overwriteDigestByteCopies(copies: readonly Uint8Array<ArrayBuffer>[]): boolean {
  let succeeded = true;

  for (const copy of copies) {
    try {
      if (typeof capturedTypedArrayFill === 'function') {
        capturedReflectApply(capturedTypedArrayFill, copy, [0]);
      } else {
        for (let index = 0; index < copy.byteLength; index += 1) {
          copy[index] = 0;
        }
      }

      for (let index = 0; index < copy.byteLength; index += 1) {
        if (copy[index] !== 0) {
          succeeded = false;
        }
      }
    } catch {
      succeeded = false;

      try {
        for (let index = 0; index < copy.byteLength; index += 1) {
          copy[index] = 0;
        }
      } catch {
        // The caller converts incomplete cleanup to the fixed unavailable error.
      }
    }
  }

  return succeeded;
}

function captureCandidates(
  value: unknown,
  registeredCopies: Uint8Array<ArrayBuffer>[],
): CapturedCandidates {
  const candidates = readExactFrozenRecord(value, CANDIDATES_KEYS);
  const access = readExactFrozenRecord(candidates['access'], CANDIDATE_KEYS);
  const refresh = readExactFrozenRecord(candidates['refresh'], CANDIDATE_KEYS);
  const accessWireValue = access['wireValue'];
  const accessCredentialDigest = access['digest'];
  const refreshWireValue = refresh['wireValue'];
  const refreshCredentialDigest = refresh['digest'];

  assertAuthenticFrozenWrapper(accessWireValue);
  assertAuthenticFrozenWrapper(accessCredentialDigest);
  assertAuthenticFrozenWrapper(refreshWireValue);
  assertAuthenticFrozenWrapper(refreshCredentialDigest);

  const serializedAccessWireValue = serializeIdentityAccessCredentialWireValue(
    accessWireValue as IdentityAccessCredentialWireValue,
  );
  const accessDigestBytes = copyIdentityAccessCredentialDigestBytes(
    accessCredentialDigest as IdentityAccessCredentialDigest,
  );
  registeredCopies.push(accessDigestBytes);
  const serializedRefreshWireValue = serializeIdentityRefreshCredentialWireValue(
    refreshWireValue as IdentityRefreshCredentialWireValue,
  );
  const refreshDigestBytes = copyIdentityRefreshCredentialDigestBytes(
    refreshCredentialDigest as IdentityRefreshCredentialDigest,
  );
  registeredCopies.push(refreshDigestBytes);

  if (
    payloadsAreEqual(serializedAccessWireValue, serializedRefreshWireValue) ||
    digestBytesAreEqual(accessDigestBytes, refreshDigestBytes)
  ) {
    invalidCandidates();
  }

  return capturedFreeze({
    candidates: value as IdentitySessionCredentialCandidates,
    accessWireValue: accessWireValue as IdentityAccessCredentialWireValue,
    accessCredentialDigest: accessCredentialDigest as IdentityAccessCredentialDigest,
    refreshWireValue: refreshWireValue as IdentityRefreshCredentialWireValue,
    refreshCredentialDigest: refreshCredentialDigest as IdentityRefreshCredentialDigest,
    accessDigestBytes,
    refreshDigestBytes,
  });
}

function captureCrypto(value: unknown): CapturedCrypto {
  if (!isObject(value)) {
    cryptoUnavailable();
  }

  const generateSessionCredentialCandidates = (value as Readonly<Record<string, unknown>>)[
    'generateSessionCredentialCandidates'
  ];
  const digestAccessCredential = (value as Readonly<Record<string, unknown>>)[
    'digestAccessCredential'
  ];
  const digestRefreshCredential = (value as Readonly<Record<string, unknown>>)[
    'digestRefreshCredential'
  ];

  if (
    typeof generateSessionCredentialCandidates !== 'function' ||
    typeof digestAccessCredential !== 'function' ||
    typeof digestRefreshCredential !== 'function'
  ) {
    cryptoUnavailable();
  }

  return capturedFreeze({
    receiver: value,
    digestAccessCredential:
      digestAccessCredential as IdentitySessionCredentialCrypto['digestAccessCredential'],
    digestRefreshCredential:
      digestRefreshCredential as IdentitySessionCredentialCrypto['digestRefreshCredential'],
  });
}

async function verifyAccessDigest(
  crypto: CapturedCrypto,
  candidates: CapturedCandidates,
  registeredCopies: Uint8Array<ArrayBuffer>[],
): Promise<VerificationOutcome> {
  try {
    const verifiedDigest: unknown = await capturedReflectApply(
      crypto.digestAccessCredential,
      crypto.receiver,
      [candidates.accessWireValue],
    );
    const verifiedBytes = copyIdentityAccessCredentialDigestBytes(
      verifiedDigest as IdentityAccessCredentialDigest,
    );
    registeredCopies.push(verifiedBytes);

    return digestBytesAreEqual(candidates.accessDigestBytes, verifiedBytes)
      ? 'matched'
      : 'mismatched';
  } catch {
    return 'unavailable';
  }
}

async function verifyRefreshDigest(
  crypto: CapturedCrypto,
  candidates: CapturedCandidates,
  registeredCopies: Uint8Array<ArrayBuffer>[],
): Promise<VerificationOutcome> {
  try {
    const verifiedDigest: unknown = await capturedReflectApply(
      crypto.digestRefreshCredential,
      crypto.receiver,
      [candidates.refreshWireValue],
    );
    const verifiedBytes = copyIdentityRefreshCredentialDigestBytes(
      verifiedDigest as IdentityRefreshCredentialDigest,
    );
    registeredCopies.push(verifiedBytes);

    return digestBytesAreEqual(candidates.refreshDigestBytes, verifiedBytes)
      ? 'matched'
      : 'mismatched';
  } catch {
    return 'unavailable';
  }
}

function stateFor(value: unknown): AttemptState {
  const state = isObject(value) ? attemptStates.get(value) : undefined;

  if (state === undefined) {
    invalidCandidates();
  }

  return state;
}

function assertOwner(value: unknown): asserts value is object {
  if (!isObject(value)) {
    invalidCandidates();
  }
}

function releaseAttemptReferences(state: AttemptState): void {
  if (state.digestView !== undefined) {
    capturedReflectApply(capturedWeakMapDelete, digestViewRegistrations, [state.digestView]);
  }

  state.owner = undefined;
  state.digestView = undefined;
  state.candidates = undefined;
  state.accessCredentialDigest = undefined;
  state.refreshCredentialDigest = undefined;
}

class IdentitySessionCredentialAttemptValue {
  public constructor(capability: unknown, state: AttemptState) {
    if (
      new.target !== IdentitySessionCredentialAttemptValue ||
      capability !== ATTEMPT_CONSTRUCTION_CAPABILITY
    ) {
      invalidCandidates();
    }

    attemptStates.set(this, state);
    capturedFreeze(this);
  }

  public toString(): string {
    return '[IdentitySessionCredentialAttempt]';
  }
}

capturedFreeze(IdentitySessionCredentialAttemptValue.prototype);
capturedFreeze(IdentitySessionCredentialAttemptValue);

function createAttemptValue(state: AttemptState): IdentitySessionCredentialAttemptValue {
  return new IdentitySessionCredentialAttemptValue(ATTEMPT_CONSTRUCTION_CAPABILITY, state);
}

/**
 * Verifies and registers one exact access/refresh issuance attempt before a transaction begins.
 *
 * @internal Identity application orchestration is the only production caller.
 */
export async function createIdentitySessionCredentialAttempt(
  candidates: unknown,
  crypto: IdentitySessionCredentialCrypto,
): Promise<IdentitySessionCredentialAttempt> {
  const registeredCopies: Uint8Array<ArrayBuffer>[] = [];
  let capturedCandidates: CapturedCandidates | undefined;
  let capturedCrypto: CapturedCrypto | undefined;
  let candidatesInvalid = false;
  let providerUnavailable = false;
  let digestsMatch = false;
  let cleanupSucceeded: boolean;

  try {
    try {
      capturedCandidates = captureCandidates(candidates, registeredCopies);
    } catch {
      candidatesInvalid = true;
    }

    if (!candidatesInvalid && capturedCandidates !== undefined) {
      try {
        capturedCrypto = captureCrypto(crypto);
      } catch {
        providerUnavailable = true;
      }
    }

    if (
      !candidatesInvalid &&
      !providerUnavailable &&
      capturedCandidates !== undefined &&
      capturedCrypto !== undefined
    ) {
      const accessOutcome = await verifyAccessDigest(
        capturedCrypto,
        capturedCandidates,
        registeredCopies,
      );

      if (accessOutcome === 'unavailable') {
        providerUnavailable = true;
      } else {
        const refreshOutcome = await verifyRefreshDigest(
          capturedCrypto,
          capturedCandidates,
          registeredCopies,
        );

        if (refreshOutcome === 'unavailable') {
          providerUnavailable = true;
        } else {
          digestsMatch = accessOutcome === 'matched' && refreshOutcome === 'matched';
        }
      }
    }
  } finally {
    cleanupSucceeded = overwriteDigestByteCopies(registeredCopies);
  }

  if (!cleanupSucceeded || providerUnavailable) {
    cryptoUnavailable();
  }

  if (candidatesInvalid || !digestsMatch || capturedCandidates === undefined) {
    invalidCandidates();
  }

  try {
    return createAttemptValue({
      status: 'unclaimed',
      owner: undefined,
      digestView: undefined,
      candidates: capturedCandidates.candidates,
      accessCredentialDigest: capturedCandidates.accessCredentialDigest,
      refreshCredentialDigest: capturedCandidates.refreshCredentialDigest,
    }) as IdentitySessionCredentialAttempt;
  } catch {
    invalidCandidates();
  }
}

/**
 * Atomically claims an unused attempt for one owner and returns only its authenticated digests.
 *
 * @internal The refresh transaction writer is the only production caller.
 */
export function claimIdentitySessionCredentialAttempt(
  attempt: unknown,
  owner: object,
): IdentitySessionCredentialAttemptDigestView {
  assertOwner(owner);
  const state = stateFor(attempt);

  if (
    state.status !== 'unclaimed' ||
    state.accessCredentialDigest === undefined ||
    state.refreshCredentialDigest === undefined
  ) {
    invalidCandidates();
  }

  const view = capturedFreeze({
    accessCredentialDigest: state.accessCredentialDigest,
    refreshCredentialDigest: state.refreshCredentialDigest,
  }) as IdentitySessionCredentialAttemptDigestView;
  state.owner = owner;
  state.digestView = view;
  state.status = 'claimed';
  digestViewRegistrations.set(
    view,
    capturedFreeze({
      attempt: attempt as object,
      owner,
    }),
  );

  return view;
}

/**
 * Authenticates a digest view for its exact live claim and winning owner.
 *
 * @internal The refresh transaction writer is the only production caller.
 */
export function inspectIdentitySessionCredentialAttemptDigestView(
  view: unknown,
  owner: object,
): IdentitySessionCredentialAttemptDigestView {
  assertOwner(owner);
  const registration = isObject(view) ? digestViewRegistrations.get(view) : undefined;

  if (registration?.owner !== owner) {
    invalidCandidates();
  }

  const state = attemptStates.get(registration.attempt);

  if (state?.status !== 'claimed' || state.owner !== owner || state.digestView !== view) {
    invalidCandidates();
  }

  return view as IdentitySessionCredentialAttemptDigestView;
}

/** Retires a claimed attempt after a proven non-commit or an indeterminate outcome. */
export function retireIdentitySessionCredentialAttempt(attempt: unknown, owner: object): void {
  assertOwner(owner);
  stateFor(attempt);

  if (!settleIdentitySessionCredentialAttemptAfterRefreshRevocation(attempt, owner)) {
    invalidCandidates();
  }
}

/**
 * Confirms the exact claimed attempt after an acknowledged refresh commit.
 *
 * The transition is intentionally non-throwing because it runs after durable
 * settlement. It retains only the exact candidate-pair binding required by the
 * later delivery gate; digest-writer authority is invalidated immediately.
 *
 * @internal The refresh completion registry is the only production caller.
 */
export function settleIdentitySessionCredentialAttemptAfterRefreshCommit(
  attemptValue: unknown,
  currentOwnerValue: unknown,
  committedOwnerValue: unknown,
): boolean {
  if (
    !isObject(attemptValue) ||
    !isObject(currentOwnerValue) ||
    !isObject(committedOwnerValue) ||
    committedOwnerValue === currentOwnerValue
  ) {
    return false;
  }

  try {
    const state = capturedReflectApply(capturedWeakMapGet, attemptStates, [attemptValue]) as
      AttemptState | undefined;

    if (
      state?.status !== 'claimed' ||
      state.owner !== currentOwnerValue ||
      state.candidates === undefined
    ) {
      return false;
    }

    if (state.digestView !== undefined) {
      capturedReflectApply(capturedWeakMapDelete, digestViewRegistrations, [state.digestView]);
    }

    state.status = 'committed';
    state.owner = committedOwnerValue;
    state.digestView = undefined;
    state.accessCredentialDigest = undefined;
    state.refreshCredentialDigest = undefined;
    return true;
  } catch {
    return false;
  }
}

/**
 * Retires the exact claimed attempt for every non-delivery settlement.
 *
 * Invalid, foreign, or replayed values return `false` without observing or
 * changing a rightful claim.
 *
 * @internal The refresh workflow and completion registry are the only callers.
 */
export function settleIdentitySessionCredentialAttemptAfterRefreshRevocation(
  attemptValue: unknown,
  ownerValue: unknown,
): boolean {
  if (!isObject(attemptValue) || !isObject(ownerValue)) {
    return false;
  }

  try {
    const state = capturedReflectApply(capturedWeakMapGet, attemptStates, [attemptValue]) as
      AttemptState | undefined;

    if (state?.status !== 'claimed' || state.owner !== ownerValue) {
      return false;
    }

    releaseAttemptReferences(state);
    state.status = 'retired';
    return true;
  } catch {
    return false;
  }
}
