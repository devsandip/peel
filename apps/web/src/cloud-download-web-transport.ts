import type {
  CloudDownloadRequest,
  CloudDownloadSender,
} from "./cloud-library-download";
import { validatePullLocation } from "../../../packages/cloud-protocol/src/pull";
import {
  createCloudWebJSONSender,
  CLOUD_WEB_DEADLINE_MS,
} from "./cloud-web-json";

export const CLOUD_DOWNLOAD_DEADLINE_MS = CLOUD_WEB_DEADLINE_MS;
const unavailable = () => Error("Cloud download transport unavailable");
function fields(value: object, keys: string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw unavailable();
}

/** Browser transport only. The parent supplies its trusted origin and issued CSRF. */
export function createCloudDownloadWebSender(
  input: { origin: string; csrfToken: string },
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): CloudDownloadSender {
  return createCloudWebJSONSender<CloudDownloadRequest>(
    input,
    (request) => {
      let path: string, body: string | undefined;
      if (request.kind === "bootstrap") {
        fields(request, ["kind", "scope"]);
        fields(request.scope, ["version", "collectionId", "modeGeneration"]);
        if (
          request.scope.version !== 1 ||
          typeof request.scope.collectionId !== "string" ||
          !/^[a-zA-Z0-9-]{1,128}$/.test(request.scope.collectionId) ||
          !Number.isSafeInteger(request.scope.modeGeneration) ||
          request.scope.modeGeneration < 1
        )
          throw unavailable();
        path = "/v1/sync/bootstrap";
        body = JSON.stringify(request.scope);
      } else if (request.kind === "resume") {
        fields(request, ["kind", "checkpoint"]);
        if (
          typeof request.checkpoint !== "string" ||
          !request.checkpoint.length ||
          request.checkpoint.length > 4096
        )
          throw unavailable();
        path = `/v1/sync?${new URLSearchParams({ after: request.checkpoint })}`;
      } else if (request.kind === "page") {
        fields(request, ["kind", "location"]);
        const location = validatePullLocation(request.location);
        path = `${location.kind === "heads" ? "/v1/notes" : "/v1/sync"}?${new URLSearchParams({ pageToken: location.token, limit: "32" })}`;
      } else throw unavailable();
      return { path, body };
    },
    unavailable,
    fetcher,
  );
}
