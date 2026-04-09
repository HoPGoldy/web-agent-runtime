import { describe, expect, it } from "vitest";
import { createRuntimeSessionData } from "../src/session/session-types";
import { IndexedDbAgentStorage } from "../src/storage/indexed-db-agent-storage";

function createStorage() {
  return new IndexedDbAgentStorage({
    dbName: `storage-contract-${crypto.randomUUID()}`,
  });
}

describe("storage provider contract", () => {
  it("persists opaque session data with revision updates", async () => {
    const storage = createStorage();
    const session = await storage.createSession({
      id: "session-1",
      title: "Session One",
      metadata: { scope: "runtime" },
    });
    const sessionData = createRuntimeSessionData({ scope: "runtime" });

    const commit = await storage.saveSessionData(session.id, sessionData, {
      expectedRevision: session.revision,
    });
    const loaded = await storage.loadSessionData(session.id);

    expect(commit.revision).not.toBe(session.revision);
    expect(loaded).toEqual({
      session: commit.session,
      data: sessionData,
    });
  });

  it("rejects stale revisions for session data writes", async () => {
    const storage = createStorage();
    const session = await storage.createSession({ id: "session-2" });
    const firstData = createRuntimeSessionData();

    const firstCommit = await storage.saveSessionData(session.id, firstData, {
      expectedRevision: session.revision,
    });

    await expect(
      storage.saveSessionData(session.id, createRuntimeSessionData(), {
        expectedRevision: session.revision,
      }),
    ).rejects.toThrow("Revision conflict for session: session-2");

    await expect(
      storage.updateSession(
        session.id,
        { title: "stale" },
        { expectedRevision: session.revision },
      ),
    ).rejects.toThrow("Revision conflict for session: session-2");

    expect(firstCommit.session.revision).not.toBe(session.revision);
  });
});