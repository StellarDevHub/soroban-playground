import { createCipheriv, randomBytes } from "crypto";
import { createReadStream, createWriteStream } from "fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { pipeline } from "stream/promises";
import { createGunzip } from "zlib";
import * as tar from "tar";
import {
  AES256GcmEncryptTransform,
  createDecryptTransformForFile,
} from "../../src/services/backupService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "backup-restore-verify-"));
  const srcDir = path.join(tmpRoot, "src");
  const encFile = path.join(tmpRoot, "snapshot.tar.gz.enc");
  const outDir = path.join(tmpRoot, "out");
  const dbName = "snapshot-verify.sqlite";
  const dbPath = path.join(srcDir, dbName);
  const marker = `disaster-recovery-ok-${Date.now()}-${randomBytes(4).toString("hex")}`;

  try {
    await mkdir(srcDir, { recursive: true });
    await mkdir(outDir, { recursive: true });
    await writeFile(dbPath, `SQLite format 3\0\n${marker}\n`, "utf8");

    // Ephemeral key for CI verification only (not stored in code/config).
    const key = randomBytes(32);
    process.env.BACKUP_ENCRYPTION_KEY = key.toString("hex");

    const encrypt = new AES256GcmEncryptTransform(key);
    const archive = tar.create(
      { gzip: true, cwd: srcDir, portable: true },
      [dbName]
    );
    archive.on("error", (err) => encrypt.destroy(err));
    archive.pipe(encrypt);
    await pipeline(encrypt, createWriteStream(encFile, { mode: 0o600 }));

    // Verify format detection + decrypt/restore path used by the service.
    const decrypt = await createDecryptTransformForFile(encFile, key);
    await pipeline(
      createReadStream(encFile),
      decrypt,
      createGunzip(),
      tar.extract({ cwd: outDir })
    );

    const restored = await readFile(path.join(outDir, dbName), "utf8");
    if (!restored.includes(marker)) {
      throw new Error("Restored database content did not match source snapshot");
    }

    console.log(
      JSON.stringify({
        success: true,
        verified: true,
        encryptedFile: path.basename(encFile),
        restoredFile: dbName,
      })
    );
  } finally {
    delete process.env.BACKUP_ENCRYPTION_KEY;
    await rm(tmpRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
