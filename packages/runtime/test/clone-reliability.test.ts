/**
 * Reliability tests for cloneSerializableValue and the data structures that
 * depend on it.
 *
 * Goals:
 *  1. Verify the clone contract: output is deeply equal but never shares
 *     references with the input.
 *  2. Document known lossy / surprising behaviours so they are caught
 *     intentionally rather than discovered in production.
 *  3. Verify that appendSessionEntry and emitStateChanged-style patterns
 *     maintain snapshot isolation between successive calls.
 */
import { describe, expect, it } from "vitest";
import { cloneSerializableValue } from "../src/utils/runtime-compat";
import {
  appendSessionEntry,
  buildRuntimeSessionView,
  createMessageEntry,
  createRuntimeSessionData,
} from "../src/session/runtime-session-data";
import type { RuntimeSessionData } from "../src/types/session";
import {
  createAssistantTextMessage,
  createUserMessage,
} from "./runtime-test-helpers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildEntryId(index: number) {
  return `entry-${index}`;
}

/**
 * Creates a RuntimeSessionData with `count` message entries already appended.
 */
function buildSessionWithMessages(count: number): RuntimeSessionData {
  let data = createRuntimeSessionData();
  for (let i = 0; i < count; i++) {
    data = appendSessionEntry(
      data,
      createMessageEntry({
        id: buildEntryId(i),
        parentId: i === 0 ? null : buildEntryId(i - 1),
        timestamp: new Date().toISOString(),
        message: createUserMessage(`message ${i}`),
      }),
    );
  }
  return data;
}

// ---------------------------------------------------------------------------
// 1. cloneSerializableValue — core contract
// ---------------------------------------------------------------------------

describe("cloneSerializableValue - core clone contract", () => {
  it("returns undefined without JSON round-trip", () => {
    // The early-return for undefined avoids JSON.stringify(undefined) → undefined
    // which is not actually an error but could mask bugs on callers.
    const result = cloneSerializableValue(undefined);
    expect(result).toBeUndefined();
  });

  it("returns null correctly", () => {
    expect(cloneSerializableValue(null)).toBeNull();
  });

  it("clones primitives by value", () => {
    expect(cloneSerializableValue(42)).toBe(42);
    expect(cloneSerializableValue("hello")).toBe("hello");
    expect(cloneSerializableValue(true)).toBe(true);
  });

  it("produces a new object reference", () => {
    const original = { a: 1 };
    const clone = cloneSerializableValue(original);
    expect(clone).not.toBe(original);
  });

  it("produces a deeply equal value", () => {
    const original = {
      role: "user",
      content: [{ type: "text", text: "hello" }],
      timestamp: 1_000,
    };
    expect(cloneSerializableValue(original)).toEqual(original);
  });

  it("does not share nested object references", () => {
    const original = { a: { b: { c: 42 } } };
    const clone = cloneSerializableValue(original);
    expect(clone.a).not.toBe(original.a);
    expect(clone.a.b).not.toBe(original.a.b);
  });

  it("does not share array element references", () => {
    const original = [
      [1, 2],
      [3, 4],
    ];
    const clone = cloneSerializableValue(original);
    expect(clone[0]).not.toBe(original[0]);
    expect(clone[1]).not.toBe(original[1]);
  });
});

// ---------------------------------------------------------------------------
// 2. cloneSerializableValue — mutation isolation
// ---------------------------------------------------------------------------

