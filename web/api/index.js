/* global process */
import { createConfiguredWebHandler } from "../server.mjs";

let handlePreview;

function reply(response, status, error) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-robots-tag": "noindex, nofollow",
  });
  return response.end(JSON.stringify({ error }));
}

export default function handler(request, response) {
  if (!["preview", "development"].includes(process.env.VERCEL_ENV)) {
    return reply(response, 404, "NOT_FOUND");
  }
  try {
    handlePreview ??= createConfiguredWebHandler(process.env);
  } catch {
    return reply(response, 503, "UNAVAILABLE");
  }
  return handlePreview(request, response);
}
