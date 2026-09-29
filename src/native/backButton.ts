/**
 * Android hardware BACK: history first; at root, double-tap to exit.
 * Never force-exit during an active CBT examination route.
 */
import { isNativeShell } from "@/native/platform";

const EXIT_WINDOW_MS = 2000;
let lastBackAt = 0;
let handle: { remove: () => Promise<void> } | null = null;

function isActiveExamPath(path: string): boolean {
  return /\/student\/exam\//i.test(path);
}

function isRootishPath(path: string): boolean {
  const p = path.replace(/\/+$/, "") || "/";
  return (
    p === "" ||
    p === "/" ||
    p === "/login" ||
    p === "/student" ||
    p === "/teacher" ||
    p === "/admin" ||
    p === "/officer" ||
    p === "/super-admin"
  );
}

function showExitHint() {
  try {
    const g = window as unknown as { __d4Toast?: (m: string) => void };
    if (typeof g.__d4Toast === "function") {
      g.__d4Toast("Tap back again to exit D4EXAM");
      return;
    }
  } catch {
    /* fall through */
  }
  const existing = document.getElementById("d4-exit-snack");
  if (existing) existing.remove();
  const el = document.createElement("div");
  el.id = "d4-exit-snack";
  el.setAttribute("role", "status");
  el.textContent = "Tap back again to exit D4EXAM";
  el.style.cssText =
    "position:fixed;left:50%;bottom:calc(1.25rem + env(safe-area-inset-bottom,0px));" +
    "transform:translateX(-50%);z-index:99999;max-width:min(22rem,calc(100vw - 2rem));" +
    "padding:0.65rem 1rem;border-radius:0.75rem;background:#0b1b3a;color:#f8fafc;" +
    "font:600 0.8125rem/1.35 system-ui,sans-serif;box-shadow:0 8px 24px rgba(15,23,42,.28);" +
    "text-align:center;pointer-events:none;";
  document.body.appendChild(el);
  window.setTimeout(() => el.remove(), EXIT_WINDOW_MS);
}

export async function registerAndroidBackButton(): Promise<() => void> {
  if (!isNativeShell()) return () => undefined;
  try {
    const { App } = await import("@capacitor/app");
    if (handle) {
      try {
        await handle.remove();
      } catch {
        /* ignore */
      }
      handle = null;
    }

    handle = await App.addListener("backButton", ({ canGoBack }) => {
      try {
        const path = window.location.pathname || "/";

        try {
          const w = window as unknown as { __d4SettingsOverlayOpen?: boolean };
          if (w.__d4SettingsOverlayOpen) {
            window.dispatchEvent(new CustomEvent("d4-settings-overlay-close"));
            return;
          }
        } catch {
          /* ignore */
        }

        if (isActiveExamPath(path)) {
          try {
            const w = window as unknown as {
              __d4CalcOpen?: boolean;
              __d4CloseCalc?: () => void;
            };
            if (w.__d4CalcOpen) {
              w.__d4CloseCalc?.();
              window.dispatchEvent(new CustomEvent("d4-close-calculator"));
              return;
            }
          } catch {
            /* ignore */
          }
          return;
        }

        if (/contact-officer|officer\/reports|\/messages/i.test(path)) {
          const w = window as unknown as { __d4MsgInChat?: boolean };
          if (w.__d4MsgInChat) {
            w.__d4MsgInChat = false;
            window.dispatchEvent(new CustomEvent("d4-messaging-back"));
            lastBackAt = 0;
            return;
          }
        }

        const atRoot = isRootishPath(path);
        if (!atRoot) {
          if (window.history.length > 1 || canGoBack) {
            window.history.back();
            lastBackAt = 0;
            return;
          }
          const role = path.split("/").filter(Boolean)[0];
          if (role && ["student", "teacher", "admin", "officer"].includes(role)) {
            window.location.href = `/${role}`;
            return;
          }
        }

        const now = Date.now();
        if (now - lastBackAt < EXIT_WINDOW_MS) {
          lastBackAt = 0;
          void App.exitApp();
          return;
        }
        lastBackAt = now;
        showExitHint();
      } catch (e) {
        console.warn("[D4EXAM] backButton handler error", e);
      }
    });

    return () => {
      void handle?.remove();
      handle = null;
    };
  } catch (e) {
    console.warn("[D4EXAM] backButton plugin unavailable", e);
    return () => undefined;
  }
}
