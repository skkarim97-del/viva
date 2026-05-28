import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/tests/**/*.test.ts"],
    // Each test file gets its own module registry so vi.mock() calls in
    // one file don't bleed into another.
    isolate: true,
  },
});
