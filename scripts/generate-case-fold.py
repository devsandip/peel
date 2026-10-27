"""Generate the shared case-fold table from Python's pinned Unicode database.

Run with Python 3.14 (Unicode 16.0.0). Unicode data is used under the Unicode
Data Files and Software License: https://www.unicode.org/license.txt.
The generated table is versioned so all clients use the same mappings.
"""
import json
import unicodedata
from pathlib import Path

mapping = {chr(i): chr(i).casefold() for i in range(0x110000) if chr(i).casefold() != chr(i)}
target = Path(__file__).parent.parent / "packages/core/src/unicode-case-fold.ts"
target.write_text(f"// Generated Unicode {unicodedata.unidata_version} full case folding. See scripts/generate-case-fold.py.\nexport const caseFolds: Record<string, string> = " + json.dumps(mapping, ensure_ascii=True, separators=(",", ":")) + ";\n")
