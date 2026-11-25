import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const MAX_INITIAL_GZIP_BYTES = 200 * 1024; // 200 KB gzipped
const nextDir = path.resolve(process.cwd(), ".next");

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function gzipSize(filePath) {
  const content = fs.readFileSync(filePath);
  return zlib.gzipSync(content, { level: 9 }).length;
}

function collectInitialJsFiles() {
  const files = new Set();

  const buildManifest = readJson(path.join(nextDir, "build-manifest.json"));
  if (buildManifest) {
    for (const file of buildManifest.rootMainFiles ?? []) {
      if (file.endsWith(".js")) files.add(file);
    }
    for (const file of buildManifest.polyfillFiles ?? []) {
      if (file.endsWith(".js")) files.add(file);
    }
  }

  const appBuildManifest = readJson(path.join(nextDir, "app-build-manifest.json"));
  if (appBuildManifest?.pages?.["/page"]) {
    for (const file of appBuildManifest.pages["/page"]) {
      if (file.endsWith(".js")) files.add(file);
    }
  }

  return [...files];
}

const initialFiles = collectInitialJsFiles();

if (initialFiles.length === 0) {
  console.error(
    "No initial JS chunks found in .next/. Run `npm run build` before checking bundle budgets.",
  );
  process.exit(1);
}

let totalGzipBytes = 0;
const breakdown = [];

for (const relPath of initialFiles) {
  const fullPath = path.join(nextDir, relPath);
  if (!fs.existsSync(fullPath)) {
    continue;
  }
  const bytes = gzipSize(fullPath);
  totalGzipBytes += bytes;
  breakdown.push({ relPath, bytes });
}

breakdown.sort((a, b) => b.bytes - a.bytes);

console.log("Initial JS bundle (gzipped):");
for (const entry of breakdown) {
  console.log(`  ${(entry.bytes / 1024).toFixed(2)} KB  ${entry.relPath}`);
}
console.log(
  `Total: ${(totalGzipBytes / 1024).toFixed(2)} KB / ${(MAX_INITIAL_GZIP_BYTES / 1024).toFixed(0)} KB`,
);

if (totalGzipBytes > MAX_INITIAL_GZIP_BYTES) {
  console.error(
    `Bundle budget exceeded: ${(totalGzipBytes / 1024).toFixed(2)} KB > ${(MAX_INITIAL_GZIP_BYTES / 1024).toFixed(0)} KB gzipped`,
  );
  process.exit(1);
}

console.log("Bundle budget check passed.");
