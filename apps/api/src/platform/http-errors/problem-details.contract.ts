import type { RequestIdentity } from '../observability/request-identity';

import type { ProblemDescriptor } from './problem-descriptors';

export const PROBLEM_DETAILS_CONTENT_TYPE = 'application/problem+json; charset=utf-8';
export const PROBLEM_DETAILS_CACHE_CONTROL = 'no-store';

export interface ProblemDetails {
  readonly type: 'about:blank';
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly instance: string;
  readonly requestId: string;
  readonly correlationId: string;
}

export function createProblemDetails(
  descriptor: ProblemDescriptor,
  identity: RequestIdentity,
): ProblemDetails {
  return Object.freeze({
    type: 'about:blank',
    title: descriptor.title,
    status: descriptor.status,
    detail: descriptor.detail,
    instance: `urn:uuid:${identity.requestId}`,
    requestId: identity.requestId,
    correlationId: identity.correlationId,
  });
}
