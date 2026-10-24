import { afterEach, expect, test, vi } from "vitest";
import { closePdfBrowser } from "../server/pdf-browser";

afterEach(() => {
  vi.useRealTimers();
});

test("normal browser shutdown clears the fallback without killing the process", async () => {
  vi.useFakeTimers();
  const server = { close: vi.fn().mockResolvedValue(undefined), kill: vi.fn() };
  await closePdfBrowser(server);
  await vi.advanceTimersByTimeAsync(3000);
  expect(server.close).toHaveBeenCalledOnce();
  expect(server.kill).not.toHaveBeenCalled();
});

test("a stalled shutdown forces cleanup and waits for the renderer to stop", async () => {
  vi.useFakeTimers();
  let stopped!: () => void;
  const server = {
    close: vi.fn(() => new Promise<void>(() => {})),
    kill: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          stopped = resolve;
        }),
    ),
  };
  let completed = false;
  const closing = closePdfBrowser(server).then(() => {
    completed = true;
  });
  await vi.advanceTimersByTimeAsync(1999);
  expect(server.kill).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(server.kill).toHaveBeenCalledOnce();
  expect(completed).toBe(false);
  stopped();
  await closing;
  expect(completed).toBe(true);
});

test("a graceful shutdown error falls back to forceful cleanup", async () => {
  const server = {
    close: vi.fn().mockRejectedValue(new Error("disconnected")),
    kill: vi.fn().mockResolvedValue(undefined),
  };
  await closePdfBrowser(server);
  expect(server.kill).toHaveBeenCalledOnce();
});

test("cleanup failures propagate instead of reporting a stopped renderer", async () => {
  const server = {
    close: vi.fn().mockRejectedValue(new Error("disconnected")),
    kill: vi.fn().mockRejectedValue(new Error("could not terminate")),
  };
  await expect(closePdfBrowser(server)).rejects.toThrow("could not terminate");
});
