import { parseIdentityAccountId, type IdentityAccountId } from '../domain/identity-account.values';
import {
  parseIdentityRefreshCredentialId,
  type IdentityRefreshCredentialId,
} from '../domain/identity-refresh-credential.values';
import {
  parseIdentitySessionId,
  type IdentitySessionId,
} from '../domain/identity-session-family.values';
import {
  copyIdentityRefreshCredentialDigestBytes,
  type IdentityRefreshCredentialDigest,
} from './identity-session-credential-digest.values';

const IDENTITY_SESSION_REFRESH_DISCOVERY_PROJECTION_KEYS = Object.freeze([
  'accountId',
  'sessionId',
  'presentedRefreshCredentialId',
] as const);

declare const identitySessionRefreshDiscoveryFoundTicketBrand: unique symbol;
declare const identitySessionRefreshDiscoveryBoundaryAuthorityBrand: unique symbol;

/** Opaque authority shared only by one discovery adapter and its matching locked loader. */
export type IdentitySessionRefreshDiscoveryBoundaryAuthority = Readonly<{
  readonly [identitySessionRefreshDiscoveryBoundaryAuthorityBrand]: true;
}>;

export type IdentitySessionRefreshDiscoveryFoundTicket = Readonly<{
  kind: 'found';
  accountId: IdentityAccountId;
  sessionId: IdentitySessionId;
  presentedRefreshCredentialId: IdentityRefreshCredentialId;
  readonly [identitySessionRefreshDiscoveryFoundTicketBrand]: true;
}>;

export type IdentitySessionRefreshDiscoveryNotFound = Readonly<{
  kind: 'not-found';
}>;

export type IdentitySessionRefreshDiscoveryResult =
  IdentitySessionRefreshDiscoveryNotFound | IdentitySessionRefreshDiscoveryFoundTicket;

/** Private binding recovered exactly once by the matching locked loader. */
export type ConsumedIdentitySessionRefreshDiscoveryTicket = Readonly<{
  refreshCredentialDigest: IdentityRefreshCredentialDigest;
  accountId: IdentityAccountId;
  sessionId: IdentitySessionId;
  presentedRefreshCredentialId: IdentityRefreshCredentialId;
}>;

export class InvalidIdentitySessionRefreshDiscoveryTicketError extends Error {
  public constructor() {
    super('Expected a valid Identity session refresh discovery ticket');
    this.name = 'InvalidIdentitySessionRefreshDiscoveryTicketError';
  }
}

export class IdentitySessionRefreshDiscoveryUnavailableError extends Error {
  public constructor() {
    super('Identity session refresh discovery is temporarily unavailable');
    this.name = 'IdentitySessionRefreshDiscoveryUnavailableError';
  }
}

/** Internal, cause-free failure for query or persisted-projection defects. */
export class IdentitySessionRefreshDiscoveryPersistenceError extends Error {
  public constructor() {
    super('Identity session refresh discovery failed');
    this.name = 'IdentitySessionRefreshDiscoveryPersistenceError';
  }
}

/**
 * Non-locking lookup for every retained refresh digest.
 *
 * Implementations authenticate and copy the digest before issuing a query,
 * never filter lifecycle state, and collapse recognized availability failures
 * to `IdentitySessionRefreshDiscoveryUnavailableError`.
 */
export interface IdentitySessionRefreshDiscovery {
  findByRefreshCredentialDigest(
    refreshCredentialDigest: IdentityRefreshCredentialDigest,
  ): Promise<IdentitySessionRefreshDiscoveryResult>;
}

export const IDENTITY_SESSION_REFRESH_DISCOVERY_NOT_FOUND: IdentitySessionRefreshDiscoveryNotFound =
  Object.freeze({ kind: 'not-found' });

type IdentitySessionRefreshDiscoveryTicketRegistration = Readonly<{
  authority: IdentitySessionRefreshDiscoveryBoundaryAuthority;
  refreshCredentialDigest: IdentityRefreshCredentialDigest;
  accountId: IdentityAccountId;
  sessionId: IdentitySessionId;
  presentedRefreshCredentialId: IdentityRefreshCredentialId;
}>;

const identitySessionRefreshDiscoveryAuthorities = new WeakSet<object>();
const identitySessionRefreshDiscoveryTicketRegistrations = new WeakMap<
  object,
  IdentitySessionRefreshDiscoveryTicketRegistration
>();

function invalidTicket(): never {
  throw new InvalidIdentitySessionRefreshDiscoveryTicketError();
}

function authenticateAuthority(value: unknown): IdentitySessionRefreshDiscoveryBoundaryAuthority {
  if (
    typeof value !== 'object' ||
    value === null ||
    !identitySessionRefreshDiscoveryAuthorities.has(value)
  ) {
    invalidTicket();
  }

  return value as IdentitySessionRefreshDiscoveryBoundaryAuthority;
}

