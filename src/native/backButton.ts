/**
 * Android hardware BACK: history first; at root, double-tap to exit.
 * Active call → minimize (do not kill the app).
 */
import { isNativeShell } from "@/native/platform";

const ROOT_PATHS = new Set([
  "/",
  "/login",
  "/student",
  "/student/dashboard",
  "/teacher/dashboard",
  "/admin/dashboard",
  "/officer/dashboard",
  "/student/messages",
]);

let lastBackPress = 0;
let registered = false;

export function registerBackButton() {
  if (typeof window === "undefined") return;
  if (!isNativeShell()) return;
  if (registered) return;
  registered = true;

  void import("@capacitor/app").then(({ App }) => {
    void App.addListener("backButton", () => {
      void (async () => {
        try {
          const { getCallSession, minimizeCall } = await import("@/lib/call-session");
          const s = getCallSession();
          if (s && !["ended", "idle", "no_answer", "failed", "declined", "missed"].includes(s.phase)) {
            minimizeCall();
            return;
          }
        } catch {
          /* ignore */
        }

        const path = (window.location.pathname || "/").replace(/\/+$/, "") || "/";
        const hash = (window.location.hash || "").replace(/^#/, "");
        const current = hash.startsWith("/") ? hash.split("?")[0] : path;

        if (!ROOT_PATHS.has(current) && window.history.length > 1) {
          window.history.back();
          return;
        }

        const now = Date.now();
        if (now - lastBackPress < 2000) {
          void App.exitApp();
        } else {
          lastBackPress = now;
          try {
            const toast = document.createElement("div");
            toast.setAttribute(
              "style",
              "position:fixed;bottom:3rem;left:50%;transform:translateX(-50%);z-index:99999;padding:0.5rem 1rem;background:rgba(0,0,0,0.85);color:#fff;font-size:12px;border-radius:9999px;pointer-events:none",
            );
            toast.textContent = "Press back again to exit D4EXAM";
            document.body.appendChild(toast);
            window.setTimeout(() => toast.remove(), 2000);
          } catch {
            /* ignore */
          }
        }
      })();
    });
  }).catch(() => {});
}
