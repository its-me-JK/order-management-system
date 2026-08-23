export interface DatabaseDriver {
  beginClose(): void;
  close(): Promise<void>;
  probe(): Promise<void>;
}
