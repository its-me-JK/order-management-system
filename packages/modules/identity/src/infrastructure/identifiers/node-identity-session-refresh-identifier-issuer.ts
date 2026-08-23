import * as nodeCrypto from 'node:crypto';

import {
  parseIdentityAccessCredentialId,
  type IdentityAccessCredentialId,
} from '../../domain/identity-access-credential.values';
import {
  parseIdentityRefreshCredentialId,
  type IdentityRefreshCredentialId,
} from '../../domain/identity-refresh-credential.values';
import {
  parseIdentitySecurityEventId,
  type IdentitySecurityEventId,
} from '../../application/identity-security-event.values';
import {
  IdentitySessionRefreshIdentifierIssuanceUnavailableError,
  type IdentitySessionRefreshIdentifierIssuer,
  type IdentitySessionRefreshIdentifiers,
} from '../../application/identity-session-refresh-identifiers';

const capturedFreeze = Object.freeze;
const capturedReflectApply = Reflect.apply;
const capturedReflectGet = Reflect.get;

type RandomUuidV7Primitive = (this: unknown) => unknown;

export type NodeIdentitySessionRefreshIdentifierPrimitives = Readonly<{
  randomUUIDv7: RandomUuidV7Primitive;
}>;

type CapturedPrimitives = Readonly<{
  receiver: object;
  randomUUIDv7: RandomUuidV7Primitive;
}>;

function issuanceUnavailable(): never {
  throw new IdentitySessionRefreshIdentifierIssuanceUnavailableError();
}

function isObject(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function capturePrimitives(value: unknown): CapturedPrimitives {
  if (!isObject(value)) {
    issuanceUnavailable();
  }

  const randomUUIDv7: unknown = capturedReflectGet(value, 'randomUUIDv7');

  if (typeof randomUUIDv7 !== 'function') {
    issuanceUnavailable();
  }

  return capturedFreeze({
    receiver: value,
    randomUUIDv7: randomUUIDv7 as RandomUuidV7Primitive,
  });
}

function invokeRandomUuidV7(primitives: CapturedPrimitives): unknown {
  return capturedReflectApply(primitives.randomUUIDv7, primitives.receiver, []);
}

function issueIdentifiers(primitives: CapturedPrimitives): IdentitySessionRefreshIdentifiers {
  try {
    const successorRefreshCredentialId: IdentityRefreshCredentialId =
      parseIdentityRefreshCredentialId(invokeRandomUuidV7(primitives));
    const issuedAccessCredentialId: IdentityAccessCredentialId = parseIdentityAccessCredentialId(
      invokeRandomUuidV7(primitives),
    );
    const securityEventId: IdentitySecurityEventId = parseIdentitySecurityEventId(
      invokeRandomUuidV7(primitives),
    );

    return capturedFreeze({
      successorRefreshCredentialId,
      issuedAccessCredentialId,
      securityEventId,
    });
  } catch {
    issuanceUnavailable();
  }
}

const capturedNodeRandomUuidV7: unknown = capturedReflectGet(nodeCrypto, 'randomUUIDv7');

function nodeRandomUuidV7(): unknown {
  if (typeof capturedNodeRandomUuidV7 !== 'function') {
    issuanceUnavailable();
  }

  return capturedReflectApply(capturedNodeRandomUuidV7, nodeCrypto, []);
}

const DEFAULT_NODE_IDENTITY_SESSION_REFRESH_IDENTIFIER_PRIMITIVES = capturedFreeze({
  randomUUIDv7: nodeRandomUuidV7,
}) satisfies NodeIdentitySessionRefreshIdentifierPrimitives;

/** Creates the production Node-backed refresh identifier issuer. */
export function createNodeIdentitySessionRefreshIdentifierIssuer(): IdentitySessionRefreshIdentifierIssuer {
  return createNodeIdentitySessionRefreshIdentifierIssuerWithPrimitives(
    DEFAULT_NODE_IDENTITY_SESSION_REFRESH_IDENTIFIER_PRIMITIVES,
  );
}

/** @internal Direct-file deterministic construction seam for adapter tests. */
export function createNodeIdentitySessionRefreshIdentifierIssuerWithPrimitives(
  primitives: unknown,
): IdentitySessionRefreshIdentifierIssuer {
  try {
    const capturedPrimitives = capturePrimitives(primitives);
    const issueSessionRefreshIdentifiers = (): IdentitySessionRefreshIdentifiers =>
      issueIdentifiers(capturedPrimitives);

    capturedFreeze(issueSessionRefreshIdentifiers);

    return capturedFreeze({ issueSessionRefreshIdentifiers });
  } catch {
    issuanceUnavailable();
  }
}
