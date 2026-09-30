import React, { useEffect, useRef, useState } from "react";
import {
  Mic, MicOff, PhoneOff, Video, VideoOff, Volume2, VolumeX, SwitchCamera,
  Loader2, MoreHorizontal, MonitorUp, MessageCircle, Phone, ChevronDown, User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  acceptIncomingCall, attachCallVideos, dismissCallUi, endCall, flipCamera,
  getCallSession, minimizeCall, rejectIncomingCall, restoreCall, startOutgoingCall,
  startScreenShare, stopScreenShare, subscribeCallSession, toggleCam, toggleMute,
  toggleSpeaker, upgradeToVideo, type CallSessionState,
} from "@/lib/call-session";
import { appNavigate } from "@/lib/app-navigate";
import { startDirectCall, notifyCalleeOfIncomingCall } from "@/lib/calls";

export type ActiveCall = {
  callId: string;
  callType: "voice" | "video";
  peerId: string;
  peerName: string;
  peerAvatar: string | null;
  peerMatric?: string | null;
  isCaller: boolean;
  conversationId?: string | null;
};

function PeerFace({ name, src, className }: { name: string; src?: string | null; className?: string }) {
  return (
    <span className={cn("relative grid place-items-center overflow-hidden rounded-full bg-[#1e3a5f]", className)}>
      {src ? (
        <img src={src} alt={name} className="h-full w-full object-cover" />
      ) : (
        <img src="/logo.png" alt="D4EXAM" className="h-[65%] w-[65%] object-contain opacity-95" />
      )}
    </span>
  );
}

/** Exported so nothing can crash with "RingWaves is not defined". */
export function RingWaves() {
  return (
    <>
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className="pointer-events-none absolute left-1/2 top-1/2 rounded-full border border-sky-400/40"
          style={{
            width: `${7.5 + i * 2.2}rem`,
            height: `${7.5 + i * 2.2}rem`,
            marginLeft: `-${(7.5 + i * 2.2) / 2}rem`,
            marginTop: `-${(7.5 + i * 2.2) / 2}rem`,
            animation: `d4RingPulse 2.2s cubic-bezier(0.2, 0.8, 0.2, 1) infinite`,
            animationDelay: `${i * 0.45}s`,
          }}
        />
      ))}
      <style>{`
        @keyframes d4RingPulse {
          0% { transform: scale(0.85); opacity: 0.85; border-color: rgba(56, 189, 248, 0.6); }
          100% { transform: scale(1.35); opacity: 0; border-color: rgba(56, 189, 248, 0); }
        }
        @keyframes d4Breath {
          0%, 100% { transform: scale(1); filter: drop-shadow(0 0 16px rgba(37, 99, 235, 0.6)); }
          50% { transform: scale(1.06); filter: drop-shadow(0 0 32px rgba(59, 130, 246, 0.9)); }
        }
      `}</style>
    </>
  );
}

function D4Center({ pulsing }: { pulsing?: boolean }) {
  return (
    <div className="relative grid place-items-center py-8">
      {pulsing ? <RingWaves /> : null}
      <div
        className="relative z-10 grid h-[7.5rem] w-[7.5rem] place-items-center rounded-full bg-gradient-to-br from-[#2563eb] via-[#1e3a6e] to-[#0b1b3a] ring-2 ring-sky-400/70"
        style={pulsing ? { animation: "d4Breath 2s ease-in-out infinite" } : undefined}
      >
        <img src="/logo.png" alt="D4" className="h-[4.25rem] w-[4.25rem] object-contain" />
      </div>
    </div>
  );
}

