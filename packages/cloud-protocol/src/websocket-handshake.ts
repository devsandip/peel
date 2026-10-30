export const CLOUD_WEBSOCKET_PROTOCOL = "synkies.v1";
export const CLOUD_WEBSOCKET_TICKET_PREFIX = "synkies-ticket.";
export const CLOUD_WEBSOCKET_PROTOCOL_BYTES = 256;
const opaque = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
const unavailable = (): never => {
  throw Error("Cloud connection handshake unavailable");
};

/** Pure offers only. A future upgrade selects the safe version, never the credential. */
export function cloudWebSocketProtocols(
  ticket: unknown,
): readonly [string, string] {
  if (!opaque(ticket)) return unavailable();
  return Object.freeze([
    CLOUD_WEBSOCKET_PROTOCOL,
    CLOUD_WEBSOCKET_TICKET_PREFIX + ticket,
  ]);
}
/** Parsing an offer is not authentication, ticket consumption or connection negotiation. */
export function cloudWebSocketTicket(raw: unknown): string {
  if (
    typeof raw !== "string" ||
    raw.length > CLOUD_WEBSOCKET_PROTOCOL_BYTES ||
    !/^[\x09\x20-\x7e]*$/.test(raw)
  )
    return unavailable();
  const offers = raw.split(",").map((value) => value.trim());
  if (
    offers.length !== 2 ||
    offers.filter((value) => value === CLOUD_WEBSOCKET_PROTOCOL).length !== 1
  )
    return unavailable();
  const credential = offers.find((value) =>
    value.startsWith(CLOUD_WEBSOCKET_TICKET_PREFIX),
  );
  const ticket = credential?.slice(CLOUD_WEBSOCKET_TICKET_PREFIX.length);
  if (!opaque(ticket)) return unavailable();
  return ticket;
}
