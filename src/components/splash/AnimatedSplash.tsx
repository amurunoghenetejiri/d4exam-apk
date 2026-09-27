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
      el.style.transition = "opacity 0.28s ease-out";
      window.setTimeout(() => {
        try {
          el.style.display = "none";
          el.remove();
        } catch {
          /* ignore */
        }
      }, 280);
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
 * D4EXAM branding splash controller.
 * Native APK: show navy logo + D4EXAM + slogan for a short time, then fade.
 * Web: dismiss quickly (light loader only if boot script showed it).
 */
export function AnimatedSplash(_props?: { force?: boolean }) {
  useEffect(() => {
    const native = isNativeShell();
    // Branding moment on app open (~2.2s); never leave it stuck
    const minMs = native ? 2200 : 400;
    const hardMs = native ? 5000 : 2500;
    const t = window.setTimeout(() => {
      markSplashShown();
      removeBootSplashDom();
      void hideSplashSafely();
    }, minMs);
    const hard = window.setTimeout(() => {
      markSplashShown();
      removeBootSplashDom();
      void hideSplashSafely();
    }, hardMs);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(hard);
    };
  }, []);

  return null;
}
