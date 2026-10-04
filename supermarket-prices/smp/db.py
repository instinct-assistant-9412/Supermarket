from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from .config import settings

_engine = None
_Session = None


def get_engine(url: str | None = None):
    global _engine, _Session
    if _engine is None or url:
        _engine = create_engine(url or settings.database_url, pool_pre_ping=True, future=True)
        _Session = sessionmaker(_engine, expire_on_commit=False)
    return _engine


@contextmanager
def session_scope():
    get_engine()
    s = _Session()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()


def get_session():
    """FastAPI dependency."""
    get_engine()
    s = _Session()
    try:
        yield s
    finally:
        s.close()
