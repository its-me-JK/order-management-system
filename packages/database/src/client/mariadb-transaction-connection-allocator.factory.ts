import { Socket } from 'node:net';

import { createConnection as createDriverConnection, type Connection } from 'mariadb';

import type {
  ManagedMariaDbAllocatedConnection,
  ManagedMariaDbConnectionAllocator,
} from './managed-mariadb-connection-lease.owner';
import type { MariaDbTransactionConnectionAllocatorOptions } from './mariadb-transaction-connection-allocator.options';

const ALLOCATOR_UNAVAILABLE_MESSAGE = 'MariaDB connection allocator is unavailable';
const CONNECTION_RELEASE_MESSAGE = 'MariaDB direct connection release failed';

const observeConnectorError = (): void => undefined;

interface ConnectionRequest {
  readonly reject: (error: Error) => void;
  readonly resolve: (connection: ManagedMariaDbAllocatedConnection) => void;
  timeout: ReturnType<typeof setTimeout> | undefined;
  slot?: ConnectionSlot;
  status: 'queued' | 'connecting' | 'settled';
}

interface ConnectionSlot {
  readonly request: ConnectionRequest;
  connection?: Connection;
  driverSettled: boolean;
  readonly operations: Set<Promise<void>>;
  socket?: Socket;
  transportClosure?: Promise<void>;
  state: 'connecting' | 'active' | 'closing' | 'settled';
}

function waitForSocketClosure(socket: Socket): Promise<void> {
  return new Promise((resolve): void => {
    const inspect = (): void => {
      if (socket.closed) {
        resolve();
        return;
      }

      setTimeout(inspect, 1);
    };

    inspect();
  });
}

/**
 * Bounded direct-connection allocator built over the connector's public API.
 *
 * MariaDB 3.4.5's Pool owns eager connection attempts that Pool.end() does not
 * await. Critical transactions instead pay one handshake per checkout so this
 * allocator can own every connecting and active transport exactly.
 */
class BoundedMariaDbConnectionAllocator implements ManagedMariaDbConnectionAllocator {
  readonly #connectionLimit: number;
  readonly #connectionOptions: MariaDbTransactionConnectionAllocatorOptions['connection'];
  readonly #requests = new Set<ConnectionRequest>();
  readonly #slots = new Set<ConnectionSlot>();
  readonly #acquireTimeoutMilliseconds: number;
  #closeOperation?: Promise<void>;
  #closing = false;
  #resolveClose: (() => void) | undefined;

  public constructor(options: MariaDbTransactionConnectionAllocatorOptions) {
    this.#acquireTimeoutMilliseconds = options.acquireTimeoutMilliseconds;
    this.#connectionLimit = options.connectionLimit;
    this.#connectionOptions = options.connection;
  }

  public getConnection(): Promise<ManagedMariaDbAllocatedConnection> {
    if (this.#closing || this.#requests.size >= this.#connectionLimit) {
      return Promise.reject(new Error(ALLOCATOR_UNAVAILABLE_MESSAGE));
    }

    return new Promise((resolve, reject): void => {
      const request: ConnectionRequest = {
        reject,
        resolve,
        status: 'queued',
        timeout: undefined,
      };
      request.timeout = setTimeout((): void => {
        this.#expire(request);
      }, this.#acquireTimeoutMilliseconds);
      this.#requests.add(request);
      this.#dispatch();
    });
  }

  #dispatch(): void {
    while (!this.#closing && this.#slots.size < this.#connectionLimit) {
      const request = this.#requests.values().next().value;

      if (request === undefined) return;
      this.#requests.delete(request);
      if (request.status !== 'queued') continue;

      this.#connect(request);
    }
  }

  #connect(request: ConnectionRequest): void {
    request.status = 'connecting';
    const slot: ConnectionSlot = {
      driverSettled: false,
      operations: new Set(),
      request,
      state: 'connecting',
    };
    request.slot = slot;
    this.#slots.add(slot);

    const operation = createDriverConnection({
      ...this.#connectionOptions,
      stream: (callback): void => {
        this.#openSocket(slot, callback);
      },
    });

