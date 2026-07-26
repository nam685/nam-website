#!/bin/bash
# Installs our hardened pg_hba.conf after initdb generates the default one.
# Runs once, only on first-time initialization of a fresh data volume --
# docker-entrypoint-initdb.d scripts are skipped entirely on existing data
# dirs. See infra/pg_hba.conf and GitHub issue #298 for why.
set -e
cp /docker-entrypoint-initdb.d/pg_hba.conf "$PGDATA/pg_hba.conf"
