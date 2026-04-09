/**
 * Metadata record persisted for each session.
 */
export interface SessionRecord {
  /** Stable session identifier. */
  id: string;
  /** Optional human-readable title for the session. */
  title?: string;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** ISO 8601 timestamp for the latest persisted change. */
  updatedAt: string;
  /** Optimistic concurrency token for the current stored revision. */
  revision: string;
  /** Arbitrary host-defined metadata associated with the session. */
  metadata?: Record<string, unknown>;
}

/**
 * Session record bundled with its serialized session payload.
 */
export interface StoredSessionData<TSessionData = unknown> {
  /** Session metadata for the stored payload. */
  session: SessionRecord;
  /** Serialized runtime-specific session data. */
  data: TSessionData;
}

/**
 * Options controlling optimistic session mutations.
 */
export interface MutationOptions {
  /** Revision that must match before the mutation is applied. */
  expectedRevision?: string;
}

/**
 * Result returned after persisting session data.
 */
export interface CommitResult {
  /** Updated session metadata after the write succeeds. */
  session: SessionRecord;
  /** Revision generated for the successful write. */
  revision: string;
}

/**
 * Input for creating a new stored session.
 */
export interface CreateSessionInput {
  /** Optional custom session identifier. */
  id?: string;
  /** Optional session title. */
  title?: string;
  /** Arbitrary metadata to persist alongside the session. */
  metadata?: Record<string, unknown>;
}

/**
 * Partial update payload for stored session metadata.
 */
export interface UpdateSessionInput {
  /** Replacement title, when changing session labeling. */
  title?: string;
  /** Replacement metadata, typically merged by the caller before submission. */
  metadata?: Record<string, unknown>;
}

/**
 * Converts between runtime-native and persisted session data formats.
 */
export interface SessionDataCodec<TSessionData = unknown, TRuntimeSessionData = unknown> {
  /** Serializes runtime session data for storage. */
  serialize(data: TRuntimeSessionData): Promise<TSessionData> | TSessionData;
  /** Rehydrates runtime session data from its stored representation. */
  deserialize(data: TSessionData): Promise<TRuntimeSessionData> | TRuntimeSessionData;
}

/**
 * Persistence backend used by the runtime session store.
 */
export interface StorageProvider<TSessionData = unknown> {
  /** Creates and persists a new session record. */
  createSession(input?: CreateSessionInput): Promise<SessionRecord>;
  /** Loads a single session record by id. */
  getSession(sessionId: string): Promise<SessionRecord | null>;
  /** Lists all sessions visible to the backend. */
  listSessions(): Promise<SessionRecord[]>;
  /** Updates persisted session metadata. */
  updateSession(
    sessionId: string,
    patch: UpdateSessionInput,
    options?: MutationOptions,
  ): Promise<SessionRecord>;
  /** Deletes a session and any associated stored payloads. */
  deleteSession(sessionId: string): Promise<void>;
  /** Loads the serialized payload for a session, if present. */
  loadSessionData(sessionId: string): Promise<StoredSessionData<TSessionData> | null>;
  /** Persists serialized session data for a session. */
  saveSessionData(sessionId: string, data: TSessionData, options?: MutationOptions): Promise<CommitResult>;
}
