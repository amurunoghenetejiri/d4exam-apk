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

async function recoverNativeScreenShare(reason: string): Promise<boolean> {
  console.warn("[screen-share] recover:", reason);
  try {
    try {
      await D4ScreenShare().setKeepAlive({ hold: true });
    } catch {
      /* ignore */
    }
    for (let i = 0; i < 5; i++) {
      try {
        const st = await D4ScreenShare().isActive();
        if (st?.active || st?.hasProjection || st?.capturing) {
          nativeActive = true;
          status = "active";
          examHoldLock = true;
          return true;
        }
      } catch {
        /* ignore */
      }
      try {
        const ensured = await D4ScreenShare().ensureRunning();
        if (ensured?.active) {
          nativeActive = true;
          status = "active";
          examHoldLock = true;
          return true;
        }
      } catch {
        /* ignore */
      }
      try {
        const result = await D4ScreenShare().start();
        if (result?.active) {
          nativeActive = true;
          status = "active";
          examHoldLock = true;
          lastStartAt = Date.now();
          return true;
        }
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 400 + i * 200));
    }
  } catch (e) {
    console.warn("[screen-share] recover failed", e);
  }
  return false;
}

function handleNativeStopped(data?: { active?: boolean; generation?: number }): void {
  const gen = typeof data?.generation === "number" ? data.generation : undefined;
  if (gen != null && gen !== sessionGeneration) {
    console.info("[screen-share] ignoring stale stopped event gen=", gen, "current=", sessionGeneration);
    return;
  }
  if (starting || (lastStartAt > 0 && Date.now() - lastStartAt < START_GRACE_MS)) {
    console.warn("[screen-share] ignoring stopped during start grace window (gen=", gen, ")");
    void recoverNativeScreenShare("start-grace");
    return;
  }
  // During live exam hold: NEVER treat native "stopped" as end-of-exam.
  // Android MediaProjection often fires spurious stopped events (focus, dialogs,
  // WebView lifecycle). Keep recovering silently until submit releases the hold.
  if (examHoldLock) {
    void (async () => {
      const ok = await recoverNativeScreenShare("hold-active-stopped");
      if (ok) {
        console.info("[screen-share] recovered after stopped (hold active)");
        return;
      }
      console.warn("[screen-share] recovery pending — exam hold keeps share alive");
      for (let n = 0; n < 8 && examHoldLock; n++) {
        await new Promise((r) => setTimeout(r, 1500));
        if (!examHoldLock) return;
        const again = await recoverNativeScreenShare("hold-retry-" + n);
        if (again) return;
      }
    })();
    return;
  }
  // Hold off (student submitted / shutdown) — allow stop callbacks
  console.warn("[screen-share] SCREEN_SHARE_DISCONNECTED native stopped event");
  examHoldLock = false;
  nativeActive = false;
  latestNativeScreenJpeg = null;
  lastFrameAt = 0;
  status = "disconnected";
  const cbs = endedCallbacks.slice();
  for (const cb of cbs) {
    try {
      cb();
    } catch {
      /* ignore */
    }
  }
}

async function ensureNativeFrameListeners(): Promise<void> {
  if (!nativeStream) nativeStream = new MediaStream();
  if (listenersReady && nativeFrameUnsub && nativeStoppedUnsub) return;
  if (!nativeFrameUnsub) {
    try {
      nativeFrameUnsub = await D4ScreenShare().addListener("frame", (data) => {
        if (!data?.jpeg) return;
        try {
          applyNativeJpeg(data.jpeg, data.ts);
        } catch {
          /* ignore */
        }
      });
    } catch (e) {
      console.warn("[screen-share] frame listener failed", e);
    }
  }
  if (!nativeStoppedUnsub) {
    try {
      nativeStoppedUnsub = await D4ScreenShare().addListener("stopped", (data) => {
        handleNativeStopped(data);
      });
    } catch (e) {
      console.warn("[screen-share] stopped listener failed", e);
    }
  }
  listenersReady = Boolean(nativeFrameUnsub);
}

