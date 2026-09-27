#!/usr/bin/env python3
"""Generate D4EXAM native Android splash: navy + centered logo."""
from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("Pillow required", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "android" / "app" / "src" / "main" / "res"
NATIVE = ROOT / "native-android" / "app" / "src" / "main" / "res"
NAVY = (11, 27, 58, 255)
LOGO_SRC = ROOT / "public" / "logo.png"


def write_logo(dest: Path, size: int, src: Image.Image) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    fg = src.copy()
    fg.thumbnail((size, size), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    off = ((size - fg.size[0]) // 2, (size - fg.size[1]) // 2)
    canvas.paste(fg, off, fg)
    canvas.save(dest, format="PNG", optimize=True)


def main() -> None:
    if not LOGO_SRC.is_file():
        print("WARN: public/logo.png missing", file=sys.stderr)
        sys.exit(0)
    logo = Image.open(LOGO_SRC).convert("RGBA")

    splash_xml = """<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@color/splash_background" />
    <item
        android:width="160dp"
        android:height="160dp"
        android:gravity="center"
        android:drawable="@drawable/d4exam_splash_logo" />
</layer-list>
"""
    blank_xml = """<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="@color/splash_background" />
</shape>
"""

    for base in (RES, NATIVE):
        if not base.parent.exists() and base == RES:
            continue
        drawable = base / "drawable"
        drawable.mkdir(parents=True, exist_ok=True)
        (drawable / "splash.xml").write_text(splash_xml, encoding="utf-8")
        (drawable / "splash_blank.xml").write_text(blank_xml, encoding="utf-8")
        for name in ("splash.png", "splash_blank.png"):
            p = drawable / name
            if p.is_file():
                p.unlink()
        write_logo(drawable / "d4exam_splash_logo.png", 420, logo)
        for dens, px in [
            ("mdpi", 140),
            ("hdpi", 210),
            ("xhdpi", 280),
            ("xxhdpi", 420),
            ("xxxhdpi", 560),
        ]:
            write_logo(base / f"drawable-{dens}" / "d4exam_splash_logo.png", px, logo)
        print("splash assets →", base)

    print("OK: navy + logo splash")


if __name__ == "__main__":
    main()
