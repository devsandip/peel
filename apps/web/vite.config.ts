import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { offlineShell } from "./offline-build.ts";
export default defineConfig({
  plugins: [react(), offlineShell()],
  resolve: {
    alias: {
      "@peel/core": path.resolve(
        import.meta.dirname,
        "../../packages/core/src/index.ts",
      ),
      "@peel/storage": path.resolve(
        import.meta.dirname,
        "../../packages/storage/src/index.ts",
      ),
    },
  },
  clearScreen: false,
  server: { strictPort: true },
  build: { target: "es2022" },
});
