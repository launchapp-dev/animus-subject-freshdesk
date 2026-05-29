import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const sdkRoot = resolve(repoRoot, "node_modules", "@launchapp-dev", "animus-plugin-sdk");
const pluginName = "animus-subject-freshdesk";

const lockfilePath = resolve(repoRoot, "package-lock.json");
if (existsSync(lockfilePath)) {
  const original = readFileSync(lockfilePath, "utf8");
  const rewritten = original.replace(
    /git\+ssh:\/\/git@github\.com\/launchapp-dev\/animus-plugin-sdk-ts\.git/g,
    "git+https://github.com/launchapp-dev/animus-plugin-sdk-ts.git",
  );
  if (rewritten !== original) {
    writeFileSync(lockfilePath, rewritten);
    console.error(`[${pluginName}] rewrote SDK lockfile URL to HTTPS`);
  }
}

if (!existsSync(sdkRoot)) process.exit(0);
if (existsSync(resolve(sdkRoot, "dist", "index.js")) && existsSync(resolve(sdkRoot, "dist", "index.d.ts"))) {
  process.exit(0);
}

const tsconfig = {
  compilerOptions: {
    target: "ES2022",
    module: "ESNext",
    moduleResolution: "Bundler",
    lib: ["ES2022"],
    types: ["node"],
    outDir: "dist",
    rootDir: "src",
    strict: true,
    skipLibCheck: true,
    esModuleInterop: true,
    declaration: true,
    declarationMap: false,
    sourceMap: false,
    isolatedModules: true,
    forceConsistentCasingInFileNames: true,
  },
  include: ["src/**/*.ts"],
  exclude: ["src/**/*.test.ts", "src/__tests__/**", "dist", "node_modules"],
};
writeFileSync(resolve(sdkRoot, "tsconfig.build.local.json"), JSON.stringify(tsconfig, null, 2));

try {
  const localTsc = resolve(repoRoot, "node_modules", ".bin", "tsc");
  if (existsSync(localTsc)) {
    execSync(`"${localTsc}" -p tsconfig.build.local.json`, { cwd: sdkRoot, stdio: "inherit" });
  } else {
    execSync("npx --yes -p typescript@^5.6 tsc -p tsconfig.build.local.json", { cwd: sdkRoot, stdio: "inherit" });
  }
} catch (err) {
  console.error(`[${pluginName}] failed to build SDK in place:`, err instanceof Error ? err.message : String(err));
  process.exit(1);
}
