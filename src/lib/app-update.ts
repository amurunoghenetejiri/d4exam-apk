/**
 * Sideloaded APK version check + install helpers.
 * Not Play Store — update downloads the APK from apkUrl on THIS site.
 * Never redirects users to GitHub for install.
 */
import { isNativeShell } from "@/native/platform";

export type AppVersionConfig = {
  minVersion: string;
  latestVersion: string;
  minBuild: number;
  latestBuild: number;
  apkUrl: string;
  forceUpdate: boolean;
  message: string;
  installMessage: string;
};

const PRODUCTION_ORIGIN = "https://d4exam.name.ng";

const DEFAULT_CONFIG: AppVersionConfig = {
  minVersion: "1.0.0",
  latestVersion: "1.0.0",
  minBuild: 1,
  latestBuild: 1,
  apkUrl: "/downloads/d4exam.apk",
  forceUpdate: false,
  message: "A newer version of D4EXAM is available. Update when you can.",
  installMessage:
    "Install the D4EXAM Android app for the full exam experience (camera, mic, screen share).",
};

let cachedConfig: { at: number; value: AppVersionConfig } | null = null;
const CACHE_MS = 60_000;

function isRealCapacitorNative(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const Cap = (window as unknown as {
      Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
    }).Capacitor;
    if (Cap?.isNativePlatform?.()) return true;
    const p = Cap?.getPlatform?.();
    if (p === "android" || p === "ios") return true;
  } catch {
    /* ignore */
  }
  return false;
}

export function parseVersionParts(v: string): number[] {
  return String(v || "0")
    .trim()
    .replace(/^v/i, "")
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((n) => parseInt(n, 10) || 0);
}

/** Return negative if a < b, 0 if equal, positive if a > b */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersionParts(a);
  const pb = parseVersionParts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

export async function fetchAppVersionConfig(): Promise<AppVersionConfig> {
  if (cachedConfig && Date.now() - cachedConfig.at < CACHE_MS) {
    return cachedConfig.value;
  }

  const urls = [
    `/app-version.json?t=${Date.now()}`,
    `${PRODUCTION_ORIGIN}/app-version.json?t=${Date.now()}`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "no-store", credentials: "omit" });
      if (!res.ok) continue;
      const data = (await res.json()) as Partial<AppVersionConfig>;
      const value: AppVersionConfig = {
        ...DEFAULT_CONFIG,
        ...data,
        minBuild: Number(data.minBuild ?? DEFAULT_CONFIG.minBuild) || 1,
        latestBuild: Number(data.latestBuild ?? DEFAULT_CONFIG.latestBuild) || 1,
        forceUpdate: data.forceUpdate === true,
        apkUrl: (() => {
          const u = String(data.apkUrl || DEFAULT_CONFIG.apkUrl);
          if (/github\.com/i.test(u)) return "/downloads/d4exam.apk";
          return u || "/downloads/d4exam.apk";
        })(),
      };
      cachedConfig = { at: Date.now(), value };
      return value;
    } catch (e) {
      console.warn("[app-update] config fetch failed", url, e);
    }
  }
  return DEFAULT_CONFIG;
}

export type NativeAppInfo = {
  version: string;
  build: string;
};

export async function getNativeAppInfo(): Promise<NativeAppInfo | null> {
  if (typeof window === "undefined") return null;
  if (!isNativeShell() && !isRealCapacitorNative()) return null;
  try {
    const { App } = await import("@capacitor/app");
    const info = await App.getInfo();
    return {
      version: String(info.version || "0"),
      build: String(info.build || "0"),
    };
  } catch (e) {
    console.warn("[app-update] App.getInfo failed", e);
    return null;
  }
}

export function needsForceUpdate(
  info: NativeAppInfo,
  cfg: AppVersionConfig,
): boolean {
  const buildNum = parseInt(info.build, 10);
  if (!Number.isNaN(buildNum) && cfg.minBuild > 0 && buildNum < cfg.minBuild) {
    return true;
  }
  if (compareVersions(info.version, cfg.minVersion) < 0) {
    return true;
  }
  return false;
}

export function resolveApkUrl(apkUrl: string): string {
  const raw = (apkUrl || DEFAULT_CONFIG.apkUrl || "/downloads/d4exam.apk").trim();
  // Never send users to GitHub for APK install
  if (/github\.com/i.test(raw)) {
    const origin =
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : PRODUCTION_ORIGIN;
    return `${origin.replace(/\/$/, "")}/downloads/d4exam.apk`;
  }
  if (/^https?:\/\//i.test(raw)) return raw;
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : PRODUCTION_ORIGIN;
  if (raw.startsWith("/")) return `${origin.replace(/\/$/, "")}${raw}`;
  return `${origin.replace(/\/$/, "")}/${raw}`;
}

/**
 * Trigger a real file download of the APK from this site (same origin preferred).
 * Never opens GitHub. Browser shows native "Downloading…" / install prompt.
 */
export function openApkDownload(apkUrl: string) {
  const url = resolveApkUrl(apkUrl);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.setAttribute("download", "d4exam.apk");
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    window.setTimeout(() => {
      try {
        a.remove();
      } catch {
        /* ignore */
      }
    }, 2000);
  } catch {
    try {
      window.location.assign(url);
    } catch {
      try {
        window.open(url, "_blank", "noopener,noreferrer");
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Android Chrome/browser (not real Capacitor APK).
 * Does NOT use isNativeShell() — that flag can stick in localStorage and hide the banner on the website.
 */
export function isAndroidWebBrowser(): boolean {
  if (typeof window === "undefined") return false;
  if (isRealCapacitorNative()) return false;
  try {
    const ua = navigator.userAgent || "";
    if (/iPhone|iPad|iPod/i.test(ua)) return false;
    if (!/Android/i.test(ua)) return false;
    if (ua.includes("; wv)") && isRealCapacitorNative()) return false;
    return true;
  } catch {
    return false;
  }
}

export function isIosWebBrowser(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const ua = navigator.userAgent || "";
    return /iPhone|iPad|iPod/i.test(ua);
  } catch {
    return false;
  }
}