/** Pill control bar — matches reference: ··· · video · speaker · mute · end */
function PillControls({
  muted,
  speakerOn,
  isVideo,
  camOff,
  moreOpen,
  onMute,
  onSpeaker,
  onVideo,
  onMore,
  onEnd,
}: {
  muted: boolean;
  speakerOn: boolean;
  isVideo: boolean;
  camOff: boolean;
  moreOpen: boolean;
  onMute: () => void;
  onSpeaker: () => void;
  onVideo: () => void;
  onMore: () => void;
  onEnd: () => void;
}) {
  return (
    <div className="mx-auto flex items-center justify-center gap-2.5 rounded-full bg-[#1a2332]/95 px-3.5 py-2.5 shadow-2xl ring-1 ring-white/10 backdrop-blur-md">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onMore(); }}
        className={cn(
          "grid h-11 w-11 place-items-center rounded-full transition active:scale-95",
          moreOpen ? "bg-white text-[#0b1b3a]" : "bg-[#2a3544] text-white",
        )}
        aria-label="More"
      >
        <MoreHorizontal className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onVideo(); }}
        className={cn(
          "grid h-11 w-11 place-items-center rounded-full transition active:scale-95",
          isVideo && !camOff ? "bg-white text-[#0b1b3a]" : "bg-[#2a3544] text-white",
        )}
        aria-label={isVideo ? "Camera" : "Video"}
      >
        {isVideo && camOff ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onSpeaker(); }}
        className={cn(
          "grid h-11 w-11 place-items-center rounded-full transition active:scale-95",
          speakerOn ? "bg-white text-[#0b1b3a]" : "bg-[#2a3544] text-white",
        )}
        aria-label="Speaker"
      >
        {speakerOn ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onMute(); }}
        className={cn(
          "grid h-11 w-11 place-items-center rounded-full transition active:scale-95",
          muted ? "bg-white text-[#0b1b3a]" : "bg-[#2a3544] text-white",
        )}
        aria-label="Mute"
      >
        {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onEnd(); }}
        className="grid h-11 w-11 place-items-center rounded-full bg-rose-500 text-white shadow-lg shadow-rose-500/30 transition active:scale-95"
        aria-label="End call"
      >
        <PhoneOff className="h-5 w-5" />
      </button>
    </div>
  );
}

function MoreMenu({
  sharingScreen,
  isVideo,
  onSwitchCamera,
  onShare,
  onMessage,
  onClose,
}: {
  sharingScreen: boolean;
  isVideo: boolean;
  onSwitchCamera: () => void;
  onShare: () => void;
  onMessage: () => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-x-0 bottom-[5.5rem] z-40 flex justify-center px-6">
      <div className="w-full max-w-[16rem] overflow-hidden rounded-2xl bg-[#1e293b]/95 py-1 shadow-2xl ring-1 ring-white/10 backdrop-blur-md">
        {isVideo ? (
          <button
            type="button"
            className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium text-white active:bg-white/10"
            onClick={() => { onClose(); onSwitchCamera(); }}
          >
            <SwitchCamera className="h-4 w-4 text-white/80" />
            Switch camera
          </button>
        ) : null}
        <button
          type="button"
          className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium text-white active:bg-white/10"
          onClick={() => { onClose(); onShare(); }}
        >
          <MonitorUp className="h-4 w-4 text-white/80" />
          {sharingScreen ? "Stop screen share" : "Share screen"}
        </button>
        <button
          type="button"
          className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium text-white active:bg-white/10"
          onClick={() => { onClose(); onMessage(); }}
        >
          <MessageCircle className="h-4 w-4 text-white/80" />
          Send message
        </button>
      </div>
    </div>
  );
}

