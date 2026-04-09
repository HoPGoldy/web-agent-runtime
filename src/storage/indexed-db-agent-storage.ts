import type { UIMessage } from "ai";
import { createAgentId, type AgentSessionCreateInput } from "../types";
import type {
  CommitResult,
  CreateSessionInput,
  MutationOptions,
  SessionRecord,
  StoredSessionData,
  StorageProvider,
  UpdateSessionInput,
} from "../session";

interface IndexedDbAgentStorageOptions {
  dbName: string;
  version?: number;
}

interface StoredMessages<UI_MESSAGE extends UIMessage> {
  sessionId: string;
  messages: UI_MESSAGE[];
}

interface StoredOpaqueSessionData<TSessionData = unknown> {
  sessionId: string;
  data: TSessionData;
}

function createRevision() {
  return `${Date.now()}-${createAgentId()}`;
}

function assertRevision(session: SessionRecord, options?: MutationOptions) {
  if (
    options?.expectedRevision !== undefined &&
    session.revision !== options.expectedRevision
  ) {
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

export class IndexedDbAgentStorage<
  UI_MESSAGE extends UIMessage = UIMessage,
  TSessionData = UI_MESSAGE[],
> implements StorageProvider<TSessionData> {
  private readonly dbName: string;
  private readonly version: number;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(options: IndexedDbAgentStorageOptions) {
    this.dbName = options.dbName;
    this.version = options.version ?? 2;
  }

  async createSession(input: AgentSessionCreateInput | CreateSessionInput = {}) {
    const now = new Date().toISOString();
    const metadata = "metadata" in input ? input.metadata : undefined;
    const session: SessionRecord = {
      id: input.id ?? createAgentId(),
      title: input.title ?? "Untitled Session",
      createdAt: now,
      updatedAt: now,
      revision: createRevision(),
      metadata,
    };

    const db = await this.getDb();
    const transaction = db.transaction(["sessions"], "readwrite");
    transaction.objectStore("sessions").put(session);
    await transactionToPromise(transaction);
    return session;
  }

  async getSession(id: string) {
    const db = await this.getDb();
    const transaction = db.transaction(["sessions"], "readonly");
    const session = await requestToPromise(
      transaction.objectStore("sessions").get(id),
    );
    await transactionToPromise(transaction);
    return (session ?? null) as SessionRecord | null;
  }

  async listSessions() {
    const db = await this.getDb();
    const transaction = db.transaction(["sessions"], "readonly");
    const sessions = await requestToPromise(
      transaction.objectStore("sessions").getAll(),
    );
    await transactionToPromise(transaction);
    return (sessions as SessionRecord[]).sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  }

  async updateSession(
    id: string,
    patch: UpdateSessionInput,
    options?: MutationOptions,
  ) {
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

  async deleteSession(id: string) {
    const db = await this.getDb();
    const transaction = db.transaction(
      ["sessions", "messages", "sessionData"],
      "readwrite",
    );
    transaction.objectStore("sessions").delete(id);
    transaction.objectStore("messages").delete(id);
    transaction.objectStore("sessionData").delete(id);
    await transactionToPromise(transaction);
  }

  async loadSessionData(sessionId: string) {
    const session = await this.getSession(sessionId);
    if (!session) {
      return null;
    }

    const db = await this.getDb();
    const transaction = db.transaction(["sessionData"], "readonly");
    const record = await requestToPromise(
      transaction.objectStore("sessionData").get(sessionId),
    );
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

  async saveSessionData(
    sessionId: string,
    data: TSessionData,
    options?: MutationOptions,
  ) {
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
    const transaction = db.transaction(
      ["sessions", "sessionData"],
      "readwrite",
    );
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

  async loadMessages(id: string) {
    const db = await this.getDb();
    const transaction = db.transaction(["messages"], "readonly");
    const record = await requestToPromise(
      transaction.objectStore("messages").get(id),
    );
    await transactionToPromise(transaction);
    return ((record as StoredMessages<UI_MESSAGE> | undefined)?.messages ??
      []) as UI_MESSAGE[];
  }

  async saveMessages(
    id: string,
    messages: UI_MESSAGE[],
    _options?: MutationOptions,
  ) {
    const db = await this.getDb();
    const transaction = db.transaction(["messages"], "readwrite");
    transaction.objectStore("messages").put({
      sessionId: id,
      messages,
    } satisfies StoredMessages<UI_MESSAGE>);
    await transactionToPromise(transaction);
  }

  private getDb() {
    if (!this.dbPromise) {
      this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(this.dbName, this.version);

        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("sessions")) {
            db.createObjectStore("sessions", { keyPath: "id" });
          }
          if (!db.objectStoreNames.contains("messages")) {
            db.createObjectStore("messages", { keyPath: "sessionId" });
          }
          if (!db.objectStoreNames.contains("sessionData")) {
            db.createObjectStore("sessionData", { keyPath: "sessionId" });
          }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    return this.dbPromise;
  }
}
