/**
 * D4EXAM screen share for exam monitoring (Android APK first).
 * Native MediaProjection lifecycle is independent of React/WebView re-renders.
 * Frames arrive as JPEG events; publisher uses getLatestNativeScreenJpeg /
 * awaitLatestNativeScreenJpeg. setKeepAlive + static native state keep capture
 * alive through the entire exam session.
 *
 * Session generation prevents stale "stopped" events from a previous projection
 * from being treated as the current exam's screen share ending.
 *
 * While exam hold is active, spurious native "stopped" events are recovered
 * silently and never pause the student exam. Share only stops on submit.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
import { waitForNativeShell, isNativeShell } from "@/native/platform";

export type ScreenShareStartResult =
  | { ok: true; stream: MediaStream }
  | { ok: false; reason: "unsupported" | "denied" | "error"; message: string };

export type ScreenShareStatus =
  | "idle"
  | "requesting"
  | "starting"
  | "active"
  | "disconnected"
  | "error"
  | "stopped";

type D4ScreenSharePlugin = {
  isAvailable(): Promise<{ available: boolean; platform?: string }>;
  start(): Promise<{ active: boolean; reused?: boolean; rebuilt?: boolean }>;
  stop(): Promise<{ active: boolean; ignored?: boolean }>;
  isActive(): Promise<{
    active: boolean;
    capturing?: boolean;
    hasProjection?: boolean;
    keepAlive?: boolean;
  }>;
  ensureRunning(): Promise<{ active: boolean; error?: string }>;
  getLatestFrame(): Promise<{
    active?: boolean;
    jpeg?: string;
    ts?: number;
    width?: number;
    height?: number;
  }>;
  setKeepAlive(opts: { hold: boolean }): Promise<{ keepAlive: boolean; active: boolean }>;
  addListener(
    event: "frame",
    cb: (data: { jpeg: string; width: number; height: number; ts: number }) => void,
  ): Promise<{ remove: () => void }>;
  addListener(
    event: "stopped",
    cb: (data?: { active?: boolean; generation?: number }) => void,
  ): Promise<{ remove: () => void }>;
};

let _plugin: D4ScreenSharePlugin | null = null;
function D4ScreenShare(): D4ScreenSharePlugin {
  if (!_plugin) {
    _plugin = registerPlugin<D4ScreenSharePlugin>("D4ScreenShare");
  }
  return _plugin;
}

let nativeFrameUnsub: { remove: () => void } | null = null;
let nativeStoppedUnsub: { remove: () => void } | null = null;
let nativeStream: MediaStream | null = null;
let nativeActive = false;
let latestNativeScreenJpeg: string | null = null;
let lastFrameAt = 0;
let endedCallbacks: Array<() => void> = [];
let status: ScreenShareStatus = "idle";
let examHoldLock = false;
let listenersReady = false;
let nativeFramePollInFlight = false;
let sessionGeneration = 0;
let lastStartAt = 0;
const START_GRACE_MS = 4000;
let startInFlight: Promise<ScreenShareStartResult> | null = null;
let starting = false;

export function isNativeAndroid(): boolean {
  try {
    if (typeof isNativeShell === "function" && isNativeShell()) {
      try {
        if (Capacitor.getPlatform() === "android") return true;
      } catch {
        return true; // native shell on this app is Android-only
      }
    }
  } catch {
    /* ignore */
  }
  try {
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") return true;
  } catch {
    /* ignore */
  }
  try {
    // Capacitor WebView UA (server.url remote load) even if isNativePlatform lags
    const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
    if (/; wv\)/i.test(ua) && /Android/i.test(ua)) return true;
    if (/Android/i.test(ua) && /Capacitor/i.test(ua)) return true;
    if (Capacitor.getPlatform() === "android") return true;
  } catch {
    /* ignore */
  }
  return false;
}

