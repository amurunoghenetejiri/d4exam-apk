import React, { useEffect, useRef, useState } from "react";
import {
  Mic, MicOff, PhoneOff, Video, VideoOff, Volume2, VolumeX, SwitchCamera,
  Loader2, MoreHorizontal, MonitorUp, MessageCircle, Phone, ChevronDown, PhoneCall, User,
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
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <img src="/logo.png" alt="" className="h-[65%] w-[65%] object-contain opacity-95" />
      )}
    </span>
  );
}

function OrbitRings() {
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="pointer-events-none absolute left-1/2 top-1/2 rounded-full"
          style={{
            width: `${7.2 + i * 1.85}rem`,
            height: `${7.2 + i * 1.85}rem`,
            marginLeft: `-${(7.2 + i * 1.85) / 2}rem`,
            marginTop: `-${(7.2 + i * 1.85) / 2}rem`,
            border: "1.5px solid rgba(96,165,250,0.35)",
            animation: `d4Orbit ${2.4 + i * 0.35}s linear infinite`,
            animationDelay: `${i * 0.2}s`,
            boxShadow: "0 0 12px rgba(59,130,246,0.15)",
          }}
        />
      ))}
      <style>{`
        @keyframes d4Orbit {
          0% { transform: rotate(0deg) scale(1); opacity: 0.55; border-color: rgba(96,165,250,0.5); }
          50% { transform: rotate(180deg) scale(1.06); opacity: 0.25; border-color: rgba(147,197,253,0.25); }
          100% { transform: rotate(360deg) scale(1); opacity: 0.55; border-color: rgba(96,165,250,0.5); }
        }
        @keyframes d4Breath {
          0%, 100% { transform: scale(1); filter: drop-shadow(0 0 18px rgba(37,99,235,0.55)); }
          50% { transform: scale(1.07); filter: drop-shadow(0 0 36px rgba(59,130,246,0.85)); }
        }
      `}</style>
    </>
  );
}

function D4Center({ pulsing }: { pulsing?: boolean }) {
  return (
    <div className="relative grid place-items-center py-8">
      {pulsing ? <OrbitRings /> : null}
      <div
        className="relative z-10 grid h-[7.5rem] w-[7.5rem] place-items-center rounded-full bg-gradient-to-br from-[#2563eb] via-[#1e3a6e] to-[#0b1b3a] ring-2 ring-sky-400/70"
        style={pulsing ? { animation: "d4Breath 2s ease-in-out infinite" } : undefined}
      >
        <img src="/logo.png" alt="D4" className="h-[4.25rem] w-[4.25rem] object-contain" />
      </div>
    </div>
  );
}

function CtrlBtn({
  icon, label, onClick, active, danger,
}: { icon: React.ReactNode; label: string; onClick: () => void; active?: boolean; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-center gap-1.5 active:scale-95">
      <span className={cn(
        "grid h-14 w-14 place-items-center rounded-full text-white shadow-lg",
        danger ? "bg-rose-500" : active ? "bg-white text-[#0b1b3a]" : "bg-white/15 backdrop-blur",
      )}>
        {icon}
      </span>
      <span className="text-[11px] font-medium text-white/75">{label}</span>
    </button>
  );
}

