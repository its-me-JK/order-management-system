import { createHash, randomBytes as requestRandomBytes } from 'node:crypto';

import { createIdentitySessionCredentialCandidates } from '../../application/identity-session-credential-candidates';
import type { IdentitySessionCredentialCrypto } from '../../application/identity-session-credential-crypto';
import {
  createIdentityAccessCredentialDigestFromBytes,
  createIdentityRefreshCredentialDigestFromBytes,
  IDENTITY_SESSION_CREDENTIAL_DIGEST_BYTE_LENGTH,
  type IdentityAccessCredentialDigest,
  type IdentityRefreshCredentialDigest,
} from '../../application/identity-session-credential-digest.values';
import { IdentitySessionCredentialCryptoUnavailableError } from '../../application/identity-session-credential.errors';
import {
  IDENTITY_ACCESS_CREDENTIAL_WIRE_PREFIX,
  IDENTITY_REFRESH_CREDENTIAL_WIRE_PREFIX,
  parseIdentityAccessCredentialWireValue,
  parseIdentityRefreshCredentialWireValue,
  serializeIdentityAccessCredentialWireValue,
  serializeIdentityRefreshCredentialWireValue,
  type IdentityAccessCredentialWireValue,
  type IdentityRefreshCredentialWireValue,
} from '../../application/identity-session-credential-wire.values';

const NODE_IDENTITY_SESSION_CREDENTIAL_CRYPTO_PRIMITIVE_KEYS = Object.freeze([
  'randomBytes',
  'sha256Ascii',
] as const);
const BASE64URL_ENCODING = 'base64url';
const ASCII_ENCODING = 'ascii';
const SHA_256_ALGORITHM = 'sha256';
const capturedNodeCreateHash = createHash;
const capturedNodeRandomBytes = requestRandomBytes;
const NODE_IDENTITY_SESSION_CREDENTIAL_CRYPTO_CONSTRUCTION_CAPABILITY = Object.freeze({});

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
function descriptorMember(
  descriptor: PropertyDescriptor | undefined,
  member: 'get' | 'value',
): unknown {
  if (descriptor === undefined) {
    return undefined;
  }

  return (descriptor as unknown as Readonly<Record<string, unknown>>)[member];
}

const typedArrayBufferGetter = descriptorMember(
  Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer'),
  'get',
);
const typedArrayByteLengthGetter = descriptorMember(
  Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength'),
  'get',
);
const typedArrayKindGetter = descriptorMember(
  Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag),
  'get',
);
const typedArrayFill = descriptorMember(
  Object.getOwnPropertyDescriptor(typedArrayPrototype, 'fill'),
  'value',
);
const typedArraySet = descriptorMember(
  Object.getOwnPropertyDescriptor(typedArrayPrototype, 'set'),
  'value',
);
const arrayBufferByteLengthGetter = descriptorMember(
  Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength'),
  'get',
);
const arrayBufferResizableGetter = descriptorMember(
  Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable'),
  'get',
);

/** @internal Direct-file deterministic seam for the Node adapter tests. */
export type NodeIdentitySessionCredentialCryptoPrimitives = Readonly<{
  randomBytes(byteLength: number): Promise<unknown>;
  sha256Ascii(wireValue: string): unknown;
}>;

type RandomBytesPrimitive = (byteLength: number) => Promise<unknown>;
type Sha256AsciiPrimitive = (wireValue: string) => unknown;
type CopiedNodeIdentitySessionCredentialCryptoPrimitives = Readonly<{
  randomBytes: RandomBytesPrimitive;
  sha256Ascii: Sha256AsciiPrimitive;
}>;

type CredentialDigest = IdentityAccessCredentialDigest | IdentityRefreshCredentialDigest;
type RegisteredTemporaryViews = Uint8Array<ArrayBuffer>[];

const nodeIdentitySessionCredentialCryptoPrimitives = new WeakMap<
  object,
  CopiedNodeIdentitySessionCredentialCryptoPrimitives
>();
let constructNodeIdentitySessionCredentialCrypto:
  ((primitives: unknown) => IdentitySessionCredentialCrypto) | undefined;

