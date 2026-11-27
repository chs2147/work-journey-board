FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
COPY --chown=node:node web/server.mjs web/pages.mjs web/session-store.mjs web/upstream.mjs ./web/
COPY --chown=node:node web/public/ ./web/public/
COPY --chown=node:node site/icon.svg site/wordmark.svg ./site/
COPY --chown=node:node poc/v2-cloud/cloud-environment.mjs ./poc/v2-cloud/
USER node

CMD ["node", "web/server.mjs"]
