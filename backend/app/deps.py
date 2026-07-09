from typing import Annotated

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_sessionmaker
from app.models import Role, User
from app.security import read_session_token

SESSION_COOKIE = "frontrun_session"


def get_db():
    db = get_sessionmaker()()
    try:
        yield db
    finally:
        db.close()


DbDep = Annotated[Session, Depends(get_db)]


def get_current_user(request: Request, db: DbDep) -> User:
    token = request.cookies.get(SESSION_COOKIE)
    uid = read_session_token(token, get_settings().secret_key) if token else None
    user = db.get(User, uid) if uid is not None else None
    if user is None:
        raise HTTPException(status_code=401, detail="not authenticated")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_admin(user: CurrentUser) -> User:
    if user.role != Role.admin:
        raise HTTPException(status_code=403, detail="admin only")
    return user


def require_timer(user: CurrentUser) -> User:
    # Finish-line endpoints: both roles allowed (timer and admin).
    return user


AdminUser = Annotated[User, Depends(require_admin)]
TimerUser = Annotated[User, Depends(require_timer)]
