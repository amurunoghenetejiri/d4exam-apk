import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { ThemeColorSync } from "@/components/ThemeColorSync";
import { OfflineBootstrap } from "@/components/OfflineBootstrap";
import { LocalDbBootstrap } from "@/components/LocalDbBootstrap";
import { OfflineStatusPill } from "@/components/OfflineStatusPill";
import { NotificationLiveListener } from "@/components/NotificationLiveListener";
import { NotificationPermissionPrompt } from "@/components/NotificationPermissionPrompt";
import { hideSplashSafely } from "@/native/statusBar";
import { AppUpdateGate } from "@/components/AppUpdateGate";
import { FingerprintLockGate } from "@/components/security/FingerprintLockGate";
import { AppUnlockSetupGate } from "@/components/security/AppUnlockSetupGate";
import { AndroidApkInstallBanner } from "@/components/AndroidApkInstallBanner";
import { useSessionUser, rememberLastPath, readLastRole, readPreferredRole, roleHome, roleFromPath, type AppRole } from "@/lib/session";
import { initNativePushIfNeeded, initWebPushIfNeeded } from "@/lib/push";
import { isNativeShell } from "@/native/platform";
import { applyNativeStatusBar } from "@/native/statusBar";
import { registerAndroidBackButton } from "@/native/backButton";
import { AnimatedSplash } from "@/components/splash/AnimatedSplash";
import { DisplayPrefsBootstrap } from "@/components/DisplayPrefsBootstrap";
import { SchoolSessionBootstrap } from "@/components/SchoolSessionBootstrap";
import { startAccountVaultKeepAlive } from "@/lib/account-switcher";
import { notifyWelcomeRole } from "@/lib/email-notify.functions";
import { isSyntheticStudentEmail } from "@/lib/student-email";
import { startNativeShellWatcher } from "@/native/platform";

if (typeof window !== "undefined") {
  startNativeShellWatcher();
}

function NativeBootstrap() {
  const { data: session } = useSessionUser();
  const router = useRouter();
  const pathForPersist = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => {
    if (!pathForPersist) return;
    rememberLastPath(pathForPersist, session?.role ?? roleFromPath(pathForPersist));
  }, [pathForPersist, session?.role]);
  useEffect(() => {
    if (pathForPersist !== "/") return;
    const role = (readLastRole() || readPreferredRole() || session?.role) as AppRole | null;
    if (role && roleHome[role]) {
      void router.navigate({ to: roleHome[role] as never, replace: true });
    }
  }, [pathForPersist, session?.role, router]);
  useEffect(() => {
    if (!isNativeShell()) return;
    let cancelled = false;
    (async () => {
      try {
        document.documentElement.classList.add("d4-native");
        await applyNativeStatusBar();
        const unsubBack = await registerAndroidBackButton();
        if (cancelled) {
          unsubBack();
          return;
        }
        (window as unknown as { __d4UnsubBack?: () => void }).__d4UnsubBack = unsubBack;
        if (!cancelled && session?.userId) {
          window.setTimeout(() => {
            void initNativePushIfNeeded(session.userId, session.role);
          }, 2500);
        }
      } catch (e) {
        console.warn("[D4EXAM] Native bootstrap error", e);
      }
    })();
    return () => {
      cancelled = true;
      try {
        (window as unknown as { __d4UnsubBack?: () => void }).__d4UnsubBack?.();
      } catch {
        /* ignore */
      }
    };
  }, [session?.userId, session?.role]);

  // Notification OS prompt is handled by NotificationPermissionPrompt after login
  // (when the user enters their room/dashboard) — not on cold app home/login screen.

  return null;
}

