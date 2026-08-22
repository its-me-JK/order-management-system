const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UUID_BYTE_LENGTH = 16;

export class InvalidUuidV7Error extends Error {
  public constructor() {
    super('Expected a canonical lowercase RFC 9562 UUIDv7');
    this.name = 'InvalidUuidV7Error';
  }
}

function assertUuidV7Bytes(value: Uint8Array): void {
  if (!(value instanceof Uint8Array)) {
    throw new InvalidUuidV7Error();
  }

  const versionByte = value[6];
  const variantByte = value[8];

  if (
    value.byteLength !== UUID_BYTE_LENGTH ||
    versionByte === undefined ||
    variantByte === undefined ||
    (versionByte & 0xf0) !== 0x70 ||
    (variantByte & 0xc0) !== 0x80
  ) {
    throw new InvalidUuidV7Error();
  }
}

function hexadecimalByte(value: number): string {
  return value.toString(16).padStart(2, '0');
}

/** Converts canonical UUIDv7 strings to and from natural RFC byte order. */
export class BinaryUuidCodec {
  public toBytes(value: string): Uint8Array<ArrayBuffer> {
    if (!UUID_V7_PATTERN.test(value)) {
      throw new InvalidUuidV7Error();
    }

    const hexadecimal = value.replaceAll('-', '');
    const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(UUID_BYTE_LENGTH);

    for (let index = 0; index < UUID_BYTE_LENGTH; index += 1) {
      const byteStart = index * 2;
      bytes[index] = Number.parseInt(hexadecimal.slice(byteStart, byteStart + 2), 16);
    }

    return bytes;
  }

  public fromBytes(value: Uint8Array): string {
    assertUuidV7Bytes(value);

    const hexadecimal = Array.from(value, hexadecimalByte).join('');

    return [
      hexadecimal.slice(0, 8),
      hexadecimal.slice(8, 12),
      hexadecimal.slice(12, 16),
      hexadecimal.slice(16, 20),
      hexadecimal.slice(20),
    ].join('-');
  }
}
