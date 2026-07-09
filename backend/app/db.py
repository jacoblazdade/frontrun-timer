from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import get_settings


class Base(DeclarativeBase):
    pass


def normalize_db_url(url: str) -> str:
    """Map Neon/Heroku-style postgres:// URLs onto the psycopg3 driver."""
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url.removeprefix("postgres://")
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url.removeprefix("postgresql://")
    return url


@lru_cache
def get_engine():
    url = normalize_db_url(get_settings().database_url)
    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    return create_engine(url, connect_args=connect_args)


@lru_cache
def get_sessionmaker():
    return sessionmaker(bind=get_engine(), expire_on_commit=False)
