import { inspect } from 'node:util';

import type { DatabaseRuntime } from '@oms/database';
import type * as MySqlTransactionModule from '@oms/database/mysql-transaction';
import type {
  AnyMySqlTransactionStatement,
  MySqlTransactionDirective,
  MySqlTransactionExecutor,
  MySqlTransactionProgram,
  MySqlTransactionProgramContext,
  MySqlTransactionStatementResult,
} from '@oms/database/mysql-transaction';
import { createPrismaDatabaseRuntime, type PrismaClient } from '@oms/database/prisma';

import type * as RefreshCommandModule from '../../src/application/identity-session-refresh-command';
import {
  createIdentitySessionRefreshCommand,
  type IdentitySessionRefreshCommand,
} from '../../src/application/identity-session-refresh-command';
import {
  createIdentitySessionCredentialAttempt,
  type IdentitySessionCredentialAttempt,
} from '../../src/application/identity-session-credential-attempt';
import {
  createIdentitySessionCredentialCandidates,
  type IdentitySessionCredentialCandidates,
} from '../../src/application/identity-session-credential-candidates';
import type { IdentitySessionCredentialCrypto } from '../../src/application/identity-session-credential-crypto';
import {
  createIdentityAccessCredentialDigestFromBytes,
  createIdentityRefreshCredentialDigestFromBytes,
  type IdentityAccessCredentialDigest,
  type IdentityRefreshCredentialDigest,
} from '../../src/application/identity-session-credential-digest.values';
import {
  parseIdentityAccessCredentialWireValue,
  parseIdentityRefreshCredentialWireValue,
} from '../../src/application/identity-session-credential-wire.values';
import type { IdentitySessionRefreshDiscovery } from '../../src/application/identity-session-refresh-discovery';
import {
  IDENTITY_SESSION_REFRESH_INDETERMINATE,
  IDENTITY_SESSION_REFRESH_NOT_COMMITTED_CONDITIONAL_CONFLICT,
  IDENTITY_SESSION_REFRESH_NOT_COMMITTED_CREDENTIAL_COLLISION,
  IDENTITY_SESSION_REFRESH_NOT_COMMITTED_UNAVAILABLE,
  IdentitySessionRefreshExecutionFailedError,
} from '../../src/application/identity-session-refresh-unit-of-work';
import {
  inspectIdentitySessionRefreshCommittedCompletion,
  InvalidIdentitySessionRefreshWorkflowError,
  type IdentityTransactionEvidence,
} from '../../src/application/identity-session-refresh-workflow';
import type * as RefreshWorkflowModule from '../../src/application/identity-session-refresh-workflow';
import {
  IDENTITY_SESSION_REFRESH_LOCK_ACCOUNT_MYSQL_STATEMENT,
  IDENTITY_SESSION_REFRESH_READ_WRITER_TIME_MYSQL_STATEMENT,
} from '../../src/infrastructure/mysql/identity-session-refresh-locked-load.statements';
import type { IdentitySessionRefreshMySqlTransactionFailure } from '../../src/infrastructure/mysql/identity-session-refresh-mysql.contract';
import { createMySqlIdentitySessionRefreshUnitOfWork } from '../../src/infrastructure/mysql/mysql-identity-session-refresh-unit-of-work';
import {
  createPrismaIdentitySessionRefreshDiscovery,
  inspectPrismaIdentitySessionRefreshDiscoveryAuthority,
} from '../../src/infrastructure/prisma/prisma-identity-session-refresh-discovery';
import { createIdentitySessionRefreshDiscoveryFoundTicket } from '../../src/application/identity-session-refresh-discovery';
import * as identityPublicApi from '../../src';

type CapturedProgram = MySqlTransactionProgram<
  unknown,
  IdentityTransactionEvidence,
  IdentitySessionRefreshMySqlTransactionFailure,
  AnyMySqlTransactionStatement<IdentitySessionRefreshMySqlTransactionFailure>
>;

