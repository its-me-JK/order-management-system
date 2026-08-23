import { createHash, createHmac, createSecretKey, type KeyObject } from 'node:crypto';
import { types as nodeUtilTypes } from 'node:util';

import type { RedisLuaScriptExecutor } from '@oms/redis/lua-script';

import {
  copyIdentityCredentialAbuseNetworkKeyBytes,
  type IdentityCredentialAbuseNetwork,
} from '../../application/identity-credential-abuse-network';
import {
  createIdentityCredentialAbuseAllowedDecision,
  createIdentityCredentialAbuseDeniedDecision,
  IdentityCredentialAbuseControlError,
  IdentityCredentialAbuseControlUnavailableError,
  type IdentityCredentialAbuseDecision,
  type IdentitySessionRefreshCredentialAbuseAdmission,
  type IdentitySessionRefreshCredentialAbuseControl,
} from '../../application/identity-session-refresh-credential-abuse-control';
import {
  serializeIdentityRefreshCredentialWireValue,
  type IdentityRefreshCredentialWireValue,
} from '../../application/identity-session-credential-wire.values';
import { REDIS_IDENTITY_SESSION_REFRESH_ABUSE_SCRIPT } from './redis-identity-session-refresh-abuse.lua-script';

const OPTIONS_KEYS = Object.freeze([
  'deploymentNamespace',
  'keyEpoch',
  'hmacSecret',
  'deployment',
  'network',
  'presentedCredential',
] as const);
const POLICY_KEYS = Object.freeze(['capacity', 'tokenIntervalMicroseconds'] as const);
const ADMISSION_KEYS = Object.freeze(['network', 'presentedRefreshCredential'] as const);
const HMAC_ALGORITHM = 'sha256';
const ASCII_ENCODING = 'ascii';
const BASE64URL_ENCODING = 'base64url';
const ALGORITHM_VERSION = 1;
const REFRESH_ROUTE = 1;
const DEPLOYMENT_DIMENSION = 1;
const NETWORK_DIMENSION = 2;
const CREDENTIAL_DIMENSION = 3;
const HMAC_SECRET_BYTES = 32;
const MIN_TOKEN_INTERVAL_MICROSECONDS = 1_000;
const MAX_TOKEN_INTERVAL_MICROSECONDS = 180_000_000;
const MAX_CAPACITY = 10_000;
const MAX_FULL_REFILL_MICROSECONDS = 3_600_000_000;
const KEY_CONTEXT = 'oms.identity.abuse-key';
const POLICY_CONTEXT = 'oms.identity.abuse-policy';
const NAMESPACE_CONTEXT = 'oms.identity.abuse-namespace';
const NAMESPACE_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?(?![\s\S])/u;
const KEY_EPOCH_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,30}[a-z0-9])?(?![\s\S])/u;
const CANONICAL_RETRY_PATTERN = /^(?:[1-9]|[1-9][0-9]|1[0-7][0-9]|180)(?![\s\S])/u;

const capturedArrayBuffer = ArrayBuffer;
// eslint-disable-next-line @typescript-eslint/unbound-method
const capturedBufferAllocUnsafe = Buffer.allocUnsafe;
// eslint-disable-next-line @typescript-eslint/unbound-method
const capturedBufferByteLength = Buffer.byteLength;
const capturedCreateHash = createHash;
const capturedCreateHmac = createHmac;
const capturedCreateSecretKey = createSecretKey;
const capturedFreeze = Object.freeze;
const capturedGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const capturedGetPrototypeOf = Object.getPrototypeOf;
const capturedIsArray = Array.isArray;
const capturedIsFrozen = Object.isFrozen;
const capturedIsInteger = Number.isInteger;
const capturedIsProxy = nodeUtilTypes.isProxy;
const capturedOwnKeys = Reflect.ownKeys;
const capturedReflectApply = Reflect.apply;
const capturedReflectGet = Reflect.get;
const capturedUint8Array = Uint8Array;
// eslint-disable-next-line @typescript-eslint/unbound-method
const capturedUint8ArraySet = Uint8Array.prototype.set;

const typedArrayPrototype = capturedGetPrototypeOf(Uint8Array.prototype) as object;
const typedArrayBufferDescriptor = capturedGetOwnPropertyDescriptor(typedArrayPrototype, 'buffer');
const typedArrayByteLengthDescriptor = capturedGetOwnPropertyDescriptor(
  typedArrayPrototype,
  'byteLength',
);
const typedArrayByteOffsetDescriptor = capturedGetOwnPropertyDescriptor(
  typedArrayPrototype,
  'byteOffset',
);
const typedArrayKindDescriptor = capturedGetOwnPropertyDescriptor(
  typedArrayPrototype,
  Symbol.toStringTag,
);
const arrayBufferByteLengthDescriptor = capturedGetOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  'byteLength',
);
const arrayBufferResizableDescriptor = capturedGetOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  'resizable',
);

