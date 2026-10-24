import type { BrowserServer } from "playwright";

// A completed PDF must not wait indefinitely for Chromium's graceful shutdown.
export async function closePdfBrowser(
  server: Pick<BrowserServer, "close" | "kill">,
  graceMs = 2000,
) {
  let forced: Promise<void> | undefined;
  const kill = () => (forced ??= server.kill());
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve()
        .then(() => server.close())
        .catch(kill),
      new Promise<void>((resolve, reject) => {
        timer = setTimeout(() => {
          void kill().then(resolve, reject);
        }, graceMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
