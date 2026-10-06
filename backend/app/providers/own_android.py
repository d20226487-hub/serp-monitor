"""Our own browser: runs captured outside SERP Monitor and imported into it.

This entry exists so those runs have a provider with a name and a set of
engines. It cannot be started from SERP Monitor: running such a job here fails
at once with this explanation instead of sending anything anywhere.
"""
from __future__ import annotations

from .base import ProviderConfigError, ResultRow, SerpProvider

_NOT_YET = ("Own browser (Android) runs are imported, not started here: this provider "
            "cannot be run from SERP Monitor yet.")


class OwnAndroidProvider(SerpProvider):
    name = "own_android"
    engines = frozenset({"google", "yandex"})

    async def search_google(self, **_kw) -> list[ResultRow]:
        raise ProviderConfigError(_NOT_YET)

    async def search_yandex(self, **_kw) -> list[ResultRow]:
        raise ProviderConfigError(_NOT_YET)

    async def test_credentials(self) -> dict:
        return {"ok": False, "detail": _NOT_YET}