type CapturedExecutor = MySqlTransactionExecutor<
  unknown,
  IdentityTransactionEvidence,
  IdentitySessionRefreshMySqlTransactionFailure
>;

type ExecuteStrategy = (program: CapturedProgram, input: unknown) => Promise<unknown>;

let capturedProgram: CapturedProgram | undefined;
let closeFailure: Error | undefined;
let failRevocation = false;
let observedRevokedEvidence: unknown;
let settlementTrace: string[] = [];
let suppressPromotion = false;
let executeStrategy: ExecuteStrategy = (): Promise<unknown> =>
  Promise.resolve(Object.freeze({ kind: 'indeterminate' as const }));

const createTransactionExecutorMock = jest.fn(
  (_runtime: unknown, program: CapturedProgram, _options: unknown): CapturedExecutor => {
    void _runtime;
    void _options;
    capturedProgram = program;

    return Object.freeze({
      execute(input: unknown): Promise<unknown> {
        return executeStrategy(program, input);
      },
    }) as CapturedExecutor;
  },
);

jest.mock('@oms/database/mysql-transaction', (): unknown => {
  const actual = jest.requireActual<typeof MySqlTransactionModule>(
    '@oms/database/mysql-transaction',
  );

  return {
    ...actual,
    createMySqlTransactionExecutor: (
      ...arguments_: Parameters<typeof createTransactionExecutorMock>
    ): ReturnType<typeof createTransactionExecutorMock> =>
      createTransactionExecutorMock(...arguments_),
  };
});

jest.mock(
  '../../src/application/identity-session-refresh-command',
  (): typeof RefreshCommandModule => {
    const actual = jest.requireActual<typeof RefreshCommandModule>(
      '../../src/application/identity-session-refresh-command',
    );

    return {
      ...actual,
      closeIdentitySessionRefreshCommand: (
        ...arguments_: Parameters<typeof actual.closeIdentitySessionRefreshCommand>
      ): ReturnType<typeof actual.closeIdentitySessionRefreshCommand> => {
        settlementTrace.push('close');
        if (closeFailure !== undefined) throw closeFailure;
        actual.closeIdentitySessionRefreshCommand(...arguments_);
      },
    };
  },
);

jest.mock(
  '../../src/application/identity-session-refresh-workflow',
  (): typeof RefreshWorkflowModule => {
    const actual = jest.requireActual<typeof RefreshWorkflowModule>(
      '../../src/application/identity-session-refresh-workflow',
    );

    return {
      ...actual,
      promoteIdentityTransactionPendingEvidence: (
        ...arguments_: Parameters<typeof actual.promoteIdentityTransactionPendingEvidence>
      ): ReturnType<typeof actual.promoteIdentityTransactionPendingEvidence> => {
        settlementTrace.push('promote');
        if (suppressPromotion) return undefined;
        return actual.promoteIdentityTransactionPendingEvidence(...arguments_);
      },
      revokeIdentityTransactionPendingEvidence: (
        ...arguments_: Parameters<typeof actual.revokeIdentityTransactionPendingEvidence>
      ): ReturnType<typeof actual.revokeIdentityTransactionPendingEvidence> => {
        settlementTrace.push('revoke');
        observedRevokedEvidence = arguments_[1];
        if (failRevocation) return false;
        return actual.revokeIdentityTransactionPendingEvidence(...arguments_);
      },
    };
  },
);

