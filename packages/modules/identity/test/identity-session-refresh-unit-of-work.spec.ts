import { inspect } from 'node:util';

import type { IdentitySessionRefreshCommand } from '../src/application/identity-session-refresh-command';
import {
  IDENTITY_SESSION_REFRESH_INDETERMINATE,
  IDENTITY_SESSION_REFRESH_NOT_COMMITTED_CONDITIONAL_CONFLICT,
  IDENTITY_SESSION_REFRESH_NOT_COMMITTED_CREDENTIAL_COLLISION,
  IDENTITY_SESSION_REFRESH_NOT_COMMITTED_UNAVAILABLE,
  IdentitySessionRefreshExecutionFailedError,
  type IdentitySessionRefreshNotCommittedReason,
  type IdentitySessionRefreshOutcome,
  type IdentitySessionRefreshUnitOfWork,
} from '../src/application/identity-session-refresh-unit-of-work';
import type {
  IdentitySessionRefreshCommittedCompletion,
  IdentityTransactionEvidence,
} from '../src/application/identity-session-refresh-workflow';
import * as identityPublicApi from '../src';

describe('Identity session refresh Unit of Work contract', (): void => {
  it('provides the three exact frozen non-commit result representations', (): void => {
    expect(IDENTITY_SESSION_REFRESH_NOT_COMMITTED_CREDENTIAL_COLLISION).toEqual({
      kind: 'not-committed',
      reason: 'credential-collision',
    });
    expect(IDENTITY_SESSION_REFRESH_NOT_COMMITTED_CONDITIONAL_CONFLICT).toEqual({
      kind: 'not-committed',
      reason: 'conditional-conflict',
    });
    expect(IDENTITY_SESSION_REFRESH_NOT_COMMITTED_UNAVAILABLE).toEqual({
      kind: 'not-committed',
      reason: 'unavailable',
    });

    for (const outcome of [
      IDENTITY_SESSION_REFRESH_NOT_COMMITTED_CREDENTIAL_COLLISION,
      IDENTITY_SESSION_REFRESH_NOT_COMMITTED_CONDITIONAL_CONFLICT,
      IDENTITY_SESSION_REFRESH_NOT_COMMITTED_UNAVAILABLE,
    ]) {
      expect(Reflect.ownKeys(outcome)).toEqual(['kind', 'reason']);
      expect(Object.isFrozen(outcome)).toBe(true);
    }
  });

  it('provides one metadata-free frozen indeterminate outcome', (): void => {
    expect(IDENTITY_SESSION_REFRESH_INDETERMINATE).toEqual({ kind: 'indeterminate' });
    expect(Reflect.ownKeys(IDENTITY_SESSION_REFRESH_INDETERMINATE)).toEqual(['kind']);
    expect(Object.isFrozen(IDENTITY_SESSION_REFRESH_INDETERMINATE)).toBe(true);
    expect(IDENTITY_SESSION_REFRESH_INDETERMINATE).not.toHaveProperty('reason');
    expect(IDENTITY_SESSION_REFRESH_INDETERMINATE).not.toHaveProperty('evidence');
  });

  it('fixes one cause-free execution-defect error', (): void => {
    const error = new IdentitySessionRefreshExecutionFailedError();

    expect(error).toMatchObject({
      name: 'IdentitySessionRefreshExecutionFailedError',
      message: 'Identity session refresh execution failed',
    });
    expect(error).not.toHaveProperty('cause');
    expect(inspect(error, { showHidden: true })).not.toContain('transaction-callback-secret');
  });

  it('declares one refresh-command operation with no callback, scope, or query capability', (): void => {
    const unitOfWork: IdentitySessionRefreshUnitOfWork = Object.freeze({
      execute(command: IdentitySessionRefreshCommand): Promise<IdentitySessionRefreshOutcome> {
        void command;
        return Promise.resolve(IDENTITY_SESSION_REFRESH_INDETERMINATE);
      },
    });

    expect(Reflect.ownKeys(unitOfWork)).toEqual(['execute']);
    expect(Object.isFrozen(unitOfWork)).toBe(true);
    expect(unitOfWork).not.toHaveProperty('callback');
    expect(unitOfWork).not.toHaveProperty('scope');
    expect(unitOfWork).not.toHaveProperty('query');
  });

  it('keeps the complete transaction contract off the package root', (): void => {
    expect(identityPublicApi).not.toHaveProperty('IdentitySessionRefreshExecutionFailedError');
    expect(identityPublicApi).not.toHaveProperty(
      'IDENTITY_SESSION_REFRESH_NOT_COMMITTED_UNAVAILABLE',
    );
    expect(identityPublicApi).not.toHaveProperty('IDENTITY_SESSION_REFRESH_INDETERMINATE');
  });
});

const _validReason: IdentitySessionRefreshNotCommittedReason = 'unavailable';
void _validReason;

const _unitOfWorkKey: keyof IdentitySessionRefreshUnitOfWork = 'execute';
void _unitOfWorkKey;

// @ts-expect-error The application port declares no caller callback.
const _invalidUnitOfWorkKey: keyof IdentitySessionRefreshUnitOfWork = 'callback';
void _invalidUnitOfWorkKey;

// @ts-expect-error The closed non-commit reason set rejects arbitrary provider details.
const _invalidReason: IdentitySessionRefreshNotCommittedReason = 'deadlock';
void _invalidReason;

// @ts-expect-error A structural object cannot self-assert confirmed commit authority.
const _forgedCommittedCompletion: IdentitySessionRefreshCommittedCompletion = {
  kind: 'committed',
  evidence: undefined as unknown as IdentityTransactionEvidence,
};
void _forgedCommittedCompletion;
