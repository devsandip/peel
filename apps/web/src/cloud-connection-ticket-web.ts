import { createCloudWebJSONSender } from "./cloud-web-json";

type FailureKind = "sign-in-required" | "paused" | "canceled";
const messages: Record<FailureKind, string> = {
  "sign-in-required": "Sign in again to connect to Cloud.",
  paused: "Could not request a Cloud connection ticket.",
  canceled: "Cloud connection ticket request canceled.",
};
export class CloudConnectionTicketReadError extends Error {
  constructor(readonly kind: FailureKind) {
    super(messages[kind]);
    this.name = "CloudConnectionTicketReadError";
  }
}
type Ticket = Readonly<{ ticket: string; expiresAt: number }>;
function readTicket(raw: unknown): Ticket {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    Reflect.ownKeys(raw).length !== 2 ||
    !Object.hasOwn(raw, "ticket") ||
    !Object.hasOwn(raw, "expiresAt")
  )
    throw new CloudConnectionTicketReadError("paused");
  const value = structuredClone(raw) as { ticket: unknown; expiresAt: unknown };
  if (
    typeof value.ticket !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(value.ticket) ||
    typeof value.expiresAt !== "number" ||
    !Number.isSafeInteger(value.expiresAt) ||
    value.expiresAt <= 0 ||
    !Number.isFinite(new Date(value.expiresAt).getTime())
  )
    throw new CloudConnectionTicketReadError("paused");
  // The server owns expiry decisions. Never substitute the device's wall clock.
  return Object.freeze({ ticket: value.ticket, expiresAt: value.expiresAt });
}

/** Fresh one-use credentials only; the parent owns auth/connection lifetime, never notes here. */
export function createCloudConnectionTicketWebReader(
  config: { origin: string; csrfToken: string },
  signal: AbortSignal,
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): () => Promise<Ticket> {
  if (
    !signal ||
    typeof signal.aborted !== "boolean" ||
    typeof signal.addEventListener !== "function" ||
    typeof signal.removeEventListener !== "function"
  )
    throw new CloudConnectionTicketReadError("paused");
  const unavailable = () =>
    new CloudConnectionTicketReadError(signal.aborted ? "canceled" : "paused");
  const send = (() => {
    try {
      return createCloudWebJSONSender<null>(
        config,
        () => ({ path: "/v1/connection-ticket", method: "POST" }),
        unavailable,
        fetcher,
      );
    } catch {
      throw unavailable();
    }
  })();
  return async () => {
    try {
      signal.throwIfAborted();
      const reply = await send(null, signal);
      signal.throwIfAborted();
      if (reply.status !== 200)
        throw new CloudConnectionTicketReadError(
          reply.status === 401 ? "sign-in-required" : "paused",
        );
      const ticket = readTicket(reply.body);
      signal.throwIfAborted();
      return ticket;
    } catch (error) {
      if (signal.aborted) throw unavailable();
      // Even a caller-supplied fetcher's domain error cannot expose modified private text.
      throw new CloudConnectionTicketReadError(
        error instanceof CloudConnectionTicketReadError &&
          error.kind === "sign-in-required"
          ? "sign-in-required"
          : "paused",
      );
    }
  };
}
