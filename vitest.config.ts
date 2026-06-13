import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // circomlibjs loads a wasm at first use; give the crypto-backed tests headroom.
    testTimeout: 30_000,
  },
});
