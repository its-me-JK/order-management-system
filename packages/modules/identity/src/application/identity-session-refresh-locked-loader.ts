import type { IdentitySessionRefreshDiscoveryFoundTicket } from './identity-session-refresh-discovery';
import type {
  IdentitySessionRefreshLockedLoadResult,
  IdentityTransactionScope,
} from './identity-session-refresh-workflow';

export class IdentitySessionRefreshLockedLoadUnavailableError extends Error {
  public constructor() {
    super('Identity session refresh locked load is temporarily unavailable');
    this.name = 'IdentitySessionRefreshLockedLoadUnavailableError';
  }
}

/** Internal, cause-free failure for query, projection, or rehydration defects. */
export class IdentitySessionRefreshLockedLoadPersistenceError extends Error {
  public constructor() {
    super('Identity session refresh locked load failed');
    this.name = 'IdentitySessionRefreshLockedLoadPersistenceError';
  }
}

/** Transaction-scoped, deterministic locked load for one authentic discovery ticket. */
export interface IdentitySessionRefreshLockedLoader {
  loadForUpdate(
    scope: IdentityTransactionScope,
    ticket: IdentitySessionRefreshDiscoveryFoundTicket,
  ): Promise<IdentitySessionRefreshLockedLoadResult>;
}
