/**
 * Incoming-call ringtone for web + native bridge.
 * Native APK uses system RingtoneManager; web uses looped oscillator tone.
 */
import { Capacitor } from "@capacitor/core";
import { nativeStartRing, nativeStopRing } from "@/lib/native-call";

let audioCtx: AudioContext | null = null;
let osc: OscillatorNode | null = null;
let gain: GainNode | null = null;
let interval: ReturnType<typeof setInterval> | null = null;
let playing = false;

function startWebRing() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audioCtx = new Ctx();
    const playBeep = () => {
      if (!audioCtx) return;
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = "sine";
      o.frequency.value = 440;
      g.gain.value = 0.0001;
      o.connect(g);
      g.connect(audioCtx.destination);
      const now = audioCtx.currentTime;
      g.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
      o.start(now);
      o.stop(now + 0.4);
    };
    playBeep();
    interval = setInterval(playBeep, 1200);
    // Second tone pattern (like phone ring)
    window.setTimeout(() => {
      if (playing) playBeep();
    }, 400);
  } catch {
    /* ignore */
  }
}

function stopWebRing() {
  try {
    if (interval) clearInterval(interval);
    interval = null;
    try {
      osc?.stop();
    } catch {
      /* ignore */
    }
    osc = null;
    gain = null;
    void audioCtx?.close();
    audioCtx = null;
  } catch {
    /* ignore */
  }
}

export async function startCallRingtone() {
  if (playing) return;
  playing = true;
  if (Capacitor.isNativePlatform()) {
    await nativeStartRing();
  }
  // Always also try web tone (covers browser + when native silent)
  startWebRing();
}

export async function stopCallRingtone() {
  playing = false;
  stopWebRing();
  await nativeStopRing();
}
