let csrf = "";
export function setCsrf(value: string) {
  csrf = value;
}
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: any,
  ) {
    super(message);
  }
}
export async function api<T = any>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && typeof options.body === "string")
    headers.set("Content-Type", "application/json");
  if (csrf) headers.set("X-CSRF-Token", csrf);
  const res = await fetch(`/api${url}`, {
    ...options,
    headers,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({
    safe_message: "The server is unavailable. Please retry.",
  }));
  if (!res.ok)
    throw new ApiError(
      data.code || "NETWORK_ERROR",
      data.safe_message || "Request failed.",
      data.details,
    );
  return data;
}
export const send = <T = any>(
  url: string,
  body: unknown,
  method = "POST",
  key?: string,
) =>
  api<T>(url, {
    method,
    body: JSON.stringify(body),
    headers: { "Idempotency-Key": key || crypto.randomUUID() },
  });
const navigationGuards = new Set<() => boolean>();
let lastUrl = typeof location === "undefined" ? "" : location.href;
let navigationIndex =
  typeof history === "undefined" ? 0 : history.state?.handlioIndex || 0;
let internalNavigation = false,
  restoringNavigation = false;
if (typeof window !== "undefined") {
  history.replaceState(
    { ...history.state, handlioIndex: navigationIndex },
    "",
    location.href,
  );
  window.addEventListener("popstate", (event) => {
    if (internalNavigation || restoringNavigation) {
      internalNavigation = false;
      restoringNavigation = false;
      lastUrl = location.href;
      return;
    }
    const targetIndex = history.state?.handlioIndex;
    if ([...navigationGuards].some((guard) => !guard())) {
      event.stopImmediatePropagation();
      restoringNavigation = true;
      if (typeof targetIndex === "number" && targetIndex !== navigationIndex)
        history.go(navigationIndex - targetIndex);
      else {
        history.pushState({ handlioIndex: navigationIndex }, "", lastUrl);
        restoringNavigation = false;
      }
      return;
    }
    navigationIndex =
      typeof targetIndex === "number" ? targetIndex : navigationIndex;
    lastUrl = location.href;
  });
}
export function registerNavigationGuard(guard: () => boolean) {
  navigationGuards.add(guard);
  return () => {
    navigationGuards.delete(guard);
  };
}
export function navigate(path: string) {
  if ([...navigationGuards].some((guard) => !guard())) return;
  navigationIndex++;
  history.pushState({ handlioIndex: navigationIndex }, "", path);
  lastUrl = location.href;
  internalNavigation = true;
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}
export const assetUrl = (aid: string, release?: string) =>
  `/api/assets/${aid}${release ? `?release=${release}` : ""}`;
export function formatDate(time: string | number | null, tz = "UTC") {
  return time
    ? new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: tz,
      }).format(new Date(time)) +
        " " +
        tz
    : "Not started";
}
