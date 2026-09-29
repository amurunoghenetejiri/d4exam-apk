import { Capacitor, registerPlugin } from "@capacitor/core";

export type IncomingCallPayload = {
  callId: string;
  callerName: string;
  subtitle?: string;
  callType?: "voice" | "video";
};

type D4CallPlugin = {
  startIncomingRing: () => Promise<void>;
  stopIncomingRing: () => Promise<void>;
  showIncomingCallNotification: (opts: IncomingCallPayload) => Promise<void>;
  startActiveCallService: (opts: { title: string; subtitle?: string }) => Promise<void>;
  stopActiveCallService: () => Promise<void>;
  setSpeakerphone: (opts: { on: boolean }) => Promise<void>;
};

const Native = registerPlugin<D4CallPlugin>("D4Call");

export function isNativeCallSupported() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export async function nativeStartRing() {
  if (!isNativeCallSupported()) return;
  try {
    await Native.startIncomingRing();
  } catch {
    /* ignore */
  }
}

export async function nativeStopRing() {
  if (!isNativeCallSupported()) return;
  try {
    await Native.stopIncomingRing();
  } catch {
    /* ignore */
  }
}

export async function nativeShowIncoming(opts: IncomingCallPayload) {
  if (!isNativeCallSupported()) return;
  try {
    await Native.showIncomingCallNotification(opts);
  } catch {
    /* ignore */
  }
}

export async function nativeStartCallService(title: string, subtitle?: string) {
  if (!isNativeCallSupported()) return;
  try {
    await Native.startActiveCallService({ title, subtitle });
  } catch {
    /* ignore */
  }
}

export async function nativeStopCallService() {
  if (!isNativeCallSupported()) return;
  try {
    await Native.stopActiveCallService();
  } catch {
    /* ignore */
  }
}

export async function nativeSetSpeaker(on: boolean) {
  if (!isNativeCallSupported()) return;
  try {
    await Native.setSpeakerphone({ on });
  } catch {
    /* ignore */
  }
}
