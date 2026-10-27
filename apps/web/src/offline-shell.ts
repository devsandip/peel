import { native } from "@peel/storage";
type State =
  | "development"
  | "preparing"
  | "ready"
  | "update-ready"
  | "unavailable"
  | "unsupported";
let state: State = import.meta.env.DEV ? "development" : "preparing";
const listeners = new Set<() => void>();
const publish = (next: State) => {
  state = next;
  for (const listener of listeners) listener();
};
export const offlineShellState = () => state;
export const subscribeOfflineShell = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const supported = () =>
  !native && import.meta.env.PROD && "serviceWorker" in navigator;
const status = (worker: ServiceWorker, retry = false) =>
  new Promise<boolean>((resolve) => {
    const channel = new MessageChannel();
    const finish = (ready: boolean) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(ready);
    };
    const timer = setTimeout(() => finish(false), 3000);
    channel.port1.onmessage = ({ data }) => finish(data?.ready === true);
    worker.postMessage(retry ? "PEEL_SHELL_RETRY" : "PEEL_SHELL_STATUS", [
      channel.port2,
    ]);
  });
async function prepare(retry = false) {
  if (!supported()) {
    if (import.meta.env.PROD) publish("unsupported");
    return;
  }
  const scope = new URL(import.meta.env.BASE_URL, location.origin);
  let repair = retry;
  const refresh = async (registration: ServiceWorkerRegistration) => {
    if (registration.active) {
      const retryOnce = repair;
      repair = false;
      publish(
        (await status(registration.active, retryOnce))
          ? registration.waiting
            ? "update-ready"
            : "ready"
          : "unavailable",
      );
    }
  };
  try {
    // An existing installed shell remains usable when registering while offline fails.
    const existing = await navigator.serviceWorker.getRegistration(scope.href);
    if (existing?.active) await refresh(existing);
    const registration = await navigator.serviceWorker.register(
      new URL("sw.js", scope),
      { scope: scope.pathname, updateViaCache: "none" },
    );
    const watch = () => {
      const installing = registration.installing;
      installing?.addEventListener("statechange", () => {
        if (installing.state === "installed" && registration.active)
          publish("update-ready");
        else if (installing.state === "redundant" && !registration.active)
          publish("unavailable");
      });
    };
    registration.addEventListener("updatefound", watch);
    watch();
    void navigator.serviceWorker.ready
      .then(refresh)
      .catch(() => publish("unavailable"));
    await refresh(registration);
  } catch {
    if (state !== "ready" && state !== "update-ready") publish("unavailable");
  }
}
export const retryOfflineShell = () => {
  publish("preparing");
  void prepare(true);
};
export function startOfflineShell() {
  if (!supported()) {
    if (import.meta.env.PROD && !native) publish("unsupported");
    return;
  }
  if (document.readyState === "complete") void prepare();
  else window.addEventListener("load", () => void prepare(), { once: true });
}
