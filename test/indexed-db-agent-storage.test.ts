import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { IndexedDbAgentStorage } from "../src/storage/indexed-db-agent-storage";

function createMessage(id: string): UIMessage {
  return {
    id,
    role: "user",
    parts: [{ type: "text", text: id }],
  } as UIMessage;
}

function createStorage() {
  return new IndexedDbAgentStorage({
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

    await storage.createSession({ id: "older", title: "Older" });
    await storage.createSession({ id: "newer", title: "Newer" });
    await storage.updateSession("older", {
      updatedAt: "2024-01-01T00:00:00.000Z",
    });
    await storage.updateSession("newer", {
      updatedAt: "2025-01-01T00:00:00.000Z",
    });

    expect((await storage.listSessions()).map((session) => session.id)).toEqual(["newer", "older"]);
  });

  it("saves, loads, and deletes session messages", async () => {
    const storage = createStorage();
    const messages = [createMessage("message-1"), createMessage("message-2")];

    await storage.createSession({ id: "session-1" });
    await storage.saveMessages("session-1", messages);

    expect(await storage.loadMessages("session-1")).toEqual(messages);

    await storage.deleteSession("session-1");

    expect(await storage.getSession("session-1")).toBeNull();
    expect(await storage.loadMessages("session-1")).toEqual([]);
  });

  it("rejects updates for missing sessions", async () => {
    const storage = createStorage();

    await expect(storage.updateSession("missing", { title: "No Session" })).rejects.toThrow(
      "Session not found: missing",
    );
  });
});
