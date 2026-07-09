"""Admin CLI. There is no self-registration; users are created here.

    uv run python -m app.cli create-user alice --role admin
    uv run python -m app.cli seed

Run `uv run alembic upgrade head` first so the tables exist.
"""

import argparse
import getpass

from sqlalchemy import select

from app.db import get_sessionmaker
from app.models import Role, User
from app.security import hash_password
from app.seed import seed


def create_user(username: str, password: str | None, role: str) -> None:
    if not password:
        password = getpass.getpass(f"password for {username}: ")
    db = get_sessionmaker()()
    try:
        user = db.scalar(select(User).where(User.username == username))
        if user is None:
            db.add(User(username=username, password_hash=hash_password(password), role=Role(role)))
            print(f"created user {username!r} with role {role}")
        else:
            user.password_hash = hash_password(password)
            user.role = Role(role)
            print(f"updated password/role for existing user {username!r}")
        db.commit()
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(prog="frontrun", description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_user = sub.add_parser("create-user", help="create a user or reset their password")
    p_user.add_argument("username")
    p_user.add_argument("--role", choices=[r.value for r in Role], default="admin")
    p_user.add_argument("--password", help="omit to be prompted securely")

    sub.add_parser("seed", help="create the demo event, races, participants and users")

    args = parser.parse_args()
    if args.cmd == "create-user":
        create_user(args.username, args.password, args.role)
    elif args.cmd == "seed":
        seed()


if __name__ == "__main__":
    main()
