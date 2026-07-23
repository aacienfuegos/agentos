"""add_run_type

Revision ID: a1b2c3d4e5f6
Revises: 5c19b2e4e686
Create Date: 2026-07-23 18:30:00.000000

Adds run_type to separate what kind of run it is (agent/chat/knowledge/execute)
from triggered_by which now only records the real origin (manual/schedule/api).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = '5c19b2e4e686'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('runs', schema=None) as batch_op:
        batch_op.add_column(sa.Column('run_type', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default='agent'))

    # Backfill run_type from existing data, then fix triggered_by
    conn = op.get_bind()

    # knowledge agent runs (agent_id starts with "knowledge:")
    conn.execute(sa.text(
        "UPDATE runs SET run_type = 'knowledge' WHERE agent_id LIKE 'knowledge:%'"
    ))

    # external API execute runs
    conn.execute(sa.text(
        "UPDATE runs SET run_type = 'execute' WHERE agent_id = '__execute__'"
    ))

    # chat follow-up runs (triggered_by="chat" and not a knowledge run)
    conn.execute(sa.text(
        "UPDATE runs SET run_type = 'chat' WHERE triggered_by = 'chat' AND agent_id NOT LIKE 'knowledge:%'"
    ))

    # triggered_by="chat" was the type, not the origin — real origin was always manual
    conn.execute(sa.text(
        "UPDATE runs SET triggered_by = 'manual' WHERE triggered_by = 'chat'"
    ))


def downgrade() -> None:
    # Restore triggered_by="chat" for what were chat runs
    conn = op.get_bind()
    conn.execute(sa.text(
        "UPDATE runs SET triggered_by = 'chat' WHERE run_type = 'chat'"
    ))

    with op.batch_alter_table('runs', schema=None) as batch_op:
        batch_op.drop_column('run_type')
