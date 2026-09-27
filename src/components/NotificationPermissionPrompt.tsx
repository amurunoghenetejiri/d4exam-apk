/**
 * Soft prompt after login — does not block UI.
 * NEVER re-ask if permission already granted.
 * Confirmation native notification only when user JUST enables.
 */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useSessionUser } from "@/lib/session";
import {
  enablePushNotifications,
  getPushPermissionState,
  refreshNativePushPermissionState,
} from "@/lib/push";
import { isNativeShell, waitForNativeShell } from "@/native/platform";
import { notificationsEnabledConfirm } from "@/lib/notify-messages";
import { showD4ExamNativeNotification } from "@/native/localNotify";

const PROMPT_KEY = "d4_notif_prompt_v2";

function alreadyPrompted(userId: string, role: string): boolean {
  try {
    return localStorage.getItem(`${PROMPT_KEY}:${userId}:${role}`) === "1";
  } catch {
    return false;
  }
}

function markPrompted(userId: string, role: string) {
  try {
    localStorage.setItem(`${PROMPT_KEY}:${userId}:${role}`, "1");
  } catch {
    /* ignore */
  }
}

function settingsLinkForRole(role?: string | null): string {
  const r = (role || "").toLowerCase();
  if (r.includes("super")) return "/super-admin/settings";
  if (r.includes("school") || r === "admin") return "/admin/settings";
  if (r.includes("officer")) return "/officer/settings";
  if (r.includes("teacher")) return "/teacher/settings";
  if (r.includes("student")) return "/student/settings";
  return "/";
}

