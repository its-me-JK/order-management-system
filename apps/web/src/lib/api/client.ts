import type { ZodType } from 'zod';

import { problemDetailsSchema } from './contracts';

const configuredOrigin = process.env.NEXT_PUBLIC_API_ORIGIN?.trim();

function parseConfiguredOrigin(value: string | undefined): string {
  if (value === undefined || value === '') {
    return '';
  }

  const parsed = new URL(value);

  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== value) {
    throw new Error('NEXT_PUBLIC_API_ORIGIN must be an exact HTTP(S) origin');
  }

  return parsed.origin;
}

const apiOrigin = parseConfiguredOrigin(configuredOrigin);

export interface ApiRequestOptions<T> {
  readonly accessToken?: string;
  readonly body?: unknown;
  readonly csrfToken?: string;
  readonly idempotencyKey?: string;
  readonly method?: 'DELETE' | 'GET' | 'PATCH' | 'POST';
  readonly schema?: ZodType<T>;
  readonly signal?: AbortSignal;
}

export class ApiError extends Error {
  public readonly correlationId: string | null;
  public readonly detail: string;
  public readonly status: number;

  public constructor(status: number, detail: string, correlationId: string | null) {
    super(detail);
    this.name = 'ApiError';
    this.correlationId = correlationId;
    this.detail = detail;
    this.status = status;
  }
}

export class ApiContractError extends Error {
  public constructor() {
    super('The server returned an unexpected response.');
    this.name = 'ApiContractError';
  }
}

function requestId(): string {
  return globalThis.crypto.randomUUID();
}

export function apiUrl(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new TypeError('API request paths must be root-relative');
  }

  return `${apiOrigin}${path}`;
}

async function responseJson(response: Response): Promise<unknown> {
  const text = await response.text();

  if (text === '') {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiContractError();
  }
}

export async function apiRequest<T = void>(
  path: string,
  options: ApiRequestOptions<T> = {},
): Promise<T> {
  const headers = new Headers({
    Accept: 'application/json',
    'X-Correlation-Id': requestId(),
  });

  if (options.accessToken !== undefined) {
    headers.set('Authorization', `Bearer ${options.accessToken}`);
  }

  if (options.csrfToken !== undefined) {
    headers.set('X-CSRF-Token', options.csrfToken);
  }

  if (options.idempotencyKey !== undefined) {
    headers.set('Idempotency-Key', options.idempotencyKey);
  }

  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(apiUrl(path), {
    cache: 'no-store',
    credentials: 'include',
    headers,
    method: options.method ?? 'GET',
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  const payload = await responseJson(response);

  if (!response.ok) {
    const problem = problemDetailsSchema.safeParse(payload);
    const detail = problem.success
      ? (problem.data.detail ?? problem.data.title ?? 'The request could not be completed.')
      : 'The request could not be completed.';

    throw new ApiError(response.status, detail, response.headers.get('X-Correlation-Id'));
  }

  if (options.schema === undefined) {
    return undefined as T;
  }

  const parsed = options.schema.safeParse(payload);

  if (!parsed.success) {
    throw new ApiContractError();
  }

  return parsed.data;
}

export async function apiHealth(signal?: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(apiUrl('/health/ready'), {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      ...(signal === undefined ? {} : { signal }),
    });

    return response.ok;
  } catch {
    return false;
  }
}

export function apiErrorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof ApiContractError) {
    return error.message;
  }

  return 'Something went wrong. Please try again.';
}
