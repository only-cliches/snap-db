import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        include: ["bin/tests/*.test.js"],
        environment: "node",
        testTimeout: 30000,
        hookTimeout: 30000
    }
});
