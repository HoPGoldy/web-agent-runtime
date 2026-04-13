import { describe, expect, it } from "vitest";
import { createAiSdkToolSet } from "../src/entries/ai-sdk";

describe("createAiSdkToolSet", () => {
  it("creates a tool map keyed by tool name", () => {
    const toolSet = createAiSdkToolSet([
      {
        name: "read",
        description: "Read a file",
        inputSchema: {
          type: "object",
          properties: {
            key: { type: "string" },
          },
        },
      },
      {
        name: "write",
        description: "Write a file",
        inputSchema: {
          type: "object",
          properties: {
            key: { type: "string" },
            content: { type: "string" },
          },
        },
      },
    ]);

    expect(Object.keys(toolSet)).toEqual(["read", "write"]);
    expect(toolSet.read).toMatchObject({
      description: "Read a file",
    });
    expect(toolSet.write).toMatchObject({
      description: "Write a file",
    });
  });
});
