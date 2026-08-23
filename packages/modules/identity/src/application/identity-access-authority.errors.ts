export class IdentityAccessAuthorityUnavailableError extends Error {
  public constructor() {
    super('Identity access authority is temporarily unavailable');
    this.name = 'IdentityAccessAuthorityUnavailableError';
  }
}

export class IdentityAccessAuthorityPersistenceError extends Error {
  public constructor() {
    super('Identity access authority read failed');
    this.name = 'IdentityAccessAuthorityPersistenceError';
  }
}
