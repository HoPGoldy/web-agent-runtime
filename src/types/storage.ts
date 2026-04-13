import type { LoggerOptions } from "./runtime";

/**
 * Options for creating an IndexedDB-backed storage provider.
 */
export interface IndexedDbAgentStorageOptions {
  /** IndexedDB database name used to store sessions and serialized session data. */
  dbName?: string;
  /** Database version used for schema upgrades. */
  version?: number;
  /** Optional runtime logger configuration for storage diagnostics. */
  loggerOptions?: LoggerOptions;
}

/**
 * IndexedDB record shape used for serialized runtime session data.
 */
export interface StoredOpaqueSessionData<TSessionData = unknown> {
  sessionId: string;
  data: TSessionData;
}
