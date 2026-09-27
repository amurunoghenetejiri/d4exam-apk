/**
 * Android status bar theming for Capacitor.
 * During CBT exams, enterExamImmersive() hides status + navigation bars.
 */
import { registerPlugin } from "@capacitor/core";
import { isNativeShell } from "@/native/platform";

export const D4EXAM_STATUS_BAR = "#0b1b3a";

type ExamImmersivePlugin = {
  enter(): Promise<void>;
  exit(): Promise<void>;
};

const ExamImmersive = registerPlugin<ExamImmersivePlugin>("ExamImmersive");

function setImmersiveCss(on: boolean) {
  if (typeof document === "undefined") return;
  try {
    document.documentElement.classList.toggle("d4-exam-immersive", on);
    document.body.classList.toggle("d4-exam-immersive", on);
  } catch {
    /* ignore */
  }
}

async function nativeExamImmersive(enter: boolean): Promise<void> {
  if (!isNativeShell()) return;
  try {
    if (enter) await ExamImmersive.enter();
    else await ExamImmersive.exit();
  } catch {
    /* plugin may be missing on web / old APK */
  }
}

export async function applyNativeStatusBar(): Promise<void> {
  if (!isNativeShell()) return;
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setOverlaysWebView({ overlay: false });
    await StatusBar.setBackgroundColor({ color: D4EXAM_STATUS_BAR });
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.show();
  } catch (e) {
    console.warn("[D4EXAM] StatusBar plugin unavailable", e);
  }
}

/** Hide system chrome during a locked CBT session (status bar + navigation bar). */
export async function enterExamImmersive(): Promise<void> {
  setImmersiveCss(true);

  if (isNativeShell()) {
    try {
      const { StatusBar } = await import("@capacitor/status-bar");
      try {
        await StatusBar.setOverlaysWebView({ overlay: true });
      } catch {
        /* older plugin */
      }
      await StatusBar.hide();
    } catch (e) {
      console.warn("[D4EXAM] enterExamImmersive StatusBar", e);
    }
    await nativeExamImmersive(true);
  }

  try {
    const el = document.documentElement as HTMLElement & {
      requestFullscreen?: () => Promise<void>;
      webkitRequestFullscreen?: () => void;
    };
    if (!document.fullscreenElement) {
      if (el.requestFullscreen) await el.requestFullscreen();
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    }
  } catch {
    /* blocked by policy */
  }
}

/** Restore normal status + navigation bars after exam ends or is left. */
export async function exitExamImmersive(): Promise<void> {
  setImmersiveCss(false);
  try {
    if (document.fullscreenElement) await document.exitFullscreen?.();
  } catch {
    /* ignore */
  }
  await nativeExamImmersive(false);
  if (!isNativeShell()) return;
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    try {
      await StatusBar.setOverlaysWebView({ overlay: false });
    } catch {
      /* older plugin */
    }
    await StatusBar.setBackgroundColor({ color: D4EXAM_STATUS_BAR });
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.show();
  } catch (e) {
    console.warn("[D4EXAM] exitExamImmersive", e);
  }
}

export async function hideSplashSafely(): Promise<void> {
  if (!isNativeShell()) return;
  try {
    const { SplashScreen } = await import("@capacitor/splash-screen");
    await SplashScreen.hide({ fadeOutDuration: 0 });
  } catch {
    /* ignore */
  }
}