const ACCOUNT_ID = '01890f3a-8bcd-7def-8abc-0123456789ab';
const SESSION_ID = '01890f3a-8bcd-7def-aabc-0123456789ab';
const PRESENTED_CREDENTIAL_ID = '01890f3a-8bcd-7def-8bcd-0123456789ab';
const SUCCESSOR_CREDENTIAL_ID = '01890f3a-8bcd-7def-9bcd-0123456789ab';
const ACCESS_CREDENTIAL_ID = '01890f3a-8bcd-7def-abcd-0123456789ab';
const SECURITY_EVENT_ID = '01890f3a-8bcd-7def-8cde-0123456789ab';
const WRITER_TIME = '2026-08-24T10:05:00.000002Z';
const ACCESS_WIRE = `oms_at_v1_${'A'.repeat(42)}E`;
const REFRESH_WIRE = `oms_rt_v1_${'E'.repeat(42)}M`;
const TRANSACTION_OPTIONS = Object.freeze({ timeoutMilliseconds: 1_000 });
const NOT_FOUND_STATEMENT_RESULT = Object.freeze({ kind: 'not-found' as const });
const WRITER_TIME_STATEMENT_RESULT = Object.freeze({
  kind: 'found' as const,
  row: Object.freeze({ writer_time: WRITER_TIME }),
});
const FAKE_DIRECTIVE = Object.freeze({}) as MySqlTransactionDirective<
  IdentityTransactionEvidence,
  IdentitySessionRefreshMySqlTransactionFailure
>;

type Fixture = Readonly<{
  command: IdentitySessionRefreshCommand;
  discovery: IdentitySessionRefreshDiscovery;
  runtime: DatabaseRuntime;
}>;

type RejectedProgramInvocation = Readonly<{
  committedEvidence: IdentityTransactionEvidence;
  operation: Promise<
    MySqlTransactionDirective<
      IdentityTransactionEvidence,
      IdentitySessionRefreshMySqlTransactionFailure
    >
  >;
  releaseStatement: () => void;
  statementCalls: () => number;
}>;

function bytes(fill: number): Uint8Array<ArrayBuffer> {
  const value = new Uint8Array(32);
  value.fill(fill);
  return value;
}

async function credentialAttempt(): Promise<IdentitySessionCredentialAttempt> {
  const accessCredentialDigest = createIdentityAccessCredentialDigestFromBytes(bytes(31));
  const refreshCredentialDigest = createIdentityRefreshCredentialDigestFromBytes(bytes(32));
  const candidates = createIdentitySessionCredentialCandidates({
    access: {
      wireValue: parseIdentityAccessCredentialWireValue(ACCESS_WIRE),
      digest: accessCredentialDigest,
    },
    refresh: {
      wireValue: parseIdentityRefreshCredentialWireValue(REFRESH_WIRE),
      digest: refreshCredentialDigest,
    },
  });
  const crypto: IdentitySessionCredentialCrypto = Object.freeze({
    generateSessionCredentialCandidates(): Promise<IdentitySessionCredentialCandidates> {
      return Promise.resolve(candidates);
    },
    digestAccessCredential(): Promise<IdentityAccessCredentialDigest> {
      return Promise.resolve(accessCredentialDigest);
    },
    digestRefreshCredential(): Promise<IdentityRefreshCredentialDigest> {
      return Promise.resolve(refreshCredentialDigest);
    },
  });

  return createIdentitySessionCredentialAttempt(candidates, crypto);
}

function prismaClient(): PrismaClient {
  return Object.freeze({
    $disconnect: jest.fn<Promise<void>, []>(() => Promise.resolve()),
    $queryRaw: jest.fn(),
  }) as unknown as PrismaClient;
}

async function fixture(): Promise<Fixture> {
  const client = prismaClient();
  const runtime = createPrismaDatabaseRuntime(client);
  const discovery = createPrismaIdentitySessionRefreshDiscovery(client);
  const authority = inspectPrismaIdentitySessionRefreshDiscoveryAuthority(discovery, client);
  const discoveryTicket = createIdentitySessionRefreshDiscoveryFoundTicket(
    authority,
    createIdentityRefreshCredentialDigestFromBytes(bytes(19)),
    {
      accountId: ACCOUNT_ID,
      sessionId: SESSION_ID,
      presentedRefreshCredentialId: PRESENTED_CREDENTIAL_ID,
    },
  );
  const command = createIdentitySessionRefreshCommand({
    discoveryTicket,
    credentialAttempt: await credentialAttempt(),
    successorRefreshCredentialId: SUCCESSOR_CREDENTIAL_ID,
    refreshIdleLifetimeSeconds: 900,
    issuedAccessCredentialId: ACCESS_CREDENTIAL_ID,
    accessLifetimeSeconds: 300,
    securityEventId: SECURITY_EVENT_ID,
  });

  return Object.freeze({ command, discovery, runtime });
}

