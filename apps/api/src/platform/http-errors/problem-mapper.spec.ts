import { BadRequestException, HttpException, ServiceUnavailableException } from '@nestjs/common';

import { SUPPORTED_PROBLEM_STATUSES, type SupportedProblemStatus } from './problem-descriptors';
import { mapExceptionToProblem } from './problem-mapper';

type ExpectedDescriptor = Readonly<{ detail: string; title: string }>;

const EXPECTED_DESCRIPTORS: Readonly<Record<SupportedProblemStatus, ExpectedDescriptor>> = {
  400: {
    title: 'Bad Request',
    detail: 'The request is invalid.',
  },
  401: {
    title: 'Unauthorized',
    detail: 'Authentication is required.',
  },
  403: {
    title: 'Forbidden',
    detail: 'You are not allowed to perform this operation.',
  },
  404: {
    title: 'Not Found',
    detail: 'The requested resource was not found.',
  },
  408: {
    title: 'Request Timeout',
    detail: 'The request did not complete within the allowed time.',
  },
  409: {
    title: 'Conflict',
    detail: 'The request conflicts with the current resource state.',
  },
  413: {
    title: 'Content Too Large',
    detail: 'The request content exceeds the allowed size.',
  },
  415: {
    title: 'Unsupported Media Type',
    detail: 'The request media type is not supported.',
  },
  422: {
    title: 'Unprocessable Content',
    detail: 'The request is well formed but cannot be processed.',
  },
  429: {
    title: 'Too Many Requests',
    detail: 'Too many requests were received. Retry later.',
  },
  500: {
    title: 'Internal Server Error',
    detail: 'The service could not complete the request.',
  },
  502: {
    title: 'Bad Gateway',
    detail: 'An upstream service returned an invalid response.',
  },
  503: {
    title: 'Service Unavailable',
    detail: 'The service is temporarily unavailable.',
  },
  504: {
    title: 'Gateway Timeout',
    detail: 'An upstream service did not respond in time.',
  },
};

function parserError(type: string, status: number): Error {
  return Object.assign(new SyntaxError('untrusted parser detail'), {
    expose: true,
    status,
    statusCode: status,
    type,
  });
}

describe('Problem mapper', (): void => {
  it.each(SUPPORTED_PROBLEM_STATUSES)(
    'maps the supported HTTP status %i to its owned descriptor',
    (status): void => {
      const mapping = mapExceptionToProblem(new HttpException('untrusted detail', status));

      expect(mapping).toEqual({
        descriptor: {
          status,
          ...EXPECTED_DESCRIPTORS[status],
        },
        unexpected: status >= 500,
      });
    },
  );

  it.each([
    new BadRequestException('secret string'),
    new BadRequestException({ message: 'secret object', token: 'secret token' }),
    new BadRequestException(['secret array']),
    new ServiceUnavailableException({ detail: 'private dependency response' }),
  ])('ignores every HttpException response representation', (exception): void => {
    const mapping = mapExceptionToProblem(exception);

    expect(mapping.descriptor.status).toBe(exception.getStatus());
    expect(mapping.descriptor.detail).not.toContain('secret');
    expect(mapping.descriptor.detail).not.toContain('private');
    expect(mapping.unexpected).toBe(exception.getStatus() >= 500);
  });

  it.each([
    ['entity.parse.failed', 400],
    ['request.aborted', 400],
    ['request.size.invalid', 400],
    ['entity.too.large', 413],
    ['charset.unsupported', 415],
    ['encoding.unsupported', 415],
  ] as const)('maps only the recognized parser error %s', (type, status): void => {
    expect(mapExceptionToProblem(parserError(type, status))).toMatchObject({
      descriptor: { status },
      unexpected: false,
    });
  });

  it.each([
    new Error('private failure'),
    'primitive failure',
    null,
    { message: 'spoofed', statusCode: 401 },
    parserError('entity.too.large', 400),
    Object.assign(new Error('spoofed parser'), {
      expose: false,
      status: 413,
      statusCode: 413,
      type: 'entity.too.large',
    }),
    new HttpException('unsupported status', 418),
    new HttpException('invalid status', 200),
  ])('fails an untrusted or unsupported exception closed to 500', (exception): void => {
    expect(mapExceptionToProblem(exception)).toEqual({
      descriptor: {
        status: 500,
        title: 'Internal Server Error',
        detail: 'The service could not complete the request.',
      },
      unexpected: true,
    });
  });

  it('fails a hostile thrown proxy closed without executing the filter boundary', (): void => {
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf(): never {
          throw new Error('hostile prototype trap');
        },
      },
    );

    expect(mapExceptionToProblem(hostile)).toMatchObject({
      descriptor: { status: 500 },
      unexpected: true,
    });
  });
});
