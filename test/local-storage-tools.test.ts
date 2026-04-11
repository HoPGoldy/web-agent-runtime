import { describe, expect, it } from "vitest";
import { createLocalStorageTools } from "../src/index";

type LocalStorageTool = ReturnType<typeof createLocalStorageTools>[number];

describe("createLocalStorageTools", () => {
  it("creates read/create/update/delete tools", () => {
    const tools = createLocalStorageTools();

    expect(tools.map((tool) => tool.name)).toEqual([
      "local_storage_read",
      "local_storage_create",
      "local_storage_update",
      "local_storage_delete",
    ]);
  });

  it("creates, reads, updates, and deletes localStorage entries", async () => {
    const tools = toToolMap(createLocalStorageTools());

    const createResult = await executeTool(tools.local_storage_create, {
      key: "draft",
      value: "v1",
    });
    expect(localStorage.getItem("draft")).toBe("v1");
    expect(createResult.details).toMatchObject({
      operation: "create",
      key: "draft",
      value: "v1",
      totalKeys: 1,
    });

    const readResult = await executeTool(tools.local_storage_read, { key: "draft" });
    expect(readResult.content).toEqual([
      {
        type: "text",
        text: 'Key "draft" exists.\n\nValue:\nv1',
      },
    ]);
    expect(readResult.details).toMatchObject({
      operation: "read",
      key: "draft",
      exists: true,
      value: "v1",
      totalKeys: 1,
    });

    const updateResult = await executeTool(tools.local_storage_update, {
      key: "draft",
      value: "v2",
    });
    expect(localStorage.getItem("draft")).toBe("v2");
    expect(updateResult.details).toMatchObject({
      operation: "update",
      key: "draft",
      value: "v2",
      totalKeys: 1,
    });

    const deleteResult = await executeTool(tools.local_storage_delete, { key: "draft" });
    expect(localStorage.getItem("draft")).toBeNull();
    expect(deleteResult.details).toMatchObject({
      operation: "delete",
      key: "draft",
      existed: true,
      totalKeys: 0,
    });
  });

  it("scopes reads and writes with a key prefix", async () => {
    localStorage.setItem("outside", "ignore");
    const tools = toToolMap(createLocalStorageTools({ keyPrefix: "demo:" }));

    await executeTool(tools.local_storage_create, { key: "alpha", value: "1" });
    await executeTool(tools.local_storage_create, { key: "beta", value: "2" });

    expect(localStorage.getItem("demo:alpha")).toBe("1");
    expect(localStorage.getItem("demo:beta")).toBe("2");
    expect(localStorage.getItem("alpha")).toBeNull();

    const readAllResult = await executeTool(tools.local_storage_read, {});
    expect(readAllResult.details).toEqual({
      operation: "read",
      keyPrefix: "demo:",
      entries: [
        { key: "alpha", value: "1" },
        { key: "beta", value: "2" },
      ],
      totalKeys: 2,
    });
    expect(readAllResult.content).toEqual([
      {
        type: "text",
        text: 'Found 2 localStorage entries.\n- alpha = "1"\n- beta = "2"',
      },
    ]);
  });

  it("keeps create and update semantics distinct", async () => {
    localStorage.setItem("existing", "v1");
    const tools = toToolMap(createLocalStorageTools());

    await expect(
      executeTool(tools.local_storage_create, {
        key: "existing",
        value: "v2",
      }),
    ).rejects.toThrow('Key "existing" already exists.');

    await expect(
      executeTool(tools.local_storage_update, {
        key: "missing",
        value: "v1",
      }),
    ).rejects.toThrow('Key "missing" does not exist.');
  });
});

async function executeTool(tool: LocalStorageTool, input: unknown) {
  return tool.execute({
    toolCallId: "test-tool-call",
    input,
    context: {
      session: null,
      messages: [],
      hostContext: undefined,
    },
    signal: new AbortController().signal,
  });
}

function toToolMap(tools: ReturnType<typeof createLocalStorageTools>) {
  return Object.fromEntries(tools.map((tool) => [tool.name, tool])) as Record<string, LocalStorageTool>;
}
