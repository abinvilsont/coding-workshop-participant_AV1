"""SQLAlchemy engine and session factory for PostgreSQL (psycopg 3 driver)."""

import logging
import time
from collections.abc import Iterator

import psycopg
from sqlalchemy import create_engine
from sqlalchemy.engine import URL
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core import config

DATABASE_URL = URL.create(
    "postgresql+psycopg",
    username=config.POSTGRES_USER,
    password=config.POSTGRES_PASS,
    host=config.POSTGRES_HOST,
    port=config.POSTGRES_PORT,
    database=config.POSTGRES_NAME,
)

# Module-level engine: its pool survives across warm Lambda invocations.
# Pool size depends on how the app runs (see config.DB_POOL_SIZE): a Lambda
# instance serves one request at a time, a long-running server up to 40.
log = logging.getLogger(__name__)


def connect_with_retry(connect=psycopg.connect, sleep=time.sleep, clock=time.monotonic):
    """Open a database connection, retrying for up to DB_WAKE_SECONDS.

    Aurora Serverless v2 pauses after 5 idle minutes; while it resumes, new
    connections are dropped. Without this the first request after a quiet spell
    would fail. Locally DB_WAKE_SECONDS is 0, so a down database fails at once.
    """
    deadline = clock() + config.DB_WAKE_SECONDS
    attempt = 0
    while True:
        attempt += 1
        try:
            return connect(
                host=config.POSTGRES_HOST, port=config.POSTGRES_PORT, user=config.POSTGRES_USER,
                password=config.POSTGRES_PASS, dbname=config.POSTGRES_NAME,
                connect_timeout=config.DB_CONNECT_TIMEOUT, sslmode=config.DB_SSLMODE,
            )
        except psycopg.OperationalError:
            if clock() >= deadline:
                raise
            log.warning("Database not ready (attempt %d), retrying - Aurora may be waking up", attempt)
            sleep(2)


engine = create_engine(
    DATABASE_URL,
    creator=connect_with_retry,
    pool_pre_ping=True,
    pool_size=config.DB_POOL_SIZE,
    max_overflow=config.DB_MAX_OVERFLOW,
    pool_timeout=config.DB_POOL_TIMEOUT,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    """Base class for ORM models. Tables are created by backend/db/schema.sql."""


def get_db() -> Iterator[Session]:
    """FastAPI dependency: one session (and transaction) per request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
