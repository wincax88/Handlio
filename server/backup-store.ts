import { DatabaseSync, backup } from "node:sqlite";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  appendFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { ZipArchive } from "archiver";
import yauzl from "yauzl";
import { dataDir, db, now, run } from "./db.js";
const magic = Buffer.from("HNDLBK1\n");
function encryptionKey(value = process.env.BACKUP_KEY || "") {
  const key = Buffer.from(value, "base64");
  if (key.length !== 32)
    throw new Error(
      "BACKUP_KEY must be a base64-encoded 32-byte key stored outside the backup directory.",
    );
  return key;
}
async function checksum(file: string) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { hash: hash.digest("hex"), bytes };
}
async function removeTemp(directory: string) {
  const resolved = path.resolve(directory);
  if (
    !resolved.startsWith(path.resolve(tmpdir()) + path.sep) ||
    !/^handlio-(backup|restore)-/.test(path.basename(resolved))
  )
    throw new Error("Unexpected temporary directory.");
  await rm(resolved, { recursive: true, force: true });
}
export let backupInProgress = false;
export async function createEncryptedBackup(
  directory = path.resolve(
    process.env.BACKUP_DIRECTORY || path.join(dataDir, "backups"),
  ),
  keyValue?: string,
) {
  if (backupInProgress) throw new Error("Backup already running.");
  const key = encryptionKey(keyValue);
  backupInProgress = true;
  const temp = await mkdtemp(path.join(tmpdir(), "handlio-backup-")).catch(
      (error) => {
        backupInProgress = false;
        throw error;
      },
    ),
    name = `handlio-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.hbk`,
    destination = path.join(directory, name);
  let success = false;
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const snapshot = path.join(temp, "handlio.sqlite");
    await backup(db, snapshot);
    const snapshotDb = new DatabaseSync(snapshot, { readOnly: true });
    const assets = snapshotDb
      .prepare("SELECT id,hash FROM assets WHERE status='ready'")
      .all() as { id: string; hash: string }[];
    snapshotDb.close();
    const files: { file: string; hash: string; bytes: number }[] = [
      { file: "handlio.sqlite", ...(await checksum(snapshot)) },
    ];
    for (const asset of assets) {
      if (!/^[0-9a-f-]{36}$/i.test(asset.id))
        throw new Error("Invalid asset identifier in snapshot.");
      const file = `${asset.id}.png`,
        info = await checksum(path.join(dataDir, file));
      if (info.hash !== asset.hash)
        throw new Error("An asset changed or is missing during backup.");
      files.push({ file, ...info });
    }
    const nonce = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(magic);
    await writeFile(destination, Buffer.concat([magic, nonce]), {
      flag: "wx",
      mode: 0o600,
    });
    const archive = new ZipArchive({ zlib: { level: 6 } });
    archive.on("warning", (error) => archive.destroy(error));
    const transfer = pipeline(
      archive,
      cipher,
      createWriteStream(destination, { flags: "a", mode: 0o600 }),
    );
    archive.append(
      JSON.stringify({
        format: "handlio-backup-v1",
        createdAt: new Date().toISOString(),
        files,
      }),
      { name: "manifest.json" },
    );
    archive.file(snapshot, { name: "handlio.sqlite" });
    for (const asset of assets)
      archive.file(path.join(dataDir, `${asset.id}.png`), {
        name: `${asset.id}.png`,
      });
    await Promise.all([archive.finalize(), transfer]);
    await appendFile(destination, cipher.getAuthTag());
    success = true;
    run(
      "INSERT INTO worker_state VALUES ('backup',?,NULL,NULL) ON CONFLICT(name) DO UPDATE SET last_success_at=excluded.last_success_at,error_code=NULL",
      now(),
    );
    return {
      file: destination,
      assets: assets.length,
      bytes: (await stat(destination)).size,
      encrypted: true,
    };
  } catch (error) {
    run(
      "INSERT INTO worker_state VALUES ('backup',NULL,?,'BACKUP_FAILED') ON CONFLICT(name) DO UPDATE SET last_error_at=excluded.last_error_at,error_code=excluded.error_code",
      now(),
    );
    throw error;
  } finally {
    if (!success) await unlink(destination).catch(() => {});
    await removeTemp(temp);
    backupInProgress = false;
  }
}
export async function pruneEncryptedBackups(directory: string, days = 35) {
  const resolved = path.resolve(directory);
  if (days < 1 || days > 35)
    throw new Error("Backup retention must be 1–35 days.");
  for (const entry of await readdir(resolved, { withFileTypes: true }))
    if (
      entry.isFile() &&
      /^handlio-[0-9TZ-]+-[0-9a-f-]{36}\.hbk$/i.test(entry.name)
    ) {
      const file = path.join(resolved, entry.name);
      const info = await lstat(file);
      if (!info.isSymbolicLink() && info.mtimeMs < Date.now() - days * 86400000)
        await unlink(file);
    }
}
export async function restoreEncryptedBackup(
  file: string,
  targetDirectory: string,
  keyValue?: string,
) {
  const key = encryptionKey(keyValue),
    target = path.resolve(targetDirectory);
  if (target === dataDir || target.startsWith(dataDir + path.sep))
    throw new Error("Restore to a new directory outside the live DATA_DIR.");
  try {
    await stat(target);
    throw new Error(
      "Restore directory already exists; existing data will not be replaced.",
    );
  } catch (error: any) {
    if (error.code !== "ENOENT") throw error;
  }
  const temp = await mkdtemp(path.join(tmpdir(), "handlio-restore-"));
  let created = false;
  try {
    const input = await open(file, "r"),
      size = (await input.stat()).size,
      header = Buffer.alloc(magic.length + 12),
      tag = Buffer.alloc(16);
    try {
      if (size < header.length + 16)
        throw new Error("Invalid encrypted backup.");
      await input.read(header, 0, header.length, 0);
      await input.read(tag, 0, 16, size - 16);
    } finally {
      await input.close();
    }
    if (!header.subarray(0, magic.length).equals(magic))
      throw new Error("Unsupported backup format.");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      header.subarray(magic.length),
    );
    decipher.setAAD(magic);
    decipher.setAuthTag(tag);
    const archiveFile = path.join(temp, "authenticated.zip");
    await pipeline(
      createReadStream(file, { start: header.length, end: size - 17 }),
      decipher,
      createWriteStream(archiveFile, { mode: 0o600 }),
    );
    const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
      yauzl.open(
        archiveFile,
        { lazyEntries: true, strictFileNames: true, validateEntrySizes: true },
        (error, zip) => (error ? reject(error) : resolve(zip!)),
      ),
    );
    let total = 0;
    const entries = new Set<string>();
    await mkdir(target, { mode: 0o700 });
    created = true;
    await new Promise<void>((resolve, reject) => {
      zip.on("error", reject);
      zip.on("end", resolve);
      zip.on("entry", async (entry: yauzl.Entry) => {
        try {
          if (
            !/^(handlio\.sqlite|manifest\.json|[0-9a-f-]{36}\.png)$/i.test(
              entry.fileName,
            ) ||
            entries.has(entry.fileName) ||
            ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000
          )
            throw new Error("Unsafe or duplicate backup entry.");
          entries.add(entry.fileName);
          total += entry.uncompressedSize;
          if (
            entry.uncompressedSize >
              (entry.fileName === "handlio.sqlite"
                ? 1073741824
                : 100 * 1048576) ||
            total > Number(process.env.BACKUP_MAX_BYTES || 50 * 1073741824) ||
            entries.size > 100000
          )
            throw new Error("Backup exceeds restoration resource limits.");
          const stream = await new Promise<NodeJS.ReadableStream>(
            (resolve, reject) =>
              zip.openReadStream(entry, (error, stream) =>
                error ? reject(error) : resolve(stream!),
              ),
          );
          await pipeline(
            stream,
            createWriteStream(path.join(target, entry.fileName), {
              flags: "wx",
              mode: 0o600,
            }),
          );
          zip.readEntry();
        } catch (error) {
          zip.close();
          reject(error);
        }
      });
      zip.readEntry();
    });
    const manifest = JSON.parse(
      await readFile(path.join(target, "manifest.json"), "utf8"),
    );
    if (
      manifest.format !== "handlio-backup-v1" ||
      !Array.isArray(manifest.files) ||
      entries.size !== manifest.files.length + 1
    )
      throw new Error("Invalid backup manifest.");
    for (const item of manifest.files) {
      if (!entries.has(item.file)) throw new Error("Manifest entry missing.");
      const actual = await checksum(path.join(target, item.file));
      if (actual.hash !== item.hash || actual.bytes !== item.bytes)
        throw new Error("Backup checksum mismatch.");
    }
    const restored = new DatabaseSync(path.join(target, "handlio.sqlite"));
    try {
      if (
        Object.values(restored.prepare("PRAGMA integrity_check").get()!)[0] !==
        "ok"
      )
        throw new Error("Database integrity check failed.");
      restored.exec(
        "PRAGMA foreign_keys=ON; DELETE FROM sessions; DELETE FROM challenges; UPDATE projects SET sharing=0; UPDATE confirmation_requests SET status='withdrawn' WHERE status IN ('pending','in_progress'); UPDATE notifications SET state='canceled' WHERE state IN ('queued','retry'); UPDATE support_grants SET revoked_at=COALESCE(revoked_at,strftime('%s','now')*1000),sample=''; UPDATE jobs SET state='canceled' WHERE state IN ('queued','running'); UPDATE jobs SET state='expired',output=NULL WHERE type='export'; UPDATE usage SET reserved=0; UPDATE ai_costs SET status='released',reserved_micros=0 WHERE status='reserved'; UPDATE ai_costs SET status='unknown' WHERE status='dispatching';",
      );
    } finally {
      restored.close();
    }
    return {
      directory: target,
      files: manifest.files.length,
      integrity: "ok",
      sessionsRevoked: true,
      sharingPaused: true,
    };
  } catch (error) {
    if (created && path.resolve(targetDirectory) === target)
      await rm(target, { recursive: true, force: true });
    throw error;
  } finally {
    await removeTemp(temp);
  }
}
