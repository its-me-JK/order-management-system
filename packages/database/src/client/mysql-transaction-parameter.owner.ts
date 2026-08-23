import { Buffer } from 'node:buffer';
import { isArrayBuffer, isProxy, isSharedArrayBuffer, isUint8Array } from 'node:util/types';

const MAX_PARAMETER_COUNT = 64;
const MAX_TOTAL_BINARY_LENGTH = 1_048_576;
const MAX_STRING_LENGTH = 65_535;
const MIN_SIGNED_64_BIT_INTEGER = -(1n << 63n);
const MAX_UNSIGNED_64_BIT_INTEGER = (1n << 64n) - 1n;

const capturedArrayBufferPrototype = ArrayBuffer.prototype;
const capturedArrayPrototype = Array.prototype;
const capturedBufferPrototype = Buffer.prototype as unknown as object;
const capturedFreeze = Object.freeze;
const capturedGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const capturedGetPrototypeOf = Object.getPrototypeOf;
const capturedHasOwn = Object.hasOwn;
const capturedIsArray = Array.isArray;
const capturedIsArrayBuffer = isArrayBuffer;
const capturedIsProxy = isProxy;
const capturedIsSafeInteger = Number.isSafeInteger;
const capturedIsSharedArrayBuffer = isSharedArrayBuffer;
const capturedIsUint8Array = isUint8Array;
const capturedOwnKeys = Reflect.ownKeys;
const capturedReflectApply = Reflect.apply;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured before hostile mutation and invoked only through Reflect.apply.
const capturedStringIncludes = String.prototype.includes;
const capturedTypedArrayPrototype = capturedGetPrototypeOf(Uint8Array.prototype) as object;
const capturedUint8ArrayPrototype = Uint8Array.prototype;

type IntrinsicGetter = (this: unknown) => unknown;

function captureGetter(prototype: object, property: string): IntrinsicGetter {
  // eslint-disable-next-line @typescript-eslint/unbound-method -- The accessor is intentionally captured and invoked only through Reflect.apply.
  const getter = capturedGetOwnPropertyDescriptor(prototype, property)?.get;

  if (getter === undefined) {
    throw new Error('Required JavaScript intrinsic is unavailable');
  }

  return getter;
}

const capturedArrayBufferByteLengthGetter = captureGetter(
  capturedArrayBufferPrototype,
  'byteLength',
);
const capturedArrayBufferResizableGetter = captureGetter(capturedArrayBufferPrototype, 'resizable');
const capturedTypedArrayBufferGetter = captureGetter(capturedTypedArrayPrototype, 'buffer');
const capturedTypedArrayByteLengthGetter = captureGetter(capturedTypedArrayPrototype, 'byteLength');
const capturedTypedArrayByteOffsetGetter = captureGetter(capturedTypedArrayPrototype, 'byteOffset');
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured before hostile mutation and invoked only through Reflect.apply.
const capturedArrayBufferSlice = ArrayBuffer.prototype.slice;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured before hostile mutation and invoked only through Reflect.apply.
const capturedBufferAllocUnsafeSlow = Buffer.allocUnsafeSlow;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured before hostile mutation and invoked as a static intrinsic.
const capturedBufferIsBuffer = Buffer.isBuffer;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured before hostile mutation and invoked only through Reflect.apply.
const capturedUint8ArrayFill = Uint8Array.prototype.fill;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured before hostile mutation and invoked only through Reflect.apply.
const capturedUint8ArraySet = Uint8Array.prototype.set;

interface CopiedMySqlTransactionParameters {
  readonly values: readonly unknown[];
  erase(): void;
}

interface BinaryCopyBudget {
  remainingBytes: number;
}

export class InvalidMySqlTransactionParametersError extends Error {
  public constructor() {
    super('Expected valid MySQL transaction parameters');
    this.name = 'InvalidMySqlTransactionParametersError';
  }
}

function invalidParameters(): never {
  throw new InvalidMySqlTransactionParametersError();
}

function readParameterValues(value: unknown, expectedCount: number): readonly unknown[] {
  if (
    capturedIsProxy(value) ||
    !capturedIsArray(value) ||
    capturedGetPrototypeOf(value) !== capturedArrayPrototype
  ) {
    invalidParameters();
  }

  const keys = capturedOwnKeys(value);
  const lengthDescriptor = capturedGetOwnPropertyDescriptor(value, 'length');

  if (
    keys.length !== expectedCount + 1 ||
    lengthDescriptor === undefined ||
    !capturedHasOwn(lengthDescriptor, 'value') ||
    lengthDescriptor.value !== expectedCount
  ) {
    invalidParameters();
  }

  const parameters: unknown[] = [];

  for (let index = 0; index < expectedCount; index += 1) {
    const descriptor = capturedGetOwnPropertyDescriptor(value, String(index));

    if (descriptor === undefined || !capturedHasOwn(descriptor, 'value')) {
      invalidParameters();
    }

    parameters[index] = descriptor.value;
  }

  return parameters;
}

