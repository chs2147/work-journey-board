import { createServer } from "node:http";
import { Readable } from "node:stream";
import { Buffer } from "node:buffer";

// Local test host only. Does not listen until a caller explicitly binds it.
export function createNodeServer(handler) {
  return createServer(
    { maxHeaderSize: 16384, requestTimeout: 5000, headersTimeout: 5000 },
    async (req, res) => {
      try {
        const request = new globalThis.Request(`http://127.0.0.1${req.url}`, {
          method: req.method,
          headers: req.headers,
          ...(["GET", "HEAD"].includes(req.method) ? {} : { body: Readable.toWeb(req), duplex: "half" }),
        });
        const result = await handler(request);
        res.statusCode = result.status;
        for (const [key, value] of result.headers) res.setHeader(key, value);
        if (!req.complete) res.setHeader("connection", "close");
        res.end(Buffer.from(await result.arrayBuffer()));
      } catch {
        res.writeHead(503, { "content-type": "application/json", "cache-control": "no-store" });
        res.end('{"error":{"code":"INTERNAL_ERROR"}}');
      }
    },
  );
}
