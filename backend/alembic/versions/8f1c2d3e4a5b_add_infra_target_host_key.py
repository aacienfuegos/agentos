"""add infra target host key columns

Revision ID: 8f1c2d3e4a5b
Revises: 2a005acba89e
Create Date: 2026-07-28 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = '8f1c2d3e4a5b'
down_revision: Union[str, Sequence[str], None] = '2a005acba89e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('infra_targets', sa.Column('known_hosts_entry', sa.Text(), nullable=True))
    op.add_column('infra_targets', sa.Column('host_key_fingerprint', sqlmodel.sql.sqltypes.AutoString(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('infra_targets', 'host_key_fingerprint')
    op.drop_column('infra_targets', 'known_hosts_entry')
