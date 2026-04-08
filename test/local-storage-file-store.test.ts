import { describe, expect, it, vi } from "vitest";
import { createLocalStorageFileStore } from "../src/local-storage-file-store";

describe("createLocalStorageFileStore", () => {
  it("bootstraps initial files and reads content by key", () => {
    const store = createLocalStorageFileStore({
      storageKey: "workspace",
      initialFiles: {
        "app.ts": "console.log('hello');",
      },
    });

    expect(store.getFiles()).toEqual({
      "app.ts": "console.log('hello');",
    });
    expect(JSON.parse(localStorage.getItem("workspace") ?? "null")).toEqual({
      "app.ts": "console.log('hello');",
    });
    expect(store.read("app.ts")).toEqual({
      key: "app.ts",
      exists: true,
      content: "console.log('hello');",
    });
    expect(store.read("missing.ts")).toEqual({
      key: "missing.ts",
      exists: false,
    });
  });

  it("writes, edits, resets, and notifies subscribers with snapshots", () => {
    const store = createLocalStorageFileStore({
      storageKey: "workspace",
      initialFiles: {
        "README.md": "# Demo",
      },
    });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    expect(store.write("notes.md", "draft")).toEqual({
      key: "notes.md",
      written: true,
      size: 5,
    });
    expect(listener).toHaveBeenLastCalledWith({
      "README.md": "# Demo",
      "notes.md": "draft",
    });

    expect(store.edit("notes.md", "draft", "done")).toEqual({
      key: "notes.md",
      edited: true,
    });
    expect(store.read("notes.md")).toEqual({
      key: "notes.md",
      exists: true,
      content: "done",
    });

    expect(store.reset()).toEqual({
      "README.md": "# Demo",
    });
    expect(store.read("notes.md")).toEqual({
      key: "notes.md",
      exists: false,
    });

    const callCountBeforeUnsubscribe = listener.mock.calls.length;
    unsubscribe();
    store.write("ignored.md", "value");
    expect(listener).toHaveBeenCalledTimes(callCountBeforeUnsubscribe);
  });

  it("recovers from malformed localStorage payloads", () => {
    localStorage.setItem("workspace", "{broken json");

    const store = createLocalStorageFileStore({
      storageKey: "workspace",
      initialFiles: {
        "index.html": "<div>Hello</div>",
      },
    });

    expect(store.getFiles()).toEqual({
      "index.html": "<div>Hello</div>",
    });
  });

  it("rejects edits when the target text is missing or ambiguous", () => {
    const store = createLocalStorageFileStore({
      storageKey: "workspace",
      initialFiles: {
        "single.txt": "once",
        "repeat.txt": "repeat repeat",
      },
    });

    expect(() => store.edit("missing.txt", "a", "b")).toThrow("File not found: missing.txt");
    expect(() => store.edit("single.txt", "missing", "value")).toThrow("Text not found in single.txt");
    expect(() => store.edit("repeat.txt", "repeat", "value")).toThrow(
      "Text matched more than once in repeat.txt",
    );
  });
});
