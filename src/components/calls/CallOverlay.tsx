import React, { useEffect, useRef, useState } from "react";
import {
  Mic,
  MicOff,
  PhoneOff,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  SwitchCamera,
  Loader2,
  MoreHorizontal,
  MonitorUp,
  MessageCircle,
  Phone,
  ChevronDown,
  PhoneCall,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  acceptIncomingCall,
  attachCallVideos,
  dismissCallUi,
  endCall,
  flipCamera,
  getCallSession,
  minimizeCall,
  rejectIncomingCall,
  restoreCall,
  startOutgoingCall,
  startScreenShare,
  stopScreenShare,
  subscribeCallSession,
  toggleCam,
  toggleMute,
  toggleSpeaker,
  type CallSessionState,
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

  useEffect(() => subscribeCallSession(setSession), []);

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
  }, [call?.callId, myUserId]);

  useEffect(() => {
    attachCallVideos(localRef.current, remoteRef.current);
  }, [session?.phase, session?.callType]);

  // Prefer session; fall back to call prop so UI never goes blank while starting
  const view = session || (call
    ? {
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
      }
    : null);

  if (!view && !call) return null;

  // Minimized → top banner only
  if (view?.phase === "minimized") {
    return <MinimizedTopBar session={view} />;
  }

  if (!view) return null;

  const isVideo = view.callType === "video";
  const connected = view.phase === "active";
  const mm = String(Math.floor(view.seconds / 60)).padStart(2, "0");
  const ss = String(view.seconds % 60).padStart(2, "0");
  const statusLabel =
    view.phase === "calling"
      ? "Calling…"
      : view.phase === "ringing"
        ? isVideo
          ? "Incoming video call"
          : "Incoming voice call"
        : view.phase === "connecting"
          ? "Connecting…"
          : view.phase === "no_answer"
            ? "No answer"
            : view.phase === "missed"
              ? "Missed call"
              : view.phase === "declined"
                ? "Call declined"
                : view.phase === "failed"
                  ? "Call failed"
                  : connected
                    ? `${mm}:${ss}`
                    : String(view.phase);

  const closeAll = () => {
    void dismissCallUi();
    onClose();
  };

  // No-answer / failed end screens
  if (view.phase === "no_answer" || view.phase === "failed" || view.phase === "declined") {
    return (
      <div className="fixed inset-0 z-[200] flex flex-col text-white">
        <div
          className="absolute inset-0"
          style={{ background: "linear-gradient(180deg, #0b1b3a 0%, #122a52 50%, #0b1b3a 100%)" }}
        />
        <Watermark />
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="grid h-20 w-20 place-items-center rounded-full bg-white/10">
            <PhoneCall className="h-9 w-9 text-[#60a5fa]" />
          </div>
          <div>
            <p className="text-xl font-extrabold">{view.peerName}</p>
            {view.peerMatric ? (
              <p className="mt-1 text-sm text-white/60">{view.peerMatric}</p>
            ) : null}
            <p className="mt-3 text-base font-semibold text-blue-100">
              {view.phase === "no_answer"
                ? "No answer"
                : view.phase === "declined"
                  ? "Call declined"
                  : view.error || "Could not connect"}
            </p>
          </div>
          <div className="mt-4 flex w-full max-w-xs flex-col gap-2">
            <button
              type="button"
              className="rounded-2xl bg-[#2563eb] py-3.5 text-sm font-bold shadow-lg active:scale-[0.98]"
              onClick={() => {
                void (async () => {
                  try {
                    const id = await startDirectCall({
                      calleeId: view.peerId,
                      callType: view.callType,
                      conversationId: view.conversationId,
                    });
                    void notifyCalleeOfIncomingCall({
                      calleeId: view.peerId,
                      callId: id,
                      callType: view.callType,
                      callerName: view.peerName,
                    });
                    dismissCallUi();
                    void startOutgoingCall({
                      callId: id,
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
                })();
              }}
            >
              Call again
            </button>
            <button
              type="button"
              className="rounded-2xl bg-white/10 py-3.5 text-sm font-bold active:scale-[0.98]"
              onClick={() => {
                closeAll();
                if (view.conversationId) {
                  appNavigate(
                    `/student/messages?chat=${encodeURIComponent(view.conversationId)}`,
                  );
                }
              }}
            >
              Send message
            </button>
            <button
              type="button"
              className="py-2 text-sm font-medium text-white/50"
              onClick={closeAll}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[200] flex flex-col overflow-hidden text-white">
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(180deg, #0b1b3a 0%, #122a52 45%, #0b1b3a 100%)",
        }}
      />
      <Watermark />

      {isVideo && connected ? (
        <video
          ref={remoteRef}
          autoPlay
          playsInline
          className="absolute inset-0 z-[1] h-full w-full object-cover"
        />
      ) : (
        <video ref={remoteRef} autoPlay playsInline className="pointer-events-none absolute h-0 w-0 opacity-0" />
      )}

      {isVideo && connected ? (
        <div className="absolute right-3 top-24 z-20 h-36 w-28 overflow-hidden rounded-2xl border-2 border-white/70 shadow-2xl">
          <video
            ref={localRef}
            autoPlay
            playsInline
            muted
            className={cn("h-full w-full object-cover", view.camOff && "opacity-0")}
          />
          {view.camOff ? (
            <div className="absolute inset-0 grid place-items-center bg-[#0b1b3a] text-[10px] font-bold">
              Camera off
            </div>
          ) : null}
        </div>
      ) : (
        <video ref={localRef} autoPlay playsInline muted className="pointer-events-none absolute h-0 w-0 opacity-0" />
      )}

      {/* Top */}
      <div className="absolute inset-x-0 top-0 z-30 flex items-start justify-between px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={() => minimizeCall()}
          className="grid h-10 w-10 place-items-center rounded-full bg-black/30 backdrop-blur"
          aria-label="Minimize"
        >
          <ChevronDown className="h-5 w-5" />
        </button>
        <div className="max-w-[70%] text-center">
          <p className="truncate text-base font-extrabold drop-shadow">{view.peerName}</p>
          {view.peerMatric ? (
            <p className="truncate text-[11px] font-semibold text-white/75">{view.peerMatric}</p>
          ) : null}
          <p className="mt-0.5 text-sm font-medium text-blue-100/90">{statusLabel}</p>
        </div>
        <span className="w-10" />
      </div>

      {/* Center: only large background watermark — no extra small logo */}
      {(!isVideo || !connected) && (
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6">
          {view.peerAvatar ? (
            <img
              src={view.peerAvatar}
              alt=""
              className="mb-3 h-16 w-16 rounded-full object-cover ring-2 ring-white/25"
            />
          ) : null}
          {(view.phase === "calling" || view.phase === "connecting") && (
            <p className="flex items-center gap-2 text-sm text-white/70">
              <Loader2 className="h-4 w-4 animate-spin" />
              {view.phase === "calling" ? "Ringing…" : "Connecting…"}
            </p>
          )}
          {view.error ? (
            <p className="mt-3 max-w-xs text-center text-sm text-rose-200">{view.error}</p>
          ) : null}
        </div>
      )}

      {/* Bottom controls */}
      <div className="absolute inset-x-0 bottom-0 z-30 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-8">
        {view.phase === "ringing" && !view.isCaller ? (
          <div className="mb-4 flex justify-center gap-12">
            <button
              type="button"
              className="flex flex-col items-center gap-2"
              onClick={() => {
                void endCall("rejected");
                onClose();
              }}
            >
              <span className="grid h-16 w-16 place-items-center rounded-full bg-rose-500 shadow-lg">
                <PhoneOff className="h-7 w-7" />
              </span>
              <span className="text-xs font-medium">Decline</span>
            </button>
            <button
              type="button"
              className="flex flex-col items-center gap-2"
              onClick={() =>
                void acceptIncomingCall({
                  callId: view.callId,
                  callType: view.callType,
                  peerId: view.peerId,
                  peerName: view.peerName,
                  peerAvatar: view.peerAvatar,
                  peerMatric: view.peerMatric,
                  conversationId: view.conversationId,
                  myUserId: view.myUserId,
                })
              }
            >
              <span className="grid h-16 w-16 place-items-center rounded-full bg-emerald-500 shadow-lg">
                <Phone className="h-7 w-7" />
              </span>
              <span className="text-xs font-medium">Answer</span>
            </button>
          </div>
        ) : (
          <div className="mx-auto flex max-w-md items-center justify-center gap-3 rounded-[2rem] bg-black/55 px-4 py-3 shadow-2xl backdrop-blur-md">
            <Ctrl onClick={() => setMoreOpen(true)}>
              <MoreHorizontal className="h-5 w-5" />
            </Ctrl>
            {isVideo ? (
              <Ctrl onClick={() => toggleCam()} active={view.camOff}>
                {view.camOff ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
              </Ctrl>
            ) : (
              <Ctrl onClick={() => {}}>
                <Video className="h-5 w-5" />
              </Ctrl>
            )}
            <Ctrl onClick={() => void toggleSpeaker()} active={view.speakerOn}>
              {view.speakerOn ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
            </Ctrl>
            <Ctrl onClick={() => toggleMute()} active={view.muted}>
              {view.muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </Ctrl>
            <button
              type="button"
              onClick={() => {
                void endCall(
                  view.isCaller && view.phase === "calling" ? "cancelled" : "ended",
                );
                onClose();
              }}
              className="grid h-14 w-14 place-items-center rounded-full bg-[#ef4444] shadow-lg transition active:scale-90"
              aria-label="End call"
            >
              <PhoneOff className="h-6 w-6" />
            </button>
          </div>
        )}
      </div>

      {moreOpen ? (
        <div
          className="absolute inset-0 z-40 flex items-end justify-center bg-black/40"
          onClick={() => setMoreOpen(false)}
        >
          <div
            className="mb-[max(5.5rem,env(safe-area-inset-bottom))] w-[min(92vw,22rem)] overflow-hidden rounded-2xl bg-[#1f2c34] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {isVideo ? (
              <>
                <SheetRow
                  icon={<SwitchCamera className="h-5 w-5" />}
                  label="Switch camera"
                  onClick={() => {
                    void flipCamera();
                    setMoreOpen(false);
                  }}
                />
                <SheetRow
                  icon={<MonitorUp className="h-5 w-5" />}
                  label={view.sharingScreen ? "Stop sharing" : "Share screen"}
                  onClick={() => {
                    if (view.sharingScreen) void stopScreenShare();
                    else void startScreenShare();
                    setMoreOpen(false);
                  }}
                />
              </>
            ) : null}
            <SheetRow
              icon={<MessageCircle className="h-5 w-5" />}
              label="Send message"
              onClick={() => {
                setMoreOpen(false);
                minimizeCall();
                if (view.conversationId) {
                  appNavigate(
                    `/student/messages?chat=${encodeURIComponent(view.conversationId)}`,
                  );
                }
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Watermark() {
  return (
    <>
      <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="relative flex items-center justify-center"
            style={{ animation: "d4WatermarkFloat 9s ease-in-out infinite" }}
          >
            <img
              src="/logo.png"
              alt=""
              className="h-[min(48vh,340px)] w-auto max-w-[70%] select-none object-contain opacity-[0.16]"
              style={{ filter: "grayscale(0.1) brightness(1.1)" }}
            />
            <span
              className="pointer-events-none absolute inset-[8%] overflow-hidden rounded-full"
              style={{
                background:
                  "linear-gradient(115deg, transparent 25%, rgba(255,255,255,0.45) 48%, rgba(147,197,253,0.3) 52%, transparent 75%)",
                backgroundSize: "220% 100%",
                animation: "d4WatermarkShine 5s ease-in-out infinite",
              }}
            />
          </div>
        </div>
      </div>
      <style>{`
        @keyframes d4WatermarkFloat{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-12px) scale(1.03)}}
        @keyframes d4WatermarkShine{0%{background-position:100% 0}100%{background-position:-100% 0}}
      `}</style>
    </>
  );
}

/** Compact top bar while call continues (or is still ringing) in the app */
function MinimizedTopBar({ session }: { session: CallSessionState }) {
  const mm = String(Math.floor(session.seconds / 60)).padStart(2, "0");
  const ss = String(session.seconds % 60).padStart(2, "0");
  const prev = (session as { _preMinimizePhase?: string })._preMinimizePhase;
  const isIncomingRing =
    !session.isCaller && (prev === "ringing" || session.phase === "ringing");
  const status =
    session.seconds > 0 || prev === "active"
      ? `In call · ${mm}:${ss}`
      : prev === "connecting" || session.phase === "connecting"
        ? "Connecting…"
        : isIncomingRing
          ? session.callType === "video"
            ? "Incoming video · Ringing…"
            : "Incoming voice · Ringing…"
          : "Calling…";

  return (
    <div className="fixed inset-x-0 top-0 z-[160] pt-[env(safe-area-inset-top,0px)]">
      <div className="flex w-full items-center gap-2 bg-[#0b1b3a] px-3 py-2.5 text-white shadow-lg ring-1 ring-white/10">
        <button
          type="button"
          onClick={() => restoreCall()}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          {session.peerAvatar ? (
            <img src={session.peerAvatar} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
          ) : (
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#1e3a6e] text-xs font-bold">
              {session.peerName.slice(0, 2).toUpperCase()}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">{session.peerName}</p>
            {session.peerMatric ? (
              <p className="truncate text-[10px] text-white/50">{session.peerMatric}</p>
            ) : null}
            <p className={cn("text-[11px]", session.seconds > 0 ? "text-emerald-300" : "text-sky-300")}>
              {status}
            </p>
          </div>
        </button>
        {isIncomingRing ? (
          <>
            <button
              type="button"
              className="rounded-full bg-rose-500 px-3 py-1.5 text-[11px] font-bold"
              onClick={() => void rejectIncomingCall()}
            >
              Decline
            </button>
            <button
              type="button"
              className="rounded-full bg-emerald-500 px-3 py-1.5 text-[11px] font-bold"
              onClick={() => {
                void acceptIncomingCall({
                  callId: session.callId,
                  callType: session.callType,
                  peerId: session.peerId,
                  peerName: session.peerName,
                  peerAvatar: session.peerAvatar,
                  peerMatric: session.peerMatric,
                  conversationId: session.conversationId,
                  myUserId: session.myUserId,
                });
              }}
            >
              Accept
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => toggleMute()}
              className={cn(
                "grid h-9 w-9 place-items-center rounded-full",
                session.muted ? "bg-white text-[#0b1b3a]" : "bg-white/15",
              )}
              aria-label="Mute"
            >
              {session.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => void toggleSpeaker()}
              className={cn(
                "grid h-9 w-9 place-items-center rounded-full",
                session.speakerOn ? "bg-white text-[#0b1b3a]" : "bg-white/15",
              )}
              aria-label="Speaker"
            >
              {session.speakerOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => void endCall("local")}
              className="grid h-9 w-9 place-items-center rounded-full bg-rose-500"
              aria-label="End call"
            >
              <PhoneOff className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Legacy floating bubble (kept for import compatibility) */
export function MinimizedCallBubble() {
  return null;
}

function Ctrl({
  children,
  onClick,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "grid h-12 w-12 place-items-center rounded-full transition active:scale-90",
        active ? "bg-white text-[#0b1b3a]" : "bg-white/15 text-white",
      )}
    >
      {children}
    </button>
  );
}

function SheetRow({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 border-b border-white/5 px-4 py-3.5 text-left last:border-0 active:bg-white/5"
    >
      <span className="grid h-9 w-9 place-items-center rounded-full bg-white/10">{icon}</span>
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}
