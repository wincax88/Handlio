import { fork, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { AppError, dataDir, one, type Row } from "./db.js";
export async function isolatedExport(
  release: Row,
  jobId: string,
  format: string,
  paper: string,
) {
  const timeout =
    process.env.NODE_ENV === "test" && process.env.EXPORT_TEST_TIMEOUT_MS
      ? Number(process.env.EXPORT_TEST_TIMEOUT_MS)
      : 180000;
  const outputPath = path.join(
    dataDir,
    `${jobId}.${format === "pdf" ? "pdf" : "zip"}`,
  );
  try {
    return await new Promise<any>((resolve, reject) => {
      const child = fork(
        fileURLToPath(new URL("./export-worker.ts", import.meta.url)),
        [],
        {
          serialization: "advanced",
          execArgv: ["--import", "tsx", "--max-old-space-size=256"],
          detached: process.platform !== "win32",
          windowsHide: true,
          stdio: ["ignore", "ignore", "ignore", "ipc"],
          env: {
            PATH: process.env.PATH,
            SystemRoot: process.env.SystemRoot,
            TEMP: process.env.TEMP,
            NODE_ENV: process.env.NODE_ENV,
            DATA_DIR: dataDir,
            CHROMIUM_EXECUTABLE_PATH: process.env.CHROMIUM_EXECUTABLE_PATH,
          },
        },
      );
      let done = false;
      async function kill() {
        if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
        const stopped = new Promise<void>((resolve) => { child.once("exit", () => resolve()); setTimeout(resolve, 5000).unref(); });
        if (process.platform === "win32") {
          await new Promise<void>((resolve) => spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
            windowsHide: true,
            stdio: "ignore",
          }).once("exit", () => resolve()).once("error", () => { child.kill(); resolve(); }));
        } else {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        }
        await stopped;
      }
      const timer = setTimeout(
        () =>
          finish(
            new AppError(
              "JOB_TIMEOUT",
              504,
              "Export exceeded its 180-second limit. Try a smaller handbook.",
            ),
          ),
        timeout,
      );
      const cancellation = setInterval(() => {
        const job = one("SELECT state FROM jobs WHERE id=?", jobId);
        if (job && job.state !== "running")
          finish(new AppError("JOB_CANCELED", 409, "Export canceled."));
      }, 500);
      async function finish(error?: Error, result?: any) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearInterval(cancellation);
        await kill();
        error ? reject(error) : resolve(result);
      }
      child.once("message", (message: any) =>
        message.ok
          ? finish(undefined, message.result)
          : finish(
              new AppError(
                "RENDER_FAILED",
                503,
                "The export renderer failed. Retry the task.",
              ),
            ),
      );
      child.once("error", () =>
        finish(
          new AppError(
            "RENDER_FAILED",
            503,
            "The export renderer could not start.",
          ),
        ),
      );
      child.once("exit", () => {
        if (!done)
          finish(
            new AppError(
              "RENDER_FAILED",
              503,
              "The export renderer stopped unexpectedly.",
            ),
          );
      });
      child.send({ release, jobId, format, paper });
    });
  } catch (error) {
    await unlink(outputPath).catch(() => {});
    throw error;
  }
}
