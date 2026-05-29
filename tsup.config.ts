import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  target: "node20",
  outDir: "dist",
  clean: true,
  splitting: false,
  minify: true,
  noExternal: ["@launchapp-dev/animus-plugin-sdk"],
  outExtension: () => ({ js: ".cjs" }),
  banner: {
    js: "#!/usr/bin/env node",
  },
});
