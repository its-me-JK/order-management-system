export class InvalidIdentityPasswordAuthenticatorStateError extends Error {
  public constructor() {
    super('Expected a valid Identity Password Authenticator snapshot');
    this.name = 'InvalidIdentityPasswordAuthenticatorStateError';
  }
}

export class IdentityPasswordAuthenticatorVerificationSnapshotMismatchError extends Error {
  public constructor() {
    super('The Identity Password Authenticator verification snapshot no longer matches');
    this.name = 'IdentityPasswordAuthenticatorVerificationSnapshotMismatchError';
  }
}

export class IdentityPasswordAuthenticatorVerificationNotPermittedError extends Error {
  public constructor() {
    super('The Identity Password Authenticator cannot record this verification result');
    this.name = 'IdentityPasswordAuthenticatorVerificationNotPermittedError';
  }
}

export class IdentityPasswordAuthenticatorLifecycleConflictError extends Error {
  public constructor() {
    super('The Identity Password Authenticator lifecycle operation is not allowed');
    this.name = 'IdentityPasswordAuthenticatorLifecycleConflictError';
  }
}

export class IdentityPasswordAuthenticatorTimestampRegressionError extends Error {
  public constructor() {
    super('The Identity Password Authenticator mutation time precedes its current update time');
    this.name = 'IdentityPasswordAuthenticatorTimestampRegressionError';
  }
}

export class IdentityPasswordAuthenticatorDeadlineOverflowError extends Error {
  public constructor() {
    super('The Identity Password Authenticator cooldown deadline exceeds the supported time range');
    this.name = 'IdentityPasswordAuthenticatorDeadlineOverflowError';
  }
}

export class IdentityPasswordAuthenticatorSamePhcError extends Error {
  public constructor() {
    super('The Identity Password Authenticator replacement PHC must be byte-different');
    this.name = 'IdentityPasswordAuthenticatorSamePhcError';
  }
}

export class IdentityPasswordAuthenticatorVersionMismatchError extends Error {
  public constructor() {
    super('The Identity Password Authenticator version does not match the expected version');
    this.name = 'IdentityPasswordAuthenticatorVersionMismatchError';
  }
}
