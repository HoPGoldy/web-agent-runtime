import { describe, expect, it, vi } from "vitest";
import { createEditTool } from "../src/tools/create-edit-tool";
import { createReadTool } from "../src/tools/create-read-tool";
import { createRunJsTool } from "../src/tools/create-run-js-tool";
import { createWriteTool } from "../src/tools/create-write-tool";

const toolContext = {
  session: null,
  messages: [],
};

function createFileStore() {
  return {
    getFiles: vi.fn(),
    reset: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
    read: vi.fn(),
    write: vi.fn(),
    edit: vi.fn(),
  };
}

describe("tool factories", () => {
  it("delegates read, write, and edit calls to the file store", async () => {
    const fileStore = createFileStore();
    fileStore.read.mockReturnValue({ key: "app.ts", exists: true, content: "ok" });
    fileStore.write.mockReturnValue({ key: "app.ts", written: true, size: 2 });
    fileStore.edit.mockReturnValue({ key: "app.ts", edited: true });

    const readTool = createReadTool({ fileStore });
    const writeTool = createWriteTool({ fileStore });
    const editTool = createEditTool({ fileStore });

    await expect(readTool.execute("tool-1", { key: "app.ts" }, toolContext)).resolves.toEqual({
      key: "app.ts",
      exists: true,
      content: "ok",
    });
    await expect(writeTool.execute("tool-2", { key: "app.ts", content: "ok" }, toolContext)).resolves.toEqual(
      { key: "app.ts", written: true, size: 2 },
    );
    await expect(
      editTool.execute("tool-3", { key: "app.ts", oldText: "a", newText: "b" }, toolContext),
    ).resolves.toEqual({ key: "app.ts", edited: true });

    expect(fileStore.read).toHaveBeenCalledWith("app.ts");
    expect(fileStore.write).toHaveBeenCalledWith("app.ts", "ok");
    expect(fileStore.edit).toHaveBeenCalledWith("app.ts", "a", "b");
  });

  it("executes JavaScript expressions", async () => {
    const tool = createRunJsTool();

    await expect(tool.execute("tool-1", { code: "1 + 2" }, toolContext)).resolves.toBe(3);
  });

  it("falls back to script execution and captures logs", async () => {
    const onConsoleLog = vi.fn();
    const tool = createRunJsTool({
      globals: {
        count: 2,
        payload: { ok: true },
      },
      onConsoleLog,
    });

    await expect(
      tool.execute(
        "tool-2",
        {
          code: "console.log(globals.payload); return globals.count * 2;",
        },
        toolContext,
      ),
    ).resolves.toEqual({
      result: 4,
      logs: ['{"ok":true}'],
    });

    expect(onConsoleLog).toHaveBeenCalledWith({ ok: true });
  });

  it("surfaces syntax errors from invalid JavaScript", async () => {
    const tool = createRunJsTool();

    await expect(tool.execute("tool-3", { code: "return )" }, toolContext)).rejects.toThrow();
  });
});
