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

# --ignore-scripts is what keeps this fast. better-sqlite3's install script runs
# prebuild-install and then falls back to compiling the SQLite amalgamation with
# node-gyp — which needs python3/make/g++ and, on the emulated arm64 leg of the
# release build, took over 90 minutes before it was cancelled. The package
# already bundles a prebuilt binary for every platform we publish, musl arm64
# included, and node-gyp-build picks the right one at require time. So the
# compile was never buying anything.
#
# Manifests first so the dependency layer stays cached across source edits.
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

# Production dependency tree, resolved from the same lockfile as the build
# stage but without devDependencies. This is the node_modules that ships, so
# this is where better-sqlite3's bundled prebuild has to land.
FROM node:22-alpine AS deps
WORKDIR /src
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --ignore-scripts

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

# npm is a build-time tool. Nothing in this stage runs it: the entrypoint is a
# shell script, CMD calls `node` directly, and the healthcheck uses wget. It is
# not free to keep, though — npm vendors its own dependency tree, and a scan of
# this image reported 1 critical and 7 high entirely from it (tar, brace-
# expansion, ip-address, picomatch, sigstore). None were in our dependencies,
# nothing here could reach them, and they were unfixable from this side: the
# patch only lands when upstream Node bundles a newer npm, so rebuilding changed
# nothing. A permanent report of unreachable, unfixable findings against every
# published tag is how you teach yourself to ignore the scanner. Deleting it
# takes the image to zero at any severity.
#
# The build and deps stages keep their npm — this is the runtime stage only. CI
# asserts npm stays gone, because restoring it is a one-line edit in the wrong
# FROM block.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

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
