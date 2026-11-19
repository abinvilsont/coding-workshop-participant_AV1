"""The Lambda package carries copies of backend/db (it can't reach outside its folder).
If this fails, run ./bin/sync-db-sql.sh and commit the result."""

from pathlib import Path

import pytest

SERVICE = Path(__file__).resolve().parents[2]
SOURCE = SERVICE.parent / "db"
PACKAGED = SERVICE / "sql"

FILES = ["schema.sql", "seed.sql"] + [f"migrations/{p.name}" for p in sorted((SOURCE / "migrations").glob("*.sql"))]


@pytest.mark.parametrize("name", FILES)
def test_packaged_copy_matches_backend_db(name):
    assert (PACKAGED / name).read_text() == (SOURCE / name).read_text(), \
        f"backend/api-service/sql/{name} is out of date: run ./bin/sync-db-sql.sh"


def test_no_stale_migrations_in_the_package():
    packaged = sorted(p.name for p in (PACKAGED / "migrations").glob("*.sql"))
    assert packaged == sorted(p.name for p in (SOURCE / "migrations").glob("*.sql"))
