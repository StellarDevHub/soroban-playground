const BASE_SDK_VERSION = "20.0.0";
const MAX_DEPS = 20;

export function isValidCrateName(name) {
  if (typeof name !== "string") return false;
  if (name.length < 1 || name.length > 64) return false;
  if (
    name.includes("\n") ||
    name.includes("\r") ||
    name.includes("\"") ||
    name.includes("'") ||
    name.includes("[") ||
    name.includes("]")
  ) {
    return false;
  }
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(name);
}

export function isValidVersionConstraint(version) {
  if (typeof version !== "string") return false;
  if (version.length < 1 || version.length > 50) return false;
  if (
    version.includes("\n") ||
    version.includes("\r") ||
    version.includes("\"") ||
    version.includes("'") ||
    version.includes("[") ||
    version.includes("]")
  ) {
    return false;
  }
  return /^[0-9A-Za-zxX\.\^\~\*\s<>=,\+\-]+$/.test(version);
}

export function sanitizeDependenciesInput(dependencies) {
  if (dependencies === undefined || dependencies === null) {
    return { ok: true, deps: {} };
  }
  if (typeof dependencies !== "object" || Array.isArray(dependencies)) {
    return {
      ok: false,
      error: "dependencies must be an object mapping crate names to version strings"
    };
  }

  const entries = Object.entries(dependencies);
  if (entries.length > MAX_DEPS) {
    return {
      ok: false,
      error: `Too many dependencies; maximum allowed is ${MAX_DEPS}`
    };
  }

  const sanitized = {};
  const errors = [];

  for (const [rawName, rawVersion] of entries) {
    const name = String(rawName).trim();
    const version = typeof rawVersion === "string" ? rawVersion.trim() : rawVersion;

    if (!isValidCrateName(name)) {
      errors.push(`Invalid crate name: ${rawName}`);
      continue;
    }
    if (typeof version !== "string" || !isValidVersionConstraint(version)) {
      errors.push(`Invalid version for ${name}: ${rawVersion}`);
      continue;
    }

    if (name === "soroban-sdk") {
      continue;
    }

    sanitized[name] = version;
  }

  if (errors.length > 0) {
    return {
      ok: false,
      error: "Validation failed",
      details: errors
    };
  }

  return { ok: true, deps: sanitized };
}

export function buildCargoToml(extraDeps = {}) {
  const allDeps = { "soroban-sdk": BASE_SDK_VERSION, ...extraDeps };
  const depLines = Object.keys(allDeps)
    .sort()
    .map((name) => `${name} = "${allDeps[name]}"`)
    .join("\n");

  return `
[package]
name = "soroban_contract"
version = "0.0.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
${depLines}

[profile.release]
opt-level = "z"
overflow-checks = true
debug = 0
strip = "symbols"
debug-assertions = false
panic = "abort"
codegen-units = 1
lto = true
`;
}