type DescriptorGetter = (this: unknown) => unknown;

function descriptorGetter(
  descriptor: PropertyDescriptor | undefined,
): DescriptorGetter | undefined {
  if (descriptor === undefined) {
    return undefined;
  }

  const getter = (descriptor as unknown as Readonly<Record<string, unknown>>)['get'];

  return typeof getter === 'function' ? (getter as DescriptorGetter) : undefined;
}

const typedArrayBufferGetter = descriptorGetter(typedArrayBufferDescriptor);
const typedArrayByteLengthGetter = descriptorGetter(typedArrayByteLengthDescriptor);
const typedArrayByteOffsetGetter = descriptorGetter(typedArrayByteOffsetDescriptor);
const typedArrayKindGetter = descriptorGetter(typedArrayKindDescriptor);
const arrayBufferByteLengthGetter = descriptorGetter(arrayBufferByteLengthDescriptor);
const arrayBufferResizableGetter = descriptorGetter(arrayBufferResizableDescriptor);

type ExecutePrimitive = RedisLuaScriptExecutor['execute'];

export type RedisIdentityCredentialAbuseBucketPolicy = Readonly<{
  capacity: number;
  tokenIntervalMicroseconds: number;
}>;

export type RedisIdentitySessionRefreshCredentialAbuseControlOptions = Readonly<{
  deploymentNamespace: string;
  keyEpoch: string;
  hmacSecret: Uint8Array;
  deployment: RedisIdentityCredentialAbuseBucketPolicy;
  network: RedisIdentityCredentialAbuseBucketPolicy;
  presentedCredential: RedisIdentityCredentialAbuseBucketPolicy;
}>;

type CapturedPolicy = Readonly<{
  capacity: number;
  capacityText: string;
  intervalText: string;
  tokenIntervalMicroseconds: number;
}>;

type CapturedExecutor = Readonly<{
  execute: ExecutePrimitive;
  receiver: object;
}>;

type CapturedOptions = Readonly<{
  deploymentNamespace: string;
  keyEpoch: string;
  key: KeyObject;
  namespaceTag: string;
  deployment: CapturedPolicy;
  network: CapturedPolicy;
  presentedCredential: CapturedPolicy;
  policyFingerprint: string;
}>;

type HmacDimension = 1 | 2 | 3;

function controlFailed(): never {
  throw new IdentityCredentialAbuseControlError();
}

function unavailable(): never {
  throw new IdentityCredentialAbuseControlUnavailableError();
}

function isObject(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function readExactFrozenRecord(
  value: unknown,
  expectedKeys: readonly (string | symbol)[],
): Readonly<Record<PropertyKey, unknown>> {
  if (
    !isObject(value) ||
    capturedIsProxy(value) ||
    capturedGetPrototypeOf(value) !== Object.prototype ||
    !capturedIsFrozen(value)
  ) {
    controlFailed();
  }

  const ownKeys = capturedOwnKeys(value);

  if (
    ownKeys.length !== expectedKeys.length ||
    !expectedKeys.every((expectedKey): boolean => ownKeys.includes(expectedKey))
  ) {
    controlFailed();
  }

  const record: Record<PropertyKey, unknown> = {};

  for (const key of expectedKeys) {
    const descriptor = capturedGetOwnPropertyDescriptor(value, key);

    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      descriptor.configurable ||
      descriptor.writable
    ) {
      controlFailed();
    }

    record[key] = descriptor.value;
  }

  return record;
}

function capturePolicy(value: unknown): CapturedPolicy {
  const record = readExactFrozenRecord(value, POLICY_KEYS);
  const capacity = record['capacity'];
  const tokenIntervalMicroseconds = record['tokenIntervalMicroseconds'];

  if (
    !capturedIsInteger(capacity) ||
    (capacity as number) < 1 ||
    (capacity as number) > MAX_CAPACITY ||
    !capturedIsInteger(tokenIntervalMicroseconds) ||
    (tokenIntervalMicroseconds as number) < MIN_TOKEN_INTERVAL_MICROSECONDS ||
    (tokenIntervalMicroseconds as number) > MAX_TOKEN_INTERVAL_MICROSECONDS ||
    (capacity as number) * (tokenIntervalMicroseconds as number) > MAX_FULL_REFILL_MICROSECONDS
  ) {
    controlFailed();
  }

  return capturedFreeze({
    capacity: capacity as number,
    capacityText: String(capacity),
    intervalText: String(tokenIntervalMicroseconds),
    tokenIntervalMicroseconds: tokenIntervalMicroseconds as number,
  });
}

