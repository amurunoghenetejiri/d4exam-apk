/**
 * Global voice-note / media audio player.
 * Survives React route changes and exposes Media Session controls.
 */

type AudioListener = (state: {
  voiceId: string | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
}) => void;

class GlobalAudioManager {
  private audio: HTMLAudioElement | null = null;
  private currentVoiceId: string | null = null;
  private listeners = new Set<AudioListener>();
  private raf: number | null = null;
  private currentSpeed = 1;

  constructor() {
    if (typeof window !== "undefined") {
      this.audio = new Audio();
      this.audio.preload = "auto";
      this.setupAudioListeners();
      this.setupMediaSession();
    }
  }

  private setupAudioListeners() {
    if (!this.audio) return;

    this.audio.addEventListener("ended", () => {
      this.stopProgressLoop();
      this.emit();
      try {
        window.dispatchEvent(
          new CustomEvent("d4-voice-ended", { detail: { voiceId: this.currentVoiceId } }),
        );
      } catch {
        /* ignore */
      }
    });

    this.audio.addEventListener("pause", () => {
      this.stopProgressLoop();
      this.emit();
    });

    this.audio.addEventListener("play", () => {
      this.startProgressLoop();
      this.emit();
    });
  }

  private setupMediaSession() {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;

    try {
      navigator.mediaSession.setActionHandler("play", () => this.resume());
      navigator.mediaSession.setActionHandler("pause", () => this.pause());
      navigator.mediaSession.setActionHandler("seekto", (details) => {
        if (details.seekTime !== undefined && this.audio) {
          this.audio.currentTime = details.seekTime;
          this.emit();
        }
      });
    } catch {
      /* ignore */
    }
  }

  private updateMediaSessionMetadata(title: string, artist: string) {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: title || "Voice Note",
        artist: artist || "D4EXAM Messages",
        album: "Voice Messages",
        artwork: [{ src: "/logo.png", sizes: "512x512", type: "image/png" }],
      });
    } catch {
      /* ignore */
    }
  }

  public playVoice(voiceId: string, url: string, senderName = "Voice Note", initialSpeed = 1) {
    if (!this.audio) return;

    if (this.currentVoiceId === voiceId && this.audio.src && !this.audio.paused) {
      this.pause();
      return;
    }

    if (this.currentVoiceId === voiceId && this.audio.src && this.audio.paused && !this.audio.ended) {
      this.resume();
      return;
    }

    this.currentVoiceId = voiceId;
    this.currentSpeed = initialSpeed;
    this.audio.src = url;
    this.audio.playbackRate = this.currentSpeed;
    this.updateMediaSessionMetadata(`Voice note (${senderName})`, "D4EXAM");

    void this.audio.play().catch((err) => {
      console.warn("[GlobalAudio] Playback prevented", err);
    });
  }

  public pause() {
    this.audio?.pause();
  }

  public resume() {
    void this.audio?.play().catch(() => undefined);
  }

  public seek(ratio: number) {
    if (!this.audio || !Number.isFinite(this.audio.duration)) return;
    this.audio.currentTime = ratio * this.audio.duration;
    this.emit();
  }

  public setRate(rate: number) {
    this.currentSpeed = rate;
    if (this.audio) this.audio.playbackRate = rate;
    this.emit();
  }

  public stop() {
    if (!this.audio) return;
    this.audio.pause();
    this.audio.currentTime = 0;
    this.currentVoiceId = null;
    this.emit();
  }

  public subscribe(fn: AudioListener) {
    this.listeners.add(fn);
    fn(this.getState());
    return () => {
      this.listeners.delete(fn);
    };
  }

  public getState() {
    return {
      voiceId: this.currentVoiceId,
      playing: Boolean(this.audio && !this.audio.paused && !this.audio.ended),
      currentTime: this.audio?.currentTime || 0,
      duration: this.audio && Number.isFinite(this.audio.duration) ? this.audio.duration : 0,
      playbackRate: this.currentSpeed,
    };
  }

  private emit() {
    const s = this.getState();
    this.listeners.forEach((fn) => fn(s));
  }

  private startProgressLoop() {
    this.stopProgressLoop();
    const tick = () => {
      this.emit();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private stopProgressLoop() {
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
  }
}

export const globalAudio = new GlobalAudioManager();
