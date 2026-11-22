# DocuMind as a single container: the API also serves the built web app.
# Used for the hosted demo (Hugging Face Spaces expects port 7860).
# For local development with two containers, see docker-compose.yml.

# ---- 1. Build the React app ----
FROM node:22-slim AS client
WORKDIR /client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---- 2. API + web app ----
# Debian-based (not Alpine): onnxruntime, used for the local models, needs glibc.
FROM node:22-slim

ENV NODE_ENV=production \
    PORT=7860 \
    CLIENT_DIST=/app/public \
    TRUST_PROXY=1
WORKDIR /app
# Build as the unprivileged user (uid 1000, which Hugging Face also uses):
# a `chown -R` afterwards would copy every file into a new layer.
RUN chown node:node /app
USER node

COPY --chown=node:node server/package.json server/package-lock.json ./
RUN npm ci --omit=dev \
 && npm cache clean --force \
 && cd node_modules/onnxruntime-node/bin/napi-v6 \
 && rm -rf darwin win32 \
 && find linux -name 'libonnxruntime_providers_cuda*' -delete \
 && find linux -name 'libonnxruntime_providers_tensorrt*' -delete

COPY --chown=node:node server/src ./src
COPY --chown=node:node server/scripts ./scripts
# Bake the embedding + reranking models into the image.
RUN node scripts/download-models.js

COPY --from=client --chown=node:node /client/dist ./public

EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||7860)+'/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/server.js"]
