import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Run each test file in an isolated module environment. This prevents
    // vi.mock() hoisting in one file from leaking into a concurrently-scheduled
    // file in the same worker (e.g. discovery.test.ts -> budget_enforcement.test.ts).
    isolate: true,
    pool: "forks",
    include: ["tests/**/*.test.ts"],
    server: {
      deps: {
        inline: ["./scripts/generate-man.ts"],
      },
    },
    typecheck: {
      tsconfig: "./tsconfig.test.json",
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      thresholds: {
        lines: 65,
        functions: 85,
        branches: 75,
        statements: 65,
      },
    },
  },
});
