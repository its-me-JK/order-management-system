import type { IdentityAuthenticatedPrincipal } from '../src';
import * as identityPublicSurface from '../src';
import { createIdentityAuthenticatedPrincipalFromAuthority } from '../src/application/identity-authenticated-principal';

const ACTOR_ID = '01890f3a-8bcd-7def-8abc-0123456789ab';
const SESSION_ID = '01890f3a-8bcd-7def-9abc-0123456789ab';

describe('@oms/identity public surface', (): void => {
  it('exports the authenticated-principal contract without a runtime constructor', (): void => {
    expect(Object.keys(identityPublicSurface)).toEqual([]);
  });

  it('accepts only the nominal principal produced by the internal authority boundary', (): void => {
    const principal: IdentityAuthenticatedPrincipal =
      createIdentityAuthenticatedPrincipalFromAuthority({
        actorId: ACTOR_ID,
        sessionId: SESSION_ID,
        activeRoleCount: 1,
        permissions: ['catalog.products.read'],
      });

    expect(principal).toEqual({
      actorId: ACTOR_ID,
      sessionId: SESSION_ID,
      permissions: ['catalog.products.read'],
    });
  });
});

// @ts-expect-error A structural object cannot self-assert authenticated authority.
const _structurallyForgedPrincipal: IdentityAuthenticatedPrincipal = {
  actorId: ACTOR_ID,
  sessionId: SESSION_ID,
  permissions: [],
};
void _structurallyForgedPrincipal;
