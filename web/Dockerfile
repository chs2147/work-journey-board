FROM node:24-bookworm-slim

WORKDIR /app/web
ENV NODE_ENV=production
COPY --chown=node:node web/package.json web/package-lock.json ./
RUN --mount=type=secret,id=npm_ca \
    if [ -f /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; \
    npm ci --omit=dev --ignore-scripts
COPY --chown=node:node web/server.mjs web/pages.mjs web/session-store.mjs web/upstream.mjs ./
COPY --chown=node:node web/public/ ./public/
COPY --chown=node:node site/icon.svg site/wordmark.svg /app/site/
COPY --chown=node:node poc/v2-cloud/cloud-environment.mjs /app/poc/v2-cloud/
USER node

CMD ["node", "server.mjs"]