export function CallOverlay({
  call, myUserId, onClose,
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
        callId: call.callId, callType: call.callType, peerId: call.peerId,
        peerName: call.peerName, peerAvatar: call.peerAvatar, peerMatric: call.peerMatric,
        conversationId: call.conversationId, myUserId,
      });
    }
  }, [call, myUserId]);
  useEffect(() => { attachCallVideos(localRef.current, remoteRef.current); }, [session?.phase, session?.callType]);

  const view = session || (call ? {
    callId: call.callId, callType: call.callType, phase: "calling" as const,
    peerId: call.peerId, peerName: call.peerName, peerAvatar: call.peerAvatar,
    peerMatric: call.peerMatric, isCaller: call.isCaller, conversationId: call.conversationId,
    myUserId, muted: false, camOff: false, speakerOn: call.callType === "video",
    facing: "user" as const, seconds: 0, sharingScreen: false, error: null,
  } : null);

  if (closed) return null;
  if (!view && !call) return null;
  if (view?.phase === "minimized") return <MinimizedTopBar session={view} />;
  if (!view) return null;

  const isVideo = view.callType === "video";
  const connected = view.phase === "active";
  const mm = String(Math.floor(view.seconds / 60)).padStart(2, "0");
  const ss = String(view.seconds % 60).padStart(2, "0");
  const sub = view.peerMatric || "";

  const closeAll = () => { void dismissCallUi(); onClose(); };

  const redial = async () => {
    try {
      const callId = await startDirectCall({ calleeId: view.peerId, callType: view.callType, conversationId: view.conversationId });
      void notifyCalleeOfIncomingCall({ calleeId: view.peerId, callId, callType: view.callType, callerName: "D4EXAM", callerMatric: view.peerMatric });
      void startOutgoingCall({
        callId, callType: view.callType, peerId: view.peerId, peerName: view.peerName,
        peerAvatar: view.peerAvatar, peerMatric: view.peerMatric, conversationId: view.conversationId, myUserId: view.myUserId,
      });
    } catch { /* ignore */ }
  };

  // End states
  if (["no_answer", "failed", "declined", "missed"].includes(view.phase)) {
    const title =
      view.phase === "no_answer" ? "No answer" :
      view.phase === "declined" ? "Call declined" :
      view.phase === "missed" ? "Missed Call" : "Call failed";
    return (
      <div className="fixed inset-0 z-[200] flex flex-col bg-gradient-to-b from-[#0b1b3a] to-[#071022] text-white">
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="grid h-20 w-20 place-items-center rounded-full bg-white/10">
            <PhoneOff className="h-9 w-9 text-rose-300" />
          </div>
          <p className="text-xl font-extrabold">{title}</p>
          <p className="text-base font-semibold">{view.peerName}</p>
          {sub ? <p className="text-sm text-white/55">{sub}</p> : null}
          <div className="mt-4 flex w-full max-w-xs flex-col gap-2">
            <button type="button" className="rounded-full bg-[#2563eb] py-3 text-sm font-bold" onClick={() => void redial()}>Call again</button>
            <button type="button" className="rounded-full bg-white/10 py-3 text-sm font-semibold" onClick={() => {
              closeAll();
              if (view.conversationId) appNavigate(`/student/messages?chat=${encodeURIComponent(view.conversationId)}`);
              else appNavigate("/student/messages");
            }}>Send message</button>
            <button type="button" className="py-2 text-sm text-white/50" onClick={closeAll}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  // Incoming ringing — matches reference: large face/logo, pulse rings, Decline + swipe Accept
  if (view.phase === "ringing" && !view.isCaller) {
    return (
      <div className="fixed inset-0 z-[200] flex flex-col bg-gradient-to-b from-[#0b1b3a] via-[#0d2140] to-[#071022] text-white">
        <div className="flex items-center justify-between px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <button type="button" onClick={() => minimizeCall()} className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold">
            Minimize
          </button>
          <p className="text-sm font-semibold text-white/70">Incoming D4EXAM Call</p>
          <span className="w-16" />
        </div>
        <div className="flex flex-1 flex-col items-center justify-center px-6">
          <div className="relative mb-8">
            <RingWaves />
            <PeerFace name={view.peerName} src={view.peerAvatar} className="h-32 w-32 ring-[3px] ring-[#3b82f6]/85 shadow-[0_0_40px_rgba(37,99,235,0.45)]" />
          </div>
          <h1 className="text-center text-2xl font-extrabold tracking-tight">{view.peerName}</h1>
          {sub ? <p className="mt-1.5 text-sm font-medium text-white/55">{sub}</p> : null}
          <p className="mt-5 flex items-center gap-2 text-sm font-medium text-sky-200">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-sky-300" />
            Ringing…
          </p>
        </div>
        <div className="flex items-center justify-center gap-10 px-8 pb-[max(2.25rem,env(safe-area-inset-bottom))]">
          <button type="button" onClick={() => void rejectIncomingCall()} className="flex flex-col items-center gap-2">
            <span className="grid h-[4.25rem] w-[4.25rem] place-items-center rounded-full bg-rose-500 shadow-lg shadow-rose-500/40 active:scale-95">
              <PhoneOff className="h-8 w-8" />
            </span>
            <span className="text-xs font-semibold text-white/80">Decline</span>
          </button>
          <div className="flex flex-col items-center gap-1 text-white/40">
            <span className="text-lg tracking-[0.35em]">›››</span>
            <span className="text-[10px] font-medium">Swipe to accept</span>
          </div>
          <button type="button" onClick={() => void acceptIncomingCall({
            callId: view.callId, callType: view.callType, peerId: view.peerId,
            peerName: view.peerName, peerAvatar: view.peerAvatar, peerMatric: view.peerMatric,
            conversationId: view.conversationId, myUserId: view.myUserId,
          })} className="flex flex-col items-center gap-2">
            <span className="grid h-[4.25rem] w-[4.25rem] place-items-center rounded-full bg-emerald-500 shadow-lg shadow-emerald-500/40 active:scale-95">
              <Phone className="h-8 w-8" />
            </span>
            <span className="text-xs font-semibold text-white/80">Accept</span>
          </button>
        </div>
      </div>
    );
  }

  // Active / calling / connecting
  const statusLine =
    connected ? "In Call…" :
    view.phase === "connecting" ? "Connecting…" :
    view.phase === "calling" ? "Calling…" : String(view.phase);

  return (
    <div className="fixed inset-0 z-[200] flex flex-col overflow-hidden bg-gradient-to-b from-[#0b1b3a] via-[#0d2140] to-[#071022] text-white">
      {/* Video layer */}
      {isVideo && connected ? (
        <div className="absolute inset-0 bg-black">
          <video ref={remoteRef} autoPlay playsInline className="h-full w-full object-cover" />
          <div className="absolute right-3 top-[max(3.5rem,calc(env(safe-area-inset-top)+2.5rem))] overflow-hidden rounded-xl border border-white/20 shadow-xl">
            <video ref={localRef} autoPlay playsInline muted className="h-28 w-20 object-cover" />
          </div>
        </div>
      ) : (
        <>
          <video ref={remoteRef} autoPlay playsInline className="pointer-events-none absolute h-0 w-0 opacity-0" />
          <video ref={localRef} autoPlay playsInline muted className="pointer-events-none absolute h-0 w-0 opacity-0" />
        </>
      )}

      {/* Top bar */}
      <div className="relative z-20 flex items-center justify-between px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button type="button" onClick={(e) => { e.stopPropagation(); minimizeCall(); }} className="flex items-center gap-1 rounded-full bg-black/30 px-3 py-1.5 text-xs font-semibold backdrop-blur">
          <ChevronDown className="h-4 w-4" /> Minimize
        </button>
        <span className="text-xs font-semibold text-white/50">D4EXAM</span>
        <span className="w-16" />
      </div>

      {/* Center content */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6">
        {!(isVideo && connected) ? (
          <>
            {view.phase === "calling" || view.phase === "connecting" ? (
              <D4Center pulsing />
            ) : (
              <div className="relative mb-4">
                <PeerFace name={view.peerName} src={view.peerAvatar} className="h-28 w-28 ring-[3px] ring-[#3b82f6]/70" />
              </div>
            )}
            <p className="mt-2 text-sm font-medium text-sky-200/90">{statusLine}</p>
            <h1 className="mt-2 text-center text-2xl font-extrabold tracking-tight">{view.peerName}</h1>
            {sub ? <p className="mt-1 text-sm text-white/55">{sub}</p> : null}
            {connected ? (
              <p className="mt-3 flex items-center gap-1.5 text-sm font-semibold tabular-nums text-white/80">
                <Phone className="h-3.5 w-3.5 text-emerald-400" /> {mm}:{ss}
              </p>
            ) : null}
            {(view.phase === "calling" || view.phase === "connecting") && (
              <p className="mt-3 flex items-center gap-2 text-xs text-white/50">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {view.phase === "calling" ? "Waiting for answer…" : "Setting up media…"}
              </p>
            )}
            {view.error ? <p className="mt-3 max-w-xs text-center text-sm text-rose-300">{view.error}</p> : null}
          </>
        ) : (
          <div className="pointer-events-none absolute inset-x-0 top-16 text-center">
            <p className="text-lg font-bold drop-shadow">{view.peerName}</p>
            <p className="text-sm tabular-nums text-white/80 drop-shadow">{mm}:{ss}</p>
          </div>
        )}
      </div>

      {/* Controls — single row like classic dialer */}
      <div className="relative z-20 border-t border-white/10 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
        <div className="mx-auto flex max-w-md items-center justify-between gap-2">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); toggleMute(); }}
            className="flex flex-col items-center gap-1 active:scale-95"
          >
            <span className={cn(
              "grid h-12 w-12 place-items-center rounded-full text-white",
              view.muted ? "bg-white text-[#0b1b3a]" : "bg-white/15",
            )}>
              {view.muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </span>
            <span className="text-[10px] font-medium text-white/70">Mute</span>
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); void toggleSpeaker(); }}
            className="flex flex-col items-center gap-1 active:scale-95"
          >
            <span className={cn(
              "grid h-12 w-12 place-items-center rounded-full text-white",
              view.speakerOn ? "bg-white text-[#0b1b3a]" : "bg-white/15",
            )}>
              {view.speakerOn ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
            </span>
            <span className="text-[10px] font-medium text-white/70">Speaker</span>
          </button>
          {isVideo ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); toggleCam(); }}
              className="flex flex-col items-center gap-1 active:scale-95"
            >
              <span className={cn(
                "grid h-12 w-12 place-items-center rounded-full text-white",
                view.camOff ? "bg-white text-[#0b1b3a]" : "bg-white/15",
              )}>
                {view.camOff ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
              </span>
              <span className="text-[10px] font-medium text-white/70">Camera</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); void upgradeToVideo(); }}
              className="flex flex-col items-center gap-1 active:scale-95"
            >
              <span className="grid h-12 w-12 place-items-center rounded-full bg-white/15 text-white">
                <Video className="h-5 w-5" />
              </span>
              <span className="text-[10px] font-medium text-white/70">Video</span>
            </button>
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setMoreOpen((v) => !v); }}
            className="flex flex-col items-center gap-1 active:scale-95"
          >
            <span className={cn(
              "grid h-12 w-12 place-items-center rounded-full text-white",
              moreOpen ? "bg-white text-[#0b1b3a]" : "bg-white/15",
            )}>
              <MoreHorizontal className="h-5 w-5" />
            </span>
            <span className="text-[10px] font-medium text-white/70">More</span>
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void (async () => {
                try { await endCall("ended"); } catch { /* ignore */ }
                setClosed(true);
                onClose();
              })();
            }}
            className="flex flex-col items-center gap-1 active:scale-95"
            aria-label="End call"
          >
            <span className="grid h-14 w-14 place-items-center rounded-full bg-rose-500 text-white shadow-lg shadow-rose-500/40">
              <PhoneOff className="h-6 w-6" />
            </span>
            <span className="text-[10px] font-medium text-white/70">End</span>
          </button>
        </div>
      </div>

      {moreOpen ? (
        <div className="absolute inset-x-4 bottom-28 z-40 overflow-hidden rounded-2xl border border-white/10 bg-[#0d2140] shadow-2xl">
          <MoreRow icon={<MessageCircle className="h-4 w-4" />} label="Send Message" onClick={() => {
            setMoreOpen(false);
            const cid = view.conversationId;
            if (cid) appNavigate(`/student/messages?chat=${encodeURIComponent(cid)}`);
            else appNavigate("/student/messages");
          }} />
          <MoreRow icon={<MonitorUp className="h-4 w-4" />} label={view.sharingScreen ? "Stop Screen Share" : "Share Screen"} onClick={() => {
            setMoreOpen(false);
            if (view.sharingScreen) void stopScreenShare();
            else void startScreenShare();
          }} />
          <MoreRow icon={<User className="h-4 w-4" />} label="View Profile" onClick={() => {
            setMoreOpen(false);
            if (view.peerId && view.peerId !== "unknown") {
              appNavigate(`/student/user/${encodeURIComponent(view.peerId)}`);
            }
          }} />
          <button type="button" className="w-full py-3 text-sm font-semibold text-white/60" onClick={() => setMoreOpen(false)}>Cancel</button>
        </div>
      ) : null}
    </div>
  );
}

