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

If a second table of DOMAIN-level metrics follows the SERP, it has one row per
distinct site in that SERP. Use it for the one thing page metrics cannot tell
you: whether a weak-looking page sits on a STRONG site or a weak one. A page
with UR 0 on a domain with thousands of referring domains is a parasite page on
an established site and behaves nothing like a standalone doorway with the same
UR 0. When a site's domain figures match its page figures, that site is
effectively a single page — itself a strong signal of a throwaway domain.

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


# Ready-made Russian variant. Offered as a "load" action in Settings, never
# applied automatically — the user's saved row always wins. Only the free-text
# `comment` follows the prompt language: `difficulty` is pinned to the English
# enum by responseSchema and the UI translates those labels itself.
DEFAULT_SERP_DIFFICULTY_PROMPT_RU = """Ты SEO-аналитик. Оцени, насколько сложно попасть в ТОП-10 по ключевому слову.

Тебе дана текущая выдача по этому запросу. Каждая строка — один результат
в порядке позиций, с метриками Ahrefs для этого точного URL:

- UR (URL Rating) — авторитет конкретной страницы. Шкала логарифмическая,
  поэтому страница с парой десятков слабых ссылок вполне может показывать 0.
- DR (Domain Rating) — авторитет всего домена.
- Ref domains — число уникальных ссылающихся доменов. Это ближайший аналог
  собственного Keyword Difficulty у Ahrefs, который считается именно по числу
  ссылающихся доменов у страниц из топ-10. Учитывай этот сигнал сильнее всего.
- Прочерк (-) означает, что Ahrefs не вернул данных по этому полю.

Если после выдачи идёт вторая таблица с метриками УРОВНЯ ДОМЕНА, в ней одна
строка на каждый сайт из выдачи. Используй её для того, чего не показывают
метрики страницы: сидит ли слабая на вид страница на СИЛЬНОМ сайте или на
слабом. Страница с UR 0 на домене с тысячами ссылающихся доменов — это
паразитная страница на авторитетном сайте, и ведёт она себя совсем не так, как
самостоятельный дорвей с тем же UR 0. Если доменные цифры сайта совпадают с
цифрами его страницы, значит сайт фактически состоит из одной страницы — сам по
себе сильный признак одноразового домена.

Как оценивать:
- Чтобы попасть в топ-10, нужно вытеснить САМЫЙ СЛАБЫЙ достижимый результат,
  а не обойти средний. Выдача с несколькими низкоавторитетными страницами
  проходима, даже если сверху стоят один-два гиганта.
- Смотри на ФОРМУ выдачи, а не только на средние: сколько там слабых мест и
  сгруппированы ли они внизу.
- Учитывай, КАКИЕ страницы ранжируются (официальные сайты брендов, партнёрки,
  форумы, новости, дорвеи/PBN). Выдача из тонких партнёрских страниц проще, чем
  из устоявшихся брендов с теми же цифрами.
- Низкие DR/UR в сочетании с большим числом ссылающихся доменов часто означают
  спам-сетку или PBN — прямо так и напиши, если это видно.

Верни ровно две вещи:
1. difficulty — одно из: low, medium, hard, too hard (именно этими словами)
2. comment — 1-3 предложения ПО-РУССКИ о нюансах ИМЕННО ЭТОЙ выдачи: что делает
   её простой или сложной и где возможность или препятствие. Конкретно, со
   ссылкой на то, что реально видно. Без общих советов и без пересказа цифр,
   которые пользователь и так видит в таблице.

Ключевое слово: {keyword}

Выдача:
{table}
"""


KEY_SERP_DIFFICULTY_DOMAIN = "prompt__serp_difficulty_domain"

