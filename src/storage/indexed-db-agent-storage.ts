import { createAgentId } from "../utils/agent";
import type {
  CommitResult,
  CreateSessionInput,
  MutationOptions,
  SessionRecord,
  StoredSessionData,
  StorageProvider,
  UpdateSessionInput,
} from "../types/session";
import type { IndexedDbAgentStorageOptions, StoredOpaqueSessionData } from "../types/storage";
import {
  createRuntimeLogger,
  traceRuntimeDebug,
  traceRuntimeError,
  traceRuntimeWarning,
  type RuntimeLogger,
} from "../runtime/debug";

export const DEFAULT_INDEXED_DB_STORAGE_NAME = "web-agent-runtime";

export type { IndexedDbAgentStorageOptions } from "../types/storage";

function createRevision() {
  return `${Date.now()}-${createAgentId()}`;
}

function assertRevision(session: SessionRecord, options?: MutationOptions) {
  if (options?.expectedRevision !== undefined && session.revision !== options.expectedRevision) {
    throw new Error(`Revision conflict for session: ${session.id}`);
  }
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionToPromise(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/**
 * Browser storage provider backed by IndexedDB.
 */
export class IndexedDbAgentStorage<TSessionData = unknown> implements StorageProvider<TSessionData> {
  private readonly dbName: string;
  private readonly version: number;
  private readonly logger?: RuntimeLogger;
  private dbPromise: Promise<IDBDatabase> | null = null;

  /**
   * Creates an IndexedDB-backed storage provider suitable for browser runtimes.
   */
  constructor(options: IndexedDbAgentStorageOptions = {}) {
    this.dbName = options.dbName ?? DEFAULT_INDEXED_DB_STORAGE_NAME;
    this.version = options.version ?? 3;
    this.logger = createRuntimeLogger(options.loggerOptions);
  }

  /** Creates and persists a new session record. */
  async createSession(input: CreateSessionInput = {}) {
    traceRuntimeDebug(this.logger, "storage:indexeddb:create-session:start", {
      dbName: this.dbName,
      title: input.title ?? null,
    });
    const now = new Date().toISOString();
    const session: SessionRecord = {
      id: input.id ?? createAgentId(),
      title: input.title ?? "Untitled Session",
      createdAt: now,
      updatedAt: now,
      revision: createRevision(),
      metadata: input.metadata,
    };

    const db = await this.getDb();
    traceRuntimeDebug(this.logger, "storage:indexeddb:create-session:db-ready", {
      dbName: this.dbName,
      sessionId: session.id,
    });
    const transaction = db.transaction(["sessions"], "readwrite");
    transaction.objectStore("sessions").put(session);
    traceRuntimeDebug(this.logger, "storage:indexeddb:create-session:put-dispatched", {
      sessionId: session.id,
    });
    await transactionToPromise(transaction);
    traceRuntimeDebug(this.logger, "storage:indexeddb:create-session:done", {
      sessionId: session.id,
      revision: session.revision,
    });
    return session;
  }

  /** Loads a single session record by id. */
  async getSession(id: string) {
    const db = await this.getDb();
    const transaction = db.transaction(["sessions"], "readonly");
    const session = await requestToPromise(transaction.objectStore("sessions").get(id));
    await transactionToPromise(transaction);
    return (session ?? null) as SessionRecord | null;
  }

  /** Lists sessions ordered by most recently updated first. */
  async listSessions() {
    const db = await this.getDb();
    const transaction = db.transaction(["sessions"], "readonly");
    const sessions = await requestToPromise(transaction.objectStore("sessions").getAll());
    await transactionToPromise(transaction);
    return (sessions as SessionRecord[]).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  /** Updates session metadata using optional optimistic concurrency checks. */
  async updateSession(id: string, patch: UpdateSessionInput, options?: MutationOptions) {
    const current = await this.getSession(id);
    if (!current) {
      throw new Error(`Session not found: ${id}`);
    }

    assertRevision(current, options);

    const next: SessionRecord = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
      revision: createRevision(),
    };

    const db = await this.getDb();
    const transaction = db.transaction(["sessions"], "readwrite");
    transaction.objectStore("sessions").put(next);
    await transactionToPromise(transaction);
    return next;
  }

  /** Deletes a session together with its serialized runtime data. */
  async deleteSession(id: string) {
    const db = await this.getDb();
    const transaction = db.transaction(["sessions", "sessionData"], "readwrite");
    transaction.objectStore("sessions").delete(id);
    transaction.objectStore("sessionData").delete(id);
    await transactionToPromise(transaction);
  }

  /** Loads serialized runtime data for the given session id. */
  async loadSessionData(sessionId: string) {
    const session = await this.getSession(sessionId);
    if (!session) {
      return null;
    }

    const db = await this.getDb();
    const transaction = db.transaction(["sessionData"], "readonly");
    const record = await requestToPromise(transaction.objectStore("sessionData").get(sessionId));
    await transactionToPromise(transaction);
    const stored = record as StoredOpaqueSessionData<TSessionData> | undefined;
    if (!stored) {
      return null;
    }

    return {
      session,
      data: stored.data,
    } as StoredSessionData<TSessionData>;
  }

  /** Persists serialized runtime data and advances the session revision. */
  async saveSessionData(sessionId: string, data: TSessionData, options?: MutationOptions) {
    const current = await this.getSession(sessionId);
    if (!current) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    assertRevision(current, options);

    const nextSession: SessionRecord = {
      ...current,
      updatedAt: new Date().toISOString(),
      revision: createRevision(),
    };
    const db = await this.getDb();
    const transaction = db.transaction(["sessions", "sessionData"], "readwrite");
    transaction.objectStore("sessions").put(nextSession);
    transaction.objectStore("sessionData").put({
      sessionId,
      data,
    } satisfies StoredOpaqueSessionData<TSessionData>);
    await transactionToPromise(transaction);

    return {
      session: nextSession,
      revision: nextSession.revision,
    } satisfies CommitResult;
  }

  private getDb() {
    if (!this.dbPromise) {
      this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        traceRuntimeDebug(this.logger, "storage:indexeddb:get-db:open:start", {
          dbName: this.dbName,
          version: this.version,
        });
        const request = indexedDB.open(this.dbName, this.version);

        request.onupgradeneeded = () => {
          traceRuntimeDebug(this.logger, "storage:indexeddb:get-db:open:upgrade-needed", {
            dbName: this.dbName,
          });
          const db = request.result;
          if (!db.objectStoreNames.contains("sessions")) {
            db.createObjectStore("sessions", { keyPath: "id" });
          }
          if (!db.objectStoreNames.contains("sessionData")) {
            db.createObjectStore("sessionData", { keyPath: "sessionId" });
          }
          if (db.objectStoreNames.contains("messages")) {
            db.deleteObjectStore("messages");
          }
        };

        request.onblocked = () => {
          traceRuntimeWarning(this.logger, "storage:indexeddb:get-db:open:blocked", {
            dbName: this.dbName,
          });
        };

        request.onsuccess = () => {
          traceRuntimeDebug(this.logger, "storage:indexeddb:get-db:open:success", {
            dbName: this.dbName,
          });
          resolve(request.result);
        };
        request.onerror = () => {
          traceRuntimeError(this.logger, "storage:indexeddb:get-db:open:error", {
            dbName: this.dbName,
            message: request.error?.message ?? String(request.error),
          });
          reject(request.error);
        };
      });
    }

    return this.dbPromise;
  }
}
