"""add participant.registered

Revision ID: fabd4867cf20
Revises: b32b87ad4639
Create Date: 2026-08-11 21:38:58.712816

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = 'fabd4867cf20'
down_revision: str | None = 'b32b87ad4639'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # server_default so the column can be NOT NULL while existing rows are
    # backfilled to False — nobody has been ticked off yet. It stays on the
    # column afterwards so plain INSERTs from older code still work.
    op.add_column(
        "participants",
        sa.Column("registered", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("participants", "registered")
