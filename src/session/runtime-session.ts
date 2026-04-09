import type {
  CommitResult,
  CreateSessionInput,
  SessionDataCodec,
  SessionRecord,
  StorageProvider,
  UpdateSessionInput,
} from "./contracts";
import { createJsonSessionDataCodec } from "./session-data-codec";
import { createRuntimeSessionData, extractBranchSessionData, type RuntimeSessionData } from "./session-types";
import type { ForkSessionInput, ForkSessionResult } from "../runtime/contracts";
import { traceRuntimeDebug, type RuntimeLogger } from "../runtime/debug";

/**
 * Runtime session record paired with its hydrated session data.
 */
export interface LoadedRuntimeSession {
  session: SessionRecord;
  data: RuntimeSessionData;
}

/**
 * Result of forking a runtime session, including the forked branch data.
 */
export interface ForkedRuntimeSession extends ForkSessionResult {
  data: RuntimeSessionData;
}

export class RuntimeSessionStore<TSessionData = RuntimeSessionData> {
  private readonly codec: SessionDataCodec<TSessionData, RuntimeSessionData>;

  constructor(
    private readonly storage: StorageProvider<TSessionData>,
    codec?: SessionDataCodec<TSessionData, RuntimeSessionData>,
    private readonly logger?: RuntimeLogger,
  ) {
    this.codec =
      codec ?? (createJsonSessionDataCodec() as SessionDataCodec<TSessionData, RuntimeSessionData>);
  }

  async create(input: CreateSessionInput = {}): Promise<LoadedRuntimeSession> {
    traceRuntimeDebug(this.logger, "session-store:create:start", {
      title: input.title ?? null,
    });
    const session = await this.storage.createSession(input);
    traceRuntimeDebug(this.logger, "session-store:create:storage-done", {
      sessionId: session.id,
      revision: session.revision,
    });
    return {
      session,
      data: createRuntimeSessionData(input.metadata),
    };
  }

  async open(sessionId: string): Promise<LoadedRuntimeSession> {
    const session = await this.storage.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const stored = await this.storage.loadSessionData(sessionId);
    if (!stored) {
      return {
        session,
        data: createRuntimeSessionData(session.metadata),
      };
    }

    return {
      session: stored.session,
      data: await this.codec.deserialize(stored.data),
    };
  }

  async list() {
    return this.storage.listSessions();
  }

  async update(sessionId: string, patch: UpdateSessionInput, expectedRevision?: string) {
    return this.storage.updateSession(sessionId, patch, { expectedRevision });
  }

  async delete(sessionId: string) {
    await this.storage.deleteSession(sessionId);
  }

  async save(sessionId: string, data: RuntimeSessionData, expectedRevision?: string): Promise<CommitResult> {
    const payload = await this.codec.serialize(data);
    return this.storage.saveSessionData(sessionId, payload, {
      expectedRevision,
    });
  }

  async fork(input: ForkSessionInput): Promise<ForkedRuntimeSession> {
    const source = await this.open(input.sourceSessionId);
    const sourceHeadId = input.fromEntryId ?? source.data.headEntryId;
    const data = sourceHeadId
      ? extractBranchSessionData(source.data, sourceHeadId)
      : createRuntimeSessionData();
    const created = await this.storage.createSession({
      title: input.title ?? source.session.title,
      metadata: {
        ...(input.metadata ?? {}),
        parentSessionId: input.sourceSessionId,
        sourceEntryId: sourceHeadId,
      },
    });
    const commit = await this.save(created.id, data, created.revision);

    return {
      session: commit.session,
      revision: commit.revision,
      data,
    };
  }
}
