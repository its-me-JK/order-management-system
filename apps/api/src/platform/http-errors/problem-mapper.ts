import { HttpException } from '@nestjs/common';

import {
  internalServerErrorDescriptor,
  type ProblemDescriptor,
  problemDescriptorForStatus,
} from './problem-descriptors';

const PARSER_ERROR_STATUSES = Object.freeze({
  'charset.unsupported': 415,
  'encoding.unsupported': 415,
  'entity.parse.failed': 400,
  'entity.too.large': 413,
  'request.aborted': 400,
  'request.size.invalid': 400,
} as const);

export interface ProblemMapping {
  readonly descriptor: ProblemDescriptor;
  readonly unexpected: boolean;
}

function readField(record: object, fieldName: string): unknown {
  try {
    return Reflect.get(record, fieldName) as unknown;
  } catch {
    return undefined;
  }
}

function httpExceptionStatus(exception: HttpException): number | undefined {
  try {
    return exception.getStatus();
  } catch {
    return undefined;
  }
}

function parserErrorStatus(exception: unknown): number | undefined {
  if (!(exception instanceof Error)) {
    return undefined;
  }

  const type = readField(exception, 'type');

  if (typeof type !== 'string' || !Object.hasOwn(PARSER_ERROR_STATUSES, type)) {
    return undefined;
  }

  const expectedStatus = PARSER_ERROR_STATUSES[type as keyof typeof PARSER_ERROR_STATUSES];
  const status = readField(exception, 'status');
  const statusCode = readField(exception, 'statusCode');
  const expose = readField(exception, 'expose');

  if (
    expose !== true ||
    (status !== undefined && status !== expectedStatus) ||
    (statusCode !== undefined && statusCode !== expectedStatus) ||
    (status !== expectedStatus && statusCode !== expectedStatus)
  ) {
    return undefined;
  }

  return expectedStatus;
}

function unexpectedProblem(): ProblemMapping {
  return {
    descriptor: internalServerErrorDescriptor(),
    unexpected: true,
  };
}

function mapException(exception: unknown): ProblemMapping {
  if (exception instanceof HttpException) {
    const status = httpExceptionStatus(exception);
    const descriptor = status === undefined ? undefined : problemDescriptorForStatus(status);

    return descriptor === undefined
      ? unexpectedProblem()
      : { descriptor, unexpected: descriptor.status >= 500 };
  }

  const parserStatus = parserErrorStatus(exception);
  const parserDescriptor =
    parserStatus === undefined ? undefined : problemDescriptorForStatus(parserStatus);

  return parserDescriptor === undefined
    ? unexpectedProblem()
    : { descriptor: parserDescriptor, unexpected: false };
}

export function mapExceptionToProblem(exception: unknown): ProblemMapping {
  try {
    return mapException(exception);
  } catch {
    return unexpectedProblem();
  }
}
