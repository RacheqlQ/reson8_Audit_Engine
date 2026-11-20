import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Keep CPU-heavy PCM analysis tests from competing with dozens of
    // simultaneously spawned workers on hosted CI runners. This preserves
    // the normal per-test timeout and all assertions.
    maxWorkers: 4,
  },
});
