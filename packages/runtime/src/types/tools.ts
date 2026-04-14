import type { ToolDefinition } from "./provider";

export interface CreateLocalStorageToolsOptions {
  /** Storage implementation to use. Defaults to `globalThis.localStorage`. */
  storage?: Storage;
  /** Optional prefix applied to every key managed by these tools. */
  keyPrefix?: string;
}

export interface LocalStorageEntry {
  key: string;
  value: string;
}

export interface LocalStorageReadInput {
  key?: string;
}

export interface LocalStorageWriteInput {
  key: string;
  value: string;
}

export interface LocalStorageDeleteInput {
  key: string;
}

export type LocalStorageToolDetails =
  | {
      operation: "read";
      keyPrefix: string;
      totalKeys: number;
      key?: string;
      exists?: boolean;
      value?: string | null;
      entries?: LocalStorageEntry[];
    }
  | {
      operation: "create" | "update";
      key: string;
      value: string;
      keyPrefix: string;
      totalKeys: number;
    }
  | {
      operation: "delete";
      key: string;
      existed: boolean;
      keyPrefix: string;
      totalKeys: number;
    };

export type LocalStorageTool = ToolDefinition<unknown, LocalStorageToolDetails>;
