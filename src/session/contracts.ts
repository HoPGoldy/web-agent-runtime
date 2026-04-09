export interface SessionRecord {
  id: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  revision: string;
  metadata?: Record<string, unknown>;
}

export interface StoredSessionData<TSessionData = unknown> {
  session: SessionRecord;
  data: TSessionData;
}

export interface MutationOptions {
  expectedRevision?: string;
}

export interface CommitResult {
  session: SessionRecord;
  revision: string;
}

export interface CreateSessionInput {
  id?: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateSessionInput {
  title?: string;
  metadata?: Record<string, unknown>;
}

export interface SessionDataCodec<TSessionData = unknown, TRuntimeSessionData = unknown> {
  serialize(data: TRuntimeSessionData): Promise<TSessionData> | TSessionData;
  deserialize(data: TSessionData): Promise<TRuntimeSessionData> | TRuntimeSessionData;
}

export interface StorageProvider<TSessionData = unknown> {
  createSession(input?: CreateSessionInput): Promise<SessionRecord>;
  getSession(sessionId: string): Promise<SessionRecord | null>;
  listSessions(): Promise<SessionRecord[]>;
  updateSession(
    sessionId: string,
    patch: UpdateSessionInput,
    options?: MutationOptions,
  ): Promise<SessionRecord>;
  deleteSession(sessionId: string): Promise<void>;
  loadSessionData(sessionId: string): Promise<StoredSessionData<TSessionData> | null>;
  saveSessionData(sessionId: string, data: TSessionData, options?: MutationOptions): Promise<CommitResult>;
}