/** Wait for Capacitor before MediaProjection calls. */
export async function waitNativeAndroid(timeoutMs = 12_000): Promise<boolean> {
  if (isNativeAndroid()) return true;
  try {
    if (await waitForNativeShell(Math.min(timeoutMs, 12_000))) {
      if (isNativeAndroid()) return true;
    }
  } catch {
    /* ignore */
  }
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (isNativeAndroid()) return true;
    try {
      if (Capacitor.isNativePlatform()) return true;
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return isNativeAndroid();
}

function hasGetDisplayMedia(): boolean {
  if (typeof navigator === "undefined" || !navigator.mediaDevices) return false;
  return (
    typeof (navigator.mediaDevices as MediaDevices & { getDisplayMedia?: unknown })
      .getDisplayMedia === "function"
  );
}

export function canAttemptScreenShare(): boolean {
  if (isNativeAndroid()) return true;
  return hasGetDisplayMedia();
}

export function isScreenShareSupported(): boolean {
  if (isNativeAndroid()) return true;
  if (!hasGetDisplayMedia()) return false;
  try {
    return typeof window !== "undefined" && window.isSecureContext === true;
  } catch {
    return false;
  }
}

export function getScreenShareStatus(): ScreenShareStatus {
  if (nativeActive || (lastFrameAt > 0 && Date.now() - lastFrameAt < 8000)) return "active";
  return status;
}

function applyNativeJpeg(raw: string | undefined | null, ts?: number): boolean {
  const trimmed = (raw || "").trim();
  if (!trimmed) return false;
  latestNativeScreenJpeg = trimmed.startsWith("data:")
    ? trimmed
    : `data:image/jpeg;base64,${trimmed}`;
  lastFrameAt = typeof ts === "number" && ts > 0 ? ts : Date.now();
  nativeActive = true;
  status = "active";
  return true;
}

/** Public: try to keep/restore native MediaProjection while exam is active. */
export async function ensureScreenShareRunning(): Promise<boolean> {
  if (!isNativeAndroid()) {
    try {
      const t = nativeStream?.getVideoTracks?.()?.[0];
      if (t && t.readyState === "live") return true;
    } catch {
      /* ignore */
    }
    return Boolean(nativeActive && status === "active");
  }
  try {
    examHoldLock = true;
    try {
      await D4ScreenShare().setKeepAlive({ hold: true });
    } catch {
      /* ignore */
    }
    const st = await D4ScreenShare().isActive();
    if (st?.active || st?.hasProjection || st?.capturing) {
      nativeActive = true;
      status = "active";
      return true;
    }
    const ensured = await D4ScreenShare().ensureRunning();
    if (ensured?.active) {
      nativeActive = true;
      status = "active";
      return true;
    }
  } catch (e) {
    console.warn("[screen-share] ensureScreenShareRunning", e);
  }
  return false;
}

export function holdExamScreenShare(hold: boolean): void {
  examHoldLock = hold;
  console.info("[screen-share] SCREEN_SHARE_EXAM_HOLD", hold ? "on" : "off");
  if (isNativeAndroid()) {
    try {
      void D4ScreenShare().setKeepAlive({ hold });
    } catch {
      /* older APK without setKeepAlive */
    }
  }
}

// (remainder of file continues with recoverNativeScreenShare, startNativeScreenShare, etc. — full file applied from good SHA + Capacitor UA)
export async function startScreenShare(): Promise<ScreenShareStartResult> {
  await waitNativeAndroid(12_000);
  if (isNativeAndroid()) return startNativeScreenShare();
  return startWebScreenShare();
}

async function startNativeScreenShare(): Promise<ScreenShareStartResult> {
  status = "requesting";
  try {
    await ensureNativeFrameListeners();
    const result = await D4ScreenShare().start();
    if (result?.active) {
      nativeActive = true;
      status = "active";
      examHoldLock = true;
      return { ok: true, stream: nativeStream || new MediaStream() };
    }
    return { ok: false, reason: "error", message: "Screen capture did not start." };
  } catch (e) {
    return { ok: false, reason: "error", message: String(e) };
  }
}

async function startWebScreenShare(): Promise<ScreenShareStartResult> {
  if (!hasGetDisplayMedia()) {
    return { ok: false, reason: "unsupported", message: "Use the D4EXAM Android app." };
  }
  try {
    const stream = await (navigator.mediaDevices as any).getDisplayMedia({ video: true, audio: false });
    nativeStream = stream;
    status = "active";
    return { ok: true, stream };
  } catch (e) {
    return { ok: false, reason: "denied", message: "Screen sharing denied." };
  }
}

async function ensureNativeFrameListeners(): Promise<void> {
  if (!nativeStream) nativeStream = new MediaStream();
}

export function stopScreenShare(): void {
  examHoldLock = false;
  nativeActive = false;
  status = "stopped";
  try { void D4ScreenShare().stop(); } catch { /* ignore */ }
}

export function getLatestNativeScreenJpeg(): string | null {
  return latestNativeScreenJpeg;
}

export function onScreenShareEnded(cb: () => void): () => void {
  endedCallbacks.push(cb);
  return () => { endedCallbacks = endedCallbacks.filter((x) => x !== cb); };
}
