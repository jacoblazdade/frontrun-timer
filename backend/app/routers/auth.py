from fastapi import APIRouter, HTTPException, Response
from sqlalchemy import select

from app.config import get_settings
from app.deps import SESSION_COOKIE, CurrentUser, DbDep
from app.models import User
from app.schemas import LoginIn, UserOut
from app.security import create_session_token, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=UserOut)
def login(body: LoginIn, response: Response, db: DbDep):
    user = db.scalar(select(User).where(User.username == body.username))
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="invalid credentials")
    settings = get_settings()
    token = create_session_token(user.id, settings.secret_key, settings.session_max_age)
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=settings.session_max_age,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )
    return user


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser):
    return user