async function startNativeScreenShare(): Promise<ScreenShareStartResult> {
  if (startInFlight) return startInFlight;
  const run = (async (): Promise<ScreenShareStartResult> => {
    starting = true;
    try {
      status = "requesting";
      await waitNativeAndroid(12_000);
      // FGS on Android 13+ needs notification permission BEFORE MediaProjection
      try {
        await ensureNotifForScreenShare();
      } catch (ne) {
        status = "error";
        return {
          ok: false,
          reason: "denied",
          message:
            ne instanceof Error
              ? ne.message
              : "Allow notifications for screen monitoring, then try again.",
        };
      }
      await ensureNativeFrameListeners();
      try {
        const st = await D4ScreenShare().isActive();
        if (st?.active) {
          sessionGeneration += 1;
          lastStartAt = Date.now();
          nativeActive = true;
          status = "active";
          examHoldLock = true;
          try {
            await D4ScreenShare().setKeepAlive({ hold: true });
          } catch {
            /* ignore */
          }
          try {
            const fr = await D4ScreenShare().getLatestFrame();
            applyNativeJpeg(fr?.jpeg, fr?.ts);
          } catch {
            /* ignore */
          }
          console.info("[screen-share] SCREEN_SHARE_CONNECTED reused active capture");
          return { ok: true, stream: nativeStream! };
        }
      } catch {
        /* continue */
      }
      if (nativeActive && lastFrameAt > 0 && Date.now() - lastFrameAt < 12000) {
        sessionGeneration += 1;
        lastStartAt = Date.now();
        status = "active";
        examHoldLock = true;
        try {
          await D4ScreenShare().setKeepAlive({ hold: true });
        } catch {
          /* ignore */
        }
        return { ok: true, stream: nativeStream! };
      }
      const avail = await D4ScreenShare().isAvailable();
      if (!avail?.available) {
        status = "error";
        return {
          ok: false,
          reason: "unsupported",
          message: "Screen sharing is not available on this device.",
        };
      }
      status = "starting";
      console.info("[screen-share] SCREEN_SHARE_PERMISSION_REQUESTED");
      const result = await D4ScreenShare().start();
      if (!result?.active) {
        status = "error";
        return {
          ok: false,
          reason: "error",
          message: "Screen capture did not start. Please try again.",
        };
      }
      sessionGeneration += 1;
      lastStartAt = Date.now();
      nativeActive = true;
      status = "active";
      examHoldLock = true;
      try {
        await D4ScreenShare().setKeepAlive({ hold: true });
      } catch {
        /* ignore */
      }
      if (!nativeFrameUnsub || !nativeStoppedUnsub) {
        listenersReady = false;
        await ensureNativeFrameListeners();
      }
      for (let i = 0; i < 8; i++) {
        try {
          const fr = await D4ScreenShare().getLatestFrame();
          if (applyNativeJpeg(fr?.jpeg, fr?.ts)) break;
        } catch {
          /* ignore */
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      console.info(
        "[screen-share] SCREEN_SHARE_CONNECTED",
        result.reused ? "reused" : result.rebuilt ? "rebuilt" : "fresh",
        "frame=",
        Boolean(latestNativeScreenJpeg),
        "gen=",
        sessionGeneration,
      );
      return { ok: true, stream: nativeStream! };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      status = "error";
      if (/denied|cancel|permission/i.test(msg)) {
        return {
          ok: false,
          reason: "denied",
          message: "Screen sharing was denied. Enable screen share to continue the exam.",
        };
      }
      return { ok: false, reason: "error", message: msg || "Could not start screen sharing." };
    } finally {
      starting = false;
    }
  })();
  startInFlight = run;
  try {
    return await run;
  } finally {
    if (startInFlight === run) startInFlight = null;
  }
}

async function startWebScreenShare(): Promise<ScreenShareStartResult> {
  if (!hasGetDisplayMedia()) {
    return {
      ok: false,
      reason: "unsupported",
      message: "Screen sharing is not available in this browser. Use the D4EXAM Android app.",
    };
  }
  try {
    status = "requesting";
    const gdm = (
      navigator.mediaDevices as MediaDevices &
        { getDisplayMedia: (c: DisplayMediaStreamOptions) => Promise<MediaStream> }
    ).getDisplayMedia.bind(navigator.mediaDevices);
    const stream = await gdm({
      video: {
        frameRate: { ideal: 5, max: 10 },
        width: { ideal: 720, max: 1280 },
        height: { ideal: 1280, max: 1920 },
      } as MediaTrackConstraints,
      audio: false,
    } as DisplayMediaStreamOptions);
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach((t) => t.stop());
      status = "error";
      return { ok: false, reason: "error", message: "No screen track returned." };
    }
    status = "active";
    examHoldLock = true;
    nativeStream = stream;
    console.info("[screen-share] SCREEN_SHARE_CONNECTED web");
    return { ok: true, stream };
  } catch (e) {
    const name = e instanceof DOMException ? e.name : "";
    status = "error";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      return {
        ok: false,
        reason: "denied",
        message: "Screen sharing was denied. Enable screen share to continue the exam.",
      };
    }
    if (name === "NotSupportedError" || name === "NotFoundError") {
      return {
        ok: false,
        reason: "unsupported",
        message: "Screen sharing is not supported on this device.",
      };
    }
    return {
      ok: false,
      reason: "error",
      message: e instanceof Error ? e.message : "Could not start screen sharing.",
    };
  }
}


