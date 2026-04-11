import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        localStorageChat: fileURLToPath(new URL("./local-storage-chat.html", import.meta.url)),
      },
    },
  },
  resolve: {
    alias: {
      "web-agent-runtime": fileURLToPath(new URL("../src/index.ts", import.meta.url)),
    },
  },
  server: {
    port: 4179,
  },
});