export function CallOverlay({
  call,
  myUserId,
  onClose,
}: {
  call: ActiveCall | null;
  myUserId: string;
  onClose: () => void;
}) {
  const [session, setSession] = useState<CallSessionState | null>(getCallSession());
  const [moreOpen, setMoreOpen] = useState(false);
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const bootstrapped = useRef<string | null>(null);
  const [closed, setClosed] = useState(false);

  useEffect(() => subscribeCallSession(setSession), []);

  useEffect(() => {
    setClosed(false);
    bootstrapped.current = null;
  }, [call?.callId]);

  useEffect(() => {
    if (!call || !myUserId) return;
    if (bootstrapped.current === call.callId) return;
    const cur = getCallSession();
    if (cur && cur.callId === call.callId) {
      bootstrapped.current = call.callId;
      return;
    }
    bootstrapped.current = call.callId;
    if (call.isCaller) {
      void startOutgoingCall({
        callId: call.callId,
        callType: call.callType,
        peerId: call.peerId,
        peerName: call.peerName,
        peerAvatar: call.peerAvatar,
        peerMatric: call.peerMatric,
        conversationId: call.conversationId,
        myUserId,
      });
    }
  }, [call, myUserId]);

  useEffect(() => {
    attachCallVideos(localRef.current, remoteRef.current);
  }, [session?.phase, session?.callType]);

  const view = session || (call ? {
    callId: call.callId,
    callType: call.callType,
    phase: "calling" as const,
    peerId: call.peerId,
    peerName: call.peerName,
    peerAvatar: call.peerAvatar,
    peerMatric: call.peerMatric,
    isCaller: call.isCaller,
    conversationId: call.conversationId,
    myUserId,
    muted: false,
    camOff: false,
    speakerOn: call.callType === "video",
    facing: "user" as const,
    seconds: 0,
    sharingScreen: false,
    error: null,
  } : null);

  if (closed) return null;
  if (!view && !call) return null;
  if (view?.phase === "minimized") return <MinimizedTopBar session={view} onClose={onClose} />;
  if (!view) return null;

  const isVideo = view.callType === "video";
  const connected = view.phase === "active";
  const mm = String(Math.floor(view.seconds / 60)).padStart(2, "0");
  const ss = String(view.seconds % 60).padStart(2, "0");
  const sub = view.peerMatric || "";

  const doEnd = () => {
    void (async () => {
      try {
        await endCall("ended");
      } catch {
        /* ignore */
      }
      setClosed(true);
      onClose();
      if (view.conversationId) {
        appNavigate(`/student/messages?chat=${encodeURIComponent(view.conversationId)}`);
      }
    })();
  };

  const closeAll = () => {
    setClosed(true);
    void dismissCallUi();
    onClose();
  };

  const redial = async () => {
    try {
      const callId = await startDirectCall({
        calleeId: view.peerId,
        callType: view.callType,
        conversationId: view.conversationId,
      });
      void notifyCalleeOfIncomingCall({
        calleeId: view.peerId,
        callId,
        callType: view.callType,
        callerName: view.peerName || "D4EXAM",
        callerMatric: view.peerMatric,
        fromUserId: view.myUserId,
        conversationId: view.conversationId,
      });
      void startOutgoingCall({
        callId,
        callType: view.callType,
        peerId: view.peerId,
        peerName: view.peerName,
        peerAvatar: view.peerAvatar,
        peerMatric: view.peerMatric,
        conversationId: view.conversationId,
        myUserId: view.myUserId,
      });
    } catch {
      /* ignore */
    }
  };

  if (["no_answer", "failed", "declined", "missed"].includes(view.phase)) {
    const title =
      view.phase === "no_answer" ? "No answer" :
      view.phase === "declined" ? "Call declined" :
      view.phase === "missed" ? "Missed Call" : "Call failed";
    return (
      <div className="fixed inset-0 z-[200] flex flex-col bg-gradient-to-b from-[#0b1b3a] to-[#071022] text-white">
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="grid h-20 w-20 place-items-center rounded-full bg-white/10 ring-2 ring-rose-400/40">
            <PhoneOff className="h-9 w-9 text-rose-300" />
          </div>
          <p className="text-xl font-extrabold">{title}</p>
          <p className="text-base font-semibold">{view.peerName}</p>
          {sub ? <p className="text-sm text-white/55">{sub}</p> : null}
          <div className="mt-6 flex w-full max-w-xs flex-col gap-2.5">
            <button
              type="button"
              className="rounded-full bg-[#2563eb] py-3 text-sm font-bold text-white shadow-lg active:scale-95"
              onClick={() => void redial()}
            >
              Call again
            </button>
            <button
              type="button"
              className="rounded-full bg-white/10 py-3 text-sm font-semibold text-white active:scale-95"
              onClick={() => {
                closeAll();
                if (view.conversationId) {
                  appNavigate(`/student/messages?chat=${encodeURIComponent(view.conversationId)}`);
                } else {
                  appNavigate("/student/messages");
                }
              }}
            >
              Send message
            </button>
            <button type="button" className="py-2.5 text-sm text-white/50 active:text-white" onClick={closeAll}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (view.phase === "ringing" && !view.isCaller) {
    return (
      <div className="fixed inset-0 z-[200] flex flex-col justify-between bg-gradient-to-b from-[#0b1b3a] via-[#0d2140] to-[#071022] text-white">
        <div className="flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <button
            type="button"
            onClick={() => minimizeCall()}
            className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold backdrop-blur active:scale-95"
          >
            <ChevronDown className="h-4 w-4" /> Minimize
          </button>
          <div className="text-center">
            <p className="text-sm font-bold text-white">{view.peerName}</p>
            {sub ? <p className="text-[11px] text-white/55">{sub}</p> : null}
          </div>
          <span className="w-16" />
        </div>

        <div className="flex flex-col items-center justify-center px-6">
          <div className="relative mb-6">
            <RingWaves />
            <PeerFace
              name={view.peerName}
              src={view.peerAvatar}
              className="relative z-10 h-32 w-32 ring-4 ring-[#3b82f6] shadow-[0_0_50px_rgba(37,99,235,0.55)]"
            />
          </div>
          <h1 className="text-center text-2xl font-extrabold tracking-tight">{view.peerName}</h1>
          {sub ? <p className="mt-1 text-sm font-medium text-white/60">{sub}</p> : null}
          <p className="mt-4 flex items-center gap-2 text-sm font-semibold text-sky-300">
            <span className="inline-block h-2.5 w-2.5 animate-ping rounded-full bg-sky-400" />
            {isVideo ? "Incoming Video Call…" : "Incoming Voice Call…"}
          </p>
        </div>

        <div className="flex items-center justify-around px-8 pb-[max(3rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => {
              void (async () => {
                await rejectIncomingCall();
                setClosed(true);
                onClose();
              })();
            }}
            className="flex flex-col items-center gap-2 active:scale-95"
          >
            <span className="grid h-16 w-16 place-items-center rounded-full bg-rose-500 shadow-xl shadow-rose-500/40 ring-4 ring-rose-400/20">
              <PhoneOff className="h-8 w-8 text-white" />
            </span>
            <span className="text-xs font-bold text-white/90">Decline</span>
          </button>

          <button
            type="button"
            onClick={() => {
              void acceptIncomingCall({
                callId: view.callId,
                callType: view.callType,
                peerId: view.peerId,
                peerName: view.peerName,
                peerAvatar: view.peerAvatar,
                peerMatric: view.peerMatric,
                conversationId: view.conversationId,
                myUserId: view.myUserId,
              });
            }}
            className="flex flex-col items-center gap-2 active:scale-95"
          >
            <span className="grid h-16 w-16 place-items-center rounded-full bg-emerald-500 shadow-xl shadow-emerald-500/40 ring-4 ring-emerald-400/20">
              <Phone className="h-8 w-8 text-white" />
            </span>
            <span className="text-xs font-bold text-white/90">Accept</span>
          </button>
        </div>
      </div>
    );
  }

  const statusLine =
    connected ? "Connected" :
    view.phase === "connecting" ? "Connecting…" :
    view.phase === "ringing" ? "Ringing…" :
    view.phase === "calling" ? "Calling…" : String(view.phase);

  return (
    <div className="fixed inset-0 z-[200] flex flex-col overflow-hidden bg-gradient-to-b from-[#0b1b3a] via-[#0d2140] to-[#071022] text-white">
      {isVideo && connected ? (
        <div className="absolute inset-0 bg-black">
          <video ref={remoteRef} autoPlay playsInline className="h-full w-full object-cover" />
          <div className="absolute right-4 top-[max(3.5rem,calc(env(safe-area-inset-top)+2.5rem))] overflow-hidden rounded-xl border border-white/20 shadow-2xl">
            <video ref={localRef} autoPlay playsInline muted className="h-32 w-24 object-cover" />
          </div>
        </div>
      ) : (
        <>
          <video ref={remoteRef} autoPlay playsInline className="pointer-events-none absolute h-0 w-0 opacity-0" />
          <video ref={localRef} autoPlay playsInline muted className="pointer-events-none absolute h-0 w-0 opacity-0" />
        </>
      )}

      <div className="relative z-20 flex items-start justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); minimizeCall(); }}
          className="mt-0.5 flex items-center gap-1 rounded-full bg-black/30 px-3 py-1.5 text-xs font-semibold backdrop-blur active:scale-95"
        >
          <ChevronDown className="h-4 w-4" /> Minimize
        </button>
        <div className="min-w-0 flex-1 px-2 text-center">
          <p className="truncate text-base font-bold text-white">{view.peerName}</p>
          {sub ? <p className="truncate text-xs text-white/55">{sub}</p> : null}
          <p className="mt-0.5 text-[11px] font-semibold text-sky-300/90">{statusLine}{connected ? ` · ${mm}:${ss}` : ""}</p>
        </div>
        <span className="w-16" />
      </div>

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6">
        {!(isVideo && connected) ? (
          <>
            {view.phase === "calling" || view.phase === "connecting" || view.phase === "ringing" ? (
              <D4Center pulsing />
            ) : (
              <div className="relative mb-4">
                <PeerFace name={view.peerName} src={view.peerAvatar} className="h-28 w-28 ring-[3px] ring-[#3b82f6]/70 shadow-2xl" />
              </div>
            )}
            {(view.phase === "calling" || view.phase === "connecting") && (
              <p className="mt-4 flex items-center gap-2 text-xs text-white/50">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {view.phase === "calling" ? "Waiting for answer…" : "Setting up media…"}
              </p>
            )}
            {view.error ? <p className="mt-3 max-w-xs text-center text-sm font-medium text-rose-300">{view.error}</p> : null}
          </>
        ) : null}
      </div>

      <div className="relative z-20 px-4 pb-[max(1.75rem,env(safe-area-inset-bottom))] pt-2">
        {moreOpen ? (
          <MoreMenu
            sharingScreen={Boolean(view.sharingScreen)}
            isVideo={isVideo}
            onSwitchCamera={() => void flipCamera()}
            onShare={() => {
              if (view.sharingScreen) void stopScreenShare();
              else void startScreenShare();
            }}
            onMessage={() => {
              const cid = view.conversationId;
              if (cid) appNavigate(`/student/messages?chat=${encodeURIComponent(cid)}`);
              else appNavigate("/student/messages");
            }}
            onClose={() => setMoreOpen(false)}
          />
        ) : null}
        <PillControls
          muted={view.muted}
          speakerOn={view.speakerOn}
          isVideo={isVideo}
          camOff={view.camOff}
          moreOpen={moreOpen}
          onMute={() => toggleMute()}
          onSpeaker={() => void toggleSpeaker()}
          onVideo={() => {
            if (isVideo) toggleCam();
            else void upgradeToVideo();
          }}
          onMore={() => setMoreOpen((v) => !v)}
          onEnd={doEnd}
        />
      </div>
    </div>
  );
}

