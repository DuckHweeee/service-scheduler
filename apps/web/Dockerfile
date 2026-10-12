# Web image. Build context = repository root:  docker build -f apps/web/Dockerfile .
# VITE_* values are compiled into the bundle, so they are build args.
FROM node:22-slim AS build
ENV COREPACK_HOME=/usr/local/share/corepack \
    CI=true
RUN corepack enable && corepack prepare pnpm@10.34.6 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@scheduler/web..."
COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY apps/web apps/web
ARG VITE_API_URL=http://localhost:3000
ARG VITE_USE_MOCKS=false
ARG VITE_CUSTOMER_ID=CUS-10482
ENV VITE_API_URL=$VITE_API_URL \
    VITE_USE_MOCKS=$VITE_USE_MOCKS \
    VITE_CUSTOMER_ID=$VITE_CUSTOMER_ID
RUN pnpm --filter @scheduler/web build

FROM nginx:alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
