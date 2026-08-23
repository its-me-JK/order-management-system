import type { IdentityCredentialAbuseNetwork } from './identity-credential-abuse-network';
import type { IdentityRefreshCredentialWireValue } from './identity-session-credential-wire.values';

export const MIN_IDENTITY_CREDENTIAL_ABUSE_RETRY_AFTER_SECONDS = 1;
export const MAX_IDENTITY_CREDENTIAL_ABUSE_RETRY_AFTER_SECONDS = 180;

const capturedFreeze = Object.freeze;
const capturedIsInteger = Number.isInteger;
const capturedReflectApply = Reflect.apply;
// eslint-disable-next-line @typescript-eslint/unbound-method
const capturedWeakSetAdd = WeakSet.prototype.add;
// eslint-disable-next-line @typescript-eslint/unbound-method
const capturedWeakSetHas = WeakSet.prototype.has;

declare const identityCredentialAbuseRetryAfterSecondsBrand: unique symbol;
declare const identityCredentialAbuseDecisionBrand: unique symbol;

/** Whole-second public retry delay for one denied credential-issuance attempt. */
export type IdentityCredentialAbuseRetryAfterSeconds = number &
  Readonly<{
    [identityCredentialAbuseRetryAfterSecondsBrand]: true;
  }>;

export type IdentityCredentialAbuseAllowed = Readonly<{
  kind: 'allowed';
  [identityCredentialAbuseDecisionBrand]: true;
}>;

export type IdentityCredentialAbuseDenied = Readonly<{
  kind: 'denied';
  retryAfterSeconds: IdentityCredentialAbuseRetryAfterSeconds;
  [identityCredentialAbuseDecisionBrand]: true;
}>;

export type IdentityCredentialAbuseDecision =
  IdentityCredentialAbuseAllowed | IdentityCredentialAbuseDenied;

/** Narrow input shape declared for one distributed refresh-admission decision. */
export type IdentitySessionRefreshCredentialAbuseAdmission = Readonly<{
  network: IdentityCredentialAbuseNetwork;
  presentedRefreshCredential: IdentityRefreshCredentialWireValue;
}>;

/**
 * Refresh-specific, state-changing abuse-control port.
 *
 * Implementations atomically decide all configured dimensions. They do not
 * expose which dimension denied the attempt and do not retry an indeterminate
 * provider operation.
 */
export interface IdentitySessionRefreshCredentialAbuseControl {
  admitSessionRefresh(
    input: IdentitySessionRefreshCredentialAbuseAdmission,
  ): Promise<IdentityCredentialAbuseDecision>;
}

export class IdentityCredentialAbuseControlUnavailableError extends Error {
  public constructor() {
    super('Identity credential abuse control is temporarily unavailable');
    this.name = 'IdentityCredentialAbuseControlUnavailableError';
  }
}

/** Internal, cause-free failure for invalid abuse-control values or transitions. */
export class IdentityCredentialAbuseControlError extends Error {
  public constructor() {
    super('Identity credential abuse control failed');
    this.name = 'IdentityCredentialAbuseControlError';
  }
}

const decisionRegistrations = new WeakSet<object>();

function controlFailed(): never {
  throw new IdentityCredentialAbuseControlError();
}

function registerDecision<Decision extends IdentityCredentialAbuseDecision>(
  decision: Decision,
): Decision {
  capturedReflectApply(capturedWeakSetAdd, decisionRegistrations, [decision]);
  return decision;
}

const IDENTITY_CREDENTIAL_ABUSE_ALLOWED = registerDecision(
  capturedFreeze({ kind: 'allowed' as const }) as IdentityCredentialAbuseAllowed,
);

export function parseIdentityCredentialAbuseRetryAfterSeconds(
  value: unknown,
): IdentityCredentialAbuseRetryAfterSeconds {
  if (
    !capturedIsInteger(value) ||
    (value as number) < MIN_IDENTITY_CREDENTIAL_ABUSE_RETRY_AFTER_SECONDS ||
    (value as number) > MAX_IDENTITY_CREDENTIAL_ABUSE_RETRY_AFTER_SECONDS
  ) {
    controlFailed();
  }

  return value as IdentityCredentialAbuseRetryAfterSeconds;
}

/** @internal Returns the canonical allowed classification for an Identity adapter. */
export function createIdentityCredentialAbuseAllowedDecision(): IdentityCredentialAbuseAllowed {
  return IDENTITY_CREDENTIAL_ABUSE_ALLOWED;
}

/** @internal Mints a denial without disclosing its limiting dimension. */
export function createIdentityCredentialAbuseDeniedDecision(
  retryAfterSecondsValue: unknown,
): IdentityCredentialAbuseDenied {
  const retryAfterSeconds = parseIdentityCredentialAbuseRetryAfterSeconds(retryAfterSecondsValue);

  return registerDecision(
    capturedFreeze({
      kind: 'denied' as const,
      retryAfterSeconds,
    }) as IdentityCredentialAbuseDenied,
  );
}

/** @internal Rejects structural, cloned, proxied, or foreign decision values. */
export function authenticateIdentityCredentialAbuseDecision(
  value: unknown,
): IdentityCredentialAbuseDecision {
  try {
    if (
      (typeof value !== 'object' && typeof value !== 'function') ||
      value === null ||
      !capturedReflectApply(capturedWeakSetHas, decisionRegistrations, [value])
    ) {
      controlFailed();
    }

    return value as IdentityCredentialAbuseDecision;
  } catch {
    controlFailed();
  }
}
