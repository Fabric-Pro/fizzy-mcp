import { defineConfig } from "vitest/config";
import { config } from "dotenv";

// Load environment variables from .env file
config();

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"], // Entry point is hard to unit test
    },
    testTimeout: 10000,
  },
});

