"""feat: tablas InfraNetwork/InfraNode/InfraService/InfraLink (#248)

Revision ID: e5f6a7b8c9d0
Revises: b1c2d3e4f5a6
Create Date: 2026-08-02 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "e5f6a7b8c9d0"
down_revision = "b1c2d3e4f5a6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "infra_networks",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("vlan_tag", sa.Integer(), nullable=True),
        sa.Column("subnet", sa.String(), nullable=False, server_default=""),
        sa.Column("gateway", sa.String(), nullable=False, server_default=""),
        sa.Column("location", sa.String(), nullable=False, server_default=""),
    )

    op.create_table(
        "infra_nodes",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("node_type", sa.String(), nullable=False, server_default=""),
        sa.Column("location", sa.String(), nullable=False, server_default=""),
        sa.Column("parent_id", sa.String(), sa.ForeignKey("infra_nodes.id"), nullable=True),
        sa.Column("network_id", sa.String(), sa.ForeignKey("infra_networks.id"), nullable=True),
        sa.Column("ip_local", sa.String(), nullable=False, server_default=""),
        sa.Column("ip_tailscale", sa.String(), nullable=False, server_default=""),
        sa.Column("role", sa.String(), nullable=False, server_default=""),
        sa.Column("status", sa.String(), nullable=False, server_default=""),
        sa.Column("source_files", sa.JSON(), nullable=True),
    )

    op.create_table(
        "infra_services",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("node_id", sa.String(), sa.ForeignKey("infra_nodes.id"), nullable=True),
        sa.Column("category", sa.String(), nullable=False, server_default=""),
        sa.Column("description", sa.String(), nullable=False, server_default=""),
        sa.Column("domain", sa.String(), nullable=False, server_default=""),
        sa.Column("source_files", sa.JSON(), nullable=True),
    )

    op.create_table(
        "infra_links",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("source_node_id", sa.String(), sa.ForeignKey("infra_nodes.id"), nullable=False),
        sa.Column("target_node_id", sa.String(), sa.ForeignKey("infra_nodes.id"), nullable=False),
        sa.Column("kind", sa.String(), nullable=False, server_default=""),
        sa.Column("label", sa.String(), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_table("infra_links")
    op.drop_table("infra_services")
    op.drop_table("infra_nodes")
    op.drop_table("infra_networks")