function copyHmacSecret(value: unknown): Uint8Array<ArrayBuffer> {
  if (
    !(value instanceof capturedUint8Array) ||
    capturedIsProxy(value) ||
    capturedGetPrototypeOf(value) !== Uint8Array.prototype ||
    typedArrayBufferGetter === undefined ||
    typedArrayByteLengthGetter === undefined ||
    typedArrayByteOffsetGetter === undefined ||
    typedArrayKindGetter === undefined ||
    arrayBufferByteLengthGetter === undefined ||
    arrayBufferResizableGetter === undefined
  ) {
    controlFailed();
  }

  const buffer = capturedReflectApply(typedArrayBufferGetter, value, []);
  const byteLength = capturedReflectApply(typedArrayByteLengthGetter, value, []);
  const byteOffset = capturedReflectApply(typedArrayByteOffsetGetter, value, []);
  const kind = capturedReflectApply(typedArrayKindGetter, value, []);

  if (
    !(buffer instanceof capturedArrayBuffer) ||
    capturedGetPrototypeOf(buffer) !== ArrayBuffer.prototype ||
    byteLength !== HMAC_SECRET_BYTES ||
    byteOffset !== 0 ||
    kind !== 'Uint8Array' ||
    capturedReflectApply(arrayBufferByteLengthGetter, buffer, []) !== HMAC_SECRET_BYTES ||
    capturedReflectApply(arrayBufferResizableGetter, buffer, []) !== false
  ) {
    controlFailed();
  }

  const copy: Uint8Array<ArrayBuffer> = new capturedUint8Array(HMAC_SECRET_BYTES);
  capturedReflectApply(capturedUint8ArraySet, copy, [value]);

  if (
    !(copy.buffer instanceof capturedArrayBuffer) ||
    copy.byteOffset !== 0 ||
    copy.byteLength !== HMAC_SECRET_BYTES ||
    capturedGetPrototypeOf(copy) !== Uint8Array.prototype ||
    capturedGetPrototypeOf(copy.buffer) !== ArrayBuffer.prototype ||
    (copy.buffer as ArrayBuffer & Readonly<{ resizable: boolean }>).resizable
  ) {
    copy.fill(0);
    controlFailed();
  }

  if (
    capturedReflectApply(typedArrayBufferGetter, value, []) !== buffer ||
    capturedReflectApply(typedArrayByteLengthGetter, value, []) !== HMAC_SECRET_BYTES ||
    capturedReflectApply(typedArrayByteOffsetGetter, value, []) !== 0 ||
    capturedReflectApply(typedArrayKindGetter, value, []) !== 'Uint8Array'
  ) {
    copy.fill(0);
    controlFailed();
  }

  for (let index = 0; index < HMAC_SECRET_BYTES; index += 1) {
    if (copy[index] !== value[index]) {
      copy.fill(0);
      controlFailed();
    }
  }

  return copy;
}

function updateLengthPrefixedAscii(
  target: ReturnType<typeof createHash> | ReturnType<typeof createHmac>,
  value: string,
): void {
  const byteLength = capturedBufferByteLength(value, ASCII_ENCODING);

  if (byteLength > 65_535) {
    controlFailed();
  }

  const header = capturedBufferAllocUnsafe(2);

  try {
    header.writeUInt16BE(byteLength, 0);
    target.update(header);
    target.update(value, ASCII_ENCODING);
  } finally {
    header.fill(0);
  }
}

function updateLengthPrefixedBytes(target: ReturnType<typeof createHmac>, value: Uint8Array): void {
  if (value.byteLength > 65_535) {
    controlFailed();
  }

  const header = capturedBufferAllocUnsafe(2);

  try {
    header.writeUInt16BE(value.byteLength, 0);
    target.update(header);
    target.update(value);
  } finally {
    header.fill(0);
  }
}

function updateProtocolHeader(
  target: ReturnType<typeof createHash> | ReturnType<typeof createHmac>,
  context: string,
  dimension: number,
): void {
  const header = capturedBufferAllocUnsafe(3);

  try {
    header[0] = ALGORITHM_VERSION;
    header[1] = REFRESH_ROUTE;
    header[2] = dimension;
    updateLengthPrefixedAscii(target, context);
    target.update(header);
  } finally {
    header.fill(0);
  }
}

