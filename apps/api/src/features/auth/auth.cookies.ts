import type { Request } from 'express';

const REFRESH_COOKIE_NAME = 'oms_refresh';
const AUTH_COOKIE_PATH = '/api/v1/auth';

function secureAttribute(): string {
  return process.env['NODE_ENV'] === 'production' ? '; Secure' : '';
}

export function createRefreshCookie(refreshToken: string, expiresAt: Date): string {
  const maxAgeSeconds = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1_000));

  return `${REFRESH_COOKIE_NAME}=${refreshToken}; Path=${AUTH_COOKIE_PATH}; HttpOnly; SameSite=Strict; Max-Age=${String(maxAgeSeconds)}${secureAttribute()}`;
}

export function createClearedRefreshCookie(): string {
  return `${REFRESH_COOKIE_NAME}=; Path=${AUTH_COOKIE_PATH}; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secureAttribute()}`;
}

export function readRefreshCookie(request: Request): string | undefined {
  const cookieHeader = request.headers.cookie;

  if (cookieHeader === undefined) return undefined;

  let result: string | undefined;

  for (const segment of cookieHeader.split(';')) {
    const candidate = segment.trim();
    const separator = candidate.indexOf('=');

    if (separator <= 0 || candidate.slice(0, separator) !== REFRESH_COOKIE_NAME) continue;
    if (result !== undefined) return undefined;

    const value = candidate.slice(separator + 1);

    if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) return undefined;
    result = value;
  }

  return result;
}
