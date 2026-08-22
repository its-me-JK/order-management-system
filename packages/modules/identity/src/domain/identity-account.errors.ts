export class InvalidIdentityAccountStateError extends Error {
  public constructor() {
    super('Expected a valid Identity Account snapshot');
    this.name = 'InvalidIdentityAccountStateError';
  }
}

export class IdentityAccountVersionMismatchError extends Error {
  public constructor() {
    super('The Identity Account version does not match the expected version');
    this.name = 'IdentityAccountVersionMismatchError';
  }
}

export class IdentityAccountLifecycleConflictError extends Error {
  public constructor() {
    super('The Identity Account lifecycle operation is not allowed');
    this.name = 'IdentityAccountLifecycleConflictError';
  }
}

export class IdentityAccountTimestampRegressionError extends Error {
  public constructor() {
    super('The Identity Account mutation time precedes its current update time');
    this.name = 'IdentityAccountTimestampRegressionError';
  }
}
