import {
  validateCloudScope,
  type CloudScope,
} from "../../../packages/cloud-protocol/src/durable";
import { createCloudWebJSONSender } from "./cloud-web-json";

type FailureKind = "sign-in-required" | "paused" | "canceled";
const messages: Record<FailureKind, string> = {
  "sign-in-required": "Sign in again to read the Cloud library context.",
  paused: "Could not read the Cloud library context.",
  canceled: "Cloud library context request canceled.",
};
export class CloudLibraryContextReadError extends Error {
  constructor(readonly kind: FailureKind) {
    super(messages[kind]);
    this.name = "CloudLibraryContextReadError";
  }
}

/** Discovery only. The parent owns authentication, caches and tier activation. */
export function createCloudLibraryContextWebReader(
  config: { origin: string; csrfToken: string },
  signal: AbortSignal,
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): () => Promise<Readonly<CloudScope>> {
  if (
    !signal ||
    typeof signal.aborted !== "boolean" ||
    typeof signal.addEventListener !== "function" ||
    typeof signal.removeEventListener !== "function"
  )
    throw new CloudLibraryContextReadError("paused");
  const unavailable = () =>
    new CloudLibraryContextReadError(signal.aborted ? "canceled" : "paused");
  const send = (() => {
    try {
      return createCloudWebJSONSender<null>(
        config,
        () => ({ path: "/v1/library-context" }),
        unavailable,
        fetcher,
      );
    } catch {
      throw unavailable();
    }
  })();
  let task: Promise<Readonly<CloudScope>> | null = null;
  return () => {
    if (signal.aborted) return Promise.reject(unavailable());
    if (task) return task;
    task = Promise.resolve()
      .then(async () => {
        const reply = await send(null, signal);
        if (signal.aborted) throw unavailable();
        if (reply.status !== 200)
          throw new CloudLibraryContextReadError(
            reply.status === 401 ? "sign-in-required" : "paused",
          );
        const scope = validateCloudScope(reply.body as CloudScope);
        if (signal.aborted) throw unavailable();
        return Object.freeze(scope);
      })
      .catch((error: unknown) => {
        if (signal.aborted) throw unavailable();
        if (error instanceof CloudLibraryContextReadError) throw error;
        throw unavailable();
      })
      .finally(() => {
        task = null;
      });
    return task;
  };
}