function WebPushBootstrap() {
  const { data: session } = useSessionUser();
  useEffect(() => {
    if (!session?.userId) return;
    try {
      const key = `d4_welcome_email_sent_${session.userId}`;
      if (typeof localStorage !== "undefined" && !localStorage.getItem(key)) {
        const em = (session.email || "").trim();
        if (em.includes("@") && !isSyntheticStudentEmail(em)) {
          localStorage.setItem(key, "1");
          void notifyWelcomeRole({
            data: {
              email: em,
              fullName: session.fullName || undefined,
              role: session.role || "student",
            },
          });
        }
      }
    } catch { /* ignore */ }
    if (isNativeShell()) return;
    void initWebPushIfNeeded(session.userId, session.role);
    const onVis = () => {
      if (document.visibilityState === "visible") {
        void initWebPushIfNeeded(session.userId, session.role);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [session?.userId, session?.role]);
  return null;
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Don&apos;t worry — D4EXAM is still running. You can try again or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try Again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go Home
          </a>
          <button
            type="button"
            onClick={() => {
              try {
                window.location.reload();
              } catch {
                window.location.href = "/";
              }
            }}
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Reload App
          </button>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover",
      },
      { title: "D4EXAM — Secure Online Examination Platform" },
      {
        name: "description",
        content:
          "D4EXAM is a professional CBT and examination management platform for schools, colleges and universities. Secure online exams, question banks, live monitoring, automated marking and results.",
      },
      { name: "author", content: "D4EXAM" },
      { name: "theme-color", content: "#ffffff" },
      { name: "robots", content: "index, follow, max-image-preview:large" },
      { name: "googlebot", content: "index, follow" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://d4exam.name.ng/" },
      { property: "og:site_name", content: "D4EXAM" },
      { property: "og:title", content: "D4EXAM — Secure Online Examination Platform" },
      {
        property: "og:description",
        content:
          "Professional CBT and examination management for schools, colleges and universities worldwide.",
      },
      { property: "og:image", content: "https://d4exam.name.ng/logo.png" },
      { property: "og:locale", content: "en_US" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "D4EXAM — Secure Online Examination Platform" },
      {
        name: "twitter:description",
        content:
          "Professional CBT and examination management for schools, colleges and universities worldwide.",
      },
      { name: "twitter:image", content: "https://d4exam.name.ng/logo.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "canonical", href: "https://d4exam.name.ng/" },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
      { rel: "icon", type: "image/png", sizes: "192x192", href: "/icon-192.png" },
      { rel: "icon", type: "image/png", sizes: "512x512", href: "/icon-512.png" },
      { rel: "manifest", href: "/site.webmanifest" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

const BOOT_SPLASH_SCRIPT = `
(function(){
  try {
    var shell = false;
    try {
      var c = window.Capacitor;
      if (c && (c.isNativePlatform && c.isNativePlatform() || c.getPlatform && (c.getPlatform()==='android'||c.getPlatform()==='ios'))) shell = true;
    } catch(e){}
    try {
      var ua = navigator.userAgent || '';
      if (/Android/i.test(ua) && (/; wv\\)/i.test(ua) || /Capacitor/i.test(ua))) shell = true;
    } catch(e){}
    try {
      if (window.matchMedia && (window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches)) shell = true;
      if (navigator.standalone === true) shell = true;
    } catch(e){}
    var el = document.getElementById('d4-boot-splash');
    if (!el) return;
    if (!shell) {
      el.className = (el.className || '') + ' d4-web-loading';
      el.style.display = 'flex';
      try { document.documentElement.style.backgroundColor = '#ffffff'; } catch(e){}
      try { document.body.style.backgroundColor = '#ffffff'; } catch(e){}
      try {
        var mt = document.querySelector('meta[name="theme-color"]');
        if (mt) mt.setAttribute('content', '#ffffff');
      } catch(e){}
    } else {
      if (sessionStorage.getItem('d4exam_splash_shown_v6') === '1') return;
      el.style.display = 'flex';
    }
    var hidden = false;
    function hideBoot(){
      if (hidden) return;
      hidden = true;
      try {
        try { sessionStorage.setItem('d4exam_splash_shown_v6', '1'); } catch(e){}
        var b = document.getElementById('d4-boot-splash');
        if (!b) return;
        b.style.opacity = '0';
        b.style.pointerEvents = 'none';
        setTimeout(function(){ try { b.remove(); } catch(e){} }, 180);
      } catch(e){}
    }
    window.addEventListener('d4-hide-boot-splash', hideBoot);
    setTimeout(hideBoot, shell ? 2200 : 1200);
  } catch(e){}
})();
`;

function RootShell({ children }: { children: ReactNode }) {
  const seoJsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "name": "D4EXAM",
        "url": "https://d4exam.name.ng",
        "logo": "https://d4exam.name.ng/logo.png",
        "description": "Professional CBT and examination management platform for schools, colleges and universities.",
      },
      {
        "@type": "WebSite",
        "name": "D4EXAM",
        "url": "https://d4exam.name.ng",
        "description": "Secure online examination (CBT) platform for institutions.",
        "publisher": { "@type": "Organization", "name": "D4EXAM" },
      },
      {
        "@type": "SoftwareApplication",
        "name": "D4EXAM",
        "applicationCategory": "EducationalApplication",
        "operatingSystem": "Web, Android",
        "url": "https://d4exam.name.ng",
        "description": "Secure computer-based testing and examination management for schools and universities.",
      },
    ],
  };

  return (
    <html lang="en" style={{ backgroundColor: "#0b1b3a" }}>
      <head>
        <HeadContent />
        <style
          dangerouslySetInnerHTML={{
            __html: `
#d4-boot-splash{display:none;position:fixed;inset:0;z-index:2147483646;flex-direction:column;align-items:center;justify-content:center;background:#0b1b3a;color:#fff;font-family:system-ui,sans-serif}
#d4-boot-splash .boot-main{display:flex;flex:1;flex-direction:column;align-items:center;justify-content:center;padding:0 1.5rem}
#d4-boot-splash img{width:min(40vw,160px);height:min(40vw,160px);object-fit:contain}
#d4-boot-splash .t{margin-top:1.25rem;font-weight:800;letter-spacing:.14em;font-size:clamp(1.5rem,6vw,2.25rem)}
#d4-boot-splash .t span.b{color:#2563eb}
#d4-boot-splash .s{margin-top:.5rem;font-size:10px;letter-spacing:.28em;color:#94a3b8;font-weight:600}
#d4-boot-splash .slogan{position:absolute;bottom:max(1.5rem,env(safe-area-inset-bottom));left:0;right:0;text-align:center;font-size:10px;letter-spacing:.28em;color:#94a3b8;font-weight:600;padding:0 2rem}
#d4-boot-splash .slogan span.hi{color:#60a5fa}
#d4-boot-splash.d4-web-loading{background:#ffffff;color:#0f172a}
#d4-boot-splash.d4-web-loading .boot-brand{display:none!important}
#d4-boot-splash.d4-web-loading .slogan{display:none!important}
#d4-boot-splash.d4-web-loading .boot-spinner-wrap{display:flex!important}
#d4-boot-splash .boot-spinner-wrap{display:none;flex-direction:column;align-items:center;justify-content:center;gap:0.75rem}
#d4-boot-splash .boot-spinner{width:2.25rem;height:2.25rem;border-radius:9999px;border:3px solid #e2e8f0;border-top-color:#2563eb;animation:d4-boot-spin 0.7s linear infinite}
@keyframes d4-boot-spin{to{transform:rotate(360deg)}}
`,
          }}
        />
      </head>
      <body className="min-h-dvh text-foreground antialiased" style={{ backgroundColor: "#ffffff" }}>
        <div id="d4-boot-splash" aria-hidden="true">
          <div className="boot-main boot-brand">
            <img src="/logo.png" alt="" width="160" height="160" />
            <div className="t">
              D<span className="b">4</span>EXAM
            </div>
            <div className="s">Smart Examination System</div>
          </div>
          <div className="boot-spinner-wrap" aria-label="Loading">
            <div className="boot-spinner" />
            <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "#64748b" }}>Loading…</div>
          </div>
          <div className="slogan">
            SMART. <span className="hi">SECURE.</span> SEAMLESS.
          </div>
        </div>
        <script dangerouslySetInnerHTML={{ __html: BOOT_SPLASH_SCRIPT }} />
        {children}
        <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(seoJsonLd) }}
          />
          <Scripts />
      </body>
    </html>
  );
}

