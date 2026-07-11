import { fileURLToPath } from "node:url";

import { config as loadEnvironment } from "dotenv";
import { defineConfig } from "vitest/config";

loadEnvironment({ path: ".env.test", override: true });

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./src/test/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["src/**/*.test.ts"],
  },
});
