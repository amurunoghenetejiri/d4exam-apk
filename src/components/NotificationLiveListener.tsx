/**
 * Keep notification inbox counts fresh when a row is inserted.
 * On native APK: also show a system LocalNotification when the app is open/backgrounded
 * (FCM requires google-services.json — LocalNotifications work without it).
 * CBT integrity alerts stay in their own flows.
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
        },
      ],
    });
  } catch (e) {
    console.warn("[notif] local tray failed", e);
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

            // Native APK: system tray via LocalNotifications (works without FCM when app process alive)
            void showNativeLocalTray(
              String(row.title || "D4EXAM"),
              String(row.message || ""),
              row.link,
            );
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
