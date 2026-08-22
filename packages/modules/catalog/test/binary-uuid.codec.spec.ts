import { BinaryUuidCodec, InvalidUuidV7Error } from '../src/infrastructure/identifiers';

const UUID = '01890f3a-8bcd-7def-8abc-0123456789ab';
const NATURAL_UUID_BYTES = Uint8Array.from([
  0x01, 0x89, 0x0f, 0x3a, 0x8b, 0xcd, 0x7d, 0xef, 0x8a, 0xbc, 0x01, 0x23, 0x45, 0x67, 0x89, 0xab,
]);

describe('BinaryUuidCodec', (): void => {
  const codec = new BinaryUuidCodec();

  it('encodes a canonical UUIDv7 in natural RFC byte order', (): void => {
    expect(codec.toBytes(UUID)).toEqual(NATURAL_UUID_BYTES);
  });

  it('decodes natural RFC bytes without applying MySQL UUID byte swapping', (): void => {
    expect(codec.fromBytes(NATURAL_UUID_BYTES)).toBe(UUID);
  });

  it('round trips the boundary UUIDv7 bit pattern', (): void => {
    const uuid = '00000000-0000-7000-8000-000000000000';

    expect(codec.fromBytes(codec.toBytes(uuid))).toBe(uuid);
  });

  it('returns independent byte buffers for independent encodes', (): void => {
    const first = codec.toBytes(UUID);
    const second = codec.toBytes(UUID);

    first[0] = 0xff;

    expect(second).toEqual(NATURAL_UUID_BYTES);
  });

  it.each([
    UUID.toUpperCase(),
    '01890f3a-8bcd-4def-8abc-0123456789ab',
    '01890f3a-8bcd-7def-7abc-0123456789ab',
    '01890f3a8bcd7def8abc0123456789ab',
    `{${UUID}}`,
    ` ${UUID}`,
    `${UUID} `,
  ])('rejects a noncanonical or non-v7 UUID string: %s', (uuid): void => {
    expect(() => codec.toBytes(uuid)).toThrow(InvalidUuidV7Error);
  });

  it.each([
    Uint8Array.from([]),
    Uint8Array.from({ length: 15 }, (): number => 0),
    Uint8Array.from({ length: 17 }, (): number => 0),
    Uint8Array.from([
      0x01, 0x89, 0x0f, 0x3a, 0x8b, 0xcd, 0x4d, 0xef, 0x8a, 0xbc, 0x01, 0x23, 0x45, 0x67, 0x89,
      0xab,
    ]),
    Uint8Array.from([
      0x01, 0x89, 0x0f, 0x3a, 0x8b, 0xcd, 0x7d, 0xef, 0x4a, 0xbc, 0x01, 0x23, 0x45, 0x67, 0x89,
      0xab,
    ]),
  ])('rejects invalid UUIDv7 bytes', (bytes): void => {
    expect(() => codec.fromBytes(bytes)).toThrow(InvalidUuidV7Error);
  });

  it('rejects a non-binary value received across an untyped runtime boundary', (): void => {
    expect(() => codec.fromBytes([] as unknown as Uint8Array)).toThrow(InvalidUuidV7Error);
  });

  it('accepts a Node.js Buffer view without changing its bytes', (): void => {
    const bytes = Buffer.from(NATURAL_UUID_BYTES);
    const snapshot = Buffer.from(bytes);

    expect(codec.fromBytes(bytes)).toBe(UUID);
    expect(bytes).toEqual(snapshot);
  });
});
