"""Builds the built-in hero thumbnails (32x32 RGBA each) in crates/vision/src:

- seeds.bin: from the "2D portrait" on each hero's Namu Wiki page. That art is what the TAB scoreboard
  rows show. The app composites each thumbnail onto the row's background color at run time and compares
  features, so heroes are recognized before the user teaches anything.
- bans.bin: from the hero thumbnail on Nexon's official stats page (the API's `thumbnail`). That art is
  what the banned-heroes strip at the top of the competitive TAB screen shows.
- ranks.bin: the tier emblems (owtics.gg assets, the same art as the "match rank range" emblems at the top
  right of the competitive TAB screen), trimmed to the emblem and squared.

Usage: uv run --with pillow python app/scripts/make-seeds.py
Hero ids and Korean names come from the PickGak API.
"""

import io
import json
import re
import struct
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

API = "https://pickgak.seolcu.com/api/heroes"
RANK_URL = "https://assets.owtics.gg/tier/{rank}.webp"
RANKS = ("bronze", "silver", "gold", "platinum", "emerald", "diamond", "master", "grandmaster", "champion")
WIKI = "https://namu.wiki/w/"
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36"}
# part of the 256x256 portrait that the scoreboard's inner portrait box shows (fit on a 5v5 match frame)
CROP = (0.20, 0.12, 0.74)
SIZE = 32
SRC = Path(__file__).resolve().parent.parent / "crates/vision/src"
# page titles that differ from the hero's Korean name
TITLE = {"솔저: 76": "솔저: 76", "제트팩 캣": "제트팩 캣"}


def get(url: str, referer: str | None = None) -> bytes:
    headers = dict(UA)
    if referer:
        headers["Referer"] = referer
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as r:
        return r.read()


def portrait_url(name: str) -> str | None:
    for title in (f"{name}(오버워치)", TITLE.get(name, name)):
        try:
            page = get(WIKI + urllib.parse.quote(title)).decode()
        except Exception:
            continue
        i = page.find("2D 초상화")
        if i < 0:
            continue
        m = re.search(r"(?:data-src|src)='(//i\.namu\.wiki/i/[^']+)'[^>]*?alt='[^']*초상화'", page[i : i + 30000])
        if m:
            return "https:" + m.group(1)
    return None


def write(path: Path, seeds: list[tuple[str, bytes]]) -> None:
    out = bytearray(b"PGS1" + struct.pack("<H", len(seeds)))
    for hero_id, rgba in sorted(seeds):
        b = hero_id.encode()
        out += struct.pack("<B", len(b)) + b + rgba
    path.write_bytes(bytes(out))
    print(f"{len(seeds)} seeds -> {path} ({len(out)} bytes)")


def main() -> None:
    heroes = json.loads(get(API))
    seeds, bans, missing = [], [], []
    for h in heroes:
        url = portrait_url(h["name"])
        if url:
            im = Image.open(io.BytesIO(get(url, "https://namu.wiki/"))).convert("RGBA")
            w, hgt = im.size
            x0, y0, s = CROP
            box = (round(x0 * w), round(y0 * hgt), round((x0 + s) * w), round((y0 + s) * hgt))
            seeds.append((h["hero_id"], im.crop(box).resize((SIZE, SIZE), Image.BOX).tobytes()))
        else:
            # a brand-new hero may not have a wiki page yet: it still works through teach-once
            missing.append(f"{h['hero_id']} ({h['name']})")
        # the ban strip shows the whole thumbnail (inside a red frame)
        thumb = Image.open(io.BytesIO(get(h["thumbnail"]))).convert("RGBA")
        bans.append((h["hero_id"], thumb.resize((SIZE, SIZE), Image.BOX).tobytes()))
        print(h["hero_id"], (url or "no 2D portrait")[:60])
        time.sleep(1)
    write(SRC / "seeds.bin", seeds)
    write(SRC / "bans.bin", bans)
    ranks = []
    for rank in RANKS:
        im = Image.open(io.BytesIO(get(RANK_URL.format(rank=rank)))).convert("RGBA")
        x0, y0, x1, y1 = im.getchannel("A").point(lambda a: 255 if a > 20 else 0).getbbox()
        side = max(x1 - x0, y1 - y0)
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        box = (round(cx - side / 2), round(cy - side / 2), round(cx + side / 2), round(cy + side / 2))
        ranks.append((rank, im.crop(box).resize((SIZE, SIZE), Image.BOX).tobytes()))
    write(SRC / "ranks.bin", ranks)
    if missing:
        print("WARNING: no Namu 2D portrait, not built in:", ", ".join(missing), file=sys.stderr)


if __name__ == "__main__":
    main()
