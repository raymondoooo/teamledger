# teamledger is a TypeScript workspace monorepo: server compiles to server/dist
# and web is a Vite bundle. The runtime image carries only the compiled output
# plus production dependencies, which keeps the published image small enough to
# be a reasonable download for people self-hosting it from GitHub.
#
# ── Every stage is node:22-alpine, and they must not drift ──────────────────
# better-sqlite3 is a native module compiled against a specific Node ABI. The
# final stage copies node_modules wholesale from `deps`, so the .node binary
# built there has to match the Node that will load it here. Bumping one stage
# and not the others produces an image that builds cleanly and then dies on the
# first query with NODE_MODULE_VERSION mismatch. That is the rule to respect
# here: bump all three together or none.
#
# 22 is a floor, not a hard ceiling — the dependabot PR moving all three stages
# to 26 passes the full container suite, SQLite tests included. Bump only via a
# PR that runs that suite, because a Node bump has to be proven against the
# RUNNING container, not just a successful build.

FROM node:22-alpine AS build
WORKDIR /src

# better-sqlite3's install script falls back to node-gyp, so `npm ci` fails on
# Alpine without a compiler even though the package bundles a musl prebuild.
# Verified by removing it: the build dies at `npm ci`. None of this reaches the
# final image; see the runtime stage below.
RUN apk add --no-cache python3 make g++

# Manifests first so the dependency layer stays cached across source edits.
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci

COPY . .
RUN npm run build

# Production dependency tree, resolved from the same lockfile as the build
# stage but without devDependencies. This is the node_modules that ships, so
# this is where better-sqlite3's binary is actually built.
FROM node:22-alpine AS deps
WORKDIR /src
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev

FROM node:22-alpine
WORKDIR /app

# Links the image back to its source, so anyone who pulls it can find the repo
# and the licence without guessing. docker/metadata-action adds the dynamic
# labels (version, revision, created) at publish time; these are the static ones
# that should be right even for a local build.
LABEL org.opencontainers.image.title="teamledger" \
      org.opencontainers.image.description="Self-hosted treasury for a youth sports team" \
      org.opencontainers.image.source="https://github.com/raymondoooo/teamledger" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later"

# su-exec drops privileges in the entrypoint (~20KB, unlike sudo/gosu).
#
# font-dejavu is for the PDF exports. pdfkit's built-in Helvetica is WinAnsi
# only, so any name outside Latin-1 — Łukasz, Ольга, 李 — rendered as mojibake
# in a document emailed to a parent, with no error to show for it. Only the two
# faces actually used are kept; the full package is ~10MB.
RUN apk add --no-cache su-exec font-dejavu \
 && mkdir -p /app/fonts \
 && cp /usr/share/fonts/dejavu/DejaVuSans.ttf /usr/share/fonts/dejavu/DejaVuSans-Bold.ttf /app/fonts/ \
 && apk del font-dejavu

# server/src/index.ts resolves web-dist, and drizzle's migrator resolves
# ./migrations, relative to process.cwd() — so both sit beside dist/ at the
# WORKDIR root rather than keeping their in-repo paths.
COPY --from=deps /src/node_modules ./node_modules
COPY --from=build /src/server/dist ./dist
COPY --from=build /src/web/dist ./web-dist
COPY server/migrations ./migrations
# The one-time Postgres importer. Shipped in the image because after this port
# there is no reason for anyone to have a source checkout — the upgrade path has
# to work with nothing but the compose file. See the README.
COPY scripts/import-postgres.cjs ./scripts/import-postgres.cjs
# Carries "type": "module", without which Node would load dist/ as CommonJS.
COPY server/package.json ./package.json

# Created here so a fresh *named* volume inherits the right ownership. A bind
# mount will not — the entrypoint fixes that case at runtime, because Docker
# creates a missing host directory as root and this chown would be masked.
RUN mkdir -p /app/data/receipts && chown -R node:node /app/data

# NOTE: no `USER node` here. The entrypoint has to start as root to chown the
# mounted volume, and drops to `node` via su-exec before exec'ing the app.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3212

# Hits an endpoint that actually queries the database. A process that is up but
# cannot read its own datastore is not healthy, and a plain port check would
# happily call that fine.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:${PORT:-3212}/api/health || exit 1

# Drizzle records applied migrations in its own table, so re-running on every
# boot is a no-op once they're applied — and a brand-new database sets itself up
# without a manual step. This is what makes `docker compose up` a complete
# install for someone who just cloned the repo.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
