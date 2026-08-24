export class OrderNotFoundError extends Error {
  public constructor() {
    super('Order was not found');
    this.name = 'OrderNotFoundError';
  }
}

export class OrderTransitionNotAllowedError extends Error {
  public constructor() {
    super('Order transition is not allowed');
    this.name = 'OrderTransitionNotAllowedError';
  }
}

export class OrderInventoryUnavailableError extends Error {
  public constructor() {
    super('Requested inventory is unavailable');
    this.name = 'OrderInventoryUnavailableError';
  }
}

export class OrderIdempotencyConflictError extends Error {
  public constructor() {
    super('Idempotency key was already used for a different request');
    this.name = 'OrderIdempotencyConflictError';
  }
}

export class OrderCurrencyMismatchError extends Error {
  public constructor() {
    super('All order items must use the same currency');
    this.name = 'OrderCurrencyMismatchError';
  }
}

export class PaymentNotFoundError extends Error {
  public constructor() {
    super('Payment was not found');
    this.name = 'PaymentNotFoundError';
  }
}
