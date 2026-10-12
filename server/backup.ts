import "dotenv/config";
import path from "node:path";
import {
  createEncryptedBackup,
  pruneEncryptedBackups,
} from "./backup-store.js";
const result = await createEncryptedBackup();
await pruneEncryptedBackups(path.dirname(result.file));
console.log(JSON.stringify(result));
