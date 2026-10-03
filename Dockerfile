# ICT LegalSuite: the task pane and its server in one container (Cloud Run, europe-west1)
# Built by scripts/felho-telepites.sh (gcloud run deploy --source .); see docs/FELHO-TELEPITES.md

FROM node:22-slim AS build
WORKDIR /app
# The local stubs are dependencies too (onnxruntime-node, sharp: not needed on a server)
COPY package.json package-lock.json ./
COPY stubs ./stubs
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
# version.json: written by the deploy script (no git in the container); missing, the version shows as unknown
COPY --from=build /app/package.json /app/version.jso[n] ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/stubs ./stubs
COPY --from=build /app/dist ./dist
USER node
# Cloud Run sets PORT (8080)
EXPOSE 8080
CMD ["node", "dist/server.cjs"]
