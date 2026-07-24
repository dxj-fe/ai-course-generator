declare module "node:sqlite" {
  type SqliteValue = string | number | bigint | Uint8Array | null;

  export interface StatementResultingChanges {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  export class StatementSync {
    all(...anonymousParameters: SqliteValue[]): unknown[];
    get(...anonymousParameters: SqliteValue[]): unknown;
    run(...anonymousParameters: SqliteValue[]): StatementResultingChanges;
  }

  export class DatabaseSync {
    constructor(path: string);
    close(): void;
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
  }
}