export function NotificationPermissionPrompt() {
  const { data: session } = useSessionUser();
  const fired = useRef(false);
  const [busy, setBusy] = useState(false);


  // After successful login (session present): request REAL Android notification permission.
  // Fires when user lands on their room/dashboard — not on the cold app home/login screen.
  // Only mark "asked" after the OS returns granted/denied — never after a failed plugin call.
  useEffect(() => {
    // Wait until the user is logged in (dashboard / room context).
    if (!session?.userId) return;
    let alreadyAsked = false;
    try {
      alreadyAsked = localStorage.getItem("d4_native_os_notif_asked_v2") === "1";
    } catch {
      alreadyAsked = false;
    }
    if (alreadyAsked) return;
    let cancelled = false;
    (async () => {
      try {
        // Wait longer for Capacitor bridge (WebView + plugins inject async)
        let nativeReady = await waitForNativeShell(12_000);
        if (!nativeReady) {
          await new Promise((r) => setTimeout(r, 2_000));
          nativeReady = await waitForNativeShell(8_000);
        }
        if (cancelled || !nativeReady) {
          console.warn("[D4EXAM] native shell not ready — will retry notification prompt next visit");
          return;
        }
        await new Promise((r) => setTimeout(r, 1_200));
        if (cancelled) return;
        let display = "default";
        try {
          const { registerPlugin } = await import("@capacitor/core");
          const auth = registerPlugin<{
            checkNotificationPermission: () => Promise<{ display?: string }>;
            requestNotificationPermission: () => Promise<{ display?: string }>;
            ping?: () => Promise<{ ok?: boolean }>;
          }>("D4NativeAuth");
          try {
            await auth.ping?.();
          } catch {
            /* plugin may still work without ping */
          }
          const cur = await auth.checkNotificationPermission();
          display = (cur?.display || "default").toLowerCase();
          if (display === "prompt") display = "default";
          if (display !== "granted" && display !== "denied") {
            const req = await auth.requestNotificationPermission();
            display = (req?.display || display).toLowerCase();
          }
        } catch (e1) {
          console.warn("[D4EXAM] D4NativeAuth notif failed, trying LocalNotifications", e1);
          try {
            const { LocalNotifications } = await import("@capacitor/local-notifications");
            const cur = await LocalNotifications.checkPermissions();
            display = (cur.display || "default").toLowerCase();
            if (display !== "granted" && display !== "denied") {
              const req = await LocalNotifications.requestPermissions();
              display = (req.display || display).toLowerCase();
            }
          } catch (e2) {
            console.warn("[D4EXAM] LocalNotifications notif failed", e2);
            return; // do NOT mark asked — retry next session
          }
        }
        // Only persist "asked" when the OS dialog actually resolved
        if (display === "granted" || display === "denied") {
          try {
            localStorage.setItem("d4_native_os_notif_asked_v2", "1");
          } catch {
            /* ignore */
          }
        }
        await refreshNativePushPermissionState();
        if (display === "granted") {
          toast.success("Notifications enabled");
          try {
            const { showD4ExamNativeNotification } = await import("@/native/localNotify");
            const { notificationsEnabledConfirm } = await import("@/lib/notify-messages");
            const copy = notificationsEnabledConfirm();
            await showD4ExamNativeNotification(copy.title, copy.message, "/");
          } catch {
            /* ignore */
          }
          if (session?.userId) {
            void enablePushNotifications(session.userId, session.role, { requestPermission: false });
          }
        }
      } catch (e) {
        console.warn("[D4EXAM] native notification permission", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.userId]); // OS notif only after login (dashboard/room)


  useEffect(() => {
    const uid: string | null | undefined = session?.userId;
    const role: string | null | undefined = session?.role;
    if (!uid || !role) return;
    if (fired.current) return;

    const run = async () => {
      if (alreadyPrompted(uid, role)) return;

      let state = getPushPermissionState();
      if (isNativeShell()) {
        state = await refreshNativePushPermissionState();
      }

      // Already granted / denied / unsupported → NEVER show Allow prompt again
      if (state === "granted" || state === "denied" || state === "unsupported") {
        markPrompted(uid, role);
        try {
          if (state === "granted") {
            localStorage.setItem(`d4_notif_enabled_once:${uid}`, "1");
            localStorage.setItem(`d4_push_prompted:${uid}`, "1");
          }
        } catch {
          /* ignore */
        }
        return;
      }

      await new Promise((r) => setTimeout(r, 1800));
      if (fired.current) return;
      fired.current = true;
      markPrompted(uid, role);

      toast.message("Stay updated with D4EXAM 🔔", {
        description:
          "Allow notifications to receive: exam reminders, examination approvals, result releases, important security alerts, and school/application updates.",
        duration: 14_000,
        action: {
          label: "Allow Notifications",
          onClick: () => {
            if (busy) return;
            setBusy(true);
            void enablePushNotifications(uid, role)
              .then(async (r) => {
                if (r.ok) {
                  toast.success("Notifications enabled");
                  try {
                    const key = `d4_notif_enabled_once:${uid}`;
                    if (localStorage.getItem(key) !== "1") {
                      localStorage.setItem(key, "1");
                      const copy = notificationsEnabledConfirm();
                      if (isNativeShell()) {
                        await showD4ExamNativeNotification(
                          copy.title,
                          copy.message,
                          settingsLinkForRole(role),
                        );
                      }
                    }
                  } catch {
                    /* ignore */
                  }
                } else toast.error(r.error || "Could not enable notifications");
              })
              .finally(() => setBusy(false));
          },
        },
      });
    };

    void run();
  }, [session?.userId, session?.role, busy]);

  return null;
}

/** Call after school application submit (optional applicant userId). */
export function promptNotificationsAfterApplication(opts?: {
  userId?: string | null;
  role?: string | null;
}) {
  try {
    if (typeof window === "undefined") return;
    const key = `d4_app_prompt:${opts?.userId || "anon"}`;
    if (localStorage.getItem(key) === "1") return;

    const state = getPushPermissionState();
    if (state === "granted" || state === "denied") {
      localStorage.setItem(key, "1");
      return;
    }

    localStorage.setItem(key, "1");
    toast.message("Get application updates", {
      description:
        "Enable notifications so you are alerted when your school application is reviewed or approved.",
      duration: 14_000,
      action: {
        label: "Enable",
        onClick: () => {
          if (opts?.userId) {
            void enablePushNotifications(opts.userId, opts.role || null).then(async (r) => {
              if (r.ok) {
                toast.success("Notifications enabled");
                const copy = notificationsEnabledConfirm();
                if (isNativeShell()) {
                  await showD4ExamNativeNotification(copy.title, copy.message, "/application-status");
                }
              } else toast.error(r.error || "Could not enable");
            });
          } else if (isNativeShell()) {
            void import("@capacitor/local-notifications")
              .then(async ({ LocalNotifications }) => {
                await LocalNotifications.requestPermissions();
                toast.success("Notifications enabled on this device");
              })
              .catch(() => {
                toast.message("Open Settings later to enable notifications after you sign in.");
              });
          } else if ("Notification" in window) {
            void Notification.requestPermission().then((p) => {
              if (p === "granted") toast.success("Notifications enabled");
            });
          }
        },
      },
    });
  } catch {
    /* ignore */
  }
}
