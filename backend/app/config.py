import os
from dataclasses import dataclass
from functools import lru_cache


@dataclass(frozen=True)
class Settings:
    database_url: str
    secret_key: str
    session_max_age: int
    cookie_secure: bool
    static_dir: str | None


@lru_cache
def get_settings() -> Settings:
    return Settings(
        database_url=os.environ.get("DATABASE_URL", "sqlite:///./frontrun.db"),
        secret_key=os.environ.get("SECRET_KEY", "dev-secret-change-me"),
        session_max_age=int(os.environ.get("SESSION_MAX_AGE", str(12 * 3600))),
        cookie_secure=os.environ.get("COOKIE_SECURE", "0") == "1",
        static_dir=os.environ.get("STATIC_DIR"),
    )
