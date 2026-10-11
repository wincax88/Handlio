import "dotenv/config";
import { backup } from "node:sqlite";
import { mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { db, dataDir, many } from "./db.js";
const destination = path.join(
  dataDir,
  "backups",
  new Date().toISOString().replace(/[:.]/g, "-"),
);
await mkdir(destination, { recursive: true });
await backup(db, path.join(destination, "handlio.sqlite"));
for (const a of many("SELECT id FROM assets WHERE status='ready'"))
  await copyFile(
    path.join(dataDir, `${a.id}.png`),
    path.join(destination, `${a.id}.png`),
  );
console.log(`Database and sanitized assets backed up to ${destination}`);
