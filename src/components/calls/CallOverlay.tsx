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
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  acceptIncomingCall,
  attachCallVideos,
  endCall,
  flipCamera,
  getCallSession,
  minimizeCall,
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

/** Mount once at app/messages level — drives UI from global session */
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

  useEffect(() => subscribeCallSession(setSession), []);

  // Bootstrap session from ActiveCall prop
  useEffect(() => {
    if (!call || !myUserId) return;
    const cur = getCallSession();
    if (cur && cur.callId === call.callId) return;
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
      }).catch(() => onClose());
    } else if (!cur) {
      void acceptIncomingCall({
        callId: call.callId,
        callType: call.callType,
        peerId: call.peerId,
        peerName: call.peerName,
        peerAvatar: call.peerAvatar,
        peerMatric: call.peerMatric,
        conversationId: call.conversationId,
        myUserId,
      }).catch(() => onClose());
    }
  }, [call?.callId, myUserId]);

  useEffect(() => {
    attachCallVideos(localRef.current, remoteRef.current);
  }, [session?.phase, session?.callType]);

  useEffect(() => {
    if (!session) onClose();
  }, [session, onClose]);

  if (!session) return null;
  if (session.phase === "minimized") return null; // floating bubble handles restore

  const isVideo = session.callType === "video";
  const connected = session.phase === "active";
  const mm = String(Math.floor(session.seconds / 60)).padStart(2, "0");
  const ss = String(session.seconds % 60).padStart(2, "0");
  const statusLabel =
    session.phase === "calling"
      ? "Calling…"
      : session.phase === "ringing"
        ? isVideo
          ? "Incoming video call"
          : "Incoming voice call"
        : session.phase === "connecting"
          ? "Connecting…"
          : connected
            ? `${mm}:${ss}`
            : session.phase;

  return (
    <div className="fixed inset-0 z-[200] flex flex-col overflow-hidden text-white">
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(180deg, #0b1b3a 0%, #122a52 45%, #0b1b3a 100%)",
        }}
      />

      {/* Same watermark animation as messages */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="relative flex items-center justify-center"
            style={{ animation: "d4WatermarkFloat 9s ease-in-out infinite" }}
          >
            <img
              src="/logo.png"
              alt=""
              className="h-[min(42vh,300px)] w-auto max-w-[62%] select-none object-contain opacity-[0.18]"
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
        @keyframes d4BtnIn{0%{transform:scale(.75);opacity:0}100%{transform:scale(1);opacity:1}}
        @keyframes d4RingPulse{0%,100%{box-shadow:0 0 0 0 rgba(37,99,235,.45)}70%{box-shadow:0 0 0 18px rgba(37,99,235,0)}}
        .d4-btn-in{animation:d4BtnIn .4s cubic-bezier(.22,1,.36,1) both}
        .d4-ring-pulse{animation:d4RingPulse 1.8s ease-out infinite}
      `}</style>

      {/* Remote video when active */}
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
            className={cn("h-full w-full object-cover", session.camOff && "opacity-0")}
          />
          {session.camOff ? (
            <div className="absolute inset-0 grid place-items-center bg-[#0b1b3a] text-[10px] font-bold">
              Camera off
            </div>
          ) : null}
        </div>
      ) : (
        <video ref={localRef} autoPlay playsInline muted className="pointer-events-none absolute h-0 w-0 opacity-0" />
      )}

      {/* Top bar */}
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
          <p className="truncate text-base font-extrabold drop-shadow">{session.peerName}</p>
          {session.peerMatric ? (
            <p className="truncate text-[11px] font-semibold text-white/75">{session.peerMatric}</p>
          ) : null}
          <p className="mt-0.5 text-sm font-medium text-blue-100/90">{statusLabel}</p>
        </div>
        <span className="w-10" />
      </div>

      {/* Center: D4 branding when not showing remote video */}
      {(!isVideo || !connected) && (
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-4 px-6">
          <div
            className={cn(
              "relative grid place-items-center",
              (session.phase === "calling" || session.phase === "ringing") && "d4-ring-pulse rounded-full",
            )}
          >
            <img
              src="/logo.png"
              alt="D4EXAM"
              className="h-28 w-28 object-contain drop-shadow-lg sm:h-32 sm:w-32"
            />
          </div>
          {session.peerAvatar ? (
            <img
              src={session.peerAvatar}
              alt=""
              className="h-14 w-14 rounded-full object-cover ring-2 ring-white/30"
            />
          ) : null}
        </div>
      )}

      {/* Bottom controls */}
      <div className="absolute inset-x-0 bottom-0 z-30 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-8">
        {session.phase === "ringing" && !session.isCaller ? (
          <div className="mb-4 flex justify-center gap-12">
            <button
              type="button"
              className="d4-btn-in flex flex-col items-center gap-2"
              onClick={() => void endCall("rejected")}
            >
              <span className="grid h-16 w-16 place-items-center rounded-full bg-rose-500 shadow-lg">
                <PhoneOff className="h-7 w-7" />
              </span>
              <span className="text-xs font-medium">Decline</span>
            </button>
            <button
              type="button"
              className="d4-btn-in flex flex-col items-center gap-2"
              style={{ animationDelay: "0.08s" }}
              onClick={() =>
                void acceptIncomingCall({
                  callId: session.callId,
                  callType: session.callType,
                  peerId: session.peerId,
                  peerName: session.peerName,
                  peerAvatar: session.peerAvatar,
                  peerMatric: session.peerMatric,
                  conversationId: session.conversationId,
                  myUserId: session.myUserId,
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
              <Ctrl onClick={() => toggleCam()} active={session.camOff}>
                {session.camOff ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
              </Ctrl>
            ) : (
              <Ctrl onClick={() => { /* upgrade placeholder */ }}>
                <Video className="h-5 w-5" />
              </Ctrl>
            )}
            <Ctrl onClick={() => void toggleSpeaker()} active={session.speakerOn}>
              {session.speakerOn ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
            </Ctrl>
            <Ctrl onClick={() => toggleMute()} active={session.muted}>
              {session.muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </Ctrl>
            <button
              type="button"
              onClick={() => void endCall(session.isCaller && session.phase === "calling" ? "cancelled" : "ended")}
              className="grid h-14 w-14 place-items-center rounded-full bg-[#ef4444] shadow-lg transition active:scale-90"
              aria-label="End call"
            >
              <PhoneOff className="h-6 w-6" />
            </button>
          </div>
        )}
        {session.phase === "calling" ? (
          <p className="mt-3 flex items-center justify-center gap-2 text-xs text-white/70">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for answer
          </p>
        ) : null}
      </div>

      {moreOpen ? (
        <div className="absolute inset-0 z-40 flex items-end justify-center bg-black/40" onClick={() => setMoreOpen(false)}>
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
                  label={session.sharingScreen ? "Stop sharing" : "Share screen"}
                  onClick={() => {
                    if (session.sharingScreen) void stopScreenShare();
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
                if (session.conversationId) {
                  appNavigate(`/student/messages?chat=${encodeURIComponent(session.conversationId)}`);
                }
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Floating bubble when call is minimized */
export function MinimizedCallBubble() {
  const [session, setSession] = useState<CallSessionState | null>(getCallSession());
  useEffect(() => subscribeCallSession(setSession), []);
  if (!session || session.phase !== "minimized") return null;
  const mm = String(Math.floor(session.seconds / 60)).padStart(2, "0");
  const ss = String(session.seconds % 60).padStart(2, "0");
  return (
    <button
      type="button"
      onClick={() => restoreCall()}
      className="fixed bottom-24 right-3 z-[150] flex items-center gap-2 rounded-full bg-[#0b1b3a] px-3 py-2.5 text-white shadow-xl ring-2 ring-[#2563eb]/50"
    >
      <Phone className="h-4 w-4 text-[#60a5fa]" />
      <span className="max-w-[7rem] truncate text-xs font-bold">{session.peerName}</span>
      <span className="text-[11px] tabular-nums text-white/70">
        {mm}:{ss}
      </span>
    </button>
  );
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