function MinimizedTopBar({
  session,
  onClose,
}: {
  session: CallSessionState;
  onClose?: () => void;
}) {
  const mm = String(Math.floor(session.seconds / 60)).padStart(2, "0");
  const ss = String(session.seconds % 60).padStart(2, "0");
  const prev = (session as { _preMinimizePhase?: string })._preMinimizePhase;
  const isIncomingRing = !session.isCaller && (prev === "ringing" || session.phase === "ringing");
  const isActive = session.seconds > 0 || prev === "active";
  const status =
    isActive ? `${mm}:${ss}` :
    prev === "connecting" || session.phase === "connecting" ? "Connecting…" :
    isIncomingRing ? "Ringing…" : "Calling…";

  return (
    <div className="fixed inset-x-0 top-0 z-[160] pt-[env(safe-area-inset-top,0px)]">
      <div className="mx-2 mt-1.5 flex items-center gap-2 rounded-2xl bg-[#0b1b3a]/97 px-3 py-2.5 text-white shadow-2xl ring-1 ring-[#3b82f6]/35 backdrop-blur-md">
        <button type="button" onClick={() => restoreCall()} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <PeerFace name={session.peerName} src={session.peerAvatar} className="h-11 w-11 shrink-0 ring-2 ring-[#3b82f6]/50" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold leading-tight">{session.peerName}</p>
            {session.peerMatric ? (
              <p className="truncate text-[10px] text-white/50">{session.peerMatric}</p>
            ) : null}
            <p className={cn("text-[11px] font-semibold", isActive ? "text-emerald-300" : "text-sky-300")}>
              {status}
            </p>
          </div>
        </button>
        {isIncomingRing ? (
          <>
            <button
              type="button"
              className="grid h-11 w-11 place-items-center rounded-full bg-rose-500 shadow-md active:scale-95"
              onClick={() => void rejectIncomingCall()}
              aria-label="Decline"
            >
              <PhoneOff className="h-5 w-5" />
            </button>
            <button
              type="button"
              className="grid h-11 w-11 place-items-center rounded-full bg-emerald-500 shadow-md active:scale-95"
              onClick={() => void acceptIncomingCall({
                callId: session.callId,
                callType: session.callType,
                peerId: session.peerId,
                peerName: session.peerName,
                peerAvatar: session.peerAvatar,
                peerMatric: session.peerMatric,
                conversationId: session.conversationId,
                myUserId: session.myUserId,
              })}
              aria-label="Accept"
            >
              <Phone className="h-5 w-5" />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void toggleSpeaker()}
              className={cn("grid h-10 w-10 place-items-center rounded-full", session.speakerOn ? "bg-white text-[#0b1b3a]" : "bg-white/15")}
            >
              {session.speakerOn ? <Volume2 className="h-4.5 w-4.5" /> : <VolumeX className="h-4.5 w-4.5" />}
            </button>
            <button
              type="button"
              onClick={() => {
                void endCall("ended");
                onClose?.();
              }}
              className="grid h-10 w-10 place-items-center rounded-full bg-rose-500 shadow-md active:scale-95"
              aria-label="End call"
            >
              <PhoneOff className="h-4.5 w-4.5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Alias used by messages list (minimized call UI). */
export function MinimizedCallBubble() {
  const [session, setSession] = useState<CallSessionState | null>(getCallSession());
  useEffect(() => subscribeCallSession(setSession), []);
  if (!session || session.phase !== "minimized") return null;
  return <MinimizedTopBar session={session} />;
}

