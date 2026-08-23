import { Buffer } from 'node:buffer';

import {
  copyMySqlTransactionParameters,
  InvalidMySqlTransactionParametersError,
} from '../src/client/mysql-transaction-parameter.owner';

const MAX_BINARY_LENGTH = 1_048_576;
const MIN_SIGNED_64_BIT_INTEGER = -(1n << 63n);
const MAX_UNSIGNED_64_BIT_INTEGER = (1n << 64n) - 1n;

interface ParameterOwnerModule {
  readonly copyMySqlTransactionParameters: typeof copyMySqlTransactionParameters;
  readonly InvalidMySqlTransactionParametersError: typeof InvalidMySqlTransactionParametersError;
}

function captureFailure(operation: () => unknown): unknown {
  try {
    operation();
  } catch (error: unknown) {
    return error;
  }

  throw new Error('Expected parameter ownership to fail');
}

function expectInvalid(operation: () => unknown): void {
  const error = captureFailure(operation);

  expect(error).toBeInstanceOf(InvalidMySqlTransactionParametersError);
  expect(error).toMatchObject({
    message: 'Expected valid MySQL transaction parameters',
    name: 'InvalidMySqlTransactionParametersError',
  });
  expect(Object.hasOwn(error as object, 'cause')).toBe(false);
}

function supportsResizableArrayBuffers(): boolean {
  // eslint-disable-next-line @typescript-eslint/unbound-method -- The accessor is invoked only through Reflect.apply.
  const getter = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get;

  if (getter === undefined) return false;

  try {
    const ResizableArrayBuffer = ArrayBuffer as unknown as new (
      byteLength: number,
      options: Readonly<{ maxByteLength: number }>,
    ) => ArrayBuffer;
    const buffer = new ResizableArrayBuffer(1, { maxByteLength: 2 });
    return Reflect.apply(getter, buffer, []) === true;
  } catch {
    return false;
  }
}

