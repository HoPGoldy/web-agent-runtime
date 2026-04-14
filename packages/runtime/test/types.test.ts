import { describe, expect, it, vi } from "vitest";
import { createAgentId } from "../src/utils/agent";

describe("createAgentId", () => {
  it("uses crypto.randomUUID when available", () => {
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => "uuid-123"),
    });

    expect(createAgentId()).toBe("uuid-123");
  });

  it("falls back to a timestamp and random suffix", () => {
    vi.stubGlobal("crypto", {});
    vi.spyOn(Date, "now").mockReturnValue(123456789);
    vi.spyOn(Math, "random").mockReturnValue(0.123456789);

    expect(createAgentId()).toBe(
      `agent-123456789-${(0.123456789).toString(36).slice(2, 10)}`,
    );
  });
});