function program(): CapturedProgram {
  if (capturedProgram === undefined) throw new Error('Expected a captured refresh program');
  return capturedProgram;
}

function invokeObserver(programValue: CapturedProgram, input: unknown): undefined {
  const observer = programValue.observeProgramSettlement;

  if (observer === undefined) throw new Error('Expected a program settlement observer');
  Reflect.apply(observer, undefined, [input]);
  return undefined;
}

function createRejectedProgramInvocation(
  programValue: CapturedProgram,
  input: unknown,
  stalled: boolean,
): RejectedProgramInvocation {
  let resolveStatement: (() => void) | undefined;
  const statementGate = new Promise<void>((resolve): void => {
    resolveStatement = resolve;
  });
  if (resolveStatement === undefined) throw new Error('Expected a statement release operation');
  let committedEvidence: IdentityTransactionEvidence | undefined;
  let statementCallCount = 0;
  const context: MySqlTransactionProgramContext<
    IdentityTransactionEvidence,
    IdentitySessionRefreshMySqlTransactionFailure,
    AnyMySqlTransactionStatement<IdentitySessionRefreshMySqlTransactionFailure>
  > = Object.freeze({
    async executeStatement<
      Statement extends AnyMySqlTransactionStatement<IdentitySessionRefreshMySqlTransactionFailure>,
    >(statement: Statement): Promise<MySqlTransactionStatementResult<Statement>> {
      statementCallCount += 1;

      if (statementCallCount === 1) {
        expect(statement).toBe(IDENTITY_SESSION_REFRESH_LOCK_ACCOUNT_MYSQL_STATEMENT);
        if (stalled) await statementGate;
        return NOT_FOUND_STATEMENT_RESULT as MySqlTransactionStatementResult<Statement>;
      }

      expect(statement).toBe(IDENTITY_SESSION_REFRESH_READ_WRITER_TIME_MYSQL_STATEMENT);
      return WRITER_TIME_STATEMENT_RESULT as MySqlTransactionStatementResult<Statement>;
    },
    requestCommit(
      evidence: IdentityTransactionEvidence,
    ): MySqlTransactionDirective<
      IdentityTransactionEvidence,
      IdentitySessionRefreshMySqlTransactionFailure
    > {
      committedEvidence = evidence;
      return FAKE_DIRECTIVE;
    },
    requestRollback(): MySqlTransactionDirective<
      IdentityTransactionEvidence,
      IdentitySessionRefreshMySqlTransactionFailure
    > {
      throw new Error('Rejected refresh must request commit');
    },
  });
  const operation = Reflect.apply(programValue.run, undefined, [context, input]);

  return Object.freeze({
    get committedEvidence(): IdentityTransactionEvidence {
      if (committedEvidence === undefined) throw new Error('Expected committed evidence');
      return committedEvidence;
    },
    operation,
    releaseStatement: resolveStatement,
    statementCalls: (): number => statementCallCount,
  });
}

function createUnitOfWork(fixtureValue: Fixture) {
  return createMySqlIdentitySessionRefreshUnitOfWork(
    fixtureValue.runtime,
    fixtureValue.discovery,
    TRANSACTION_OPTIONS,
  );
}

beforeEach((): void => {
  capturedProgram = undefined;
  closeFailure = undefined;
  failRevocation = false;
  observedRevokedEvidence = undefined;
  settlementTrace = [];
  suppressPromotion = false;
  executeStrategy = (): Promise<unknown> =>
    Promise.resolve(Object.freeze({ kind: 'indeterminate' as const }));
});

