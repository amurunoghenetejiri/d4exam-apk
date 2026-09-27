import { useEffect } from "react";
import { hideSplashSafely } from "@/native/statusBar";
import { isNativeShell } from "@/native/platform";

/** Marks splash already dismissed for this app process / tab session. */
const SESSION_KEY = "d4exam_splash_shown_v6";

function markSplashShown(): void {
  try {
    sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    /* ignore */
  }
}

function removeBootSplashDom(): void {
  try {
    const el = document.getElementById("d4-boot-splash");
    if (el) {
      el.style.opacity = "0";
      el.style.pointerEvents = "none";
      el.style.display = "none";
      window.setTimeout(() => {
        try {
          el.remove();
        } catch {
          /* ignore */
        }
      }, 180);
    }
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new Event("d4-hide-boot-splash"));
  } catch {
    /* ignore */
  }
}

/**
 * Splash controller.
 * APK: keep full branded #d4-boot-splash (logo + D4EXAM + slogan) visible
 * for a short minimum time, then fade — never show a white icon tile.
 * Web: tear down quickly (web uses its own light loader class).
 */
export function AnimatedSplash(_props?: { force?: boolean }) {
  useEffect(() => {
    const native = isNativeShell();
    const minMs = native ? 1800 : 120;
    const t = window.setTimeout(() => {
      markSplashShown();
      removeBootSplashDom();
      void hideSplashSafely();
    }, minMs);
    // Hard fallback so splash never sticks
    const hard = window.setTimeout(() => {
      markSplashShown();
      removeBootSplashDom();
      void hideSplashSafely();
    }, native ? 4500 : 2000);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(hard);
    };
  }, []);

  return null;
}
