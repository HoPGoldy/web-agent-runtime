import { describe, expect, it } from "vitest";
import { IndexedDbAgentStorage } from "../src/storage/indexed-db-agent-storage";

function createStorage() {
  return new IndexedDbAgentStorage<Record<string, unknown>>({
    dbName: `test-db-${crypto.randomUUID()}`,
  });
}

describe("IndexedDbAgentStorage", () => {
  it("creates and loads sessions", async () => {
    const storage = createStorage();

    const session = await storage.createSession({
      id: "session-1",
      title: "First Session",
    });

    expect(await storage.getSession("session-1")).toEqual(session);
  });

  it("lists sessions by descending updatedAt", async () => {
    const storage = createStorage();

    const older = await storage.createSession({ id: "older", title: "Older" });
    let newer = await storage.createSession({ id: "newer", title: "Newer" });

    for (
      let attempt = 0;
      attempt < 5 && newer.updatedAt <= older.updatedAt;
      attempt += 1
    ) {
      newer = await storage.updateSession("newer", {
        title: `Newer ${attempt}`,
      });
    }

    expect((await storage.listSessions()).map((session) => session.id)).toEqual(
      ["newer", "older"],
    );
  });

  it("saves, loads, and deletes session data", async () => {
    const storage = createStorage();
    const sessionData = {
      version: 1,
      entries: ["message-1", "message-2"],
    };

    const session = await storage.createSession({ id: "session-1" });
    await storage.saveSessionData("session-1", sessionData, {
      expectedRevision: session.revision,
    });

    expect(await storage.loadSessionData("session-1")).toEqual({
      session: expect.objectContaining({ id: "session-1" }),
      data: sessionData,
    });

    await storage.deleteSession("session-1");

    expect(await storage.getSession("session-1")).toBeNull();
    expect(await storage.loadSessionData("session-1")).toBeNull();
  });

  it("rejects updates for missing sessions", async () => {
    const storage = createStorage();

    await expect(
      storage.updateSession("missing", { title: "No Session" }),
    ).rejects.toThrow("Session not found: missing");
  });
});
