/**
 * Keep notification inbox counts fresh when a row is inserted.
 * When the app process is alive:
 * - Native APK: LocalNotifications system tray
 * - Web/PWA: Notification API / service-worker showNotification (with Open action)
 * Background delivery still requires FCM + registered push_devices token.
 */
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSessionUser } from "@/lib/session";
import { isNativeShell } from "@/native/platform";

function isCountdownSpam(row: {
  title?: string;
  message?: string;
  type?: string;
}): boolean {
  const ty = String(row.type || "").toLowerCase();
  const title = String(row.title || "").toLowerCase();
  const msg = String(row.message || "").toLowerCase();
  if (ty.includes("countdown") || ty.includes("exam_countdown")) return true;
  if (title.includes("starts in") || msg.includes("starts in")) return true;
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(msg.trim())) return true;
  return false;
}

function absIcon(path: string): string {
  if (typeof window === "undefined") return path;
  try {
    return new URL(path, window.location.origin).href;
  } catch {
    return path;
  }
}

async function showNativeLocalTray(title: string, body: string, link?: string | null) {
  if (!isNativeShell()) return;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== "granted") {
      const req = await LocalNotifications.requestPermissions();
      if (req.display !== "granted") return;
    }
    const id = Math.floor(Date.now() % 2_000_000_000) + 1;
    await LocalNotifications.schedule({
      notifications: [
        {
          id,
          title: title || "D4EXAM",
          body: body || "",
          schedule: { at: new Date(Date.now() + 250) },
          extra: { link: link || "/" },
          smallIcon: "ic_stat_d4exam",
          iconColor: "#2563eb",
          actionTypeId: "D4_OPEN",
        },
      ],
    });
  } catch (e) {
    console.warn("[notif] local tray failed", e);
  }
}

async function showWebTray(title: string, body: string, link?: string | null) {
  if (isNativeShell()) return;
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  let path = String(link || "/");
  if (path.startsWith("http")) {
    try {
      const u = new URL(path);
      path = u.pathname + (u.search || "");
    } catch {
      /* keep */
    }
  }
  if (!path.startsWith("/")) path = `/${path}`;

  const icon = absIcon("/icon-192.png");
  const options: NotificationOptions & { actions?: { action: string; title: string }[] } = {
    body: body || "",
    icon,
    badge: icon,
    tag: `d4exam-${path}`,
    renotify: true,
    data: { link: path, title },
    // Chromium supports actions on service-worker notifications
  };

  try {
    if ("serviceWorker" in navigator) {
      const reg =
        (await navigator.serviceWorker.getRegistration()) ||
        (await navigator.serviceWorker.ready.catch(() => null));
      if (reg?.showNotification) {
        await reg.showNotification(title || "D4EXAM", {
          ...options,
          actions: [
            { action: "open", title: "Open" },
            { action: "dismiss", title: "Dismiss" },
          ],
        } as NotificationOptions);
        return;
      }
    }
  } catch {
    /* fall through */
  }

  try {
    const n = new Notification(title || "D4EXAM", options);
    n.onclick = () => {
      try {
        window.focus();
        window.location.assign(path);
      } catch {
        /* ignore */
      }
      n.close();
    };
  } catch (e) {
    console.warn("[notif] web tray failed", e);
  }
}

export function NotificationLiveListener() {
  const { data: session } = useSessionUser();
  const queryClient = useQueryClient();
  const userId = session?.userId;
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`d4-notif-live-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `recipient_user_id=eq.${userId}`,
        },
        (payload) => {
          try {
            const row = payload.new as {
              id?: string;
              title?: string;
              message?: string;
              link?: string | null;
              type?: string;
            };
            if (!row?.id || seen.current.has(row.id)) return;
            seen.current.add(row.id);
            if (seen.current.size > 80) {
              const first = seen.current.values().next().value as string;
              seen.current.delete(first);
            }

            if (isCountdownSpam(row)) {
              void queryClient.invalidateQueries({ queryKey: ["count", "notifications"] });
              void queryClient.invalidateQueries({
                queryKey: ["own-notifications", userId],
              });
              return;
            }

            void queryClient.invalidateQueries({ queryKey: ["count", "notifications"] });
            void queryClient.invalidateQueries({
              queryKey: ["count", "notifications", "unread", userId],
            });
            void queryClient.invalidateQueries({
              queryKey: ["own-notifications", userId],
            });
            void queryClient.invalidateQueries({ queryKey: ["rows", "notifications"] });

            const title = String(row.title || "D4EXAM");
            const body = String(row.message || "");
            void showNativeLocalTray(title, body, row.link);
            void showWebTray(title, body, row.link);
          } catch {
            /* ignore */
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);

  return null;
}
