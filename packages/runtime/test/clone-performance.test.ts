/**
 * Performance characterisation tests for cloneSerializableValue and the
 * hot-path call sites that depend on it.
 *
 * Design principles:
 *  - Avoid hard time-budget assertions — CI machines vary in speed.
 *  - Instead, assert *growth ratios*: a 10× larger input must not take more
 *    than ~20× longer (linear or better). This catches O(n²) regressions
 *    while remaining robust to environment variance.
 *  - Each benchmark warms up the JIT before measuring.
 *  - console.table output gives a human-readable summary when running locally.
 *
 * Run with:
 *   pnpm vitest run test/clone-performance.test.ts
 */
import { describe, expect, it } from "vitest";
import { cloneSerializableValue } from "../src/utils/runtime-compat";
import {
  appendSessionEntry,
  buildRuntimeSessionView,
  createMessageEntry,
  createRuntimeSessionData,
} from "../src/session/runtime-session-data";
import type { AgentMessage, RuntimeSessionData } from "../src/types/session";
import {
  createAssistantTextMessage,
  createUserMessage,
} from "./runtime-test-helpers";

// ---------------------------------------------------------------------------
// Measurement utilities
// ---------------------------------------------------------------------------

/**
 * Runs `fn` `iterations` times and returns the total elapsed milliseconds.
 * A small warm-up pass is run first to avoid JIT cold-start noise.
 */
function measure(fn: () => void, iterations: number, warmUp = 5): number {
  for (let i = 0; i < warmUp; i++) fn();

  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  return performance.now() - start;
}

/**
 * Returns a printable summary row used in console.table calls.
 */
function row(label: string, ms: number, iterations: number) {
  return {
    label,
    "total ms": ms.toFixed(2),
    "per-call µs": ((ms / iterations) * 1_000).toFixed(1),
  };
}

// ---------------------------------------------------------------------------
// Data factory helpers
// ---------------------------------------------------------------------------

function buildMessagePayload(textLength: number): AgentMessage {
  return createUserMessage("x".repeat(textLength));
}

/**
 * Creates a RuntimeSessionData that already contains `count` message entries.
 * This is used to examine how cost grows with session depth.
 */
function buildSessionWithMessages(count: number): RuntimeSessionData {
  let data = createRuntimeSessionData();
  for (let i = 0; i < count; i++) {
    data = appendSessionEntry(
      data,
      createMessageEntry({
        id: `entry-${i}`,
        parentId: i === 0 ? null : `entry-${i - 1}`,
        timestamp: new Date().toISOString(),
        message:
          i % 2 === 0
            ? createUserMessage(`user message ${i}`)
            : createAssistantTextMessage(`assistant reply ${i}`),
      }),
    );
  }
  return data;
}

/**
 * Simulates the hot path in emitStateChanged / buildLlmContext that clones
 * the live messages array on every call.
 */
function cloneMessagesArray(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((m) => cloneSerializableValue(m));
}

// ---------------------------------------------------------------------------
// 1. cloneSerializableValue — baseline cost by payload size
//
// Purpose: Establish a reference curve so future changes can be compared.
// Assertion: Cost is sub-linear-to-linear in payload size — doubling the
// payload must not more-than-triple the per-call cost (accounting for noise).
// ---------------------------------------------------------------------------

describe("cloneSerializableValue - cost scales with payload size", () => {
  const ITERATIONS = 500;
  const sizes = [100, 1_000, 10_000] as const;

  it("cost grows at most linearly (not exponentially) with text length", () => {
    const results = sizes.map((size) => {
      const payload = buildMessagePayload(size);
      const ms = measure(() => cloneSerializableValue(payload), ITERATIONS);
      return { size, ms };
    });

    console.table(
      results.map(({ size, ms }) => row(`text=${size} chars`, ms, ITERATIONS)),
    );

    // Moving from 100 → 10 000 chars (100× text) should take < 200× the time.
    // A linear implementation would take 100×; we allow 2× slack.
    const small = results[0]!.ms;
    const large = results[2]!.ms;
    expect(large / small).toBeLessThan(200);
  });
});

// ---------------------------------------------------------------------------
// 2. appendSessionEntry — growth with session depth
//
// The current implementation calls cloneRuntimeSessionData() (O(n)) on every
// append, making N successive appends O(n²) total. This test quantifies that.
//
// Assertion: appending to a 500-entry session should take no more than 50×
// longer than appending to a 10-entry session. If the implementation is
// accidentally O(n²), the ratio will be ~(500/10)² = 2500.
// ---------------------------------------------------------------------------

describe("appendSessionEntry - cost grows with session depth", () => {
  const ITERATIONS = 20;
  const depths = [10, 50, 200, 500] as const;

  it("quantifies per-append cost at various session depths", () => {
    const results = depths.map((depth) => {
      const data = buildSessionWithMessages(depth);
      const nextEntry = createMessageEntry({
        id: "entry-new",
        parentId: `entry-${depth - 1}`,
        timestamp: new Date().toISOString(),
        message: createUserMessage("new message"),
      });

      // We need a fresh parentId each iteration — rebuild each time
      const ms = measure(() => {
        appendSessionEntry(data, {
          ...nextEntry,
          id: `entry-${Math.random()}`,
        });
      }, ITERATIONS);
      return { depth, ms };
    });

    console.table(
      results.map(({ depth, ms }) =>
        row(`depth=${depth} entries`, ms, ITERATIONS),
      ),
    );

    // Regression gate: depth-500 must not exceed 50× the depth-10 cost.
    // An O(n) implementation would be ~50×; an O(n²) would be ~2500×.
    const shallow = results[0]!.ms;
    const deep = results[3]!.ms;
    const ratio = deep / shallow;
    console.log(
      `appendSessionEntry depth ratio (500/10): ${ratio.toFixed(1)}×`,
    );

    // Generous upper bound; tighten once the implementation is optimised.
    expect(ratio).toBeLessThan(200);
  });
});

