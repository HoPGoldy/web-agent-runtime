import { describe, expect, it } from "vitest";
import {
  createJsonSessionDataCodec,
  SESSION_DATA_VERSION,
} from "../src/session/session-data-codec";
import {
  appendSessionEntry,
  createMessageEntry,
  createRuntimeSessionData,
} from "../src/session/session-types";

describe("session data codec", () => {
  it("round-trips runtime session data without mutating the original", async () => {
    const codec = createJsonSessionDataCodec();
    const original = appendSessionEntry(
      createRuntimeSessionData(),
      createMessageEntry({
        id: "entry-1",
        parentId: null,
        timestamp: "2026-04-09T00:00:00.000Z",
        message: {
          role: "user",
          content: "hello",
          timestamp: 1,
        },
      }),
    );

    const encoded = await codec.serialize(original);
    const decoded = await codec.deserialize(encoded);

    expect(decoded).toEqual(original);
    expect(decoded).not.toBe(original);
  });

  it("rejects payloads that do not match the runtime session schema", async () => {
    const codec = createJsonSessionDataCodec();

    await expect(
      codec.deserialize({
        version: SESSION_DATA_VERSION,
        headEntryId: null,
        entries: [{ type: "message" }],
      }),
    ).rejects.toThrow("Invalid runtime session data");
  });

  it("rejects unsupported schema versions", async () => {
    const codec = createJsonSessionDataCodec();

    await expect(
      codec.deserialize({
        version: SESSION_DATA_VERSION + 1,
        headEntryId: null,
        entries: [],
      }),
    ).rejects.toThrow(`Unsupported runtime session data version: ${SESSION_DATA_VERSION + 1}`);
  });
});