function cryptoUnavailable(): never {
  throw new IdentitySessionCredentialCryptoUnavailableError();
}

function invalidProviderRepresentation(): never {
  throw new TypeError('Invalid Node credential cryptography provider representation');
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactPrimitiveKeys(value: Readonly<Record<string, unknown>>): boolean {
  const keys = Reflect.ownKeys(value);

  return (
    keys.length === NODE_IDENTITY_SESSION_CREDENTIAL_CRYPTO_PRIMITIVE_KEYS.length &&
    keys.every(
      (key) =>
        typeof key === 'string' &&
        NODE_IDENTITY_SESSION_CREDENTIAL_CRYPTO_PRIMITIVE_KEYS.some(
          (expectedKey) => expectedKey === key,
        ),
    )
  );
}

function copyPrimitives(value: unknown): CopiedNodeIdentitySessionCredentialCryptoPrimitives {
  if (!isRecord(value) || !hasExactPrimitiveKeys(value)) {
    invalidProviderRepresentation();
  }

  const randomBytes = value['randomBytes'];
  const sha256Ascii = value['sha256Ascii'];

  if (typeof randomBytes !== 'function' || typeof sha256Ascii !== 'function') {
    invalidProviderRepresentation();
  }

  return Object.freeze({
    randomBytes: randomBytes as RandomBytesPrimitive,
    sha256Ascii: sha256Ascii as Sha256AsciiPrimitive,
  });
}

function readTypedArrayBuffer(value: unknown): ArrayBuffer {
  if (typeof typedArrayBufferGetter !== 'function') {
    invalidProviderRepresentation();
  }

  const backingStore: unknown = Reflect.apply(typedArrayBufferGetter, value, []);

  if (
    typeof arrayBufferByteLengthGetter !== 'function' ||
    typeof arrayBufferResizableGetter !== 'function'
  ) {
    invalidProviderRepresentation();
  }

  const backingByteLength: unknown = Reflect.apply(arrayBufferByteLengthGetter, backingStore, []);
  const resizable: unknown = Reflect.apply(arrayBufferResizableGetter, backingStore, []);

  if (
    typeof backingByteLength !== 'number' ||
    !Number.isSafeInteger(backingByteLength) ||
    backingByteLength < 0 ||
    resizable !== false
  ) {
    invalidProviderRepresentation();
  }

  return backingStore as ArrayBuffer;
}

function readTypedArrayByteLength(value: unknown): number {
  if (typeof typedArrayByteLengthGetter !== 'function') {
    invalidProviderRepresentation();
  }

  const byteLength: unknown = Reflect.apply(typedArrayByteLengthGetter, value, []);

  if (typeof byteLength !== 'number' || !Number.isSafeInteger(byteLength) || byteLength < 0) {
    invalidProviderRepresentation();
  }

  return byteLength;
}

function assertUint8ArrayKind(value: unknown): void {
  if (
    typeof typedArrayKindGetter !== 'function' ||
    Reflect.apply(typedArrayKindGetter, value, []) !== 'Uint8Array'
  ) {
    invalidProviderRepresentation();
  }
}

function validateProviderBytes(value: unknown): Uint8Array<ArrayBuffer> {
  assertUint8ArrayKind(value);
  readTypedArrayBuffer(value);

  if (readTypedArrayByteLength(value) !== IDENTITY_SESSION_CREDENTIAL_DIGEST_BYTE_LENGTH) {
    invalidProviderRepresentation();
  }

  return value as Uint8Array<ArrayBuffer>;
}

function registerAndCopyProviderBytes(
  value: unknown,
  registeredViews: RegisteredTemporaryViews,
): Uint8Array<ArrayBuffer> {
  const source = validateProviderBytes(value);
  registeredViews.push(source);

  const scratch: Uint8Array<ArrayBuffer> = new Uint8Array(
    IDENTITY_SESSION_CREDENTIAL_DIGEST_BYTE_LENGTH,
  );
  registeredViews.push(scratch);

  if (typeof typedArraySet !== 'function') {
    invalidProviderRepresentation();
  }

  Reflect.apply(typedArraySet, scratch, [source]);

  return scratch;
}

function overwriteRegisteredViews(registeredViews: RegisteredTemporaryViews): boolean {
  let succeeded = typeof typedArrayFill === 'function';

  for (const view of registeredViews) {
    try {
      if (typeof typedArrayFill !== 'function') {
        continue;
      }

      Reflect.apply(typedArrayFill, view, [0]);
    } catch {
      succeeded = false;
    }
  }

  return succeeded;
}

function encodeBase64url(value: Uint8Array<ArrayBuffer>): string {
  const viewWithoutCopy = Buffer.from(value.buffer, value.byteOffset, value.byteLength);

  return viewWithoutCopy.toString(BASE64URL_ENCODING);
}

async function requestCredentialPayload(randomBytes: RandomBytesPrimitive): Promise<string> {
  const registeredViews: RegisteredTemporaryViews = [];
  let outcome: Readonly<{ payload: string }> | undefined;

  try {
    const providerResult: unknown = await randomBytes(
      IDENTITY_SESSION_CREDENTIAL_DIGEST_BYTE_LENGTH,
    );
    const scratch = registerAndCopyProviderBytes(providerResult, registeredViews);
    outcome = { payload: encodeBase64url(scratch) };
  } catch {
    outcome = undefined;
  }

  const cleanupSucceeded = overwriteRegisteredViews(registeredViews);

  if (outcome === undefined || !cleanupSucceeded) {
    cryptoUnavailable();
  }

  return outcome.payload;
}

function digestCredentialWireValue<TDigest extends CredentialDigest>(
  serializedWireValue: string,
  sha256Ascii: Sha256AsciiPrimitive,
  createDigest: (value: unknown) => TDigest,
): TDigest {
  const registeredViews: RegisteredTemporaryViews = [];
  let outcome: Readonly<{ digest: TDigest }> | undefined;

  try {
    const providerResult = sha256Ascii(serializedWireValue);
    const scratch = registerAndCopyProviderBytes(providerResult, registeredViews);
    outcome = { digest: createDigest(scratch) };
  } catch {
    outcome = undefined;
  }

  const cleanupSucceeded = overwriteRegisteredViews(registeredViews);

  if (outcome === undefined || !cleanupSucceeded) {
    cryptoUnavailable();
  }

  return outcome.digest;
}

function primitivesFor(value: object): CopiedNodeIdentitySessionCredentialCryptoPrimitives {
  const primitives = nodeIdentitySessionCredentialCryptoPrimitives.get(value);

  if (primitives === undefined) {
    cryptoUnavailable();
  }

  return primitives;
}

class NodeIdentitySessionCredentialCrypto implements IdentitySessionCredentialCrypto {
  private constructor(constructionCapability: unknown, primitives: unknown) {
    try {
      if (
        new.target !== NodeIdentitySessionCredentialCrypto ||
        constructionCapability !== NODE_IDENTITY_SESSION_CREDENTIAL_CRYPTO_CONSTRUCTION_CAPABILITY
      ) {
        invalidProviderRepresentation();
      }

      nodeIdentitySessionCredentialCryptoPrimitives.set(this, copyPrimitives(primitives));
      Object.freeze(this);
    } catch {
      cryptoUnavailable();
    }
  }

  static {
    constructNodeIdentitySessionCredentialCrypto = (
      primitives: unknown,
    ): IdentitySessionCredentialCrypto =>
      new NodeIdentitySessionCredentialCrypto(
        NODE_IDENTITY_SESSION_CREDENTIAL_CRYPTO_CONSTRUCTION_CAPABILITY,
        primitives,
      );
  }

  public async generateSessionCredentialCandidates(): ReturnType<
    IdentitySessionCredentialCrypto['generateSessionCredentialCandidates']
  > {
    try {
      const primitives = primitivesFor(this);
      const accessPayload = await requestCredentialPayload(primitives.randomBytes);
      const refreshPayload = await requestCredentialPayload(primitives.randomBytes);
      const accessWireValue = parseIdentityAccessCredentialWireValue(
        `${IDENTITY_ACCESS_CREDENTIAL_WIRE_PREFIX}${accessPayload}`,
      );
      const refreshWireValue = parseIdentityRefreshCredentialWireValue(
        `${IDENTITY_REFRESH_CREDENTIAL_WIRE_PREFIX}${refreshPayload}`,
      );
      const accessDigest = digestCredentialWireValue(
        serializeIdentityAccessCredentialWireValue(accessWireValue),
        primitives.sha256Ascii,
        createIdentityAccessCredentialDigestFromBytes,
      );
      const refreshDigest = digestCredentialWireValue(
        serializeIdentityRefreshCredentialWireValue(refreshWireValue),
        primitives.sha256Ascii,
        createIdentityRefreshCredentialDigestFromBytes,
      );

      return createIdentitySessionCredentialCandidates({
        access: { wireValue: accessWireValue, digest: accessDigest },
        refresh: { wireValue: refreshWireValue, digest: refreshDigest },
      });
    } catch {
      cryptoUnavailable();
    }
  }

  public digestAccessCredential(
    wireValue: IdentityAccessCredentialWireValue,
  ): ReturnType<IdentitySessionCredentialCrypto['digestAccessCredential']> {
    return Promise.resolve().then((): IdentityAccessCredentialDigest => {
      const serializedWireValue = serializeIdentityAccessCredentialWireValue(wireValue);

      try {
        const primitives = primitivesFor(this);

        return digestCredentialWireValue(
          serializedWireValue,
          primitives.sha256Ascii,
          createIdentityAccessCredentialDigestFromBytes,
        );
      } catch {
        cryptoUnavailable();
      }
    });
  }

  public digestRefreshCredential(
    wireValue: IdentityRefreshCredentialWireValue,
  ): ReturnType<IdentitySessionCredentialCrypto['digestRefreshCredential']> {
    return Promise.resolve().then((): IdentityRefreshCredentialDigest => {
      const serializedWireValue = serializeIdentityRefreshCredentialWireValue(wireValue);

      try {
        const primitives = primitivesFor(this);

        return digestCredentialWireValue(
          serializedWireValue,
          primitives.sha256Ascii,
          createIdentityRefreshCredentialDigestFromBytes,
        );
      } catch {
        cryptoUnavailable();
      }
    });
  }
}

Object.freeze(NodeIdentitySessionCredentialCrypto.prototype);
Object.freeze(NodeIdentitySessionCredentialCrypto);

function nodeRandomBytes(byteLength: number): Promise<unknown> {
  return new Promise((resolve, reject): void => {
    capturedNodeRandomBytes(byteLength, (error, value): void => {
      if (error !== null) {
        reject(error);
        return;
      }

      resolve(value);
    });
  });
}

function nodeSha256Ascii(wireValue: string): unknown {
  return capturedNodeCreateHash(SHA_256_ALGORITHM).update(wireValue, ASCII_ENCODING).digest();
}

const DEFAULT_NODE_IDENTITY_SESSION_CREDENTIAL_CRYPTO_PRIMITIVES = Object.freeze({
  randomBytes: nodeRandomBytes,
  sha256Ascii: nodeSha256Ascii,
}) satisfies NodeIdentitySessionCredentialCryptoPrimitives;

/** Creates the fixed-policy production Node cryptography adapter. */
export function createNodeIdentitySessionCredentialCrypto(): IdentitySessionCredentialCrypto {
  return createNodeIdentitySessionCredentialCryptoWithPrimitives(
    DEFAULT_NODE_IDENTITY_SESSION_CREDENTIAL_CRYPTO_PRIMITIVES,
  );
}

/** @internal Direct-file deterministic construction seam for adapter tests. */
export function createNodeIdentitySessionCredentialCryptoWithPrimitives(
  primitives: unknown,
): IdentitySessionCredentialCrypto {
  try {
    const construct = constructNodeIdentitySessionCredentialCrypto;

    if (construct === undefined) {
      cryptoUnavailable();
    }

    return construct(primitives);
  } catch {
    cryptoUnavailable();
  }
}