    void operation.then(
      (connection): void => {
        this.#connectionEstablished(slot, connection);
      },
      (): void => {
        this.#connectionFailed(slot);
      },
    );
  }

  #openSocket(
    slot: ConnectionSlot,
    callback: Parameters<
      NonNullable<MariaDbTransactionConnectionAllocatorOptions['connection']['stream']>
    >[0],
  ): void {
    if (callback === undefined) return;

    if (this.#closing || slot.state !== 'connecting') {
      callback(new Error(ALLOCATOR_UNAVAILABLE_MESSAGE));
      return;
    }

    const socket = new Socket();
    slot.socket = socket;
    callback(undefined, socket);
    socket.connect({
      host: this.#connectionOptions.host,
      port: this.#connectionOptions.port,
    });
  }

  #connectionEstablished(slot: ConnectionSlot, connection: Connection): void {
    slot.driverSettled = true;
    slot.connection = connection;
    // A fixed-error transport quarantine is intentional. The connector emits
    // that error on its Connection when no command is active; observing it
    // prevents a process-level uncaught exception without logging internals.
    connection.on('error', observeConnectorError);

    if (this.#closing || slot.request.status === 'settled' || slot.state !== 'connecting') {
      this.#destroyTransport(slot);
      return;
    }

    slot.state = 'active';
    this.#settleRequest(slot.request);
    slot.request.resolve(this.#managedConnection(slot, connection));
  }

  #connectionFailed(slot: ConnectionSlot): void {
    slot.driverSettled = true;
    this.#rejectRequest(slot.request);
    this.#destroyTransport(slot);
    this.#settleSlotIfClosed(slot);
  }

  #managedConnection(
    slot: ConnectionSlot,
    connection: Connection,
  ): ManagedMariaDbAllocatedConnection {
    return Object.freeze({
      destroy: (): void => {
        this.#destroyTransport(slot);
      },
      query: <Result>(sql: string): Promise<Result> => this.#query(slot, connection, sql),
      release: async (): Promise<void> => this.#release(slot),
    });
  }

  #query<Result>(slot: ConnectionSlot, connection: Connection, sql: string): Promise<Result> {
    if (slot.state !== 'active') return Promise.reject(new Error(ALLOCATOR_UNAVAILABLE_MESSAGE));

    let operation: Promise<Result>;

    try {
      operation = connection.query<Result>(sql);
    } catch (error: unknown) {
      return Promise.reject(
        error instanceof Error ? error : new Error(ALLOCATOR_UNAVAILABLE_MESSAGE),
      );
    }

    const settlement = operation.then(
      (): void => undefined,
      (): void => undefined,
    );
    slot.operations.add(settlement);
    void settlement.then((): void => {
      slot.operations.delete(settlement);
      this.#settleSlotIfClosed(slot);
    });
    return operation;
  }

  async #release(slot: ConnectionSlot): Promise<void> {
    if (slot.state !== 'active') throw new Error(CONNECTION_RELEASE_MESSAGE);
    // One-use connections are deliberately terminated through their exact
    // owned stream. Calling connector end() first moves it to CLOSING, where
    // its socket error handler no longer rejects a stalled command or QUIT.
    this.#destroyTransport(slot);
    await Promise.all([this.#observeTransportClosure(slot), ...slot.operations]);

    this.#settleSlotIfClosed(slot);
  }

  #destroyTransport(slot: ConnectionSlot): void {
    if (slot.state === 'settled') return;
    slot.state = 'closing';

    if (slot.socket === undefined) {
      this.#settleSlotIfClosed(slot);
      return;
    }

    if (!slot.socket.destroyed) {
      // Never call connector Connection.destroy(): with work in flight it opens
      // an unbudgeted helper connection to issue KILL. This exact owned stream
      // is the quarantine boundary.
      slot.socket.once('error', observeConnectorError);
      slot.socket.destroy(new Error(ALLOCATOR_UNAVAILABLE_MESSAGE));
    }
    void this.#observeTransportClosure(slot);
  }

  #observeTransportClosure(slot: ConnectionSlot): Promise<void> {
    if (slot.socket === undefined) return Promise.resolve();

    slot.transportClosure ??= waitForSocketClosure(slot.socket).then((): void => {
      this.#settleSlotIfClosed(slot);
    });
    return slot.transportClosure;
  }

  #settleSlotIfClosed(slot: ConnectionSlot): void {
    if (!slot.driverSettled) return;
    if (slot.operations.size > 0) return;
    if (slot.socket !== undefined && !slot.socket.closed) return;
    this.#settleSlot(slot);
  }

  #settleSlot(slot: ConnectionSlot): void {
    if (slot.state === 'settled') return;
    slot.state = 'settled';
    this.#slots.delete(slot);
    this.#dispatch();
    this.#resolveCloseIfDrained();
  }

  #expire(request: ConnectionRequest): void {
    if (request.status === 'settled') return;
    this.#requests.delete(request);
    this.#rejectRequest(request);

    if (request.slot !== undefined) this.#destroyTransport(request.slot);
  }

  #settleRequest(request: ConnectionRequest): void {
    if (request.status === 'settled') return;
    request.status = 'settled';
    if (request.timeout !== undefined) clearTimeout(request.timeout);
    request.timeout = undefined;
  }

  #rejectRequest(request: ConnectionRequest): void {
    if (request.status === 'settled') return;
    this.#settleRequest(request);
    request.reject(new Error(ALLOCATOR_UNAVAILABLE_MESSAGE));
  }

  public end(): Promise<void> {
    if (this.#closeOperation !== undefined) return this.#closeOperation;

    this.#closing = true;
    this.#closeOperation = new Promise((resolve): void => {
      this.#resolveClose = resolve;
    });

    const queuedRequests = [...this.#requests];
    this.#requests.clear();
    for (const request of queuedRequests) this.#rejectRequest(request);

    for (const slot of this.#slots) {
      if (slot.state === 'connecting') {
        this.#rejectRequest(slot.request);
        this.#destroyTransport(slot);
      }
    }

    this.#resolveCloseIfDrained();
    return this.#closeOperation;
  }

  #resolveCloseIfDrained(): void {
    if (!this.#closing || this.#slots.size > 0) return;
    this.#resolveClose?.();
    this.#resolveClose = undefined;
  }
}

/** @internal Creates the package-owned bounded direct-connection allocator. */
export function createManagedMariaDbConnectionAllocator(
  options: MariaDbTransactionConnectionAllocatorOptions,
): ManagedMariaDbConnectionAllocator {
  if (
    !Number.isSafeInteger(options.acquireTimeoutMilliseconds) ||
    options.acquireTimeoutMilliseconds < 1 ||
    !Number.isSafeInteger(options.connectionLimit) ||
    options.connectionLimit < 1 ||
    typeof options.connection.host !== 'string' ||
    typeof options.connection.port !== 'number' ||
    !Number.isSafeInteger(options.connection.port)
  ) {
    throw new TypeError('Invalid MariaDB connection allocator configuration');
  }

  return new BoundedMariaDbConnectionAllocator(options);
}
