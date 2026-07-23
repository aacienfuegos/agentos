#!/bin/sh
set -e

# Strip sqlite:/// prefix to get the filesystem path (handles both /// and ////)
DB_PATH="${DATABASE_URL#sqlite:///}"

# One-time transition for DBs that pre-date Alembic: if the DB file already
# exists with data but no alembic_version table, apply all legacy column
# migrations column-by-column before stamping head — so Alembic takes over
# from a complete schema regardless of which intermediate state the DB is in.
if [ -f "$DB_PATH" ]; then
  python3 - "$DB_PATH" <<'PYEOF' || uv run alembic stamp head
import sqlite3, sys

conn = sqlite3.connect(sys.argv[1])
tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}

# Already Alembic-managed or empty DB — nothing to do
if "alembic_version" in tables or "runs" not in tables:
    conn.close()
    sys.exit(0)

# Full list of columns added by the manual _run_migrations() system, in order.
# Hardcoded here intentionally: this is a closed historical list, not a live mechanism.
migrations = [
    ("knowledge_agents", "max_tokens", "INTEGER NOT NULL DEFAULT 4096"),
    ("runs", "session_id", "TEXT"),
    ("knowledge_agents", "web_access", "INTEGER NOT NULL DEFAULT 0"),
    ("knowledge_agents", "write_access", "INTEGER NOT NULL DEFAULT 1"),
    ("knowledge_agents", "tools", 'TEXT DEFAULT \'["Read","Write"]\''),
    ("knowledge_agents", "knowledge_path", "TEXT NOT NULL DEFAULT ''"),
    ("runs", "tokens_cache_read", "INTEGER"),
    ("runs", "tokens_cache_write", "INTEGER"),
    ("agent_definitions", "knowledge_agent_id", "TEXT"),
]

for table, column, definition in migrations:
    existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
    if column not in existing:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
        conn.commit()

conn.execute(
    "UPDATE knowledge_agents SET knowledge_path = '/data/knowledge/' || id "
    "WHERE knowledge_path = '' OR knowledge_path IS NULL"
)
conn.commit()
conn.close()
sys.exit(1)
PYEOF
fi

uv run alembic upgrade head
exec "$@"
