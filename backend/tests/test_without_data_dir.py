"""The app's modules must import, and a query must go out, with no data directory.

CI runs the tests with no /data at all. A module that opens its database at
import time then fails to import and takes down every test that imports it —
which is how the first push of provider_locations.py broke CI while the same
tests passed on a machine that has the directory. Each check runs in its own
interpreter, pointed at a database path that cannot exist.
"""
import os
import subprocess
import sys
from pathlib import Path

import app

BACKEND = Path(app.__file__).resolve().parents[1]

# Everything that reaches the locations mirror or the connected tools.
MODULES = ("app.providers", "app.provider_locations", "app.proxy_checker", "app.routers.tools",
           "app.routers.locations")


def _run(code: str, tmp_path) -> subprocess.CompletedProcess:
    missing = (tmp_path / "no_such_dir" / "serp.db").as_posix()
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{missing}", "PYTHONPATH": str(BACKEND)}
    return subprocess.run([sys.executable, "-c", code], env=env, cwd=BACKEND, capture_output=True, text=True)


def test_modules_import_with_a_database_path_that_cannot_exist(tmp_path):
    r = _run("import importlib\n" + "".join(f"importlib.import_module({m!r})\n" for m in MODULES), tmp_path)
    assert r.returncode == 0, r.stderr[-800:]


def test_a_run_gets_no_list_rather_than_an_error_when_the_mirror_cannot_be_opened(tmp_path):
    # (None, False) = "no entry, and no list to look in": the provider then
    # sends the stored name, as it did before there was a mirror.
    r = _run(
        "from app.provider_locations import location_for\n"
        "for p in ('dataforseo', 'brightdata', 'oxylabs'):\n"
        "    got = location_for(p, {'canonical_name': 'Uzbekistan', 'country_code': 'uz'})\n"
        "    assert got == (None, False), (p, got)\n",
        tmp_path,
    )
    assert r.returncode == 0, r.stderr[-800:]
