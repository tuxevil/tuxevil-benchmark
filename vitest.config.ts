import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    exclude: ["**/node_modules/**", "**/e2e/**", "**/integration/**", "**/.{git,cache,output,temp}/**"],
    env: {
      SQLITE_PATH: join(tmpdir(), `tuxevil-benchmark-test-${process.pid}.db`),
    },
  },
});
