#!/bin/sh
set -e

# Strip sqlite:/// prefix to get the filesystem path (handles both /// and ////)
DB_PATH="${DATABASE_URL#sqlite:///}"

# One-time transition for DBs that pre-date Alembic: if the DB file already
# exists with data but no alembic_version table, stamp it at head so Alembic
# knows the schema is current and doesn't try to recreate existing tables.
if [ -f "$DB_PATH" ]; then
  python -c "
import sqlite3, sys
conn = sqlite3.connect(sys.argv[1])
tables = {r[0] for r in conn.execute(\"SELECT name FROM sqlite_master WHERE type='table'\")}
conn.close()
sys.exit(0 if 'alembic_version' in tables or 'runs' not in tables else 1)
" "$DB_PATH" || uv run alembic stamp head
fi

uv run alembic upgrade head
exec "$@"