function authenticateRefreshCredentialDigest(value: unknown): IdentityRefreshCredentialDigest {
  let copiedBytes: Uint8Array<ArrayBuffer> | undefined;

  try {
    copiedBytes = copyIdentityRefreshCredentialDigestBytes(
      value as IdentityRefreshCredentialDigest,
    );
    copiedBytes.fill(0);

    return value as IdentityRefreshCredentialDigest;
  } catch {
    if (copiedBytes !== undefined) {
      try {
        copiedBytes.fill(0);
      } catch {
        // Validation fails closed below; cleanup is best effort for this bounded copy.
      }
    }

    invalidTicket();
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactProjectionKeys(value: Readonly<Record<string, unknown>>): boolean {
  const keys = Reflect.ownKeys(value);

  return (
    keys.length === IDENTITY_SESSION_REFRESH_DISCOVERY_PROJECTION_KEYS.length &&
    keys.every(
      (key) =>
        typeof key === 'string' &&
        IDENTITY_SESSION_REFRESH_DISCOVERY_PROJECTION_KEYS.some(
          (expectedKey) => expectedKey === key,
        ),
    )
  );
}

function parseFoundProjection(value: unknown): Readonly<{
  accountId: IdentityAccountId;
  sessionId: IdentitySessionId;
  presentedRefreshCredentialId: IdentityRefreshCredentialId;
}> {
  if (!isRecord(value) || !hasExactProjectionKeys(value)) {
    invalidTicket();
  }

  return Object.freeze({
    accountId: parseIdentityAccountId(value['accountId']),
    sessionId: parseIdentitySessionId(value['sessionId']),
    presentedRefreshCredentialId: parseIdentityRefreshCredentialId(
      value['presentedRefreshCredentialId'],
    ),
  });
}

/** Creates one empty, frozen authority for a paired discovery/loader boundary. */
export function createIdentitySessionRefreshDiscoveryBoundaryAuthority(): IdentitySessionRefreshDiscoveryBoundaryAuthority {
  const authority = Object.freeze({}) as IdentitySessionRefreshDiscoveryBoundaryAuthority;
  identitySessionRefreshDiscoveryAuthorities.add(authority);

  return authority;
}

/**
 * Creates a runtime-authentic ticket after a successful non-locking lookup.
 * The exact projection is validated before the ticket registry is mutated.
 */
export function createIdentitySessionRefreshDiscoveryFoundTicket(
  authorityValue: IdentitySessionRefreshDiscoveryBoundaryAuthority,
  refreshCredentialDigestValue: IdentityRefreshCredentialDigest,
  projectionValue: unknown,
): IdentitySessionRefreshDiscoveryFoundTicket {
  try {
    const authority = authenticateAuthority(authorityValue);
    const refreshCredentialDigest = authenticateRefreshCredentialDigest(
      refreshCredentialDigestValue,
    );
    const projection = parseFoundProjection(projectionValue);
    const ticket = Object.freeze({
      kind: 'found' as const,
      accountId: projection.accountId,
      sessionId: projection.sessionId,
      presentedRefreshCredentialId: projection.presentedRefreshCredentialId,
    }) as IdentitySessionRefreshDiscoveryFoundTicket;

    identitySessionRefreshDiscoveryTicketRegistrations.set(
      ticket,
      Object.freeze({
        authority,
        refreshCredentialDigest,
        accountId: projection.accountId,
        sessionId: projection.sessionId,
        presentedRefreshCredentialId: projection.presentedRefreshCredentialId,
      }),
    );

    return ticket;
  } catch {
    invalidTicket();
  }
}

/**
 * Consumes one ticket before the matching locked loader issues its first query.
 * A rejected consume never changes any authentic ticket registration.
 */
export function consumeIdentitySessionRefreshDiscoveryFoundTicket(
  authorityValue: IdentitySessionRefreshDiscoveryBoundaryAuthority,
  ticketValue: IdentitySessionRefreshDiscoveryFoundTicket,
): ConsumedIdentitySessionRefreshDiscoveryTicket;
export function consumeIdentitySessionRefreshDiscoveryFoundTicket(
  authorityValue: unknown,
  ticketValue: unknown,
): ConsumedIdentitySessionRefreshDiscoveryTicket {
  try {
    const authority = authenticateAuthority(authorityValue);

    if (typeof ticketValue !== 'object' || ticketValue === null) {
      invalidTicket();
    }

    const registration = identitySessionRefreshDiscoveryTicketRegistrations.get(ticketValue);

    if (registration?.authority !== authority) {
      invalidTicket();
    }

    const consumed = Object.freeze({
      refreshCredentialDigest: registration.refreshCredentialDigest,
      accountId: registration.accountId,
      sessionId: registration.sessionId,
      presentedRefreshCredentialId: registration.presentedRefreshCredentialId,
    });

    if (!identitySessionRefreshDiscoveryTicketRegistrations.delete(ticketValue)) {
      invalidTicket();
    }

    return consumed;
  } catch {
    invalidTicket();
  }
}