describe('MySQL transaction parameter ownership', (): void => {
  it('accepts the exact scalar boundaries and freezes the copied collection', (): void => {
    const parameters = Object.freeze([
      null,
      false,
      true,
      '',
      'a'.repeat(65_535),
      Number.MIN_SAFE_INTEGER,
      -0,
      Number.MAX_SAFE_INTEGER,
      MIN_SIGNED_64_BIT_INTEGER,
      MAX_UNSIGNED_64_BIT_INTEGER,
    ]);

    const owner = copyMySqlTransactionParameters(parameters, parameters.length);

    expect(owner.values).toEqual(parameters);
    expect(Object.isFrozen(owner)).toBe(true);
    expect(Object.isFrozen(owner.values)).toBe(true);
    expect((): void => {
      owner.erase();
    }).not.toThrow();
  });

  it('accepts zero through 64 exact positional parameters and rejects count mismatches', (): void => {
    expect(copyMySqlTransactionParameters([], 0).values).toEqual([]);

    const maximum = Array.from({ length: 64 }, (_, index): number => index);
    expect(copyMySqlTransactionParameters(maximum, 64).values).toEqual(maximum);

    for (const invalidCount of [-1, 1.5, 65, Number.NaN, Number.POSITIVE_INFINITY]) {
      expectInvalid(() => copyMySqlTransactionParameters([], invalidCount));
    }

    expectInvalid(() => copyMySqlTransactionParameters([], 1));
    expectInvalid(() => copyMySqlTransactionParameters([1], 0));
  });

  it.each([
    ['undefined', undefined],
    ['symbol', Symbol('parameter')],
    ['plain object', {}],
    ['nested array', []],
    ['function', (): void => undefined],
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
    ['fraction', 1.5],
    ['positive unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ['negative unsafe integer', Number.MIN_SAFE_INTEGER - 1],
    ['below signed 64-bit', MIN_SIGNED_64_BIT_INTEGER - 1n],
    ['above unsigned 64-bit', MAX_UNSIGNED_64_BIT_INTEGER + 1n],
    ['NUL string', 'prefix\0suffix'],
    ['oversized string', 'a'.repeat(65_536)],
    ['boxed string', new String('value')],
    ['boxed number', new Number(1)],
  ])('rejects the invalid %s scalar without a cause', (_caseName, value): void => {
    expectInvalid(() => copyMySqlTransactionParameters([value], 1));
  });

  it('rejects proxies before their traps, sparse/accessor arrays, subclasses, and extra keys', (): void => {
    const ownKeysTrap = jest.fn((): never => {
      throw new Error('must not inspect proxy keys');
    });
    const proxy = new Proxy([1], { ownKeys: ownKeysTrap });
    expectInvalid(() => copyMySqlTransactionParameters(proxy, 1));
    expect(ownKeysTrap).not.toHaveBeenCalled();

    expectInvalid(() => copyMySqlTransactionParameters(new Array(1), 1));

    let accessorCalls = 0;
    const accessorParameters: unknown[] = [];
    Object.defineProperty(accessorParameters, '0', {
      configurable: true,
      enumerable: true,
      get(): number {
        accessorCalls += 1;
        return 1;
      },
    });
    expectInvalid(() => copyMySqlTransactionParameters(accessorParameters, 1));
    expect(accessorCalls).toBe(0);

    class ParameterArray extends Array<unknown> {}
    expectInvalid(() => copyMySqlTransactionParameters(new ParameterArray(1), 1));

    const extraStringKey = [1] as unknown[] & { metadata?: string };
    extraStringKey.metadata = 'not positional';
    expectInvalid(() => copyMySqlTransactionParameters(extraStringKey, 1));

    const extraSymbolKey = [1] as unknown[] & Record<symbol, boolean>;
    extraSymbolKey[Symbol('metadata')] = true;
    expectInvalid(() => copyMySqlTransactionParameters(extraSymbolKey, 1));
  });

  it('copies exact Buffer and Uint8Array subviews independently', (): void => {
    const callerBuffer = Buffer.from([90, 1, 2, 3, 91]);
    const callerBytes = new Uint8Array([80, 4, 5, 6, 81]);
    const bufferSubview = callerBuffer.subarray(1, 4);
    const byteSubview = new Uint8Array(callerBytes.buffer, 1, 3);
    const owner = copyMySqlTransactionParameters([bufferSubview, byteSubview, bufferSubview], 3);
    const first = owner.values[0];
    const second = owner.values[1];
    const third = owner.values[2];

    expect(Buffer.isBuffer(first)).toBe(true);
    expect(Buffer.isBuffer(second)).toBe(true);
    expect(Buffer.isBuffer(third)).toBe(true);
    expect(first).not.toBe(bufferSubview);
    expect(second).not.toBe(byteSubview);
    expect(first).not.toBe(third);
    expect(Array.from(first as Buffer)).toEqual([1, 2, 3]);
    expect(Array.from(second as Buffer)).toEqual([4, 5, 6]);
    expect(Array.from(third as Buffer)).toEqual([1, 2, 3]);

    bufferSubview.fill(7);
    byteSubview.fill(8);
    (first as Buffer)[0] = 11;

    expect(Array.from(first as Buffer)).toEqual([11, 2, 3]);
    expect(Array.from(second as Buffer)).toEqual([4, 5, 6]);
    expect(Array.from(third as Buffer)).toEqual([1, 2, 3]);
    expect(Array.from(callerBuffer)).toEqual([90, 7, 7, 7, 91]);
    expect(Array.from(callerBytes)).toEqual([80, 8, 8, 8, 81]);

    owner.erase();
    expect(Array.from(first as Buffer)).toEqual([0, 0, 0]);
    expect(Array.from(second as Buffer)).toEqual([0, 0, 0]);
    expect(Array.from(third as Buffer)).toEqual([0, 0, 0]);
    expect(Array.from(callerBuffer)).toEqual([90, 7, 7, 7, 91]);
    expect(Array.from(callerBytes)).toEqual([80, 8, 8, 8, 81]);

    expect((): void => {
      owner.erase();
    }).not.toThrow();
    expect(Array.from(first as Buffer)).toEqual([0, 0, 0]);
  });

  it('accepts exactly 1 MiB of aggregate binary data and rejects one byte more', (): void => {
    const boundary = Buffer.alloc(MAX_BINARY_LENGTH, 0x5a);
    const owner = copyMySqlTransactionParameters([boundary], 1);
    const ownedCopy = owner.values[0];

    expect(Buffer.isBuffer(ownedCopy)).toBe(true);
    expect((ownedCopy as Buffer).byteLength).toBe(MAX_BINARY_LENGTH);
    expect((ownedCopy as Buffer)[0]).toBe(0x5a);
    expect((ownedCopy as Buffer)[MAX_BINARY_LENGTH - 1]).toBe(0x5a);
    owner.erase();
    expect((ownedCopy as Buffer)[0]).toBe(0);
    expect((ownedCopy as Buffer)[MAX_BINARY_LENGTH - 1]).toBe(0);
    expect(boundary[0]).toBe(0x5a);

    const oversized = Buffer.alloc(MAX_BINARY_LENGTH + 1, 0x6b);
    expectInvalid(() => copyMySqlTransactionParameters([oversized], 1));
    expect(oversized[0]).toBe(0x6b);
    expect(oversized[MAX_BINARY_LENGTH]).toBe(0x6b);

    const first = Buffer.alloc(MAX_BINARY_LENGTH / 2 + 1, 0x7c);
    const second = Buffer.alloc(MAX_BINARY_LENGTH / 2, 0x7d);
    expectInvalid(() => copyMySqlTransactionParameters([first, second], 2));
    expect(first[0]).toBe(0x7c);
    expect(second[0]).toBe(0x7d);
  });

  it('rejects proxied and non-exact binary views without touching caller memory', (): void => {
    const caller = new Uint8Array([1, 2, 3]);
    const getPrototypeTrap = jest.fn((): object => {
      throw new Error('must not inspect proxy prototype');
    });
    const proxy = new Proxy(caller, { getPrototypeOf: getPrototypeTrap });

    expectInvalid(() => copyMySqlTransactionParameters([proxy], 1));
    expect(getPrototypeTrap).not.toHaveBeenCalled();

    class ByteSubclass extends Uint8Array {}
    const subclass = new ByteSubclass([4, 5, 6]);
    expectInvalid(() => copyMySqlTransactionParameters([subclass], 1));
    expect(Array.from(subclass)).toEqual([4, 5, 6]);

    const signed = new Int8Array([7, 8]);
    expectInvalid(() => copyMySqlTransactionParameters([signed], 1));
    expect(Array.from(signed)).toEqual([7, 8]);

    const dataViewBuffer = new ArrayBuffer(2);
    const dataView = new DataView(dataViewBuffer);
    dataView.setUint8(0, 9);
    expectInvalid(() => copyMySqlTransactionParameters([dataView], 1));
    expect(dataView.getUint8(0)).toBe(9);
    expect(Array.from(caller)).toEqual([1, 2, 3]);
  });

  it('rejects SharedArrayBuffer-backed, resizable, and detached Uint8Array views', (): void => {
    const shared = new Uint8Array(new SharedArrayBuffer(3));
    shared.set([1, 2, 3]);
    expectInvalid(() => copyMySqlTransactionParameters([shared], 1));
    expect(Array.from(shared)).toEqual([1, 2, 3]);

    if (supportsResizableArrayBuffers()) {
      const ResizableArrayBuffer = ArrayBuffer as unknown as new (
        byteLength: number,
        options: Readonly<{ maxByteLength: number }>,
      ) => ArrayBuffer;
      const resizable = new ResizableArrayBuffer(3, { maxByteLength: 6 });
      const resizableView = new Uint8Array(resizable);
      resizableView.set([4, 5, 6]);
      expectInvalid(() => copyMySqlTransactionParameters([resizableView], 1));
      expect(Array.from(resizableView)).toEqual([4, 5, 6]);
    }

    if (typeof structuredClone === 'function') {
      const detachable = new Uint8Array([7, 8, 9]);
      const detachableBuffer = detachable.buffer;
      structuredClone(detachableBuffer, { transfer: [detachableBuffer] });
      expect(detachableBuffer.byteLength).toBe(0);
      expectInvalid(() => copyMySqlTransactionParameters([detachable], 1));
    }
  });

  it('preserves caller bytes and wipes a partial owned copy when later validation fails', (): void => {
    const caller = Buffer.from([0xaa, 0xbb, 0xcc]);
    const allocated: Buffer<ArrayBuffer>[] = [];
    // eslint-disable-next-line @typescript-eslint/unbound-method -- The original static intrinsic is invoked through Reflect.apply.
    const originalAllocate = Buffer.allocUnsafeSlow;
    const allocation = jest
      .spyOn(Buffer, 'allocUnsafeSlow')
      .mockImplementation((size): Buffer<ArrayBuffer> => {
        const copy = Reflect.apply(originalAllocate, Buffer, [size]);
        allocated.push(copy);
        return copy;
      });

    try {
      jest.isolateModules((): void => {
        const isolated = jest.requireActual<ParameterOwnerModule>(
          '../src/client/mysql-transaction-parameter.owner',
        );
        expect(() => isolated.copyMySqlTransactionParameters([caller, undefined], 2)).toThrow(
          isolated.InvalidMySqlTransactionParametersError,
        );
      });
    } finally {
      allocation.mockRestore();
    }

    expect(allocated).toHaveLength(1);
    const allocatedCopy = allocated[0];
    if (allocatedCopy === undefined) throw new Error('Expected one observed owned copy');
    expect(Array.from(allocatedCopy)).toEqual([0, 0, 0]);
    expect(Array.from(caller)).toEqual([0xaa, 0xbb, 0xcc]);
  });
});
