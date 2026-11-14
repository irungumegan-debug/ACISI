"""
Builds src/assets/icd11/icd11-mms-2025-01.json from WHO's official ICD-11 MMS
"Simple Tabulation" (English), release 2025-01:
  https://icdcdn.who.int/static/releasefiles/2025-01/SimpleTabulation-ICD-11-MMS-en.zip

Keeps the coded categories of chapters 01-25 (diagnoses). Leaves out chapter
26 (traditional medicine), V (functioning) and X (extension codes). Codes and
titles are kept exactly as WHO publishes them (only the depth dashes WHO puts
in front of titles in this file are removed).

ICD-11 (c) World Health Organization, licensed under CC BY-ND 3.0 IGO.

Usage: python3 -I scripts/buildIcd11Data.py <path to SimpleTabulation-ICD-11-MMS-en.txt>
"""
import csv
import json
import re
import sys

KEEP_CHAPTERS = {f"{n:02d}" for n in range(1, 26)}

rows = csv.DictReader(open(sys.argv[1], encoding="utf-8-sig"), delimiter="\t")
codes = []
for r in rows:
    if r["ClassKind"] != "category" or not r["Code"] or r["ChapterNo"] not in KEEP_CHAPTERS:
        continue
    title = re.sub(r"^(- )+", "", r["Title"].strip().strip('"')).strip()
    codes.append({"c": r["Code"], "t": title, "ch": r["ChapterNo"], "leaf": r["isLeaf"] == "True"})

out = {
    "source": "WHO ICD-11 for Mortality and Morbidity Statistics (MMS), release 2025-01, Simple Tabulation (English)",
    "license": "ICD-11 (c) World Health Organization, CC BY-ND 3.0 IGO. Codes and titles unmodified.",
    "system": "http://id.who.int/icd/release/11/mms",
    "count": len(codes),
    "codes": codes,
}
json.dump(out, open("src/assets/icd11/icd11-mms-2025-01.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(len(codes), "codes written")
