import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    pool: "forks",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
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
      exclude: ["src/**/*.test.ts"],
      thresholds: {
        lines: 65,
        functions: 85,
        branches: 75,
        statements: 65,
      },
    },
  },
});