function eraseOwnedBuffers(buffers: Buffer[]): void {
  // Indexing avoids a mutable Array iterator in this credential-adjacent wipe path.
  // eslint-disable-next-line @typescript-eslint/prefer-for-of
  for (let index = 0; index < buffers.length; index += 1) {
    const buffer = buffers[index];

    if (buffer === undefined) continue;

    try {
      capturedReflectApply(capturedUint8ArrayFill, buffer, [0]);
    } catch {
      // Owned buffers are exact, attached Buffer instances. Continue wiping
      // the remaining copies if hostile code nevertheless detached one.
    }
  }

  buffers.length = 0;
}

function copyBinaryParameter(
  value: unknown,
  ownedBuffers: Buffer[],
  budget: BinaryCopyBudget,
): Buffer {
  if (capturedIsProxy(value)) invalidParameters();

  const isBufferValue = capturedBufferIsBuffer(value);

  if (
    (isBufferValue && capturedGetPrototypeOf(value) !== capturedBufferPrototype) ||
    (!isBufferValue &&
      (!capturedIsUint8Array(value) ||
        capturedGetPrototypeOf(value) !== capturedUint8ArrayPrototype))
  ) {
    invalidParameters();
  }

  const view = value as Uint8Array;
  const backingBuffer = capturedReflectApply(capturedTypedArrayBufferGetter, view, []);

  if (
    capturedIsProxy(backingBuffer) ||
    capturedIsSharedArrayBuffer(backingBuffer) ||
    !capturedIsArrayBuffer(backingBuffer) ||
    capturedGetPrototypeOf(backingBuffer) !== capturedArrayBufferPrototype ||
    capturedReflectApply(capturedArrayBufferResizableGetter, backingBuffer, []) !== false
  ) {
    invalidParameters();
  }

  // ArrayBuffer getters can report zero for a detached view. The intrinsic
  // slice operation is the attachment proof and does not touch caller bytes.
  capturedReflectApply(capturedArrayBufferSlice, backingBuffer, [0, 0]);

  const backingByteLength = capturedReflectApply(
    capturedArrayBufferByteLengthGetter,
    backingBuffer,
    [],
  );
  const byteLength = capturedReflectApply(capturedTypedArrayByteLengthGetter, view, []);
  const byteOffset = capturedReflectApply(capturedTypedArrayByteOffsetGetter, view, []);

  if (
    typeof backingByteLength !== 'number' ||
    typeof byteLength !== 'number' ||
    typeof byteOffset !== 'number' ||
    !capturedIsSafeInteger(backingByteLength) ||
    !capturedIsSafeInteger(byteLength) ||
    !capturedIsSafeInteger(byteOffset) ||
    backingByteLength < 0 ||
    byteLength < 0 ||
    byteLength > budget.remainingBytes ||
    byteOffset < 0 ||
    byteOffset + byteLength > backingByteLength
  ) {
    invalidParameters();
  }

  budget.remainingBytes -= byteLength;
  const copy = capturedReflectApply(capturedBufferAllocUnsafeSlow, Buffer, [byteLength]) as Buffer;
  ownedBuffers[ownedBuffers.length] = copy;
  capturedReflectApply(capturedUint8ArraySet, copy, [view, 0]);
  return copy;
}

function copyParameter(value: unknown, ownedBuffers: Buffer[], budget: BinaryCopyBudget): unknown {
  if (
    value === null ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && capturedIsSafeInteger(value))
  ) {
    return value;
  }

  if (typeof value === 'string') {
    if (
      value.length > MAX_STRING_LENGTH ||
      capturedReflectApply(capturedStringIncludes, value, ['\0'])
    ) {
      invalidParameters();
    }

    return value;
  }

  if (typeof value === 'bigint') {
    if (value < MIN_SIGNED_64_BIT_INTEGER || value > MAX_UNSIGNED_64_BIT_INTEGER) {
      invalidParameters();
    }

    return value;
  }

  return copyBinaryParameter(value, ownedBuffers, budget);
}

/** @internal Copies and exclusively owns every mutable transaction parameter. */
export function copyMySqlTransactionParameters(
  value: unknown,
  expectedCount: number,
): CopiedMySqlTransactionParameters {
  const ownedBuffers: Buffer[] = [];
  const binaryCopyBudget: BinaryCopyBudget = {
    remainingBytes: MAX_TOTAL_BINARY_LENGTH,
  };

  try {
    if (
      !capturedIsSafeInteger(expectedCount) ||
      expectedCount < 0 ||
      expectedCount > MAX_PARAMETER_COUNT
    ) {
      invalidParameters();
    }

    const input = readParameterValues(value, expectedCount);
    const copiedValues: unknown[] = [];

    for (let index = 0; index < input.length; index += 1) {
      copiedValues[index] = copyParameter(input[index], ownedBuffers, binaryCopyBudget);
    }

    let erased = false;
    const erase = (): void => {
      if (erased) return;
      erased = true;
      eraseOwnedBuffers(ownedBuffers);
    };

    return capturedFreeze({
      erase,
      values: capturedFreeze(copiedValues),
    });
  } catch {
    eraseOwnedBuffers(ownedBuffers);
    throw new InvalidMySqlTransactionParametersError();
  }
}
