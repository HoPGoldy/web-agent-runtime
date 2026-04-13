import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "ai-sdk": "src/entries/ai-sdk.ts",
    "openai-compatible": "src/entries/openai-compatible.ts",
    "provider-utils": "src/entries/provider-utils.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
});
