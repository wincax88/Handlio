import "dotenv/config";
import { restoreEncryptedBackup } from "./backup-store.js";
const [file, directory] = process.argv.slice(2);
if (!file || !directory)
  throw new Error(
    "Usage: npm run restore -- <encrypted-backup.hbk> <new-directory>",
  );
console.log(JSON.stringify(await restoreEncryptedBackup(file, directory)));
