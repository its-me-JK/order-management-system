import type { DatabaseDriver } from './client/database.driver';
import type { DatabaseConnection } from './database.contract';

export class ManagedDatabaseConnection implements DatabaseConnection {
  private activeProbe: Promise<void> | undefined;
  private closeOperation: Promise<void> | undefined;
  private closed = false;

  public constructor(
    private readonly driver: DatabaseDriver,
    private readonly probeTimeoutMilliseconds = 1_000,
  ) {}

  public probe(): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error('Database connection is closed'));
    }

    this.activeProbe ??= this.startProbe();

    return this.withProbeTimeout(this.activeProbe);
  }

  private startProbe(): Promise<void> {
    const operation = Promise.resolve().then(async (): Promise<void> => this.driver.probe());

    void operation.then(
      (): void => {
        this.clearActiveProbe(operation);
      },
      (): void => {
        this.clearActiveProbe(operation);
      },
    );

    return operation;
  }

  public close(): Promise<void> {
    if (this.closeOperation !== undefined) {
      return this.closeOperation;
    }

    this.closed = true;
    this.driver.beginClose();
    const activeProbeSettlement = this.waitForActiveProbe();

    this.closeOperation = activeProbeSettlement.then(() => this.driver.close());

    return this.closeOperation;
  }

  private clearActiveProbe(operation: Promise<void>): void {
    if (this.activeProbe === operation) {
      this.activeProbe = undefined;
    }
  }

  private waitForActiveProbe(): Promise<void> {
    if (this.activeProbe === undefined) {
      return Promise.resolve();
    }

    return this.settleWithinTimeout(this.activeProbe);
  }

  private settleWithinTimeout(operation: Promise<void>): Promise<void> {
    return new Promise((resolve): void => {
      const timeout = setTimeout(resolve, this.probeTimeoutMilliseconds);

      void operation.then(
        (): void => {
          clearTimeout(timeout);
          resolve();
        },
        (): void => {
          clearTimeout(timeout);
          resolve();
        },
      );
    });
  }

  private withProbeTimeout(operation: Promise<void>): Promise<void> {
    return new Promise((resolve, reject): void => {
      const timeout = setTimeout((): void => {
        reject(new Error('Database probe timed out'));
      }, this.probeTimeoutMilliseconds);

      void operation.then(
        (): void => {
          clearTimeout(timeout);
          resolve();
        },
        (error: unknown): void => {
          clearTimeout(timeout);
          reject(error instanceof Error ? error : new Error('Database probe failed'));
        },
      );
    });
  }
}
