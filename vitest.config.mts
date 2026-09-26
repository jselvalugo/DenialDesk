import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = {
  "@rules": fileURLToPath(new URL("./rules", import.meta.url)),
  "@": fileURLToPath(new URL("./src", import.meta.url)),
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: { name: "unit", include: ["src/**/*.test.ts", "rules/**/*.test.ts"], environment: "node" },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          include: ["test/integration/**/*.test.ts"],
          environment: "node",
          setupFiles: ["test/integration/setup.ts"],
          fileParallelism: false,
        },
      },
    ],
  },
});
