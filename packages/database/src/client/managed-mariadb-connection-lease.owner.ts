const DEFAULT_SHUTDOWN_GRACE_MILLISECONDS = 1_000;
const capturedReflectApply = Reflect.apply;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once and invoked only through Reflect.apply.
const capturedSetAdd = Set.prototype.add;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once and invoked only through Reflect.apply.
const capturedSetDelete = Set.prototype.delete;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once and invoked only through Reflect.apply.
const capturedSetForEach = Set.prototype.forEach;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once and invoked only through Reflect.apply.
const capturedSetHas = Set.prototype.has;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once and invoked only through Reflect.apply.
const capturedWeakMapGet = WeakMap.prototype.get;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once and invoked only through Reflect.apply.
const capturedWeakMapSet = WeakMap.prototype.set;
const setSizeDescriptor = Object.getOwnPropertyDescriptor(Set.prototype, 'size');

if (setSizeDescriptor?.get === undefined) {
  throw new TypeError('Expected the intrinsic Set size getter');
}

// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once and invoked only through Reflect.apply.
const capturedSetSize = setSizeDescriptor.get;

/** @internal One owned direct connection retained inside the database package. */
export interface ManagedMariaDbAllocatedConnection {
  destroy(): void;
  execute<Result>(sql: string, values: readonly unknown[]): Promise<Result>;
  query<Result>(sql: string): Promise<Result>;
  release(): Promise<void>;
}

/** @internal Bounded allocator surface retained inside the database package. */
export interface ManagedMariaDbConnectionAllocator {
  end(): Promise<void>;
  getConnection(): Promise<ManagedMariaDbAllocatedConnection>;
}

export type ManagedMariaDbConnectionAllocatorFactory<Options> = (
  options: Options,
) => ManagedMariaDbConnectionAllocator;

export type ManagedMariaDbConnectionLeaseOwnerOptions = Readonly<{
  shutdownGraceMilliseconds?: number;
}>;

declare const managedMariaDbConnectionLeaseBrand: unique symbol;

/** @internal Frozen, runtime-authentic authority over one checkout. */
export type ManagedMariaDbConnectionLease = Readonly<{
  readonly [managedMariaDbConnectionLeaseBrand]: true;
}>;

export class ManagedMariaDbConnectionAllocatorUnavailableError extends Error {
  public constructor() {
    super('MariaDB direct connection allocator is unavailable');
    this.name = 'ManagedMariaDbConnectionAllocatorUnavailableError';
  }
}

export class InvalidManagedMariaDbConnectionLeaseError extends Error {
  public constructor() {
    super('Expected an active MariaDB direct connection lease');
    this.name = 'InvalidManagedMariaDbConnectionLeaseError';
  }
}

export class ManagedMariaDbConnectionReleaseError extends Error {
  public constructor() {
    super('MariaDB direct connection release failed');
    this.name = 'ManagedMariaDbConnectionReleaseError';
  }
}

export class ManagedMariaDbConnectionAllocatorShutdownError extends Error {
  public constructor() {
    super('MariaDB direct connection allocator shutdown failed');
    this.name = 'ManagedMariaDbConnectionAllocatorShutdownError';
  }
}

interface LeaseRegistration {
  readonly lease: ManagedMariaDbConnectionLease;
  readonly owner: object;
  connection: ManagedMariaDbAllocatedConnection | undefined;
  destroyAttempted: boolean;
  status: 'pending' | 'active' | 'releasing' | 'settled';
}

type ActiveLeaseRegistration = Omit<LeaseRegistration, 'connection'> & {
  connection: ManagedMariaDbAllocatedConnection;
};

const leaseRegistrations = new WeakMap<object, LeaseRegistration>();

function setAdd<Value>(set: Set<Value>, value: Value): void {
  capturedReflectApply(capturedSetAdd, set, [value]);
}

function setDelete<Value>(set: Set<Value>, value: Value): void {
  capturedReflectApply(capturedSetDelete, set, [value]);
}

function setHas<Value>(set: ReadonlySet<Value>, value: Value): boolean {
  return capturedReflectApply(capturedSetHas, set, [value]);
}

function setSize(set: ReadonlySet<unknown>): number {
  const size: unknown = capturedReflectApply(capturedSetSize, set, []);
  return size as number;
}

function setSnapshot<Value>(set: ReadonlySet<Value>): readonly Value[] {
  const values: Value[] = [];
  let index = 0;

  capturedReflectApply(capturedSetForEach, set, [
    (value: Value): void => {
      values[index] = value;
      index += 1;
    },
  ]);
  return values;
}

