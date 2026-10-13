"""CSV upload: SERPs read by another tool and uploaded to a project
(see ../serp_csv.py).

This entry exists so those runs have a provider with a name and a set of
engines. There is nothing to run: starting such a job here fails at once with
this explanation instead of sending anything anywhere.
"""
from __future__ import annotations

from .base import ProviderConfigError, ResultRow, SerpProvider

_NOT_RUNNABLE = ("This job only receives uploaded CSV files: upload one on the project's page. "
                 "It cannot be run from SERP Monitor.")


class CsvUploadProvider(SerpProvider):
    name = "csv"
    engines = frozenset({"google", "yandex"})

    async def search_google(self, **_kw) -> list[ResultRow]:
        raise ProviderConfigError(_NOT_RUNNABLE)

    async def search_yandex(self, **_kw) -> list[ResultRow]:
        raise ProviderConfigError(_NOT_RUNNABLE)

    async def test_credentials(self) -> dict:
        return {"ok": False, "detail": _NOT_RUNNABLE}
