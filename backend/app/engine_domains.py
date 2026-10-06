"""Which Yandex domain a search for a country goes to.

One table for both places that need it: where an API provider's Yandex request
is built (tasks._execute_variant), and where an export has to say which domain
a stored Yandex row came from. Results only have a `google_domain` column, and
API-provider Yandex rows leave it empty — the domain was never stored, but it
is exactly this table's answer for the row's country, so it can be named.

Our own browser (provider own_android) does not use this table: it enters
through ya.ru, which keeps Russia and Kyrgyzstan on ya.ru and sends Kazakhstan
and Uzbekistan to yandex.kz / yandex.uz. Its rows store the domain the saved
page itself reports, so they never need this fallback.
"""
from __future__ import annotations

YANDEX_BY_COUNTRY = {
    "ru": "yandex.ru", "by": "yandex.by", "kz": "yandex.kz",
    "uz": "yandex.uz", "tr": "yandex.com.tr",
}


def yandex_domain_for(country_code: str | None) -> str:
    """Countries without a Yandex of their own (Kyrgyzstan: yandex.kg has no
    DNS) are asked on yandex.com."""
    return YANDEX_BY_COUNTRY.get((country_code or "").lower(), "yandex.com")