function MoreRow({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 border-b border-white/5 px-4 py-3.5 text-left text-sm font-medium active:bg-white/5">
      <span className="text-sky-300">{icon}</span>
      {label}
    </button>
  );
}

function MinimizedTopBar({ session }: { session: CallSessionState }) {
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
            <button type="button" className="grid h-11 w-11 place-items-center rounded-full bg-rose-500 shadow-md active:scale-95" onClick={() => void rejectIncomingCall()} aria-label="Decline">
              <PhoneOff className="h-5 w-5" />
            </button>
            <button type="button" className="grid h-11 w-11 place-items-center rounded-full bg-emerald-500 shadow-md active:scale-95" onClick={() => void acceptIncomingCall({
              callId: session.callId, callType: session.callType, peerId: session.peerId,
              peerName: session.peerName, peerAvatar: session.peerAvatar, peerMatric: session.peerMatric,
              conversationId: session.conversationId, myUserId: session.myUserId,
            })} aria-label="Accept">
              <Phone className="h-5 w-5" />
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => void toggleSpeaker()} className={cn("grid h-10 w-10 place-items-center rounded-full", session.speakerOn ? "bg-white text-[#0b1b3a]" : "bg-white/15")}>
              {session.speakerOn ? <Volume2 className="h-4.5 w-4.5" /> : <VolumeX className="h-4.5 w-4.5" />}
            </button>
            <button type="button" onClick={() => { void endCall("ended"); }} className="grid h-10 w-10 place-items-center rounded-full bg-rose-500 shadow-md active:scale-95" aria-label="End">
              <PhoneOff className="h-4.5 w-4.5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function MinimizedCallBubble() {
  return null;
}
