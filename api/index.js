/* global process */
import { createConfiguredWebHandler } from "../web/server.mjs";

let handlePreview;

export default function handler(request, response) {
  if (!["preview", "development"].includes(process.env.VERCEL_ENV)) {
    response.writeHead(404, {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-robots-tag": "noindex, nofollow",
    });
    return response.end(JSON.stringify({ error: "NOT_FOUND" }));
  }
  handlePreview ??= createConfiguredWebHandler(process.env);
  return handlePreview(request, response);
}