function installGlobalErrorHandlers() {
  if (typeof window === "undefined") return;
  const w = window as Window & { __d4GlobalHandlers?: boolean };
  if (w.__d4GlobalHandlers) return;
  w.__d4GlobalHandlers = true;
  window.addEventListener("unhandledrejection", (ev) => {
    console.warn("[D4EXAM] unhandledrejection", ev.reason);
    ev.preventDefault?.();
  });
  window.addEventListener("error", (ev) => {
    console.warn("[D4EXAM] window error", ev.message);
  });
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  useEffect(() => {
    installGlobalErrorHandlers();
    startAccountVaultKeepAlive();
    // APK: AnimatedSplash owns splash timing (branded navy screen).
    // Web: dismiss boot loader promptly.
    const native = isNativeShell();
    if (!native) {
      void hideSplashSafely();
      try {
        window.dispatchEvent(new Event("d4-hide-boot-splash"));
      } catch { /* ignore */ }
    }
    try {
      const el = document.getElementById("d4-boot-splash");
      if (el) {
        el.style.opacity = "0";
        el.style.pointerEvents = "none";
        el.style.display = "none";
      }
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
      document.body.classList.remove("d4-fp-lock-active", "d4-setup-lock-active");
      document.body.style.pointerEvents = "";
      document.documentElement.style.pointerEvents = "";
      document.querySelectorAll("[data-radix-dialog-overlay]").forEach((el) => {
        try {
          (el as HTMLElement).style.pointerEvents = "none";
        } catch {
          /* ignore */
        }
      });
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeColorSync />
      <LocalDbBootstrap />
      <OfflineBootstrap />
      <OfflineStatusPill />
      <NotificationLiveListener />
      <NotificationPermissionPrompt />
      <AppUpdateGate />
      <AppUnlockSetupGate />
      <FingerprintLockGate />
      <AndroidApkInstallBanner />
      <Outlet />
      <NativeBootstrap />
      <WebPushBootstrap />
      <SchoolSessionBootstrap />
      <DisplayPrefsBootstrap />
      <AnimatedSplash />
      <Toaster />
    </QueryClientProvider>
  );
}