describe("cloneSerializableValue - mutation isolation", () => {
  it("mutating the clone does not affect the original", () => {
    const original = { messages: [{ role: "user", content: "hello" }] };
    const clone = cloneSerializableValue(original);
    (clone.messages[0] as { content: string }).content = "mutated";
    expect(original.messages[0]!.content).toBe("hello");
  });

  it("mutating the original does not affect an existing clone", () => {
    const original = { messages: [{ role: "user", content: "hello" }] };
    const clone = cloneSerializableValue(original);
    (original.messages[0] as { content: string }).content = "mutated";
    expect(clone.messages[0]!.content).toBe("hello");
  });

  it("pushing to the original array does not change clone length", () => {
    const original: number[] = [1, 2, 3];
    const clone = cloneSerializableValue(original);
    original.push(4);
    expect(clone).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// 3. cloneSerializableValue — known lossy behaviours (document & detect)
// ---------------------------------------------------------------------------

describe("cloneSerializableValue - lossy serialisation behaviours", () => {
  it("drops function-valued properties", () => {
    const original = { value: 1, fn: () => 42 };
    const clone = cloneSerializableValue(original as Record<string, unknown>);
    expect(clone).not.toHaveProperty("fn");
    expect(clone.value).toBe(1);
  });

  it("converts Date objects to ISO strings (prototype is lost)", () => {
    const date = new Date("2024-01-01T00:00:00.000Z");
    const clone = cloneSerializableValue({ date });
    // After JSON round-trip the value is a string, not a Date instance.
    expect(typeof clone.date).toBe("string");
    expect(clone.date).toBe(date.toISOString());
  });

  it("drops undefined-valued properties within objects", () => {
    const original = { a: 1, b: undefined };
    const clone = cloneSerializableValue(original);
    // JSON.stringify strips keys whose value is undefined.
    expect(clone).not.toHaveProperty("b");
  });

  it("throws on circular references", () => {
    const obj: Record<string, unknown> = {};
    obj.self = obj;
    expect(() => cloneSerializableValue(obj)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 4. appendSessionEntry — snapshot isolation
// ---------------------------------------------------------------------------

describe("appendSessionEntry - snapshot isolation", () => {
  it("returns a new object reference each call", () => {
    const data = createRuntimeSessionData();
    const entry = createMessageEntry({
      id: "entry-0",
      parentId: null,
      timestamp: new Date().toISOString(),
      message: createUserMessage("hello"),
    });
    const next = appendSessionEntry(data, entry);
    expect(next).not.toBe(data);
  });

  it("does not mutate the input data", () => {
    const data = createRuntimeSessionData();
    const entry = createMessageEntry({
      id: "entry-0",
      parentId: null,
      timestamp: new Date().toISOString(),
      message: createUserMessage("hello"),
    });
    const originalLength = data.entries.length;
    appendSessionEntry(data, entry);
    expect(data.entries).toHaveLength(originalLength);
  });

  it("does not share the entries array reference", () => {
    const data = buildSessionWithMessages(3);
    const newEntry = createMessageEntry({
      id: "entry-new",
      parentId: buildEntryId(2),
      timestamp: new Date().toISOString(),
      message: createUserMessage("new"),
    });
    const next = appendSessionEntry(data, newEntry);
    expect(next.entries).not.toBe(data.entries);
  });

  it("stored entry is a clone of the input — not the same reference", () => {
    const data = createRuntimeSessionData();
    const entry = createMessageEntry({
      id: "entry-0",
      parentId: null,
      timestamp: new Date().toISOString(),
      message: createUserMessage("hello"),
    });
    const next = appendSessionEntry(data, entry);
    const stored = next.entries.find((e) => e.id === "entry-0")!;
    // If the stored entry is the same reference as the input, a later mutation
    // of `entry` would silently corrupt the stored session data.
    expect(stored).not.toBe(entry);
  });

  it("successive snapshots are fully independent of each other", () => {
    const data1 = buildSessionWithMessages(2);
    const entry = createMessageEntry({
      id: "entry-new",
      parentId: buildEntryId(1),
      timestamp: new Date().toISOString(),
      message: createUserMessage("new"),
    });
    const data2 = appendSessionEntry(data1, entry);

    // data2's entries array must not be the same reference as data1's
    expect(data2.entries).not.toBe(data1.entries);

    // data1 must remain unchanged even after data2 is derived from it
    expect(data1.entries).toHaveLength(2);
    expect(data2.entries).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// 5. emitStateChanged pattern — cloneMessages isolation
//    Simulates what BrowserAgentRuntime.emitStateChanged() does on every
//    streaming token: `cloneMessages(this._state.messages)`.
// ---------------------------------------------------------------------------

describe("cloneMessages pattern (emitStateChanged simulation) - isolation", () => {
  function cloneMessages<T>(messages: T[]): T[] {
    return messages.map((m) => cloneSerializableValue(m));
  }

  it("each state snapshot is independent of the live messages array", () => {
    const liveMessages = [
      createUserMessage("hello"),
      createAssistantTextMessage("world"),
    ];

    const snapshot1 = cloneMessages(liveMessages);
    liveMessages.push(createUserMessage("follow-up"));
    const snapshot2 = cloneMessages(liveMessages);

    // snapshot1 captured before the push — must not see the new message
    expect(snapshot1).toHaveLength(2);
    expect(snapshot2).toHaveLength(3);
  });

  it("snapshots do not share message object references", () => {
    const liveMessages = [createUserMessage("hello")];
    const snapshot1 = cloneMessages(liveMessages);
    const snapshot2 = cloneMessages(liveMessages);

    // Two separate cloneMessages calls must yield independent objects
    expect(snapshot1[0]).not.toBe(snapshot2[0]);
    expect(snapshot1[0]).not.toBe(liveMessages[0]);
  });

  it("mutating a snapshotted message does not affect the live state", () => {
    const liveMessages = [createUserMessage("original")];
    const snapshot = cloneMessages(liveMessages);
    (snapshot[0] as { content: string }).content = "mutated";
    expect(liveMessages[0]!.content).toBe("original");
  });
});

// ---------------------------------------------------------------------------
// 6. buildRuntimeSessionView — output isolation
// ---------------------------------------------------------------------------

describe("buildRuntimeSessionView - output isolation", () => {
  it("returned messages array is not the same reference as internal entries", () => {
    const data = buildSessionWithMessages(3);
    const model = { id: "test-model" };
    const view1 = buildRuntimeSessionView(data, {
      model,
      thinkingLevel: "off",
    });
    const view2 = buildRuntimeSessionView(data, {
      model,
      thinkingLevel: "off",
    });

    // Two consecutive views of the same data must be independent snapshots
    expect(view1.messages).not.toBe(view2.messages);
  });

  it("mutating a message from the view does not affect subsequent views", () => {
    const data = buildSessionWithMessages(1);
    const model = { id: "test-model" };
    const view = buildRuntimeSessionView(data, { model, thinkingLevel: "off" });
    const originalContent = (view.messages[0] as { content: string }).content;

    (view.messages[0] as { content: string }).content = "corrupted";

    const freshView = buildRuntimeSessionView(data, {
      model,
      thinkingLevel: "off",
    });
    expect((freshView.messages[0] as { content: string }).content).toBe(
      originalContent,
    );
  });
});
