#!/usr/bin/env python3
"""
Configure Capacitor Android assets for a 100% STANDALONE local APK.

- Loads UI from bundled dist/ via https://localhost (NO server.url / NO Vercel)
- Native plugins (biometric, splash, push, screen share) still work
- errorPath = index.html so SPA deep links work offline
"""
from __future__ import annotations

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
CFG = ROOT / "android" / "app" / "src" / "main" / "assets" / "capacitor.config.json"


def main() -> int:
    if not CFG.exists():
        print("WARN: no assets capacitor.config.json yet (run cap sync first)")
        return 0

    d = json.loads(CFG.read_text(encoding="utf-8"))
    server = dict(d.get("server") or {})

    # CRITICAL: never inject a remote website shell
    server.pop("url", None)
    server["androidScheme"] = "https"
    server["cleartext"] = False
    server["hostname"] = "localhost"
    server["errorPath"] = "index.html"
    server["allowNavigation"] = [
        "*.supabase.co",
        "*.googleapis.com",
        "*.gstatic.com",
        "*.firebaseio.com",
        "*.firebasestorage.app",
        "*.firebaseapp.com",
        "localhost",
    ]

    d["server"] = server

    plugins = dict(d.get("plugins") or {})
    plugins["SplashScreen"] = {
        "launchShowDuration": 0,
        "launchAutoHide": False,
        "backgroundColor": "#0b1b3a",
        "androidSplashResourceName": "splash",
        "androidScaleType": "CENTER",
        "showSpinner": False,
        "splashFullScreen": True,
        "splashImmersive": True,
        "launchFadeOutDuration": 250,
    }
    d["plugins"] = plugins
    d["webDir"] = "dist"
    d["appId"] = d.get("appId") or "com.d4exam.app"
    d["appName"] = d.get("appName") or "D4EXAM"

    CFG.write_text(json.dumps(d, indent=2) + "\n", encoding="utf-8")

    if "url" in (d.get("server") or {}):
        print("FATAL: server.url still present after force-local")
        return 1
    print("OK: standalone APK — webDir=dist, hostname=localhost, NO server.url")
    return 0


if __name__ == "__main__":
    sys.exit(main())
