// Google UULE-v2 encoder — JS port of backend/app/providers/uule.py.
// Used by the Settings UI to display the exact `uule=` value Bright Data
// Google will receive for a saved location, so the user can verify what's
// being sent without reading server-side code.
//
// Format: "w+CAIQICI" + length_char + base64(name)
// where length_char = String.fromCharCode(0x20 + utf8_byte_length).
// Names ≥ 0xE0 bytes (~224) skip uule and rely on `gl=` country fallback.

export function googleUule(canonicalName: string | null | undefined): string {
  const name = (canonicalName ?? "").trim();
  if (!name) return "";
  // UTF-8 byte length (canonical names with Cyrillic chars are multi-byte)
  const utf8 = new TextEncoder().encode(name);
  if (utf8.length >= 0xe0) return "";
  const lengthChar = String.fromCharCode(0x20 + utf8.length);
  // base64 in browsers: btoa works on binary strings only, so feed it the
  // utf-8 bytes converted via String.fromCharCode (binary-safe for our values).
  let bin = "";
  for (let i = 0; i < utf8.length; i++) bin += String.fromCharCode(utf8[i]);
  const encoded = btoa(bin).replace(/=+$/, "");
  return `w+CAIQICI${lengthChar}${encoded}`;
}
