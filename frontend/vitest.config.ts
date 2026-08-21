import { defineConfig } from "vitest/config";
import path from "node:path";

// Unit tests for the pure logic in lib/: the entry-bar cohort, the opportunity
// score, CSV emission and the Ahrefs paste parser. No DOM and no component
// rendering — everything here is a plain function, which is why that logic was
// pulled out of the components in the first place.
export default defineConfig({
  resolve: {
    // Mirrors the "@/*" path alias in tsconfig.json. Without it the lib modules
    // cannot resolve each other and every import fails.
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
