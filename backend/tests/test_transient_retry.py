"""Automatic retries of transient provider failures.

The runner retries ONLY ProviderTransientError — failures a provider marks as
intermittent (Bright Data's empty body on an active zone, an Oxylabs job that
faulted, a captcha behind a rotating proxy). Everything else must fail on the
first attempt: retrying a missing language or a disabled zone only fails the
same way, slower.
"""
import pytest

from app import tasks
from app.providers.base import (
    ProviderConfigError,
    ProviderError,
    ProviderTransientError,
)
from app.providers.brightdata import BrightDataProvider
from app.providers.oxylabs import _check_job
from app.providers.yandex_html import parse_yandex_html

VARIANT = {"keyword": "boostwin", "engine": "google"}


@pytest.fixture(autouse=True)
def no_backoff(monkeypatch):
    # The real pauses are seconds long; the logic under test is the counting.
    monkeypatch.setattr(tasks, "TRANSIENT_BACKOFF_S", (0.0, 0.0))


def scripted(monkeypatch, outcomes):
    """Replace _execute_variant with one that plays `outcomes` in order: an
    exception instance is raised, anything else is returned."""
    calls = []

    async def fake(provider, v, top_n):
        calls.append(v)
        out = outcomes[len(calls) - 1]
        if isinstance(out, Exception):
            raise out
        return out

    monkeypatch.setattr(tasks, "_execute_variant", fake)
    return calls


@pytest.mark.asyncio
class TestExecuteWithRetries:
    async def test_a_transient_failure_is_retried_until_it_answers(self, monkeypatch):
        calls = scripted(monkeypatch, [
            ProviderTransientError("empty body"),
            ProviderTransientError("empty body"),
            [{"position": 1}],
        ])
        rows, attempts = await tasks._execute_with_retries(object(), VARIANT, 10)
        assert rows == [{"position": 1}]
        assert attempts == 3
        assert len(calls) == 3

    async def test_a_first_time_answer_takes_one_attempt(self, monkeypatch):
        scripted(monkeypatch, [[]])
        rows, attempts = await tasks._execute_with_retries(object(), VARIANT, 10)
        assert (rows, attempts) == ([], 1)

    async def test_gives_up_after_the_limit_and_says_how_hard_it_tried(self, monkeypatch):
        calls = scripted(monkeypatch, [ProviderTransientError("faulted")] * 5)
        with pytest.raises(ProviderTransientError) as info:
            await tasks._execute_with_retries(object(), VARIANT, 10)
        assert len(calls) == tasks.TRANSIENT_ATTEMPTS
        assert info.value.attempts == tasks.TRANSIENT_ATTEMPTS
        assert f"failed {tasks.TRANSIENT_ATTEMPTS} times" in tasks._failure_message(info.value)

    @pytest.mark.parametrize("error", [
        ProviderError("Bright Data 400: bad request"),
        ProviderConfigError("DataForSEO needs a language"),
        ValueError("unsupported engine"),
    ])
    async def test_a_permanent_failure_is_not_retried(self, monkeypatch, error):
        calls = scripted(monkeypatch, [error, [{"position": 1}]])
        with pytest.raises(type(error)):
            await tasks._execute_with_retries(object(), VARIANT, 10)
        assert len(calls) == 1
        # No retry note on a message for something that was tried once.
        assert "retried automatically" not in tasks._failure_message(error)


class TestOxylabsJobStatus:
    def test_a_faulted_job_is_transient(self):
        # Run 97's exact shape: HTTP 200, job status 613, empty content.
        with pytest.raises(ProviderTransientError):
            _check_job({"results": [{"status_code": 613, "content": []}]}, "google 'x'")

    def test_an_unlisted_job_status_fails_without_being_retried(self):
        with pytest.raises(ProviderError) as info:
            _check_job({"results": [{"status_code": 400, "content": []}]}, "google 'x'")
        assert not isinstance(info.value, ProviderTransientError)

    @pytest.mark.asyncio
    async def test_a_fetched_but_unparsed_page_is_transient(self):
        # Measured: the same SERP parsed with 3 results, then came back 12005
        # with none minutes later — Oxylabs failing to read it that time.
        from app.providers.oxylabs import OxylabsProvider

        p = OxylabsProvider()
        await p.aclose()

        async def fake_post(body):
            return {"results": [{"status_code": 200,
                                 "content": {"parse_status_code": 12005, "results": {}}}]}

        p._post = fake_post
        with pytest.raises(ProviderTransientError):
            await p.search_google(
                keyword="boostwin", device="mobile",
                location={"canonical_name": "Uzbekistan", "country_code": "uz"},
                language="ru", google_domain="google.com", country_code="uz", top_n=10,
            )

    def test_a_fetched_job_passes(self):
        first = _check_job({"results": [{"status_code": 200, "content": {}}]}, "google 'x'")
        assert first["status_code"] == 200


class _FakeResponse:
    def __init__(self, status):
        self.status_code = 200
        self._status = status

    def json(self):
        return {"status": self._status}


class _FakeClient:
    def __init__(self, status):
        self.status = status

    async def get(self, url, headers=None):
        if self.status is None:
            raise RuntimeError("status probe failed")
        return _FakeResponse(self.status)


@pytest.mark.asyncio
class TestBrightDataEmptyBody:
    async def explain(self, status):
        p = BrightDataProvider()
        await p.aclose()
        p._client = _FakeClient(status)
        return await p._explain_empty("token", "serp_api1", "https://g/?brd_mobile=1")

    async def test_an_active_zone_is_transient(self):
        msg, transient = await self.explain("active")
        assert transient is True
        assert "although the zone is active" in msg

    async def test_a_disabled_zone_is_not(self):
        msg, transient = await self.explain("disabled")
        assert transient is False
        assert "is disabled" in msg

    async def test_an_unknown_status_is_given_the_benefit_of_a_retry(self):
        _msg, transient = await self.explain(None)
        assert transient is True


def test_a_yandex_captcha_page_is_transient():
    # Bright Data and Oxylabs rotate the exit IP per request, so a retry
    # usually arrives from an address Yandex has not flagged.
    html = "<html><head><title>Ой!</title></head><body>captcha</body></html>"
    with pytest.raises(ProviderTransientError):
        parse_yandex_html(html, 10)
