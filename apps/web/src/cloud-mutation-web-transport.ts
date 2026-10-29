import type { CloudMutationSender } from "./cloud-note-upload";
import { createCloudWebJSONSender } from "./cloud-web-json";
import { verifyMutationHash } from "../../../packages/cloud-protocol/src/index";
import type { CloudMutationRequest } from "../../../packages/cloud-protocol/src/server";

const unavailable = () => Error("Cloud upload transport unavailable");
/** No session/paid grant: the parent binds this sender to its authenticated lifetime. */
export function createCloudMutationWebSender(
  input: { origin: string; csrfToken: string },
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): CloudMutationSender {
  return createCloudWebJSONSender<CloudMutationRequest>(
    input,
    async (request) => {
      const keys = ["version", "collectionId", "modeGeneration", "mutation"];
      if (
        !request ||
        typeof request !== "object" ||
        Array.isArray(request) ||
        Object.keys(request).length !== keys.length ||
        keys.some((key) => !Object.hasOwn(request, key)) ||
        request.version !== 1 ||
        typeof request.collectionId !== "string" ||
        !/^[a-zA-Z0-9-]{1,128}$/.test(request.collectionId) ||
        !Number.isSafeInteger(request.modeGeneration) ||
        request.modeGeneration < 1 ||
        (request.mutation?.snapshot &&
          request.mutation.snapshot.collectionId !== request.collectionId) ||
        !(await verifyMutationHash(request.mutation))
      )
        throw unavailable();
      return { path: "/v1/mutations", body: JSON.stringify(request) };
    },
    unavailable,
    fetcher,
  );
}
