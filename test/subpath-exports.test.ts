import { describe, expect, it } from "vitest";

describe("package subpath exports", () => {
  it("keeps optional LLM adapters out of the root entry", async () => {
    const rootModule = await import("../src/index");

    expect(rootModule).not.toHaveProperty("createUnsafeOpenAiProvider");
    expect(rootModule).not.toHaveProperty("createResultStream");
  });

  it("exposes the unsafe OpenAI adapter from its subpath", async () => {
    const openAiCompatibleModule = await import("../src/entries/unsafe-openai");

    expect(openAiCompatibleModule).toHaveProperty("createUnsafeOpenAiProvider");
  });

  it("exposes provider utilities from the provider-utils subpath", async () => {
    const providerUtilsModule = await import("../src/entries/provider-utils");

    expect(providerUtilsModule).toHaveProperty("createResultStream");
  });
});
