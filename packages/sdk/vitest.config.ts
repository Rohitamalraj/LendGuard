import { defineConfig } from "vitest/config";

export default defineConfig({
  // Disable PostCSS lookup so vitest doesn't try to load the Next.js
  // workspace root's postcss.config.mjs (Tailwind v4 plugin lives in web/).
  css: { postcss: { plugins: [] } },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
