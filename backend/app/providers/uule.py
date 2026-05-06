"""Google UULE-v2 encoder for location targeting in Search URLs.

Format: ``w+CAIQICI<L><B64>``
  - prefix ``w+CAIQICI`` is literal (protobuf framing)
  - ``L`` is a single character whose ASCII value is ``0x20 + len(name)`` —
    valid for canonical names up to 192 bytes (covers everything SerpAPI ships)
  - ``B64`` is standard base64 of the canonical name, ``=`` padding stripped

This is the encoding Google itself accepts via ``&uule=...`` in search URLs.
SerpAPI hides this behind their ``location=`` parameter; Bright Data and any
other "raw URL" provider needs the encoded value directly.

Best-effort: if Google ever changes the format we'd need to update the prefix
and/or length encoding. Falls back to empty string for too-long names — caller
should then fall back to ``gl=<country>`` country-level targeting.
"""
from __future__ import annotations

import base64


def google_uule(canonical_name: str | None) -> str:
    name = (canonical_name or "").strip()
    if not name:
        return ""
    s = name.encode("utf-8")
    # 0x20 + len must stay in printable ASCII; 0xE0 is the upper bound.
    if len(s) >= 0xE0:
        return ""
    length_char = chr(0x20 + len(s))
    encoded = base64.b64encode(s).decode("ascii").rstrip("=")
    return f"w+CAIQICI{length_char}{encoded}"