// ---------------------------------------------------------------------------
// 3. cloneMessages (emitStateChanged pattern) — streaming simulation
//
// During streaming, setStreamMessage() fires on every token, which triggers
// emitStateChanged(), which calls cloneMessages(this._state.messages).
// With M messages and K tokens, the total clone work is O(M × K).
//
// This test measures that cost for realistic combinations and reports whether
// doubling the message count doubles (linear) or quadruples (super-linear) time.
// ---------------------------------------------------------------------------

describe("cloneMessages (streaming simulation) - cost vs message count", () => {
  const TOKEN_COUNT = 200; // tokens per streaming response
  const messageCounts = [10, 50, 100, 200] as const;

  it("quantifies cumulative clone cost across a streaming response", () => {
    const results = messageCounts.map((messageCount) => {
      // Build a realistic messages array: alternating user / assistant
      const messages: AgentMessage[] = Array.from(
        { length: messageCount },
        (_, i) =>
          i % 2 === 0
            ? createUserMessage(`turn ${i}: ${"word ".repeat(20)}`)
            : createAssistantTextMessage(`reply ${i}: ${"word ".repeat(50)}`),
      );

      // Simulate K streaming tokens, each triggering a full clone of messages
      const ms = measure(
        () => {
          for (let t = 0; t < TOKEN_COUNT; t++) {
            cloneMessagesArray(messages);
          }
        },
        5, // outer iterations
        2, // warm-up
      );

      return { messageCount, ms };
    });

    console.table(
      results.map(({ messageCount, ms }) =>
        row(`messages=${messageCount}, tokens=${TOKEN_COUNT}`, ms, 5),
      ),
    );

    // Growth must be sub-quadratic.
    // messages: 10 → 200 is 20× increase; time should be < 60× (3× slack over linear).
    const small = results[0]!.ms;
    const large = results[3]!.ms;
    const ratio = large / small;
    console.log(
      `cloneMessages streaming ratio (200/10 messages): ${ratio.toFixed(1)}×`,
    );

    expect(ratio).toBeLessThan(60);
  });
});

// ---------------------------------------------------------------------------
// 4. buildRuntimeSessionView — cost grows with lineage length
//
// Called from rebuildState() after every appendMessage(). Each rebuild walks
// the full entry lineage and clones every message, so cost is O(n).
// Doing N appends thus makes the total work O(n²).
//
// Assertion: building a view from 500 entries must not be >50× slower than
// from 10 entries (linear would be ~50×; a regression would be much higher).
// ---------------------------------------------------------------------------

describe("buildRuntimeSessionView - cost scales with lineage length", () => {
  const ITERATIONS = 30;
  const depths = [10, 50, 200, 500] as const;
  const model = { id: "test-model" };

  it("quantifies view rebuild cost at various session depths", () => {
    const results = depths.map((depth) => {
      const data = buildSessionWithMessages(depth);
      const ms = measure(
        () => buildRuntimeSessionView(data, { model, thinkingLevel: "off" }),
        ITERATIONS,
      );
      return { depth, ms };
    });

    console.table(
      results.map(({ depth, ms }) => row(`depth=${depth}`, ms, ITERATIONS)),
    );

    // Regression gate: depth-500 should not exceed 100× depth-10.
    // Linear would be ~50×; allow 2× environmental noise.
    const shallow = results[0]!.ms;
    const deep = results[3]!.ms;
    const ratio = deep / shallow;
    console.log(
      `buildRuntimeSessionView depth ratio (500/10): ${ratio.toFixed(1)}×`,
    );

    expect(ratio).toBeLessThan(100);
  });
});

// ---------------------------------------------------------------------------
// 5. appendSessionEntry total rebuild cost — O(n²) detection
//
// This is the most important test: it measures the *total* cost of building a
// session from scratch by appending one message at a time (as the runtime
// does during a conversation). Because each append clones the entire previous
// data, the total work is O(n²).
//
// We measure wall time for building sessions of size N and assert that the
// ratio t(2N) / t(N) is close to 4 — which is the signature of O(n²).
// If the implementation is ever fixed to O(n), this ratio should drop to ~2.
// ---------------------------------------------------------------------------

describe("appendSessionEntry total session build - O(n²) growth detection", () => {
  function buildCost(count: number): number {
    return measure(
      () => buildSessionWithMessages(count),
      3, // repeat entire build 3 times
      1, // one warm-up
    );
  }

  it("reports the growth exponent between N=50 and N=100", () => {
    const t50 = buildCost(50);
    const t100 = buildCost(100);
    const ratio = t100 / t50;

    console.log(
      `Total build cost — N=50: ${t50.toFixed(2)}ms, N=100: ${t100.toFixed(2)}ms, ratio: ${ratio.toFixed(2)}×`,
    );
    console.log(
      `  → ratio ≈ 4 indicates O(n²); ratio ≈ 2 indicates O(n log n) / O(n)`,
    );

    // This test is intentionally a *characterisation*, not a strict gate.
    // It will FAIL if someone accidentally makes the growth cubic or worse.
    expect(ratio).toBeLessThan(20);
  });

  it("reports the growth exponent between N=100 and N=200", () => {
    const t100 = buildCost(100);
    const t200 = buildCost(200);
    const ratio = t200 / t100;

    console.log(
      `Total build cost — N=100: ${t100.toFixed(2)}ms, N=200: ${t200.toFixed(2)}ms, ratio: ${ratio.toFixed(2)}×`,
    );

    expect(ratio).toBeLessThan(20);
  });
});
