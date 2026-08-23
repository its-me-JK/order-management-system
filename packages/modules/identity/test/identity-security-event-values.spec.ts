import * as identityPublicApi from '../src';
import {
  InvalidIdentitySecurityEventIdError,
  parseIdentitySecurityEventId,
  type IdentitySecurityEventId,
} from '../src/application/identity-security-event.values';
import {
  parseIdentityAccountId,
  type IdentityAccountId,
} from '../src/domain/identity-account.values';
import {
  parseIdentitySessionId,
  type IdentitySessionId,
} from '../src/domain/identity-session-family.values';

const SECURITY_EVENT_ID = '01890f3a-8bcd-7def-8abc-0123456789ab';

function captureError(operation: () => unknown): Error {
  try {
    operation();
  } catch (error: unknown) {
    if (error instanceof Error) {
      return error;
    }
  }

  throw new Error('Expected the operation to throw an Error');
}

describe('Identity SecurityEvent identifier', (): void => {
  it('accepts only canonical lowercase UUIDv7 text', (): void => {
    const eventId = parseIdentitySecurityEventId(SECURITY_EVENT_ID);

    expect(eventId).toBe(SECURITY_EVENT_ID);
    expect(typeof eventId).toBe('string');
  });

  it.each([
    ['wrong UUID version', '01890f3a-8bcd-4def-8abc-0123456789ab'],
    ['wrong UUID variant', '01890f3a-8bcd-7def-7abc-0123456789ab'],
    ['uppercase text', '01890F3A-8BCD-7DEF-8ABC-0123456789AB'],
    ['braces', `{${SECURITY_EVENT_ID}}`],
    ['surrounding whitespace', ` ${SECURITY_EVENT_ID}`],
    ['secret text', 'security-event-identifier-secret'],
    ['null', null],
    ['object', { value: SECURITY_EVENT_ID }],
  ] as const)('rejects %s with one fixed cause-free error', (_scenario, value): void => {
    const error = captureError(() => parseIdentitySecurityEventId(value));

    expect(error).toBeInstanceOf(InvalidIdentitySecurityEventIdError);
    expect(error).toMatchObject({
      name: 'InvalidIdentitySecurityEventIdError',
      message: 'Expected a canonical lowercase UUIDv7 Identity SecurityEvent identifier',
    });
    expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
    expect(String(error)).not.toContain('security-event-identifier-secret');
    expect(JSON.stringify(error)).not.toContain('security-event-identifier-secret');
  });

  it('keeps SecurityEvent, Account, and Session identifier namespaces nominally separate', (): void => {
    const eventId = parseIdentitySecurityEventId(SECURITY_EVENT_ID);
    const accountId = parseIdentityAccountId(SECURITY_EVENT_ID);
    const sessionId = parseIdentitySessionId(SECURITY_EVENT_ID);

    expect(eventId).toBe(accountId);
    expect(eventId).toBe(sessionId);
  });

  it('does not widen the Identity package root', (): void => {
    expect(identityPublicApi).not.toHaveProperty('parseIdentitySecurityEventId');
    expect(identityPublicApi).not.toHaveProperty('InvalidIdentitySecurityEventIdError');
  });
});

function compileOnlySecurityEventNamespaceSeparation(): void {
  const eventId: IdentitySecurityEventId = parseIdentitySecurityEventId(SECURITY_EVENT_ID);
  const accountId: IdentityAccountId = parseIdentityAccountId(SECURITY_EVENT_ID);
  const sessionId: IdentitySessionId = parseIdentitySessionId(SECURITY_EVENT_ID);

  // @ts-expect-error Account IDs cannot authorize SecurityEvent writes.
  const eventFromAccount: IdentitySecurityEventId = accountId;
  // @ts-expect-error Session IDs cannot authorize SecurityEvent writes.
  const eventFromSession: IdentitySecurityEventId = sessionId;
  // @ts-expect-error SecurityEvent IDs cannot be substituted for Account IDs.
  const accountFromEvent: IdentityAccountId = eventId;

  void eventFromAccount;
  void eventFromSession;
  void accountFromEvent;
}
void compileOnlySecurityEventNamespaceSeparation;
