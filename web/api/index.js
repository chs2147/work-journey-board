/* global process */
import { createConfiguredWebHandler } from "../server.mjs";

let handleWeb;

function reply(response, status, error) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-robots-tag": "noindex, nofollow",
  });
  return response.end(JSON.stringify({ error }));
}

export default function handler(request, response) {
  if (!["preview", "development", "production"].includes(process.env.VERCEL_ENV)) {
    return reply(response, 404, "NOT_FOUND");
  }
  try {
    handleWeb ??= createConfiguredWebHandler(process.env);
  } catch {
    return reply(response, 503, "UNAVAILABLE");
  }
  return handleWeb(request, response);
}
