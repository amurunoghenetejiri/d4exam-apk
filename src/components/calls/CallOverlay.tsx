import React, { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  Mic,
  MicOff,
  PhoneOff,
  Video,
  VideoOff,
  Volume2,
  SwitchCamera,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  broadcastSignal,
  createPeerConnection,
  getLocalMedia,
  subscribeCallChannel,
  updateCallStatus,
  updateParticipantStatus,
  type SignalEvent,
} from "@/lib/calls";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type ActiveCall = {
  callId: string;
  callType: "voice" | "video";
  peerId: string;
  peerName: string;
  peerAvatar: string | null;
  peerMatric?: string | null;
  isCaller: boolean;
};

export function CallOverlay({
  call,
  myUserId,
  onClose,
}: {
  call: ActiveCall;
  myUserId: string;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<"ringing" | "connecting" | "active" | "ended">(
    "ringing",
  );
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localAudioRef = useRef<HTMLAudioElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Draggable local PIP
  const pipRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [pipPos, setPipPos] = useState({ x: 16, y: 72 });

  const cleanup = useCallback(
    async (
      endStatus: "ended" | "cancelled" | "rejected" | "busy" | "missed" = "ended",
    ) => {
      if (timerRef.current) clearInterval(timerRef.current);
      try {
        localStreamRef.current?.getTracks().forEach((t) => t.stop());
      } catch {
        /* ignore */
      }
      try {
        pcRef.current?.close();
      } catch {
        /* ignore */
      }
      if (channelRef.current) void channelRef.current.unsubscribe();
      try {
        await updateCallStatus(call.callId, endStatus);
        await updateParticipantStatus(call.callId, myUserId, "left");
      } catch {
        /* ignore */
      }
      setStatus("ended");
      onClose();
    },
    [call.callId, myUserId, onClose],
  );

  useEffect(() => {
    let cancelled = false;
    const video = call.callType === "video";

    void (async () => {
      try {
        const stream = await getLocalMedia(video);
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;

        const pc = createPeerConnection();
        pcRef.current = pc;
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));

        pc.ontrack = (ev) => {
          const [remote] = ev.streams;
          if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remote;
          if (localAudioRef.current && !video) {
            localAudioRef.current.srcObject = remote;
            void localAudioRef.current.play().catch(() => {});
          }
          setStatus("active");
          if (!timerRef.current) {
            timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
          }
          void updateCallStatus(call.callId, "active");
        };

        pc.onicecandidate = (ev) => {
          if (ev.candidate && channelRef.current) {
            void broadcastSignal(channelRef.current, {
              type: "ice",
              candidate: ev.candidate.toJSON(),
              from: myUserId,
            });
          }
        };

        const ch = subscribeCallChannel(call.callId, (ev: SignalEvent) => {
          if (ev.from === myUserId) return;
          void (async () => {
            if (ev.type === "offer" && pc.signalingState !== "closed") {
              await pc.setRemoteDescription(ev.sdp);
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              if (channelRef.current) {
                await broadcastSignal(channelRef.current, {
                  type: "answer",
                  sdp: answer,
                  from: myUserId,
                });
              }
              setStatus("connecting");
              await updateParticipantStatus(call.callId, myUserId, "joined");
            } else if (ev.type === "answer" && pc.signalingState !== "closed") {
              await pc.setRemoteDescription(ev.sdp);
              setStatus("connecting");
            } else if (ev.type === "ice" && ev.candidate) {
              try {
                await pc.addIceCandidate(ev.candidate);
              } catch {
                /* ignore */
              }
            } else if (ev.type === "hangup" || ev.type === "reject") {
              await cleanup(ev.type === "reject" ? "rejected" : "ended");
            } else if (ev.type === "busy") {
              await cleanup("busy");
            }
          })();
        });
        channelRef.current = ch;

        if (call.isCaller) {
          window.setTimeout(() => {
            void (async () => {
              if (cancelled || !pcRef.current) return;
              const offer = await pcRef.current.createOffer();
              await pcRef.current.setLocalDescription(offer);
              if (channelRef.current) {
                await broadcastSignal(channelRef.current, {
                  type: "offer",
                  sdp: offer,
                  from: myUserId,
                });
              }
            })();
          }, 400);
        }
      } catch (e) {
        console.error(e);
        await cleanup("cancelled");
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.callId]);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    localStreamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = !next;
    });
  };

  const toggleCam = () => {
    const next = !camOff;
    setCamOff(next);
    localStreamRef.current?.getVideoTracks().forEach((t) => {
      t.enabled = !next;
    });
  };

  const onPipPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = pipRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      ox: pipPos.x,
      oy: pipPos.y,
    };
  };
  const onPipPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    const nx = Math.max(8, Math.min(window.innerWidth - 120, drag.current.ox + dx));
    const ny = Math.max(48, Math.min(window.innerHeight - 180, drag.current.oy + dy));
    setPipPos({ x: nx, y: ny });
  };
  const onPipPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pipRef.current?.releasePointerCapture(e.pointerId);
    drag.current = null;
  };

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  const isVideo = call.callType === "video";
  const statusLabel =
    status === "ringing"
      ? call.isCaller
        ? "Calling…"
        : isVideo
          ? "Incoming video call"
          : "Incoming voice call"
      : status === "connecting"
        ? "Connecting…"
        : status === "active"
          ? `${mm}:${ss}`
          : "Call ended";

  return (
    <div className="fixed inset-0 z-[200] flex flex-col overflow-hidden text-white">
      {/* Messaging-style sky blue + logo watermark animation */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#cfe8f8] via-[#e8f4fc] to-[#d4ecf8]" />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="d4-call-pulse h-[min(70vw,22rem)] w-[min(70vw,22rem)] rounded-full bg-[#2563eb]/10" />
      </div>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-[0.12]">
        <div className="d4-call-float text-[7rem] font-black tracking-tighter text-[#0b1b3a] sm:text-[9rem]">
          D4
        </div>
      </div>
      <style>{`
        @keyframes d4CallPulse{0%,100%{transform:scale(1);opacity:.55}50%{transform:scale(1.12);opacity:.25}}
        @keyframes d4CallFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
        @keyframes d4BtnIn{0%{transform:scale(.7);opacity:0}100%{transform:scale(1);opacity:1}}
        @keyframes d4Ring{0%,100%{box-shadow:0 0 0 0 rgba(37,99,235,.45)}70%{box-shadow:0 0 0 14px rgba(37,99,235,0)}}
        .d4-call-pulse{animation:d4CallPulse 3.2s ease-in-out infinite}
        .d4-call-float{animation:d4CallFloat 4s ease-in-out infinite}
        .d4-btn-in{animation:d4BtnIn .45s cubic-bezier(.22,1,.36,1) both}
        .d4-ring{animation:d4Ring 1.6s ease-out infinite}
      `}</style>

      {isVideo ? (
        <>
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="absolute inset-0 h-full w-full object-cover"
          />
          {/* if no remote yet, keep gradient visible underneath */}
          <div
            ref={pipRef}
            onPointerDown={onPipPointerDown}
            onPointerMove={onPipPointerMove}
            onPointerUp={onPipPointerUp}
            className="absolute z-20 touch-none overflow-hidden rounded-2xl border-2 border-white/80 shadow-2xl shadow-black/30"
            style={{
              left: pipPos.x,
              top: pipPos.y,
              width: 112,
              height: 152,
            }}
          >
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className={cn("h-full w-full object-cover", camOff && "opacity-0")}
            />
            {camOff ? (
              <div className="absolute inset-0 grid place-items-center bg-[#0b1b3a] text-xs font-bold">
                Camera off
              </div>
            ) : null}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/50 to-transparent px-1.5 py-1 text-[9px] font-semibold">
              You
            </div>
          </div>
        </>
      ) : (
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-5 px-6">
          <div className={cn("relative", status === "ringing" && "d4-ring rounded-full")}>
            <div className="grid h-32 w-32 place-items-center overflow-hidden rounded-full bg-[#0b1b3a] shadow-xl ring-4 ring-white/50 sm:h-36 sm:w-36">
              {call.peerAvatar ? (
                <img src={call.peerAvatar} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="text-4xl font-extrabold text-white">
                  {call.peerName.slice(0, 2).toUpperCase()}
                </span>
              )}
            </div>
          </div>
          <audio ref={localAudioRef} autoPlay />
        </div>
      )}

      {/* Top identity */}
      <div className="absolute inset-x-0 top-0 z-30 bg-gradient-to-b from-[#0b1b3a]/70 to-transparent px-4 pb-8 pt-[max(1rem,env(safe-area-inset-top))] text-center">
        <p className="text-lg font-extrabold drop-shadow-sm sm:text-xl">{call.peerName}</p>
        {call.peerMatric ? (
          <p className="mt-0.5 text-xs font-semibold text-white/80">{call.peerMatric}</p>
        ) : null}
        <p className="mt-1 text-sm font-medium text-blue-100">{statusLabel}</p>
      </div>

      {/* Bottom controls */}
      <div className="absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-[#0b1b3a]/80 via-[#0b1b3a]/40 to-transparent px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-10">
        <div className="mx-auto flex max-w-md items-center justify-center gap-4 sm:gap-5">
          <CtrlBtn className="d4-btn-in" style={{ animationDelay: "0.05s" }} onClick={toggleMute} active={muted}>
            {muted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
          </CtrlBtn>
          {isVideo ? (
            <CtrlBtn className="d4-btn-in" style={{ animationDelay: "0.1s" }} onClick={toggleCam} active={camOff}>
              {camOff ? <VideoOff className="h-6 w-6" /> : <Video className="h-6 w-6" />}
            </CtrlBtn>
          ) : (
            <CtrlBtn className="d4-btn-in" style={{ animationDelay: "0.1s" }} onClick={() => {}}>
              <Volume2 className="h-6 w-6" />
            </CtrlBtn>
          )}
          <button
            type="button"
            onClick={() =>
              void cleanup(call.isCaller && status === "ringing" ? "cancelled" : "ended")
            }
            className="d4-btn-in grid h-[4.25rem] w-[4.25rem] place-items-center rounded-full bg-rose-500 text-white shadow-lg shadow-rose-600/40 transition active:scale-90"
            style={{ animationDelay: "0.15s" }}
            aria-label="End call"
          >
            <PhoneOff className="h-7 w-7" />
          </button>
          {isVideo ? (
            <CtrlBtn className="d4-btn-in" style={{ animationDelay: "0.2s" }} onClick={() => {}}>
              <SwitchCamera className="h-6 w-6" />
            </CtrlBtn>
          ) : null}
        </div>

        {!call.isCaller && status === "ringing" ? (
          <div className="mt-5 flex justify-center gap-4">
            <button
              type="button"
              className="rounded-full bg-rose-500 px-7 py-3 text-sm font-bold shadow-lg active:scale-95"
              onClick={() => {
                if (channelRef.current) {
                  void broadcastSignal(channelRef.current, {
                    type: "reject",
                    from: myUserId,
                  });
                }
                void cleanup("rejected");
              }}
            >
              Decline
            </button>
            <button
              type="button"
              className="rounded-full bg-emerald-500 px-7 py-3 text-sm font-bold shadow-lg active:scale-95"
              onClick={() => setStatus("connecting")}
            >
              Accept
            </button>
          </div>
        ) : null}

        {status === "ringing" && call.isCaller ? (
          <p className="mt-4 flex items-center justify-center gap-2 text-xs text-white/75">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for answer
          </p>
        ) : null}
      </div>
    </div>
  );
}

function CtrlBtn({
  children,
  onClick,
  active,
  className,
  style,
}: {
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={style}
      className={cn(
        "grid h-14 w-14 place-items-center rounded-full transition active:scale-90",
        active ? "bg-white text-[#0b1b3a]" : "bg-white/20 text-white backdrop-blur-md",
        className,
      )}
    >
      {children}
    </button>
  );
}
