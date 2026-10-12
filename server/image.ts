import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "./db.js";
let active = 0;
export function imageSlot(req: Request, res: Response, next: NextFunction) {
  if (active >= 4) {
    next(
      new AppError(
        "UPLOAD_BUSY",
        503,
        "Image processing is busy. Retry this image shortly.",
      ),
    );
    return;
  }
  active++;
  let released = false;
  const release = () => {
    if (!released) {
      active--;
      released = true;
    }
  };
  res.once("finish", release);
  res.once("close", release);
  next();
}
export function sanitizeImage(
  bytes: Buffer,
  overlay?: string,
): Promise<{
  safe: Buffer;
  width: number;
  height: number;
  quality: {
    smallText: boolean;
    glyphCandidates: number;
    tinyCandidates: number;
    method: string;
  };
}> {
  return new Promise((resolve, reject) => {
    const child = fork(
      fileURLToPath(new URL("./image-worker.mjs", import.meta.url)),
      [],
      {
        serialization: "advanced",
        execArgv: ["--max-old-space-size=256"],
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          TEMP: process.env.TEMP,
        },
      },
    );
    let finished = false;
    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        child.kill();
        reject(
          new AppError(
            "IMAGE_TIMEOUT",
            400,
            "This image took too long to process. Resize or re-export it and retry.",
          ),
        );
      }
    }, 15000);
    child.once("message", (message: any) => {
      finished = true;
      clearTimeout(timer);
      child.disconnect();
      if (message.ok)
        resolve({
          safe: message.data,
          width: message.width,
          height: message.height,
          quality: message.quality,
        });
      else
        reject(
          new AppError(
            "IMAGE_INVALID",
            400,
            "Use a valid static PNG, JPEG or WebP within the image limits.",
          ),
        );
    });
    child.once("error", () => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        reject(
          new AppError(
            "IMAGE_INVALID",
            400,
            "Image processing failed. Retry with a new PNG.",
          ),
        );
      }
    });
    child.once("exit", () => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        reject(
          new AppError(
            "IMAGE_INVALID",
            400,
            "This image could not be decoded. Re-export it as a PNG.",
          ),
        );
      }
    });
    child.send({ bytes, overlay });
  });
}
