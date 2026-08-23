import { inspect } from 'node:util';

import type {
  // @ts-expect-error The abuse-network capability remains package-internal.
  IdentityCredentialAbuseNetwork as LeakedIdentityCredentialAbuseNetwork,
} from '../src';
import * as identityPublicSurface from '../src';
import {
  authenticateIdentityCredentialAbuseNetwork,
  copyIdentityCredentialAbuseNetworkKeyBytes,
  createIdentityCredentialAbuseNetworkFromAddressBytes,
  InvalidIdentityCredentialAbuseNetworkError,
  type IdentityCredentialAbuseNetwork,
  type IdentityCredentialAbuseNetworkAddressFamily,
} from '../src/application/identity-credential-abuse-network';

const REDACTED = '[REDACTED]';
const IPV4_KEY_HEADER = [1, 4] as const;
const IPV6_KEY_HEADER = [1, 6] as const;

type RuntimeNetwork = Readonly<{
  constructor: new (capability: unknown, keyBytes: Uint8Array<ArrayBuffer>) => object;
  toJSON(): string;
  toString(): string;
  [Symbol.toPrimitive](): string;
}>;

function ipv4(...octets: [number, number, number, number]): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(octets);
}

function ipv6(...octets: number[]): Uint8Array<ArrayBuffer> {
  if (octets.length !== 16) {
    throw new Error('Invalid test IPv6 fixture');
  }

  return Uint8Array.from(octets);
}

function mappedIpv4(...octets: [number, number, number, number]): Uint8Array<ArrayBuffer> {
  return ipv6(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, ...octets);
}

function resizableArrayBuffer(byteLength: number): ArrayBuffer {
  const ResizableArrayBufferConstructor = ArrayBuffer as unknown as new (
    initialByteLength: number,
    options: Readonly<{ maxByteLength: number }>,
  ) => ArrayBuffer;

  return new ResizableArrayBufferConstructor(byteLength, {
    maxByteLength: byteLength * 2,
  });
}

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
  rejectedValues: readonly string[] = [],
): void {
  const error = captureError(operation);

  expect(error).toBeInstanceOf(InvalidIdentityCredentialAbuseNetworkError);
  expect(error).toMatchObject({
    name: 'InvalidIdentityCredentialAbuseNetworkError',
    message: 'Expected a canonical Identity credential abuse network',
  });
  expect((error as Error & { cause?: unknown }).cause).toBeUndefined();

  for (const rejectedValue of rejectedValues) {
    expect(String(error)).not.toContain(rejectedValue);
    expect(JSON.stringify(error)).not.toContain(rejectedValue);
  }
}

function expectOrdinaryKeyCopy(actual: Uint8Array<ArrayBuffer>, expected: readonly number[]): void {
  expect(actual).toBeInstanceOf(Uint8Array);
  expect(Buffer.isBuffer(actual)).toBe(false);
  expect(Object.getPrototypeOf(actual)).toBe(Uint8Array.prototype);
  expect(actual.byteOffset).toBe(0);
  expect(actual.byteLength).toBe(expected.length);
  expect(actual.buffer).toBeInstanceOf(ArrayBuffer);
  expect(Object.getPrototypeOf(actual.buffer)).toBe(ArrayBuffer.prototype);
  expect(actual.buffer.byteLength).toBe(expected.length);
  expect((actual.buffer as ArrayBuffer & Readonly<{ resizable: boolean }>).resizable).toBe(false);
  expect(Array.from(actual)).toEqual(expected);
}

function copyKey(value: unknown): Uint8Array<ArrayBuffer> {
  return copyIdentityCredentialAbuseNetworkKeyBytes(value as IdentityCredentialAbuseNetwork);
}