function createNamespaceTag(deploymentNamespace: string, keyEpoch: string): string {
  const hash = capturedCreateHash('sha256');
  updateLengthPrefixedAscii(hash, NAMESPACE_CONTEXT);
  updateLengthPrefixedAscii(hash, deploymentNamespace);
  updateLengthPrefixedAscii(hash, keyEpoch);

  return hash.digest(BASE64URL_ENCODING);
}

function createPolicyFingerprint(
  key: KeyObject,
  deploymentNamespace: string,
  keyEpoch: string,
  deployment: CapturedPolicy,
  network: CapturedPolicy,
  presentedCredential: CapturedPolicy,
): string {
  const hmac = capturedCreateHmac(HMAC_ALGORITHM, key);
  updateProtocolHeader(hmac, POLICY_CONTEXT, 0);

  for (const value of [
    deploymentNamespace,
    keyEpoch,
    deployment.capacityText,
    deployment.intervalText,
    network.capacityText,
    network.intervalText,
    presentedCredential.capacityText,
    presentedCredential.intervalText,
  ]) {
    updateLengthPrefixedAscii(hmac, value);
  }

  return hmac.digest('hex');
}

function captureOptions(value: unknown): CapturedOptions {
  const record = readExactFrozenRecord(value, OPTIONS_KEYS);
  const deploymentNamespace = record['deploymentNamespace'];
  const keyEpoch = record['keyEpoch'];

  if (
    typeof deploymentNamespace !== 'string' ||
    !NAMESPACE_PATTERN.test(deploymentNamespace) ||
    typeof keyEpoch !== 'string' ||
    !KEY_EPOCH_PATTERN.test(keyEpoch)
  ) {
    controlFailed();
  }

  const deployment = capturePolicy(record['deployment']);
  const network = capturePolicy(record['network']);
  const presentedCredential = capturePolicy(record['presentedCredential']);
  const secret = copyHmacSecret(record['hmacSecret']);

  try {
    const key = capturedCreateSecretKey(secret);

    return capturedFreeze({
      deploymentNamespace,
      keyEpoch,
      key,
      namespaceTag: createNamespaceTag(deploymentNamespace, keyEpoch),
      deployment,
      network,
      presentedCredential,
      policyFingerprint: createPolicyFingerprint(
        key,
        deploymentNamespace,
        keyEpoch,
        deployment,
        network,
        presentedCredential,
      ),
    });
  } catch {
    controlFailed();
  } finally {
    secret.fill(0);
  }
}

function captureExecutor(value: unknown): CapturedExecutor {
  if (!isObject(value) || capturedIsProxy(value)) {
    controlFailed();
  }

  const execute: unknown = capturedReflectGet(value, 'execute');

  if (typeof execute !== 'function') {
    controlFailed();
  }

  return capturedFreeze({ receiver: value, execute: execute as ExecutePrimitive });
}

function deriveDigest(
  options: CapturedOptions,
  dimension: HmacDimension,
  material?: Uint8Array | string,
): string {
  const hmac = capturedCreateHmac(HMAC_ALGORITHM, options.key);
  updateProtocolHeader(hmac, KEY_CONTEXT, dimension);
  updateLengthPrefixedAscii(hmac, options.deploymentNamespace);
  updateLengthPrefixedAscii(hmac, options.keyEpoch);

  if (typeof material === 'string') {
    updateLengthPrefixedAscii(hmac, material);
  } else if (material === undefined) {
    updateLengthPrefixedAscii(hmac, '');
  } else {
    updateLengthPrefixedBytes(hmac, material);
  }

  return hmac.digest(BASE64URL_ENCODING);
}

function readAdmission(value: unknown): Readonly<{
  network: IdentityCredentialAbuseNetwork;
  presentedRefreshCredential: IdentityRefreshCredentialWireValue;
}> {
  if (
    !isObject(value) ||
    capturedIsProxy(value) ||
    capturedGetPrototypeOf(value) !== Object.prototype
  ) {
    controlFailed();
  }

  const ownKeys = capturedOwnKeys(value);

  if (
    ownKeys.length !== ADMISSION_KEYS.length ||
    !ADMISSION_KEYS.every((expectedKey): boolean => ownKeys.includes(expectedKey))
  ) {
    controlFailed();
  }

  const networkDescriptor = capturedGetOwnPropertyDescriptor(value, 'network');
  const credentialDescriptor = capturedGetOwnPropertyDescriptor(
    value,
    'presentedRefreshCredential',
  );

  if (
    networkDescriptor === undefined ||
    !('value' in networkDescriptor) ||
    credentialDescriptor === undefined ||
    !('value' in credentialDescriptor)
  ) {
    controlFailed();
  }

  return {
    network: networkDescriptor.value as IdentityCredentialAbuseNetwork,
    presentedRefreshCredential: credentialDescriptor.value as IdentityRefreshCredentialWireValue,
  };
}

