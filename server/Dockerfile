# DocuMind API
# Debian-based (not Alpine): onnxruntime, used for the local models, needs glibc.
FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app
# Build as the unprivileged user from the start: a `chown -R` afterwards would
# copy every file into a new image layer and double the image size.
RUN chown node:node /app
USER node

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev \
 && npm cache clean --force \
 # onnxruntime ships binaries for every OS plus GPU (CUDA/TensorRT) providers.
 # This CPU-only Linux container needs just linux/<arch> without them.
 && cd node_modules/onnxruntime-node/bin/napi-v6 \
 && rm -rf darwin win32 \
 && find linux -name 'libonnxruntime_providers_cuda*' -delete \
 && find linux -name 'libonnxruntime_providers_tensorrt*' -delete

COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts

# Bake the embedding + reranking models (~150 MB) into the image.
RUN node scripts/download-models.js && mkdir -p uploads

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://localhost:5000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/server.js"]
