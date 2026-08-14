#!/bin/sh
# Step 1 of moving an existing teamledger off Postgres. Dumps every table to one
# JSON file, using the psql that already exists inside the database container —
# so this needs nothing installed on the host and no source checkout.
#
#   ./scripts/export-postgres.sh > pg-export.json
#
# Then feed that file to scripts/import-postgres.cjs. See "Upgrading from the
# Postgres version" in the README.
#
# Read-only: it takes no locks worth worrying about and changes nothing, so it
# is safe to run against a live instance.
set -e

CONTAINER="${DB_CONTAINER:-teamledger-db-1}"
USER="${PGUSER:-teamledger}"
DATABASE="${PGDATABASE:-teamledger}"

# app_schema_version and __drizzle_migrations are deliberately absent: they
# describe the *old* storage engine's migration state, and the SQLite build
# keeps its own. Importing them would make a fresh version-1 database claim to
# be at version 5 and trip the downgrade guard on the next boot.
TABLES="admin_users teams players seasons trainers season_players ical_feeds events cost_rules tournaments event_charges bank_accounts bank_transactions expenses credits player_credits payments trainer_payments"

PARTS=""
for t in $TABLES; do
  [ -n "$PARTS" ] && PARTS="$PARTS,"
  PARTS="$PARTS'$t', (select coalesce(json_agg(row_to_json(x)), '[]'::json) from $t x)"
done

exec docker exec -i "$CONTAINER" \
  psql -U "$USER" -d "$DATABASE" -tAc "select json_build_object($PARTS)"