# Guidance that introduces the DOMAIN-level table. Kept as its own editable
# prompt because it is only used when domain enrichment is on, and because the
# judgement it encodes (authority site vs PBN) is the part most worth tuning.
# The domain table is appended after this text, unless the text itself contains
# a {domain_table} placeholder — then it is substituted there instead.
DEFAULT_DOMAIN_PROMPT = """A second table follows with DOMAIN-level metrics — one row per distinct site in
the SERP above. Use it for the one thing page metrics cannot tell you: whether a
weak-looking page sits on a STRONG site or a weak one. A page with UR 0 on a
domain with thousands of referring domains is a parasite page on an established
site, and behaves nothing like a standalone doorway with the same UR 0.

The ORGANIC-KEYWORD columns are the clearest way to tell genuine authority sites
apart from PBN / doorway networks:

- A real site ranks for many organic keywords, spread across positions 1-3, 4-10
  and 11-20, and has organic traffic to match. It attracts links because people
  actually find and use it.
- A PBN or doorway shows the opposite signature: a HIGH referring-domain count
  combined with near-zero organic keywords and no organic traffic. Such a site
  exists to pass links, not to rank, so it never accumulates real keyword
  coverage no matter how many domains point at it.
- Treat "many referring domains + almost no organic keywords" as a strong PBN
  signal and say so in your comment. A competitor propped up by that kind of
  network is far easier to out-rank than one with the same link count backed by
  genuine keyword coverage.
- Conversely, a modest referring-domain count alongside broad keyword coverage
  (especially many keywords in positions 1-3) marks a genuinely authoritative
  site that will be hard to displace.
- When a site's domain figures match its page figures exactly, that site is
  effectively a single page — another throwaway-domain tell.
"""


# Russian counterpart, offered by the same "load Russian version" action.
DEFAULT_DOMAIN_PROMPT_RU = """Ниже идёт вторая таблица с метриками УРОВНЯ ДОМЕНА — по одной строке на каждый
сайт из выдачи выше. Используй её для того, чего не показывают метрики страницы:
сидит ли слабая на вид страница на СИЛЬНОМ сайте или на слабом. Страница с UR 0
на домене с тысячами ссылающихся доменов — это паразитная страница на
авторитетном сайте, и ведёт она себя совсем не так, как самостоятельный дорвей
с тем же UR 0.

Колонки по ОРГАНИЧЕСКИМ КЛЮЧЕВЫМ СЛОВАМ — самый надёжный способ отличить
настоящие авторитетные сайты от PBN-сеток и дорвеев:

- Настоящий сайт ранжируется по множеству органических запросов, распределённых
  по позициям 1-3, 4-10 и 11-20, и имеет соответствующий органический трафик.
  Он получает ссылки потому, что им реально пользуются.
- У PBN или дорвея картина обратная: МНОГО ссылающихся доменов при почти нулевом
  числе органических ключей и нулевом органическом трафике. Такой сайт создан
  ради передачи ссылок, а не ради ранжирования, поэтому реальный охват запросов
  у него не накапливается, сколько бы доменов на него ни ссылалось.
- Считай сочетание «много ссылающихся доменов + почти нет органических ключей»
  сильным признаком PBN и прямо пиши об этом в комментарии. Конкурента, который
  держится на такой сетке, обойти намного проще, чем сайт с тем же числом ссылок
  и реальным охватом запросов.
- И наоборот: умеренное число ссылающихся доменов при широком охвате запросов
  (особенно много ключей в позициях 1-3) означает по-настоящему авторитетный
  сайт, вытеснить который будет тяжело.
- Если доменные цифры сайта в точности совпадают с цифрами его страницы, сайт
  фактически состоит из одной страницы — ещё один признак одноразового домена.
"""


def get_domain_prompt() -> str:
    """Active domain-section guidance: user's saved version, else the default."""
    db = SessionLocal()
    try:
        return _get(db, KEY_SERP_DIFFICULTY_DOMAIN) or DEFAULT_DOMAIN_PROMPT
    finally:
        db.close()


def set_domain_prompt(value: str | None) -> None:
    """Empty/None clears the row so the built-in default applies again."""
    db = SessionLocal()
    try:
        _set(db, KEY_SERP_DIFFICULTY_DOMAIN, (value or "").strip() or None)
    finally:
        db.close()


def domain_prompt_status() -> dict:
    db = SessionLocal()
    try:
        custom = _get(db, KEY_SERP_DIFFICULTY_DOMAIN)
    finally:
        db.close()
    return {
        "domain_prompt": custom or DEFAULT_DOMAIN_PROMPT,
        "domain_is_custom": bool(custom),
        "domain_default": DEFAULT_DOMAIN_PROMPT,
        "domain_default_ru": DEFAULT_DOMAIN_PROMPT_RU,
    }


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
        "default_ru": DEFAULT_SERP_DIFFICULTY_PROMPT_RU,
        **domain_prompt_status(),
    }
