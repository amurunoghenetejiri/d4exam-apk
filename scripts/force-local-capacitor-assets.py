#!/usr/bin/env python3
"""
Configure Capacitor Android assets for hybrid APK:

  UI / menu / deep links  → live site (Vercel / d4exam.name.ng)
  Permissions / biometrics / notifications / screen share → native Capacitor plugins

server.url loads the production website inside the WebView so menus and pages
match the live site. Native plugins (D4NativeAuth, D4ScreenShare, Capgo, etc.)
still run in the APK process and can request real OS permissions.
"""
from __future__ import annotations

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
CFG = ROOT / "android" / "app" / "src" / "main" / "assets" / "capacitor.config.json"

LIVE_URL = "https://d4exam-platform.vercel.app"


def main() -> int:
    if not CFG.exists():
        print("WARN: no assets capacitor.config.json yet (run cap sync first)")
        return 0

    d = json.loads(CFG.read_text(encoding="utf-8"))
    server = dict(d.get("server") or {})

    server["url"] = LIVE_URL
    server["androidScheme"] = "https"
    server["cleartext"] = False
    server["errorPath"] = "offline.html"
    # Hostname kept for local asset fallback when offline
    server["hostname"] = "localhost"
    server["allowNavigation"] = [
        "d4exam.name.ng",
        "*.d4exam.name.ng",
        "d4exam-platform.vercel.app",
        "*.vercel.app",
        "*.supabase.co",
        "*.googleapis.com",
        "*.gstatic.com",
        "*.firebaseio.com",
        "*.firebasestorage.app",
        "*.firebaseapp.com",
        "localhost",
    ]

    d["server"] = server
    d["webDir"] = "dist"
    d["appId"] = d.get("appId") or "com.d4exam.app"
    d["appName"] = d.get("appName") or "D4EXAM"

    CFG.write_text(json.dumps(d, indent=2) + "\n", encoding="utf-8")
    print("OK: hybrid APK — server.url =", LIVE_URL, "+ native plugins")
    return 0


if __name__ == "__main__":
    sys.exit(main())