describe('Identity credential abuse network', (): void => {
  it('retains one exact IPv4 address in a versioned family namespace', (): void => {
    const network = createIdentityCredentialAbuseNetworkFromAddressBytes(
      'ipv4',
      ipv4(192, 0, 2, 17),
    );

    expectOrdinaryKeyCopy(copyKey(network), [...IPV4_KEY_HEADER, 192, 0, 2, 17]);
    expect(authenticateIdentityCredentialAbuseNetwork(network)).toBe(network);
    expect(Object.isFrozen(network)).toBe(true);
    expect(Object.isFrozen(Object.getPrototypeOf(network))).toBe(true);
    expect(Object.isFrozen((network as unknown as RuntimeNetwork).constructor)).toBe(true);
  });

  it('does not leak its type, factory, helper, or error through the package root', (): void => {
    for (const internalName of [
      'IdentityCredentialAbuseNetwork',
      'InvalidIdentityCredentialAbuseNetworkError',
      'createIdentityCredentialAbuseNetworkFromAddressBytes',
      'authenticateIdentityCredentialAbuseNetwork',
      'copyIdentityCredentialAbuseNetworkKeyBytes',
    ]) {
      expect(identityPublicSurface).not.toHaveProperty(internalName);
    }
  });

  it('normalizes native IPv6 addresses to their first 64 bits', (): void => {
    const first = createIdentityCredentialAbuseNetworkFromAddressBytes(
      'ipv6',
      ipv6(
        0x20,
        0x01,
        0x0d,
        0xb8,
        0xab,
        0xcd,
        0x12,
        0x34,
        0x11,
        0x11,
        0x22,
        0x22,
        0x33,
        0x33,
        0x44,
        0x44,
      ),
    );
    const samePrefix = createIdentityCredentialAbuseNetworkFromAddressBytes(
      'ipv6',
      ipv6(
        0x20,
        0x01,
        0x0d,
        0xb8,
        0xab,
        0xcd,
        0x12,
        0x34,
        0xff,
        0xff,
        0xee,
        0xee,
        0xdd,
        0xdd,
        0xcc,
        0xcc,
      ),
    );
    const nextPrefix = createIdentityCredentialAbuseNetworkFromAddressBytes(
      'ipv6',
      ipv6(0x20, 0x01, 0x0d, 0xb8, 0xab, 0xcd, 0x12, 0x35, 0, 0, 0, 0, 0, 0, 0, 1),
    );
    const expected = [...IPV6_KEY_HEADER, 0x20, 0x01, 0x0d, 0xb8, 0xab, 0xcd, 0x12, 0x34];

    expectOrdinaryKeyCopy(copyKey(first), expected);
    expectOrdinaryKeyCopy(copyKey(samePrefix), expected);
    expect(Array.from(copyKey(nextPrefix))).not.toEqual(expected);
  });

  it('collapses IPv4-mapped IPv6 into the exact IPv4 namespace', (): void => {
    const native = createIdentityCredentialAbuseNetworkFromAddressBytes(
      'ipv4',
      ipv4(192, 0, 2, 17),
    );
    const mapped = createIdentityCredentialAbuseNetworkFromAddressBytes(
      'ipv6',
      mappedIpv4(192, 0, 2, 17),
    );

    expectOrdinaryKeyCopy(copyKey(mapped), Array.from(copyKey(native)));
  });

  it('keeps the IPv4 and native IPv6 namespaces distinct even for zero payloads', (): void => {
    const ipv4Network = createIdentityCredentialAbuseNetworkFromAddressBytes(
      'ipv4',
      ipv4(0, 0, 0, 0),
    );
    const ipv6Network = createIdentityCredentialAbuseNetworkFromAddressBytes(
      'ipv6',
      ipv6(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    );

    expectOrdinaryKeyCopy(copyKey(ipv4Network), [...IPV4_KEY_HEADER, 0, 0, 0, 0]);
    expectOrdinaryKeyCopy(copyKey(ipv6Network), [...IPV6_KEY_HEADER, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('accepts exact offset Uint8Array and Buffer views and copies them immediately', (): void => {
    const ipv4Backing = new ArrayBuffer(32);
    const ipv4View = new Uint8Array(ipv4Backing, 7, 4);
    ipv4View.set(ipv4(198, 51, 100, 42));
    const ipv6Backing = new ArrayBuffer(48);
    const ipv6View = Buffer.from(ipv6Backing, 13, 16);
    ipv6View.set(
      ipv6(0x20, 0x01, 0x0d, 0xb8, 0, 1, 0, 2, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0, 1),
    );

    const ipv4Network = createIdentityCredentialAbuseNetworkFromAddressBytes('ipv4', ipv4View);
    const ipv6Network = createIdentityCredentialAbuseNetworkFromAddressBytes('ipv6', ipv6View);
    ipv4View.fill(0xff);
    ipv6View.fill(0xff);

    expectOrdinaryKeyCopy(copyKey(ipv4Network), [...IPV4_KEY_HEADER, 198, 51, 100, 42]);
    expectOrdinaryKeyCopy(copyKey(ipv6Network), [
      ...IPV6_KEY_HEADER,
      0x20,
      0x01,
      0x0d,
      0xb8,
      0,
      1,
      0,
      2,
    ]);
  });

  it('isolates retained state from mutations of every extracted copy', (): void => {
    const network = createIdentityCredentialAbuseNetworkFromAddressBytes(
      'ipv4',
      ipv4(203, 0, 113, 9),
    );
    const expected = [...IPV4_KEY_HEADER, 203, 0, 113, 9];
    const first = copyKey(network);
    const second = copyKey(network);

    expect(first).not.toBe(second);
    expect(first.buffer).not.toBe(second.buffer);
    first.fill(0);
    second.fill(0xff);
    expectOrdinaryKeyCopy(copyKey(network), expected);
  });

  it('uses captured typed-array operations after mutable prototypes are poisoned', (): void => {
    const source = ipv6(
      0x20,
      0x01,
      0x0d,
      0xb8,
      0xca,
      0xfe,
      0xba,
      0xbe,
      0xaa,
      0xbb,
      0xcc,
      0xdd,
      0xee,
      0xff,
      0,
      1,
    );
    const setDescriptor = Object.getOwnPropertyDescriptor(Uint8Array.prototype, 'set');
    const subarrayDescriptor = Object.getOwnPropertyDescriptor(Uint8Array.prototype, 'subarray');
    const byteLengthDescriptor = Object.getOwnPropertyDescriptor(
      Uint8Array.prototype,
      'byteLength',
    );

    Object.defineProperties(Uint8Array.prototype, {
      set: {
        configurable: true,
        value(): never {
          throw new Error('poisoned Uint8Array.set');
        },
      },
      subarray: {
        configurable: true,
        value(): never {
          throw new Error('poisoned Uint8Array.subarray');
        },
      },
      byteLength: {
        configurable: true,
        get(): never {
          throw new Error('poisoned Uint8Array.byteLength');
        },
      },
    });

    try {
      const network = createIdentityCredentialAbuseNetworkFromAddressBytes('ipv6', source);

      expect(Array.from(copyKey(network))).toEqual([
        ...IPV6_KEY_HEADER,
        0x20,
        0x01,
        0x0d,
        0xb8,
        0xca,
        0xfe,
        0xba,
        0xbe,
      ]);
    } finally {
      for (const [name, descriptor] of [
        ['set', setDescriptor],
        ['subarray', subarrayDescriptor],
        ['byteLength', byteLengthDescriptor],
      ] as const) {
        if (descriptor === undefined) {
          Reflect.deleteProperty(Uint8Array.prototype, name);
        } else {
          Object.defineProperty(Uint8Array.prototype, name, descriptor);
        }
      }
    }
  });

  it.each([
    ['short IPv4', 'ipv4', new Uint8Array(3)],
    ['long IPv4', 'ipv4', new Uint8Array(5)],
    ['short IPv6', 'ipv6', new Uint8Array(15)],
    ['long IPv6', 'ipv6', new Uint8Array(17)],
    ['number array', 'ipv4', [192, 0, 2, 1]],
    ['text', 'ipv4', '192.0.2.1'],
    ['ArrayBuffer', 'ipv4', new ArrayBuffer(4)],
    ['DataView', 'ipv4', new DataView(new ArrayBuffer(4))],
    ['Uint8ClampedArray', 'ipv4', new Uint8ClampedArray(4)],
    ['Uint16Array', 'ipv4', new Uint16Array(2)],
  ] as const)('rejects %s input', (_scenario, family, input): void => {
    expectFixedSafeError(() => createIdentityCredentialAbuseNetworkFromAddressBytes(family, input));
  });

  it('rejects an invalid family before inspecting hostile address bytes', (): void => {
    const secret = 'hostile-invalid-family-address-secret';
    let trapCalls = 0;
    const hostile = new Proxy(new Uint8Array(4), {
      getPrototypeOf(): never {
        trapCalls += 1;
        throw new Error(secret);
      },
    });

    expectFixedSafeError(
      () =>
        createIdentityCredentialAbuseNetworkFromAddressBytes(
          'ipv5' as IdentityCredentialAbuseNetworkAddressFamily,
          hostile,
        ),
      [secret],
    );
    expect(trapCalls).toBe(0);
  });

  it('rejects forged, detached, shared, and resizable typed-array views', (): void => {
    const forged = new Uint8ClampedArray(4);
    Object.setPrototypeOf(forged, Uint8Array.prototype);
    const detached = new Uint8Array(4);
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    const shared = new Uint8Array(new SharedArrayBuffer(4));
    const resizable = new Uint8Array(resizableArrayBuffer(4));

    for (const input of [forged, detached, shared, resizable]) {
      expectFixedSafeError(() =>
        createIdentityCredentialAbuseNetworkFromAddressBytes('ipv4', input),
      );
    }
  });

  it('uses intrinsic buffer facts instead of spoofable own properties', (): void => {
    const shared = new Uint8Array(new SharedArrayBuffer(4));
    const resizable = new Uint8Array(resizableArrayBuffer(4));

    for (const input of [shared, resizable]) {
      Object.defineProperties(input, {
        buffer: { value: new ArrayBuffer(4) },
        byteLength: { value: 4 },
      });
      expectFixedSafeError(() =>
        createIdentityCredentialAbuseNetworkFromAddressBytes('ipv4', input),
      );
    }
  });

  it('rejects typed-array proxies, including revoked proxies', (): void => {
    const proxied = new Proxy(ipv4(192, 0, 2, 1), {});
    const revoked = Proxy.revocable(ipv4(192, 0, 2, 1), {});
    revoked.revoke();

    for (const input of [proxied, revoked.proxy]) {
      expectFixedSafeError(() =>
        createIdentityCredentialAbuseNetworkFromAddressBytes('ipv4', input),
      );
    }
  });

  it('redacts coercion, JSON, and inspection without own address properties', (): void => {
    const address = ipv4(198, 51, 100, 73);
    const secretHex = Buffer.from(address).toString('hex');
    const network = createIdentityCredentialAbuseNetworkFromAddressBytes('ipv4', address);
    const runtime = network as unknown as RuntimeNetwork;
    const coercible: unknown = runtime;
    const clone = structuredClone(network);

    expect(Object.keys(network)).toEqual([]);
    expect(Reflect.ownKeys(network)).toEqual([]);
    expect(Object.getOwnPropertyDescriptors(network)).toEqual({});
    expect(Object.assign({}, network)).toEqual({});
    expect(runtime.toJSON()).toBe(REDACTED);
    expect(runtime.toString()).toBe(REDACTED);
    expect(runtime[Symbol.toPrimitive]()).toBe(REDACTED);
    expect(String(coercible)).toBe(REDACTED);
    expect(JSON.stringify(network)).toBe(JSON.stringify(REDACTED));
    expect(JSON.stringify({ network })).toBe(`{"network":"${REDACTED}"}`);
    expect(inspect(network, { showHidden: true })).not.toContain(secretHex);
    expect(inspect({ network }, { showHidden: true })).not.toContain(secretHex);
    expectFixedSafeError(() => authenticateIdentityCredentialAbuseNetwork(clone));
    expectFixedSafeError(() => copyKey(clone));
  });

  it('seals the recovered constructor and rejects subclass construction', (): void => {
    const network = createIdentityCredentialAbuseNetworkFromAddressBytes(
      'ipv4',
      ipv4(192, 0, 2, 23),
    );
    const Constructor = (network as unknown as RuntimeNetwork).constructor;
    const keyBytes = copyKey(network);

    expectFixedSafeError(() => new Constructor({}, keyBytes));
    expectFixedSafeError(() => new Constructor(undefined, keyBytes));

    class ForgedSubclass extends Constructor {}

    expectFixedSafeError(() => new ForgedSubclass({}, keyBytes));
  });

  it('authenticates only the exact capability, not clones, wrappers, or proxies', (): void => {
    const network = createIdentityCredentialAbuseNetworkFromAddressBytes(
      'ipv4',
      ipv4(192, 0, 2, 29),
    );
    const structuralClone = Object.create(Object.getPrototypeOf(network) as object) as unknown;
    const wrapper = Object.freeze({ network });
    const proxy = new Proxy(network, {});
    const revoked = Proxy.revocable(network, {});
    revoked.revoke();

    for (const invalid of [null, {}, structuralClone, wrapper, proxy, revoked.proxy]) {
      expectFixedSafeError(() => authenticateIdentityCredentialAbuseNetwork(invalid));
      expectFixedSafeError(() => copyKey(invalid));
    }
  });

  it('collapses hostile input failures into fresh cause-free errors without coercion', (): void => {
    const secret = 'hostile-network-input-secret';
    let coercionCalls = 0;
    const hostile = {
      get buffer(): never {
        throw new Error(secret);
      },
      toJSON(): never {
        coercionCalls += 1;
        throw new Error(secret);
      },
      toString(): never {
        coercionCalls += 1;
        throw new Error(secret);
      },
      [Symbol.toPrimitive](): never {
        coercionCalls += 1;
        throw new Error(secret);
      },
    };
    const first = captureError(() =>
      createIdentityCredentialAbuseNetworkFromAddressBytes('ipv4', hostile),
    );
    const second = captureError(() =>
      createIdentityCredentialAbuseNetworkFromAddressBytes('ipv4', hostile),
    );

    expect(first).not.toBe(second);
    expectFixedSafeError(
      () => createIdentityCredentialAbuseNetworkFromAddressBytes('ipv4', hostile),
      [secret],
    );
    expect(coercionCalls).toBe(0);
  });
});

export type _LeakedIdentityCredentialAbuseNetwork = LeakedIdentityCredentialAbuseNetwork;
