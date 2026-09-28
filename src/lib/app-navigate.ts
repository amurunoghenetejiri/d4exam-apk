/**
 * SPA-safe navigation for D4EXAM web + Capacitor.
 * Uses TanStack router when available; hash history on local native shell.
 */

function isLocalNativeShell(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    const ua = navigator.userAgent || "";
    const native =
      Boolean(cap?.isNativePlatform?.()) ||
      (/; wv\)/i.test(ua) && /Android/i.test(ua)) ||
      /Capacitor/i.test(ua);
    const host = window.location.hostname || "";
    const local =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "" ||
      window.location.protocol === "file:";
    return Boolean(native && local);
  } catch {
    return false;
  }
}

function shouldUseHash(): boolean {
  if (typeof window === "undefined") return false;
  if (window.location.hash.startsWith("#/")) return true;
  if ((window as unknown as { __D4_FORCE_HASH__?: boolean }).__D4_FORCE_HASH__) return true;
  try {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    const ua = navigator.userAgent || "";
    if (Boolean(cap?.isNativePlatform?.()) || /Capacitor/i.test(ua) || (/; wv\)/i.test(ua) && /Android/i.test(ua))) {
      return true;
    }
  } catch {
    /* ignore */
  }
  return isLocalNativeShell();
}

function normalizePath(path: string): string {
  const p = (path || "/").trim() || "/";
  return p.startsWith("/") ? p : `/${p}`;
}

type D4Router = {
  navigate?: (opts: { to: string; replace?: boolean }) => Promise<unknown> | unknown;
  history?: { push?: (p: string) => void; replace?: (p: string) => void };
};

function getRouter(): D4Router | null {
  if (typeof window === "undefined") return null;
  try {
    return ((window as unknown as { __D4_ROUTER?: D4Router }).__D4_ROUTER as D4Router) || null;
  } catch {
    return null;
  }
}

/** Push a client route (hash-aware). */
export function appNavigate(path: string): void {
  const clean = normalizePath(path);
  if (typeof window === "undefined") return;

  // On hash shells (APK / #/ routes), always update the hash first so deep links work
  if (shouldUseHash()) {
    const next = `#${clean}`;
    try {
      if (window.location.hash !== next) {
        window.location.hash = clean.startsWith("#") ? clean.slice(1) : clean;
      } else {
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      }
    } catch {
      try {
        window.location.hash = clean;
      } catch {
        /* ignore */
      }
    }
  }

  const router = getRouter();
  if (router?.navigate) {
    try {
      void Promise.resolve(router.navigate({ to: clean, replace: false }));
    } catch {
      /* ignore — hash already set when needed */
    }
  }
  if (router?.history?.push) {
    try {
      router.history.push(clean);
    } catch {
      /* ignore */
    }
  }

  if (shouldUseHash()) return;

  try {
    window.history.pushState({}, "", clean);
    window.dispatchEvent(new PopStateEvent("popstate"));
  } catch {
    window.location.assign(clean);
  }
}

/** Replace current route (hash-aware) — preferred after login. */
export function appReplace(path: string): void {
  const clean = normalizePath(path);
  if (typeof window === "undefined") return;

  const router = getRouter();
  if (router?.navigate) {
    try {
      void Promise.resolve(router.navigate({ to: clean, replace: true }));
      return;
    } catch {
      /* fall through */
    }
  }
  if (router?.history?.replace) {
    try {
      router.history.replace(clean);
      return;
    } catch {
      /* fall through */
    }
  }

  if (shouldUseHash()) {
    const base = `${window.location.pathname}${window.location.search}`;
    const next = `${base}#${clean}`;
    try {
      window.location.replace(next);
    } catch {
      window.location.hash = `#${clean}`;
    }
    return;
  }

  try {
    window.history.replaceState({}, "", clean);
    window.dispatchEvent(new PopStateEvent("popstate"));
  } catch {
    try {
      window.location.replace(clean);
    } catch {
      window.location.href = clean;
    }
  }
}

/** Attach router instance so appNavigate/appReplace can use it. */
export function bindAppRouter(router: D4Router): void {
  if (typeof window === "undefined") return;
  try {
    (window as unknown as { __D4_ROUTER?: D4Router }).__D4_ROUTER = router;
  } catch {
    /* ignore */
  }
}
