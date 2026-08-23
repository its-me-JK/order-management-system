// Domain, credential values, persistence ports, and trusted factories stay internal to Identity.
export { IdentityBearerResolutionUnavailableError } from './application/identity-bearer-resolution.errors';
export type { IdentityAuthenticatedPrincipal } from './application/identity-authenticated-principal';
export {
  ResolveIdentityBearerPrincipal,
  type IdentityBearerPrincipalRejected,
  type IdentityBearerPrincipalResolution,
  type IdentityBearerPrincipalResolved,
} from './application/resolve-identity-bearer-principal';
