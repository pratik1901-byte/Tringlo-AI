// ============================================================
// Dialo AI — "Is this request from this machine?"
// ============================================================
//
// Used by first-run setup, which lets the person sitting at the server create
// the first account without first inventing an internal secret.
//
// The subtlety: the Cloudflare tunnel connects to localhost, so a request
// arriving from the public URL *also* has a local socket. What distinguishes
// them is that Cloudflare stamps every request it forwards with `cf-ray` and
// `cf-connecting-ip`. A request carrying either came from the internet, whoever
// it claims to be.
//
// Those headers can be forged by something already on this machine — but
// forging them only makes a request look MORE remote, which fails closed.
// ============================================================

/** True when the request did not arrive through the Cloudflare tunnel. */
export function arrivedThroughTunnel(request: Request): boolean {
  const headers = request.headers;
  return Boolean(headers.get("cf-ray") || headers.get("cf-connecting-ip"));
}

/**
 * True when this request plausibly came from a browser on the server machine.
 *
 * Requires both that it did not come through the tunnel and that the Host is a
 * loopback address, so a request proxied in some other way is not mistaken for
 * a local one.
 */
export function isLocalRequest(request: Request): boolean {
  if (arrivedThroughTunnel(request)) return false;

  // Next's dev server sets x-forwarded-host on ordinary local requests, so its
  // presence proves nothing. What matters is the value: if something did
  // forward this request, the name it was asked for must still be loopback.
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost && !isLoopbackHost(forwardedHost)) return false;

  return isLoopbackHost(request.headers.get("host") || "");
}

function isLoopbackHost(value: string): boolean {
  // Takes the first entry, since forwarding headers may carry a list.
  const first = value.split(",")[0].trim().toLowerCase();
  // Strips the port, and the brackets an IPv6 literal arrives wrapped in.
  const hostname = first.replace(/^\[([^\]]+)\].*$/, "$1").split(":")[0];

  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    first === "[::1]" ||
    first.startsWith("[::1]:")
  );
}
