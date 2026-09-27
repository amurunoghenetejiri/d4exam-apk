import { useEffect } from "react";
import { hideSplashSafely } from "@/native/statusBar";

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
      el.style.display = "none";
      el.style.opacity = "0";
      el.style.pointerEvents = "none";
      try {
        el.remove();
      } catch {
        /* ignore */
      }
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
 * No branded loading screen — hide native + DOM splash immediately.
 */
export function AnimatedSplash(_props?: { force?: boolean }) {
  useEffect(() => {
    markSplashShown();
    removeBootSplashDom();
    void hideSplashSafely();
    const t = window.setTimeout(() => {
      removeBootSplashDom();
      void hideSplashSafely();
    }, 50);
    return () => window.clearTimeout(t);
  }, []);

  return null;
}