describe('MySQL Identity session refresh Unit of Work', (): void => {
  it('constructs one fixed closed program over the thirteen reviewed statements', async (): Promise<void> => {
    const prepared = await fixture();
    const unitOfWork = createUnitOfWork(prepared);
    const fixedProgram = program();

    expect(Object.isFrozen(unitOfWork)).toBe(true);
    expect(Reflect.ownKeys(unitOfWork)).toEqual(['execute']);
    expect(Object.isFrozen(fixedProgram)).toBe(true);
    expect(Reflect.ownKeys(fixedProgram)).toEqual([
      'defectFailure',
      'failures',
      'observeProgramSettlement',
      'run',
      'statements',
      'unavailableFailure',
    ]);
    expect(fixedProgram.failures).toEqual([
      'credential-collision',
      'conditional-conflict',
      'unavailable',
      'execution-defect',
    ]);
    expect(Object.isFrozen(fixedProgram.failures)).toBe(true);
    expect(fixedProgram.statements).toHaveLength(13);
    expect(new Set(fixedProgram.statements)).toHaveProperty('size', 13);
    expect(fixedProgram.unavailableFailure).toBe('unavailable');
    expect(fixedProgram.defectFailure).toBe('execution-defect');
  });

  it('promotes only exact rejected evidence after observer close and acknowledged commit', async (): Promise<void> => {
    const events: string[] = [];
    executeStrategy = async (programValue, input): Promise<unknown> => {
      const invocation = createRejectedProgramInvocation(programValue, input, false);
      await invocation.operation;
      events.push('program-settled');
      expect(invocation.statementCalls()).toBe(2);
      invokeObserver(programValue, input);
      events.push('program-observed');
      return Object.freeze({ kind: 'committed' as const, result: invocation.committedEvidence });
    };
    const prepared = await fixture();
    const outcome = await createUnitOfWork(prepared).execute(prepared.command);
    const completion = inspectIdentitySessionRefreshCommittedCompletion(outcome);

    expect(events).toEqual(['program-settled', 'program-observed']);
    expect(settlementTrace).toEqual(['close', 'promote']);
    expect(completion).toBe(outcome);
    expect(completion.kind).toBe('committed');
    expect(completion.evidence.kind).toBe('rejected');
    expect(Object.isFrozen(completion)).toBe(true);
  });

  it.each([
    ['credential-collision', IDENTITY_SESSION_REFRESH_NOT_COMMITTED_CREDENTIAL_COLLISION],
    ['conditional-conflict', IDENTITY_SESSION_REFRESH_NOT_COMMITTED_CONDITIONAL_CONFLICT],
    ['unavailable', IDENTITY_SESSION_REFRESH_NOT_COMMITTED_UNAVAILABLE],
  ] as const)(
    'maps a proven no-start %s outcome only after closing the admitted command',
    async (failure, expected): Promise<void> => {
      executeStrategy = (): Promise<unknown> =>
        Promise.resolve(Object.freeze({ kind: 'not-committed' as const, failure }));
      const prepared = await fixture();
      const unitOfWork = createUnitOfWork(prepared);

      await expect(unitOfWork.execute(prepared.command)).resolves.toBe(expected);
      await expect(unitOfWork.execute(prepared.command)).rejects.toBeInstanceOf(
        IdentitySessionRefreshExecutionFailedError,
      );
      expect(createTransactionExecutorMock).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects a proven execution defect with one fresh cause-free error', async (): Promise<void> => {
    executeStrategy = (): Promise<unknown> =>
      Promise.resolve(
        Object.freeze({ kind: 'not-committed' as const, failure: 'execution-defect' as const }),
      );
    const prepared = await fixture();
    const rejection = createUnitOfWork(prepared).execute(prepared.command);

    await expect(rejection).rejects.toMatchObject({
      name: 'IdentitySessionRefreshExecutionFailedError',
      message: 'Identity session refresh execution failed',
    });

    try {
      await rejection;
    } catch (error: unknown) {
      expect(error).not.toHaveProperty('cause');
      expect(inspect(error, { showHidden: true })).not.toContain('execution-provider-secret');
    }
  });

  it('fails closed when acknowledged commit carries a different evidence identity', async (): Promise<void> => {
    let exactEvidence: IdentityTransactionEvidence | undefined;
    executeStrategy = async (programValue, input): Promise<unknown> => {
      const invocation = createRejectedProgramInvocation(programValue, input, false);
      await invocation.operation;
      invokeObserver(programValue, input);
      exactEvidence = invocation.committedEvidence;
      return Object.freeze({
        kind: 'committed' as const,
        result: Object.freeze({ kind: 'rejected' as const }),
      });
    };
    const prepared = await fixture();

    await expect(createUnitOfWork(prepared).execute(prepared.command)).resolves.toBe(
      IDENTITY_SESSION_REFRESH_INDETERMINATE,
    );
    expect(settlementTrace).toEqual(['close', 'revoke']);
    expect(observedRevokedEvidence).toBe(exactEvidence);
  });

  it('does not invoke accessor-backed malformed outcomes and reports indeterminate', async (): Promise<void> => {
    let accessorReads = 0;
    const malformed = {} as Record<string, unknown>;
    Object.defineProperty(malformed, 'kind', {
      configurable: false,
      enumerable: true,
      get(): string {
        accessorReads += 1;
        return 'not-committed';
      },
    });
    Object.freeze(malformed);
    executeStrategy = (): Promise<unknown> => Promise.resolve(malformed);
    const prepared = await fixture();

    await expect(createUnitOfWork(prepared).execute(prepared.command)).resolves.toBe(
      IDENTITY_SESSION_REFRESH_INDETERMINATE,
    );
    expect(accessorReads).toBe(0);
  });

  it('does not invoke an accessor-backed committed result after authentic program settlement', async (): Promise<void> => {
    let accessorReads = 0;
    let exactEvidence: IdentityTransactionEvidence | undefined;
    executeStrategy = async (programValue, input): Promise<unknown> => {
      const invocation = createRejectedProgramInvocation(programValue, input, false);

      await invocation.operation;
      invokeObserver(programValue, input);
      exactEvidence = invocation.committedEvidence;

      const malformed = {} as Record<string, unknown>;

      Object.defineProperty(malformed, 'kind', {
        configurable: false,
        enumerable: true,
        value: 'committed',
        writable: false,
      });
      Object.defineProperty(malformed, 'result', {
        configurable: false,
        enumerable: true,
        get(): IdentityTransactionEvidence {
          accessorReads += 1;
          return invocation.committedEvidence;
        },
      });
      return Object.freeze(malformed);
    };
    const prepared = await fixture();

    await expect(createUnitOfWork(prepared).execute(prepared.command)).resolves.toBe(
      IDENTITY_SESSION_REFRESH_INDETERMINATE,
    );
    expect(accessorReads).toBe(0);
    expect(settlementTrace).toEqual(['close', 'revoke']);
    expect(observedRevokedEvidence).toBe(exactEvidence);
  });

  it('quarantines a command whose no-start close fails instead of returning a retry reason', async (): Promise<void> => {
    closeFailure = new Error('close-provider-secret');
    executeStrategy = (): Promise<unknown> =>
      Promise.resolve(
        Object.freeze({
          kind: 'not-committed' as const,
          failure: 'credential-collision' as const,
        }),
      );
    const prepared = await fixture();

    let error: unknown;

    try {
      await createUnitOfWork(prepared).execute(prepared.command);
    } catch (caught: unknown) {
      error = caught;
    }

    expect(error).toBeInstanceOf(IdentitySessionRefreshExecutionFailedError);
    expect(error).not.toHaveProperty('cause');
    expect(inspect(error, { showHidden: true })).not.toContain('close-provider-secret');
    expect(settlementTrace).toEqual(['close']);
    expect(observedRevokedEvidence).toBeUndefined();
  });

  it('returns indeterminate and quarantines exact evidence when promotion and revocation fail', async (): Promise<void> => {
    let exactEvidence: IdentityTransactionEvidence | undefined;
    suppressPromotion = true;
    failRevocation = true;
    executeStrategy = async (programValue, input): Promise<unknown> => {
      const invocation = createRejectedProgramInvocation(programValue, input, false);

      await invocation.operation;
      invokeObserver(programValue, input);
      exactEvidence = invocation.committedEvidence;
      return Object.freeze({ kind: 'committed' as const, result: invocation.committedEvidence });
    };
    const prepared = await fixture();
    const outcome = await createUnitOfWork(prepared).execute(prepared.command);

    expect(outcome).toBe(IDENTITY_SESSION_REFRESH_INDETERMINATE);
    expect(settlementTrace).toEqual(['close', 'promote', 'revoke']);
    expect(observedRevokedEvidence).toBe(exactEvidence);
    expect(() => inspectIdentitySessionRefreshCommittedCompletion(outcome)).toThrow(
      InvalidIdentitySessionRefreshWorkflowError,
    );
  });

  it('converts an unexpected executor rejection to indeterminate without retaining its cause', async (): Promise<void> => {
    const providerError = new Error('executor-rejection-secret');
    executeStrategy = (): Promise<unknown> => Promise.reject(providerError);
    const prepared = await fixture();
    const outcome = await createUnitOfWork(prepared).execute(prepared.command);

    expect(outcome).toBe(IDENTITY_SESSION_REFRESH_INDETERMINATE);
    expect(inspect(outcome, { showHidden: true })).not.toContain('executor-rejection-secret');
  });

  it('returns indeterminate before a stalled program settles, then permits late observer cleanup', async (): Promise<void> => {
    let completeLateProgram: (() => Promise<void>) | undefined;
    let exactEvidence: IdentityTransactionEvidence | undefined;
    executeStrategy = (programValue, input): Promise<unknown> => {
      const invocation = createRejectedProgramInvocation(programValue, input, true);
      completeLateProgram = async (): Promise<void> => {
        invocation.releaseStatement();
        await invocation.operation;
        exactEvidence = invocation.committedEvidence;
        invokeObserver(programValue, input);
      };

      return Promise.resolve(Object.freeze({ kind: 'indeterminate' as const }));
    };
    const prepared = await fixture();
    const outcome = await createUnitOfWork(prepared).execute(prepared.command);

    expect(outcome).toBe(IDENTITY_SESSION_REFRESH_INDETERMINATE);
    expect(settlementTrace).toEqual([]);
    expect(completeLateProgram).toBeDefined();
    await completeLateProgram?.();
    expect(settlementTrace).toEqual(['close', 'revoke']);
    expect(observedRevokedEvidence).toBe(exactEvidence);
    expect(outcome).toBe(IDENTITY_SESSION_REFRESH_INDETERMINATE);
  });

  it('keeps the concrete transaction factory and command contract off the Identity root', (): void => {
    expect(identityPublicApi).not.toHaveProperty('createMySqlIdentitySessionRefreshUnitOfWork');
    expect(identityPublicApi).not.toHaveProperty('IdentitySessionRefreshCommand');
    expect(identityPublicApi).not.toHaveProperty('IdentityTransactionEvidence');
  });

  it('rejects a discovery that belongs to a different authenticated runtime', (): void => {
    const firstClient = prismaClient();
    const secondClient = prismaClient();
    const runtime = createPrismaDatabaseRuntime(firstClient);
    const foreignDiscovery = createPrismaIdentitySessionRefreshDiscovery(secondClient);

    let error: unknown;

    try {
      createMySqlIdentitySessionRefreshUnitOfWork(runtime, foreignDiscovery, TRANSACTION_OPTIONS);
    } catch (caught: unknown) {
      error = caught;
    }

    expect(error).toMatchObject({
      name: 'InvalidMySqlIdentitySessionRefreshUnitOfWorkError',
      message: 'Invalid MySQL Identity session refresh Unit of Work configuration',
    });
  });
});
