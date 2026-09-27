import { useEffect } from "react";
import { hideSplashSafely } from "@/native/statusBar";
import { isNativeShell } from "@/native/platform";

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
      el.style.transition = "opacity 0.32s ease-out";
      el.style.opacity = "0";
      el.style.pointerEvents = "none";
      window.setTimeout(() => {
        try {
          el.style.display = "none";
          el.remove();
        } catch {
          /* ignore */
        }
      }, 320);
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

function dismissAll(): void {
  markSplashShown();
  removeBootSplashDom();
  void hideSplashSafely();
  try {
    // Restore page background after branded splash (content routes handle their own bg)
    if (!isNativeShell()) {
      document.body.style.backgroundColor = "";
      document.documentElement.style.backgroundColor = "";
    } else {
      document.body.style.backgroundColor = "#0b1b3a";
    }
  } catch {
    /* ignore */
  }
}

/**
 * Keep the exact branded splash visible while the app shell loads in the background.
 * Dismiss only after min branding time AND document is interactive / React mounted,
 * with a hard cap so it never sticks forever.
 */
export function AnimatedSplash(_props?: { force?: boolean }) {
  useEffect(() => {
    const native = isNativeShell();
    const minMs = native ? 1800 : 350;
    const hardMs = native ? 10000 : 3000;
    const started = Date.now();
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      const wait = Math.max(0, minMs - (Date.now() - started));
      window.setTimeout(() => dismissAll(), wait);
    };

    // App considered "loaded enough" when DOM is complete and first paint can proceed
    if (document.readyState === "complete") {
      // Defer one frame so React root can paint under the splash
      requestAnimationFrame(() => requestAnimationFrame(finish));
    } else {
      window.addEventListener("load", () => {
        requestAnimationFrame(() => requestAnimationFrame(finish));
      }, { once: true });
    }

    // Also finish shortly after React mounts (this effect running)
    const reactReady = window.setTimeout(finish, native ? 2400 : 500);
    const hard = window.setTimeout(() => dismissAll(), hardMs);

    return () => {
      window.clearTimeout(reactReady);
      window.clearTimeout(hard);
    };
  }, []);

  return null;
}
