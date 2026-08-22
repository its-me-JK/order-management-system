export const SUPPORTED_PROBLEM_STATUSES = [
  400, 403, 404, 408, 409, 413, 415, 422, 429, 500, 502, 503, 504,
] as const;

export type SupportedProblemStatus = (typeof SUPPORTED_PROBLEM_STATUSES)[number];

export interface ProblemDescriptor {
  readonly status: SupportedProblemStatus;
  readonly title: string;
  readonly detail: string;
}

const PROBLEM_DESCRIPTORS: Readonly<Record<SupportedProblemStatus, ProblemDescriptor>> =
  Object.freeze({
    400: Object.freeze({
      status: 400,
      title: 'Bad Request',
      detail: 'The request is invalid.',
    }),
    403: Object.freeze({
      status: 403,
      title: 'Forbidden',
      detail: 'You are not allowed to perform this operation.',
    }),
    404: Object.freeze({
      status: 404,
      title: 'Not Found',
      detail: 'The requested resource was not found.',
    }),
    408: Object.freeze({
      status: 408,
      title: 'Request Timeout',
      detail: 'The request did not complete within the allowed time.',
    }),
    409: Object.freeze({
      status: 409,
      title: 'Conflict',
      detail: 'The request conflicts with the current resource state.',
    }),
    413: Object.freeze({
      status: 413,
      title: 'Content Too Large',
      detail: 'The request content exceeds the allowed size.',
    }),
    415: Object.freeze({
      status: 415,
      title: 'Unsupported Media Type',
      detail: 'The request media type is not supported.',
    }),
    422: Object.freeze({
      status: 422,
      title: 'Unprocessable Content',
      detail: 'The request is well formed but cannot be processed.',
    }),
    429: Object.freeze({
      status: 429,
      title: 'Too Many Requests',
      detail: 'Too many requests were received. Retry later.',
    }),
    500: Object.freeze({
      status: 500,
      title: 'Internal Server Error',
      detail: 'The service could not complete the request.',
    }),
    502: Object.freeze({
      status: 502,
      title: 'Bad Gateway',
      detail: 'An upstream service returned an invalid response.',
    }),
    503: Object.freeze({
      status: 503,
      title: 'Service Unavailable',
      detail: 'The service is temporarily unavailable.',
    }),
    504: Object.freeze({
      status: 504,
      title: 'Gateway Timeout',
      detail: 'An upstream service did not respond in time.',
    }),
  });

export function problemDescriptorForStatus(status: number): ProblemDescriptor | undefined {
  if (!SUPPORTED_PROBLEM_STATUSES.some((supportedStatus): boolean => supportedStatus === status)) {
    return undefined;
  }

  return PROBLEM_DESCRIPTORS[status as SupportedProblemStatus];
}

export function internalServerErrorDescriptor(): ProblemDescriptor {
  return PROBLEM_DESCRIPTORS[500];
}