function weakMapGet<Key extends object, Value>(
  map: WeakMap<Key, Value>,
  key: Key,
): Value | undefined {
  const value: unknown = capturedReflectApply(capturedWeakMapGet, map, [key]);
  return value as Value | undefined;
}

function weakMapSet<Key extends object, Value>(
  map: WeakMap<Key, Value>,
  key: Key,
  value: Value,
): void {
  capturedReflectApply(capturedWeakMapSet, map, [key, value]);
}

/** @internal Checkout lifecycle owner; deliberately not a transaction API. */
export class ManagedMariaDbConnectionLeaseOwner<Options> {
  readonly #active = new Set<LeaseRegistration>();
  readonly #factory: ManagedMariaDbConnectionAllocatorFactory<Options>;
  readonly #options: Options;
  readonly #pending = new Set<Promise<ManagedMariaDbConnectionLease>>();
  readonly #shutdownGraceMilliseconds: number;
  #closeOperation?: Promise<void>;
  #drainActive: (() => void) | undefined;
  #allocator?: ManagedMariaDbConnectionAllocator;
  #allocatorEndOperation?: Promise<void>;
  #shutdownFailed = false;
  #status: 'open' | 'closing' | 'closed' = 'open';

  #isOpen(): boolean {
    return this.#status === 'open';
  }

  public constructor(
    factory: ManagedMariaDbConnectionAllocatorFactory<Options>,
    options: Options,
    ownerOptions: ManagedMariaDbConnectionLeaseOwnerOptions = {},
  ) {
    const grace = ownerOptions.shutdownGraceMilliseconds ?? DEFAULT_SHUTDOWN_GRACE_MILLISECONDS;

    if (
      typeof factory !== 'function' ||
      !Number.isSafeInteger(grace) ||
      grace < 0 ||
      grace > 60_000
    ) {
      throw new TypeError('Invalid managed MariaDB connection lease owner configuration');
    }

    this.#factory = factory;
    this.#options = options;
    this.#shutdownGraceMilliseconds = grace;
  }

  public acquire(): Promise<ManagedMariaDbConnectionLease> {
    if (this.#status !== 'open') {
      throw new ManagedMariaDbConnectionAllocatorUnavailableError();
    }

    const lease = Object.freeze({}) as ManagedMariaDbConnectionLease;
    const registration: LeaseRegistration = {
      connection: undefined,
      destroyAttempted: false,
      lease,
      owner: this,
      status: 'pending',
    };
    weakMapSet(leaseRegistrations, lease, registration);

    // The operation is registered before the provider factory or getConnection can re-enter.
    const operation = Promise.resolve().then(() => this.#acquire(registration));
    setAdd(this.#pending, operation);
    void operation.then(
      (): void => {
        setDelete(this.#pending, operation);
      },
      (): void => {
        setDelete(this.#pending, operation);
      },
    );
    return operation;
  }

  async #acquire(registration: LeaseRegistration): Promise<ManagedMariaDbConnectionLease> {
    if (!this.#isOpen()) {
      registration.status = 'settled';
      throw new ManagedMariaDbConnectionAllocatorUnavailableError();
    }

    let connection: ManagedMariaDbAllocatedConnection;

    try {
      const allocator = this.#allocatorForAcquire();

      if (!this.#isOpen()) throw new ManagedMariaDbConnectionAllocatorUnavailableError();
      connection = await allocator.getConnection();
    } catch {
      registration.status = 'settled';
      throw new ManagedMariaDbConnectionAllocatorUnavailableError();
    }

    if (!this.#isOpen()) {
      registration.status = 'settled';
      this.#destroy(registration, connection);
      throw new ManagedMariaDbConnectionAllocatorUnavailableError();
    }

    registration.connection = connection;
    registration.status = 'active';
    setAdd(this.#active, registration);
    return registration.lease;
  }

  #allocatorForAcquire(): ManagedMariaDbConnectionAllocator {
    if (this.#allocator !== undefined) return this.#allocator;

    const allocator = this.#factory(this.#options);
    this.#allocator = allocator;
    return allocator;
  }

  #registrationForActive(lease: ManagedMariaDbConnectionLease): ActiveLeaseRegistration {
    const registration = weakMapGet(leaseRegistrations, lease);

    if (
      registration?.owner !== this ||
      registration.status !== 'active' ||
      registration.connection === undefined ||
      !setHas(this.#active, registration)
    ) {
      throw new InvalidManagedMariaDbConnectionLeaseError();
    }

    return registration as ActiveLeaseRegistration;
  }

  #registrationForDestroy(lease: ManagedMariaDbConnectionLease): ActiveLeaseRegistration {
    const registration = weakMapGet(leaseRegistrations, lease);

    if (
      registration?.owner !== this ||
      (registration.status !== 'active' && registration.status !== 'releasing') ||
      registration.connection === undefined ||
      !setHas(this.#active, registration)
    ) {
      throw new InvalidManagedMariaDbConnectionLeaseError();
    }

    return registration as ActiveLeaseRegistration;
  }

  public connectionFor(lease: ManagedMariaDbConnectionLease): ManagedMariaDbAllocatedConnection {
    return this.#registrationForActive(lease).connection;
  }

  public release(lease: ManagedMariaDbConnectionLease): Promise<void> {
    const registration = this.#registrationForActive(lease);
    const connection = registration.connection;
    registration.status = 'releasing';
    const operation = this.#release(registration, connection);
    void operation.catch((): void => undefined);
    return operation;
  }

  async #release(
    registration: LeaseRegistration,
    connection: ManagedMariaDbAllocatedConnection,
  ): Promise<void> {
    try {
      await connection.release();
    } catch {
      this.#destroy(registration, connection);
      this.#settle(registration);
      throw new ManagedMariaDbConnectionReleaseError();
    }

    this.#settle(registration);
  }

  public destroy(lease: ManagedMariaDbConnectionLease): void {
    const registration = this.#registrationForDestroy(lease);
    const connection = registration.connection;
    registration.status = 'settled';
    const destroyed = this.#destroy(registration, connection);
    this.#settle(registration);
    if (!destroyed) throw new ManagedMariaDbConnectionAllocatorShutdownError();
  }

  #destroy(
    registration: LeaseRegistration,
    connection: ManagedMariaDbAllocatedConnection,
  ): boolean {
    if (registration.destroyAttempted) return true;
    registration.destroyAttempted = true;

    try {
      connection.destroy();
      return true;
    } catch {
      this.#shutdownFailed = true;
      return false;
    }
  }

  #settle(registration: LeaseRegistration): void {
    registration.status = 'settled';
    registration.connection = undefined;
    setDelete(this.#active, registration);
    if (setSize(this.#active) === 0) this.#drainActive?.();
  }

  public beginClose(): void {
    if (this.#status === 'open') this.#status = 'closing';
  }

  public close(): Promise<void> {
    if (this.#closeOperation !== undefined) return this.#closeOperation;

    this.beginClose();
    this.#closeOperation = Promise.resolve()
      .then(() => this.#performClose())
      .catch(() => {
        throw new ManagedMariaDbConnectionAllocatorShutdownError();
      });
    return this.#closeOperation;
  }

  async #performClose(): Promise<void> {
    const initialAllocatorEnd = this.#startAllocatorEnd();

    try {
      await Promise.all(
        setSnapshot(this.#pending).map((operation) => operation.catch(() => undefined)),
      );
      const lateAllocatorEnd = this.#startAllocatorEnd();
      await this.#waitForDrain();
      this.#destroyRemaining();
      await Promise.all([initialAllocatorEnd, lateAllocatorEnd]);
    } catch {
      this.#shutdownFailed = true;
      this.#destroyRemaining();
    } finally {
      this.#status = 'closed';
    }

    if (this.#shutdownFailed) throw new ManagedMariaDbConnectionAllocatorShutdownError();
  }

  #startAllocatorEnd(): Promise<void> {
    if (this.#allocatorEndOperation !== undefined) return this.#allocatorEndOperation;
    if (this.#allocator === undefined) return Promise.resolve();

    try {
      this.#allocatorEndOperation = Promise.resolve(this.#allocator.end()).then(
        (): void => undefined,
        (): void => {
          this.#shutdownFailed = true;
        },
      );
    } catch {
      this.#shutdownFailed = true;
      this.#allocatorEndOperation = Promise.resolve();
    }
    return this.#allocatorEndOperation;
  }

  #waitForDrain(): Promise<void> {
    if (setSize(this.#active) === 0) return Promise.resolve();

    return new Promise((resolve): void => {
      const timeout = setTimeout(
        (): void => this.#drainActive?.(),
        this.#shutdownGraceMilliseconds,
      );
      this.#drainActive = (): void => {
        clearTimeout(timeout);
        this.#drainActive = undefined;
        resolve();
      };
      if (setSize(this.#active) === 0) this.#drainActive();
    });
  }

  #destroyRemaining(): void {
    for (const registration of setSnapshot(this.#active)) {
      const connection = registration.connection;
      registration.status = 'settled';
      if (connection === undefined) this.#shutdownFailed = true;
      else this.#destroy(registration, connection);
      this.#settle(registration);
    }
  }
}