function exactDenseStringResult(value: unknown): readonly [string, string, string] {
  if (
    !isObject(value) ||
    capturedIsProxy(value) ||
    !capturedIsArray(value) ||
    capturedGetPrototypeOf(value) !== Array.prototype
  ) {
    unavailable();
  }

  const ownKeys = capturedOwnKeys(value);
  const lengthDescriptor = capturedGetOwnPropertyDescriptor(value, 'length');

  if (
    ownKeys.length !== 4 ||
    ownKeys[0] !== '0' ||
    ownKeys[1] !== '1' ||
    ownKeys[2] !== '2' ||
    ownKeys[3] !== 'length' ||
    lengthDescriptor === undefined ||
    !('value' in lengthDescriptor) ||
    lengthDescriptor.value !== 3
  ) {
    unavailable();
  }

  const result: string[] = [];

  for (let index = 0; index < 3; index += 1) {
    const descriptor = capturedGetOwnPropertyDescriptor(value, String(index));

    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'string'
    ) {
      unavailable();
    }

    result.push(descriptor.value);
  }

  return result as unknown as readonly [string, string, string];
}

function parseResult(value: unknown): IdentityCredentialAbuseDecision {
  const [version, kind, retryText] = exactDenseStringResult(value);

  if (version !== 'v1') {
    unavailable();
  }

  if (kind === 'allowed' && retryText === '0') {
    return createIdentityCredentialAbuseAllowedDecision();
  }

  if (kind !== 'denied' || !CANONICAL_RETRY_PATTERN.test(retryText)) {
    unavailable();
  }

  return createIdentityCredentialAbuseDeniedDecision(Number(retryText));
}

async function admit(
  executor: CapturedExecutor,
  options: CapturedOptions,
  input: IdentitySessionRefreshCredentialAbuseAdmission,
): Promise<IdentityCredentialAbuseDecision> {
  let keys: readonly string[];
  let arguments_: readonly string[];

  try {
    const admission = readAdmission(input);
    const networkBytes = copyIdentityCredentialAbuseNetworkKeyBytes(admission.network);

    try {
      const credentialWire = serializeIdentityRefreshCredentialWireValue(
        admission.presentedRefreshCredential,
      );
      const deploymentDigest = deriveDigest(options, DEPLOYMENT_DIMENSION);
      const prefix = `oms:{${options.namespaceTag}}:id-abuse-refresh:a1:e${options.keyEpoch}`;

      keys = capturedFreeze([
        `${prefix}:m`,
        `${prefix}:d:${deploymentDigest}`,
        `${prefix}:n:${deriveDigest(options, NETWORK_DIMENSION, networkBytes)}`,
        `${prefix}:c:${deriveDigest(options, CREDENTIAL_DIMENSION, credentialWire)}`,
      ]);
      arguments_ = capturedFreeze([
        options.policyFingerprint,
        options.deployment.capacityText,
        options.deployment.intervalText,
        options.network.capacityText,
        options.network.intervalText,
        options.presentedCredential.capacityText,
        options.presentedCredential.intervalText,
      ]);
    } finally {
      networkBytes.fill(0);
    }
  } catch {
    controlFailed();
  }

  let rawResult: unknown;

  try {
    rawResult = await capturedReflectApply(executor.execute, executor.receiver, [
      REDIS_IDENTITY_SESSION_REFRESH_ABUSE_SCRIPT,
      keys,
      arguments_,
    ]);
  } catch {
    unavailable();
  }

  return parseResult(rawResult);
}

/** Creates the Identity-owned Redis adapter for one atomic refresh-admission decision. */
export function createRedisIdentitySessionRefreshCredentialAbuseControl(
  executor: RedisLuaScriptExecutor,
  options: RedisIdentitySessionRefreshCredentialAbuseControlOptions,
): IdentitySessionRefreshCredentialAbuseControl {
  try {
    const capturedExecutor = captureExecutor(executor);
    const capturedOptions = captureOptions(options);
    const admitSessionRefresh = (
      input: IdentitySessionRefreshCredentialAbuseAdmission,
    ): Promise<IdentityCredentialAbuseDecision> => admit(capturedExecutor, capturedOptions, input);

    capturedFreeze(admitSessionRefresh);
    return capturedFreeze({ admitSessionRefresh });
  } catch {
    controlFailed();
  }
}
