import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

// Unit tests run in a plain Node environment — the suites here cover pure,
// dependency-free logic (e.g. the refrigeration submission helpers in
// src/app/reports/refrigeration/_lib/compute.ts). The `@/` alias mirrors
// tsconfig so test imports resolve the same way as app code.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
})
