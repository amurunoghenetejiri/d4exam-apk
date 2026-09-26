import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, createRootRoute, useRouterState } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { useEffect, useState } from "react";
import { SessionProvider } from "@/lib/session";
import { FingerprintLockGate } from "@/components/security/FingerprintLockGate";
import { NotificationPermissionPrompt } from "@/components/NotificationPermissionPrompt";
import { AppShell } from "@/components/AppShell";
import { cn } from "@/lib/utils";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function NativeBootstrap() {
  useEffect(() => {
    // Hide boot splash once React is mounted
    try {
      const el = document.getElementById("d4-boot-splash");
      if (el) {
        el.style.display = "none";
      }
      try {
        window.sessionStorage.setItem("d4exam_splash_shown_v6", "1");
      } catch {
        /* ignore */
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Request POST_NOTIFICATIONS on native app entry (before login).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        try {
          if (localStorage.getItem("d4_native_os_notif_asked_v2") === "1") return;
        } catch {
          /* ignore */
        }
        const { waitForNativeShell, isNativeShell } = await import("@/native/platform");
        let ready = isNativeShell() || (await waitForNativeShell(12_000));
        if (!ready) {
          await new Promise((r) => setTimeout(r, 1500));
          ready = isNativeShell() || (await waitForNativeShell(6_000));
        }
        if (cancelled || !ready) return;
        await new Promise((r) => setTimeout(r, 800));
        if (cancelled) return;
        let display = "default";
        try {
          const { registerPlugin } = await import("@capacitor/core");
          const auth = registerPlugin<{
            checkNotificationPermission: () => Promise<{ display?: string }>;
            requestNotificationPermission: () => Promise<{ display?: string }>;
          }>("D4NativeAuth");
          const cur = await auth.checkNotificationPermission();
          display = (cur?.display || "default").toLowerCase();
          if (display !== "granted" && display !== "denied") {
            const req = await auth.requestNotificationPermission();
            display = (req?.display || display).toLowerCase();
          }
        } catch {
          try {
            const { LocalNotifications } = await import("@capacitor/local-notifications");
            const cur = await LocalNotifications.checkPermissions();
            display = (cur.display || "default").toLowerCase();
            if (display !== "granted" && display !== "denied") {
              const req = await LocalNotifications.requestPermissions();
              display = (req.display || display).toLowerCase();
            }
          } catch {
            return; // do not mark asked on plugin failure
          }
        }
        if (display === "granted" || display === "denied") {
          try {
            localStorage.setItem("d4_native_os_notif_asked_v2", "1");
          } catch {
            /* ignore */
          }
        }
      } catch (e) {
        console.warn("[D4EXAM] NativeBootstrap notif", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}

function RootComponent() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <div className={cn("min-h-dvh bg-background text-foreground antialiased")}>
          <AppShell>
            <Outlet />
          </AppShell>
          <FingerprintLockGate />
          <NotificationPermissionPrompt />
          <NativeBootstrap />
          <Toaster richColors position="top-center" closeButton />
        </div>
      </SessionProvider>
    </QueryClientProvider>
  );
}

export const Route = createRootRoute({
  component: RootComponent,
});