/** Android 13+ requires notification permission for MediaProjection foreground service. */
async function ensureNotifForScreenShare(): Promise<void> {
  try {
    if (typeof window === "undefined") return;
    // Must complete before MediaProjection (Android 13+ FGS needs notification permission)
    try {
      const { registerPlugin } = await import("@capacitor/core");
      const auth = registerPlugin<{
        checkNotificationPermission: () => Promise<{ display?: string }>;
        requestNotificationPermission: () => Promise<{ display?: string }>;
      }>("D4NativeAuth");
      let cur = await auth.checkNotificationPermission();
      let display = (cur?.display || "").toLowerCase();
      if (display !== "granted") {
        const req = await auth.requestNotificationPermission();
        display = (req?.display || display).toLowerCase();
      }
      if (display === "granted") return;
      if (display === "denied") {
        throw new Error(
          "Allow notifications for D4EXAM (required for screen monitoring), then start the exam again.",
        );
      }
    } catch (e) {
      if (e instanceof Error && /Allow notifications/i.test(e.message)) throw e;
      /* try LocalNotifications fallback */
    }
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform?.()) return;
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    let st = await LocalNotifications.checkPermissions();
    if (st.display !== "granted") {
      st = await LocalNotifications.requestPermissions();
    }
    if (st.display !== "granted") {
      throw new Error(
        "Allow notifications for D4EXAM (required for screen monitoring), then start the exam again.",
      );
    }
  } catch (e) {
    if (e instanceof Error && /Allow notifications/i.test(e.message)) throw e;
    /* non-fatal only when native path unavailable */
  }
}

export async function startScreenShareStream(): Promise<ScreenShareStartResult> {
  await waitNativeAndroid(12_000);
  if (isNativeAndroid()) return startNativeScreenShare();
  return startWebScreenShare();
}

export function stopScreenShareStream(stream: MediaStream | null | undefined): void {
  if (examHoldLock && isNativeAndroid()) {
    console.warn("[screen-share] stop ignored — exam hold lock active");
    if (stream && stream !== nativeStream) {
      try {
        stream.getTracks().forEach((t) => t.stop());
      } catch {
        /* ignore */
      }
    }
    return;
  }
  console.info("[screen-share] SCREEN_SHARE_STOPPED");
  status = "stopped";
  examHoldLock = false;
  sessionGeneration += 1;
  lastStartAt = 0;
  if (isNativeAndroid()) {
    nativeActive = false;
    latestNativeScreenJpeg = null;
    lastFrameAt = 0;
    try {
      void D4ScreenShare()
        .setKeepAlive({ hold: false })
        .then(() => {
          try {
            void D4ScreenShare().stop();
          } catch {
            /* ignore */
          }
        });
    } catch {
      try {
        void D4ScreenShare().stop();
      } catch {
        /* ignore */
      }
    }
  }
  if (nativeFrameUnsub) {
    try {
      nativeFrameUnsub.remove();
    } catch {
      /* ignore */
    }
    nativeFrameUnsub = null;
  }
  if (nativeStoppedUnsub) {
    try {
      nativeStoppedUnsub.remove();
    } catch {
      /* ignore */
    }
    nativeStoppedUnsub = null;
  }
  listenersReady = false;
  endedCallbacks = [];
  if (stream) {
    try {
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      /* ignore */
    }
  }
  if (nativeStream && nativeStream !== stream) {
    try {
      nativeStream.getTracks().forEach((t) => t.stop());
    } catch {
      /* ignore */
    }
  }
  nativeStream = null;
}

