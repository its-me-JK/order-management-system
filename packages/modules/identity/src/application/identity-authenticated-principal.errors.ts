export class InvalidIdentityAuthenticatedPrincipalError extends Error {
  public constructor() {
    super('Expected valid Identity authenticated-principal authority evidence');
    this.name = 'InvalidIdentityAuthenticatedPrincipalError';
  }
}
