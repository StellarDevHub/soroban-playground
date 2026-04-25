import { execSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";

function normalizeWslCwd(cwd) {
  if (!(process.platform === "linux" && process.env.WSL_DISTRO_NAME)) {
    return cwd;
  }

  try {
    const escaped = cwd.replaceAll('"', '\\"');
    const winPath = execSync(`wslpath -w "${escaped}"`, { encoding: "utf8" }).trim();
    const canonical = execSync(`wslpath "${winPath}"`, { encoding: "utf8" }).trim();
    return canonical || cwd;
  } catch {
    return cwd;
  }
}

const cwd = normalizeWslCwd(process.cwd());
const require = createRequire(import.meta.url);
const nextCli = require.resolve("next/dist/bin/next");
const env = { ...process.env };

for (const key of Object.keys(env)) {
  if (/^npm_/i.test(key)) {
    delete env[key];
  }
}

const result = spawnSync(process.execPath, [nextCli, "build", "--webpack"], {
  cwd,
  stdio: "inherit",
  env,
});

process.exit(result.status ?? 1);
