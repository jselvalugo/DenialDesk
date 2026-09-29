# Production image for Azure (ADR 0002). Next.js standalone output, non-root user.
# The base is pinned by digest (SC-A4.2, SC-B12.3): the multi-platform index for node:24-alpine,
# Node.js 24.21.0 (built 2026-09-17). Dependabot's docker ecosystem proposes digest updates. pnpm is
# fetched by corepack from the version and sha512 in package.json's packageManager, and corepack
# refuses a tarball whose hash differs.
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV BUILD_STANDALONE=1 NEXT_TELEMETRY_DISABLED=1
# SC-B12.3: server source maps never reach the runtime image.
RUN pnpm build && find .next/standalone -name '*.map' -delete

FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
# SC-B12.3: the runtime needs only node. Remove the package managers the base image ships (npm,
# corepack, yarn, and Alpine's apk binary). Keep /lib/apk/db and /etc/apk: container scanners and
# SBOM tools read the installed-package list from them (SC-B12.1, SC-B12.2).
RUN addgroup -S app && adduser -S app -G app \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-v* \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn \
      /usr/local/bin/yarnpkg /sbin/apk /var/cache/apk
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3000
CMD ["node", "server.js"]
