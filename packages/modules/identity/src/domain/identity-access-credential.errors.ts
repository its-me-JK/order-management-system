export class InvalidIdentityAccessCredentialStateError extends Error {
  public constructor() {
    super('Expected a valid Identity Access Credential snapshot');
    this.name = 'InvalidIdentityAccessCredentialStateError';
  }
}
