export interface DatabaseDriver {
  close(): Promise<void>;
  probe(): Promise<void>;
}
