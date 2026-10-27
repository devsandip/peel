import { PublicModelCache, smallSet } from "./model-cache-contract";
self.onmessage = async ({ data }: MessageEvent<{ name: string }>) => {
  const cache = new PublicModelCache(data.name);
  const set = await smallSet("interrupted-v2");
  let calls = 0;
  await cache.install(set.manifest, async () => {
    if (++calls === 2) {
      self.postMessage({ kind: "staged-and-blocked" });
      await new Promise(() => {});
    }
    return set.load();
  });
};
