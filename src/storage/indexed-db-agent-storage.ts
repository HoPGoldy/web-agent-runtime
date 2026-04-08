import type { UIMessage } from "ai";
import {
  createAgentId,
  type AgentSession,
  type AgentSessionCreateInput,
  type AgentSessionUpdateInput,
} from "../types";
import type { StorageInterface } from "./storage-interface";

interface IndexedDbAgentStorageOptions {
  dbName: string;
  version?: number;
}

interface StoredMessages<UI_MESSAGE extends UIMessage> {
  sessionId: string;
  messages: UI_MESSAGE[];
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
> implements StorageInterface<UI_MESSAGE> {
  private readonly dbName: string;
  private readonly version: number;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(options: IndexedDbAgentStorageOptions) {
    this.dbName = options.dbName;
    this.version = options.version ?? 1;
  }

  async createSession(input: AgentSessionCreateInput = {}) {
    const now = new Date().toISOString();
    const session: AgentSession = {
      id: input.id ?? createAgentId(),
      title: input.title ?? "Untitled Session",
      createdAt: now,
      updatedAt: now,
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
    return (session ?? null) as AgentSession | null;
  }

  async listSessions() {
    const db = await this.getDb();
    const transaction = db.transaction(["sessions"], "readonly");
    const sessions = await requestToPromise(
      transaction.objectStore("sessions").getAll(),
    );
    await transactionToPromise(transaction);
    return (sessions as AgentSession[]).sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  }

  async updateSession(id: string, patch: AgentSessionUpdateInput) {
    const current = await this.getSession(id);
    if (!current) {
      throw new Error(`Session not found: ${id}`);
    }

    const next: AgentSession = {
      ...current,
      ...patch,
      updatedAt: patch.updatedAt ?? new Date().toISOString(),
    };

    const db = await this.getDb();
    const transaction = db.transaction(["sessions"], "readwrite");
    transaction.objectStore("sessions").put(next);
    await transactionToPromise(transaction);
    return next;
  }

  async deleteSession(id: string) {
    const db = await this.getDb();
    const transaction = db.transaction(["sessions", "messages"], "readwrite");
    transaction.objectStore("sessions").delete(id);
    transaction.objectStore("messages").delete(id);
    await transactionToPromise(transaction);
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

  async saveMessages(id: string, messages: UI_MESSAGE[]) {
    const db = await this.getDb();
    const transaction = db.transaction(["messages"], "readwrite");
    const payload: StoredMessages<UI_MESSAGE> = {
      sessionId: id,
      messages,
    };
    transaction.objectStore("messages").put(payload);
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
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    return this.dbPromise;
  }
}
