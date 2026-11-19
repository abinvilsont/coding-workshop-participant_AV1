"""A paused Aurora drops new connections while it wakes; the API retries instead of failing."""

import psycopg
import pytest

from app.core import config
from app.db.session import connect_with_retry


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


def flaky(failures):
    calls = []

    def connect(**kwargs):
        calls.append(kwargs)
        if len(calls) <= failures:
            raise psycopg.OperationalError("server closed the connection unexpectedly")
        return "connection"
    return connect, calls


def test_retries_while_the_database_wakes(monkeypatch):
    monkeypatch.setattr(config, "DB_WAKE_SECONDS", 25)
    clock = Clock()
    connect, calls = flaky(failures=3)
    assert connect_with_retry(connect, clock.sleep, clock) == "connection"
    assert len(calls) == 4 and clock.now == 6  # three 2-second waits
    assert calls[0]["sslmode"] == config.DB_SSLMODE and calls[0]["connect_timeout"] == config.DB_CONNECT_TIMEOUT


def test_gives_up_after_the_wake_window(monkeypatch):
    monkeypatch.setattr(config, "DB_WAKE_SECONDS", 5)
    clock = Clock()
    connect, calls = flaky(failures=100)
    with pytest.raises(psycopg.OperationalError):
        connect_with_retry(connect, clock.sleep, clock)
    assert len(calls) == 4  # tries at 0, 2, 4 and 6 s, then gives up


def test_locally_a_down_database_fails_at_once(monkeypatch):
    monkeypatch.setattr(config, "DB_WAKE_SECONDS", 0)
    clock = Clock()
    connect, calls = flaky(failures=1)
    with pytest.raises(psycopg.OperationalError):
        connect_with_retry(connect, clock.sleep, clock)
    assert len(calls) == 1