export function onScreenShareEnded(stream: MediaStream, onEnded: () => void): () => void {
  if (isNativeAndroid()) {
    endedCallbacks.push(onEnded);
    void ensureNativeFrameListeners();
    return () => {
      endedCallbacks = endedCallbacks.filter((c) => c !== onEnded);
    };
  }
  const track = stream?.getVideoTracks?.()?.[0];
  if (!track) return () => {};
  const handler = () => {
    // During exam hold, do not notify pause — ignore spurious ends
    if (examHoldLock) {
      console.warn("[screen-share] web track ended while hold — ignored (no pause)");
      return;
    }
    try {
      onEnded();
    } catch {
      /* ignore */
    }
  };
  track.addEventListener("ended", handler);
  return () => {
    try {
      track.removeEventListener("ended", handler);
    } catch {
      /* ignore */
    }
  };
}

export function getLatestNativeScreenJpeg(): string | null {
  if (isNativeAndroid() && !nativeFramePollInFlight) {
    nativeFramePollInFlight = true;
    void (async () => {
      try {
        await ensureNativeFrameListeners();
        const r = await D4ScreenShare().getLatestFrame();
        applyNativeJpeg(r?.jpeg, r?.ts);
        if (r?.active) {
          nativeActive = true;
          status = "active";
        }
      } catch {
        /* older APK */
      } finally {
        nativeFramePollInFlight = false;
      }
    })();
  }
  return latestNativeScreenJpeg;
}

export async function awaitLatestNativeScreenJpeg(): Promise<string | null> {
  if (!isNativeAndroid()) return latestNativeScreenJpeg;
  try {
    await ensureNativeFrameListeners();
    try {
      const ensured = await D4ScreenShare().ensureRunning();
      if (ensured?.active) {
        nativeActive = true;
        status = "active";
      }
    } catch {
      /* older APK */
    }
    const r = await D4ScreenShare().getLatestFrame();
    applyNativeJpeg(r?.jpeg, r?.ts);
    if (r?.active) {
      nativeActive = true;
      status = "active";
    }
  } catch {
    /* ignore */
  }
  return latestNativeScreenJpeg;
}

export function clearNativeScreenJpeg(): void {
  latestNativeScreenJpeg = null;
}

export function isNativeScreenShareActive(): boolean {
  return nativeActive || (lastFrameAt > 0 && Date.now() - lastFrameAt < 8000);
}

export function isExamScreenShareHold(): boolean {
  return examHoldLock;
}

export function getActiveScreenStream(): MediaStream | null {
  return nativeStream;
}

export async function refreshNativeScreenShareState(): Promise<boolean> {
  if (!isNativeAndroid()) return false;
  try {
    await ensureNativeFrameListeners();
    try {
      const ensured = await D4ScreenShare().ensureRunning();
      if (ensured?.active) {
        nativeActive = true;
        status = "active";
      }
    } catch {
      /* older APK */
    }
    try {
      const fr = await D4ScreenShare().getLatestFrame();
      if (applyNativeJpeg(fr?.jpeg, fr?.ts)) return true;
      if (fr?.active) {
        nativeActive = true;
        status = "active";
        return true;
      }
    } catch {
      /* older APK */
    }
    const st = await D4ScreenShare().isActive();
    if (st?.active) {
      nativeActive = true;
      status = "active";
      return true;
    }
  } catch {
    /* ignore */
  }
  if (lastFrameAt > 0 && Date.now() - lastFrameAt < 8000) {
    nativeActive = true;
    return true;
  }
  return nativeActive;
}
