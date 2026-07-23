"""refactor: KnowledgeAgent → KnowledgeBase con instructions

Revision ID: c3d4e5f6a7b8
Revises: a1b2c3d4e5f6
Create Date: 2026-07-23 20:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "c3d4e5f6a7b8"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    existing = {row[0] for row in bind.execute(sa.text("SELECT name FROM sqlite_master WHERE type='table'")).fetchall()}

    if "knowledge_bases" in existing and "knowledge_agents" in existing:
        # Dev edge case: SQLModel already created knowledge_bases with the new schema.
        # Migrate data from knowledge_agents, then drop the old table.
        bind.execute(sa.text("""
            INSERT OR IGNORE INTO knowledge_bases (id, name, description, knowledge_path, instructions, created_at, updated_at)
            SELECT id, name, description, knowledge_path,
                   json_object(
                       'cite_verbatim', json('false'),
                       'no_recommendations', json('false'),
                       'require_source_refs', json('false'),
                       'readonly', json('false'),
                       'free_text', COALESCE(system_prompt, '')
                   ),
                   created_at, updated_at
            FROM knowledge_agents
        """))
        op.drop_table("knowledge_agents")
    else:
        # Standard path: rename and reshape.
        op.rename_table("knowledge_agents", "knowledge_bases")

        with op.batch_alter_table("knowledge_bases") as batch_op:
            batch_op.add_column(sa.Column("instructions", sa.JSON(), nullable=True))

        op.execute("""
            UPDATE knowledge_bases
            SET instructions = json_object(
                'cite_verbatim', json('false'),
                'no_recommendations', json('false'),
                'require_source_refs', json('false'),
                'readonly', json('false'),
                'free_text', COALESCE(system_prompt, '')
            )
        """)

        with op.batch_alter_table("knowledge_bases") as batch_op:
            batch_op.drop_column("system_prompt")
            batch_op.drop_column("tools")
            batch_op.drop_column("model")
            batch_op.drop_column("max_tokens")

    # Rename FK column on agent_definitions (applies both paths)
    ad_cols = {row[1] for row in bind.execute(sa.text("PRAGMA table_info(agent_definitions)")).fetchall()}
    if "knowledge_agent_id" in ad_cols and "knowledge_base_id" not in ad_cols:
        with op.batch_alter_table("agent_definitions") as batch_op:
            batch_op.add_column(sa.Column("knowledge_base_id", sa.String(), nullable=True))

        op.execute("UPDATE agent_definitions SET knowledge_base_id = knowledge_agent_id")

        with op.batch_alter_table("agent_definitions") as batch_op:
            batch_op.drop_column("knowledge_agent_id")


def downgrade() -> None:
    with op.batch_alter_table("agent_definitions") as batch_op:
        batch_op.add_column(sa.Column("knowledge_agent_id", sa.String(), nullable=True))

    op.execute("UPDATE agent_definitions SET knowledge_agent_id = knowledge_base_id")

    with op.batch_alter_table("agent_definitions") as batch_op:
        batch_op.drop_column("knowledge_base_id")

    with op.batch_alter_table("knowledge_bases") as batch_op:
        batch_op.add_column(sa.Column("system_prompt", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("tools", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("model", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("max_tokens", sa.Integer(), nullable=True))

    op.execute("""
        UPDATE knowledge_bases
        SET system_prompt = json_extract(instructions, '$.free_text'),
            tools = json_array('Read', 'Write'),
            model = 'claude-sonnet-4-6',
            max_tokens = 4096
    """)

    with op.batch_alter_table("knowledge_bases") as batch_op:
        batch_op.drop_column("instructions")

    op.rename_table("knowledge_bases", "knowledge_agents")
