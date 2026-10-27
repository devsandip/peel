/// <reference lib="webworker" />
declare const __PEEL_SHELL_MANIFEST__: {
  version: string;
  files: { path: string; sha256: string }[];
};
(() => {
  const sw = globalThis as unknown as ServiceWorkerGlobalScope;
  const manifest = __PEEL_SHELL_MANIFEST__;
  const scope = new URL(sw.registration.scope);
  const prefix = `peel-shell-${encodeURIComponent(scope.pathname)}-`;
  const cacheName = prefix + manifest.version;
  const index = new URL("index.html", scope).href;
  const files = new Set(
    manifest.files.map((file) => new URL(file.path, scope).href),
  );
  const digest = async (bytes: ArrayBuffer) =>
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  const prepareShell = async () => {
    const responses = await Promise.all(
      manifest.files.map(async (file) => {
        const url = new URL(file.path, scope).href;
        const response = await fetch(url, {
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
        });
        if (
          !response.ok ||
          response.type !== "basic" ||
          (await digest(await response.clone().arrayBuffer())) !== file.sha256
        )
          throw new Error("Incomplete application shell");
        return { url, response };
      }),
    );
    const cache = await caches.open(cacheName);
    await Promise.all(
      responses.map(({ url, response }) => cache.put(url, response)),
    );
  };
  sw.addEventListener("install", (event) => {
    event.waitUntil(
      prepareShell().catch(async (error) => {
        await caches.delete(cacheName);
        throw error;
      }),
    );
  });
  sw.addEventListener("activate", (event) => {
    event.waitUntil(
      (async () => {
        for (const key of await caches.keys())
          if (key.startsWith(prefix) && key !== cacheName)
            await caches.delete(key);
        await sw.clients.claim();
      })(),
    );
  });
  sw.addEventListener("fetch", (event) => {
    const request = event.request,
      url = new URL(request.url);
    if (request.method !== "GET" || url.origin !== scope.origin) return;
    const navigation =
      request.mode === "navigate" &&
      (url.pathname === scope.pathname || url.href.split("?")[0] === index);
    if (!navigation && (!files.has(url.href) || url.search)) return;
    event.respondWith(
      (async () => {
        const cached = await (
          await caches.open(cacheName)
        ).match(navigation ? index : url.href);
        // Never runtime-cache responses, APIs, auth, query strings or note data.
        return cached ?? fetch(request);
      })(),
    );
  });
  sw.addEventListener("message", (event) => {
    if (
      !["PEEL_SHELL_STATUS", "PEEL_SHELL_RETRY"].includes(event.data) ||
      !event.ports[0]
    )
      return;
    event.waitUntil(
      (async () => {
        if (event.data === "PEEL_SHELL_RETRY")
          await prepareShell().catch(() => {});
        try {
          const cache = await caches.open(cacheName);
          const present = await Promise.all(
            [...files].map(async (url) => !!(await cache.match(url))),
          );
          event.ports[0].postMessage({
            ready: present.every(Boolean),
            version: manifest.version,
          });
        } catch {
          event.ports[0].postMessage({ ready: false });
        }
      })(),
    );
  });
})();
