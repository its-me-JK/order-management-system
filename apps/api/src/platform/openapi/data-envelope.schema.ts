import type { Type } from '@nestjs/common';
import { getSchemaPath, type SchemaObject } from '@nestjs/swagger';

export function dataEnvelopeSchema(model: Type<unknown>, collection = false): SchemaObject {
  const modelReference = getSchemaPath(model);

  return {
    additionalProperties: false,
    properties: {
      data: collection
        ? { items: { $ref: modelReference }, type: 'array' }
        : { $ref: modelReference },
    },
    required: ['data'],
    type: 'object',
  };
}
