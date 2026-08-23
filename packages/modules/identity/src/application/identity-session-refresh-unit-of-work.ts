import type { IdentitySessionRefreshCommand } from './identity-session-refresh-command';
import type { IdentitySessionRefreshCommittedCompletion } from './identity-session-refresh-workflow';

export type IdentitySessionRefreshNotCommittedReason =
  'credential-collision' | 'conditional-conflict' | 'unavailable';

export type IdentitySessionRefreshNotCommitted = Readonly<{
  kind: 'not-committed';
  reason: IdentitySessionRefreshNotCommittedReason;
}>;

export type IdentitySessionRefreshIndeterminate = Readonly<{
  kind: 'indeterminate';
}>;

/**
 * Closed transaction outcome. Only the runtime-authentic committed member can
 * authorize the later rotation delivery gate.
 */
export type IdentitySessionRefreshOutcome =
  | IdentitySessionRefreshCommittedCompletion
  | IdentitySessionRefreshNotCommitted
  | IdentitySessionRefreshIndeterminate;

/** Refresh-specific transaction boundary; it accepts no caller callback. */
export interface IdentitySessionRefreshUnitOfWork {
  execute(command: IdentitySessionRefreshCommand): Promise<IdentitySessionRefreshOutcome>;
}

export const IDENTITY_SESSION_REFRESH_NOT_COMMITTED_CREDENTIAL_COLLISION: IdentitySessionRefreshNotCommitted =
  Object.freeze({
    kind: 'not-committed',
    reason: 'credential-collision',
  });

export const IDENTITY_SESSION_REFRESH_NOT_COMMITTED_CONDITIONAL_CONFLICT: IdentitySessionRefreshNotCommitted =
  Object.freeze({
    kind: 'not-committed',
    reason: 'conditional-conflict',
  });

export const IDENTITY_SESSION_REFRESH_NOT_COMMITTED_UNAVAILABLE: IdentitySessionRefreshNotCommitted =
  Object.freeze({
    kind: 'not-committed',
    reason: 'unavailable',
  });

export const IDENTITY_SESSION_REFRESH_INDETERMINATE: IdentitySessionRefreshIndeterminate =
  Object.freeze({
    kind: 'indeterminate',
  });

/**
 * Fixed failure for an unexpected package-owned execution defect after the
 * adapter has independently proved non-commit.
 */
export class IdentitySessionRefreshExecutionFailedError extends Error {
  public constructor() {
    super('Identity session refresh execution failed');
    this.name = 'IdentitySessionRefreshExecutionFailedError';
  }
}
