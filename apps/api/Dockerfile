# API image. Build context = repository root:  docker build -f apps/api/Dockerfile .
# Multi-arch (linux/amd64 + linux/arm64): only the official node base image, no arch-specific binaries or digests.
FROM node:22-slim AS deps
ENV COREPACK_HOME=/usr/local/share/corepack \
    CI=true
RUN corepack enable && corepack prepare pnpm@10.34.6 --activate && chmod -R a+rX /usr/local/share/corepack
WORKDIR /app
# Manifests first so the dependency layer is cached until a package.json or the lockfile changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@scheduler/api..."

FROM node:22-slim AS runtime
ENV NODE_ENV=production \
    COREPACK_HOME=/usr/local/share/corepack \
    PORT=3000
COPY --from=deps /usr/local/share/corepack /usr/local/share/corepack
RUN corepack enable
WORKDIR /app
COPY --from=deps --chown=node:node /app /app
COPY --chown=node:node tsconfig.base.json ./
COPY --chown=node:node packages/contracts packages/contracts
COPY --chown=node:node apps/api apps/api
# .dockerignore keeps host node_modules out, so the copies above never clobber the installed ones
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "--filter", "@scheduler/api", "start"]
