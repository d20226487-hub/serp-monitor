"""User-editable AI prompts, stored in app_settings under `prompt__*`.

Follows the Drop Sherlock convention: the DB row is the user's calibration and
is NEVER overwritten by a code deploy. Editing the default in code only changes
what a user who has never customised the prompt sees, and "Reset" is an explicit
user action — we don't silently clobber a tuned prompt.
"""
from __future__ import annotations

from ..app_settings import SessionLocal, _get, _set

KEY_SERP_DIFFICULTY = "prompt__serp_difficulty"

# Placeholders the runtime fills in. Documented here because they're the
# contract between this default and serp_difficulty.build_user_message().
#   {keyword} — the query being judged
#   {table}   — the united SERP + Ahrefs markdown table
DEFAULT_SERP_DIFFICULTY_PROMPT = """\
You are an SEO analyst judging how hard it is to rank in the TOP 10 for a keyword.

You are given the current SERP for the keyword. Each row is one ranking result,
in position order, with its Ahrefs link metrics for that exact URL:

- UR (URL Rating): authority of the specific page. Log-scaled, so a page with a
  few dozen weak links can legitimately read 0.
- DR (Domain Rating): authority of the whole domain.
- Ref domains: number of unique referring domains. This is the closest signal to
  Ahrefs' own Keyword Difficulty, which is derived from the referring-domain
  counts of the top-10 pages. Weight it heavily.
- A dash (-) means Ahrefs returned no data for that field.

How to judge:
- Ranking top 10 means displacing the WEAKEST result you can reach, not beating
  the average. A SERP with several low-authority pages is winnable even if one
  or two giants sit at the top.
- Look at the SHAPE of the SERP, not just averages: how many soft targets are
  there, and are they clustered at the bottom?
- Consider what KIND of pages rank (official brand sites, affiliates, forums,
  news, doorway/PBN pages). A SERP full of thin affiliate pages is easier than
  one full of established brands with the same raw metrics.
- Low DR/UR combined with a high referring-domain count often indicates a
  spam/PBN network — say so if you see it.

Return exactly two things:
1. difficulty — one of: low, medium, hard, too hard
2. comment — 1 to 3 sentences explaining the nuance of THIS SERP: what makes it
   easy or hard, and where the opportunity or the obstacle is. Be specific and
   reference what you actually see. No generic advice, no restating the numbers
   the user can already read in the table.

Keyword: {keyword}

SERP:
{table}
"""


def get_serp_difficulty_prompt() -> str:
    """The active prompt: the user's saved version, else the built-in default."""
    db = SessionLocal()
    try:
        return _get(db, KEY_SERP_DIFFICULTY) or DEFAULT_SERP_DIFFICULTY_PROMPT
    finally:
        db.close()


def set_serp_difficulty_prompt(value: str | None) -> None:
    """Save a custom prompt. Passing None/empty clears the row so the built-in
    default applies again — a reset, not a destructive overwrite."""
    db = SessionLocal()
    try:
        _set(db, KEY_SERP_DIFFICULTY, (value or "").strip() or None)
    finally:
        db.close()


def serp_difficulty_prompt_status() -> dict:
    db = SessionLocal()
    try:
        custom = _get(db, KEY_SERP_DIFFICULTY)
    finally:
        db.close()
    return {
        "prompt": custom or DEFAULT_SERP_DIFFICULTY_PROMPT,
        "is_custom": bool(custom),
        "default": DEFAULT_SERP_DIFFICULTY_PROMPT,
    }
