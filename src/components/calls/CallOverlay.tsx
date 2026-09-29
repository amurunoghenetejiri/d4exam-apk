import React, { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  broadcastSignal,
  createPeerConnection,
  getLocalMedia,
  subscribeCallChannel,
  switchCameraFacing,
  updateCallStatus,
  updateParticipantStatus,
  type SignalEvent,
} from "@/lib/calls";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

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
  call: ActiveCall;
  myUserId: string;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<"ringing" | "connecting" | "active" | "ended">(
    "ringing",
  );
  const [muted, setMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [camOff, setCamOff] = useState(false);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [seconds, setSeconds] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const [callType, setCallType] = useState(call.callType);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localAudioRef = useRef<HTMLAudioElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  const pipRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [pipPos, setPipPos] = useState({ x: 16, y: 72 });

  const postCallSystemMessage = useCallback(
    async (kind: "missed" | "no_answer" | "ended" | "rejected", type: "voice" | "video") => {
      if (!call.conversationId) return;
      try {
        const labels: Record<string, string> = {
          missed: type === "video" ? "Missed video call" : "Missed voice call",
          no_answer: type === "video" ? "Video call · No answer" : "Voice call · No answer",
          ended: type === "video" ? "Video call ended" : "Voice call ended",
          rejected: type === "video" ? "Video call declined" : "Voice call declined",
        };
        await supabase.from("campus_messages").insert({
          conversation_id: call.conversationId,
          sender_id: myUserId,
          body: labels[kind] || "Call",
          attachment_type: "call",
          attachment_url: null,
          duration_sec: kind === "ended" ? seconds : null,
        } as never);
      } catch {
        /* ignore */
      }
    },
    [call.conversationId, call.callId, myUserId, seconds],
  );

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

      const wasAnswered = statusRef.current === "active";
      if (!wasAnswered) {
        if (endStatus === "rejected") {
          await postCallSystemMessage("rejected", callType);
        } else if (call.isCaller) {
          await postCallSystemMessage("no_answer", callType);
        } else {
          await postCallSystemMessage("missed", callType);
        }
      } else {
        await postCallSystemMessage("ended", callType);
      }

      setStatus("ended");
      onClose();
    },
    [call.callId, call.isCaller, callType, myUserId, onClose, postCallSystemMessage],
  );

  useEffect(() => {
    let cancelled = false;
    const video = callType === "video";

    void (async () => {
      try {
        // For outgoing video while ringing: only show local preview after media granted
        // but UI shows branding until answered for cleaner look
        const stream = await getLocalMedia(video, facing);
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
          if (localAudioRef.current && callType === "voice") {
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

  const doSwitchCamera = async () => {
    if (!localStreamRef.current) return;
    const next = facing === "user" ? "environment" : "user";
    try {
      await switchCameraFacing(localStreamRef.current, pcRef.current, next);
      setFacing(next);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStreamRef.current;
      }
    } catch (e) {
      console.error(e);
    }
  };

  const onPipPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = pipRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: pipPos.x, oy: pipPos.y };
  };
  const onPipPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    setPipPos({
      x: Math.max(8, Math.min(window.innerWidth - 120, drag.current.ox + dx)),
      y: Math.max(48, Math.min(window.innerHeight - 180, drag.current.oy + dy)),
    });
  };
  const onPipPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pipRef.current?.releasePointerCapture(e.pointerId);
    drag.current = null;
  };

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  const isVideo = callType === "video";
  const connected = status === "active";
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
      {/* Brand background — same as messages watermark */}
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(180deg, #0b1b3a 0%, #122a52 40%, #0b1b3a 100%)",
        }}
      />
      <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="relative flex items-center justify-center"
            style={{ animation: "d4WatermarkFloat 9s ease-in-out infinite" }}
          >
            <img
              src="/logo.png"
              alt=""
              className="h-[min(48vh,360px)] w-auto max-w-[68%] select-none object-contain opacity-[0.16]"
              style={{ filter: "grayscale(0.15) brightness(1.1)" }}
              loading="eager"
              decoding="async"
            />
          </div>
        </div>
      </div>
      <style>{`
        @keyframes d4WatermarkFloat{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-12px) scale(1.03)}}
        @keyframes d4BtnIn{0%{transform:scale(.75);opacity:0}100%{transform:scale(1);opacity:1}}
        @keyframes d4RingPulse{0%,100%{box-shadow:0 0 0 0 rgba(37,99,235,.5)}70%{box-shadow:0 0 0 18px rgba(37,99,235,0)}}
        .d4-btn-in{animation:d4BtnIn .4s cubic-bezier(.22,1,.36,1) both}
        .d4-ring-pulse{animation:d4RingPulse 1.8s ease-out infinite}
      `}</style>

      {/* Remote video only when connected */}
      {isVideo && connected ? (
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="absolute inset-0 z-[1] h-full w-full object-cover"
        />
      ) : null}

      {/* Local PIP when video active */}
      {isVideo && connected ? (
        <div
          ref={pipRef}
          onPointerDown={onPipPointerDown}
          onPointerMove={onPipPointerMove}
          onPointerUp={onPipPointerUp}
          className="absolute z-20 touch-none overflow-hidden rounded-2xl border-2 border-white/70 shadow-2xl"
          style={{ left: pipPos.x, top: pipPos.y, width: 108, height: 148 }}
        >
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className={cn("h-full w-full object-cover", camOff && "opacity-0")}
          />
          {camOff ? (
            <div className="absolute inset-0 grid place-items-center bg-[#0b1b3a] text-[10px] font-bold">
              Camera off
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Hidden local video element for early stream binding before answer */}
      {isVideo && !connected ? (
        <video ref={localVideoRef} autoPlay playsInline muted className="pointer-events-none absolute h-0 w-0 opacity-0" />
      ) : null}
      {!isVideo ? <audio ref={localAudioRef} autoPlay /> : null}
      {/* remote video element always mounted for ontrack */}
      {!connected ? (
        <video ref={remoteVideoRef} autoPlay playsInline className="pointer-events-none absolute h-0 w-0 opacity-0" />
      ) : null}

      {/* Center content while ringing / voice */}
      {(!isVideo || !connected) && (
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-5 px-6">
          <div className={cn("relative", status === "ringing" && "d4-ring-pulse rounded-full")}>
            <div className="grid h-36 w-36 place-items-center overflow-hidden rounded-full bg-[#1e3a6e] shadow-2xl ring-4 ring-white/20 sm:h-40 sm:w-40">
              {call.peerAvatar ? (
                <img src={call.peerAvatar} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="text-4xl font-extrabold text-[#60a5fa]">
                  {call.peerName.slice(0, 2).toUpperCase()}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Top identity */}
      <div className="absolute inset-x-0 top-0 z-30 px-4 pb-6 pt-[max(1rem,env(safe-area-inset-top))] text-center">
        <p className="text-lg font-extrabold drop-shadow sm:text-xl">{call.peerName}</p>
        {call.peerMatric ? (
          <p className="mt-0.5 text-xs font-semibold text-white/75">{call.peerMatric}</p>
        ) : null}
        <p className="mt-1 text-sm font-medium text-blue-100/90">{statusLabel}</p>
      </div>

      {/* Bottom controls — WhatsApp-like pill bar */}
      <div className="absolute inset-x-0 bottom-0 z-30 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-8">
        {!call.isCaller && status === "ringing" ? (
          <div className="mb-6 flex justify-center gap-10">
            <button
              type="button"
              className="d4-btn-in flex flex-col items-center gap-2"
              onClick={() => {
                if (channelRef.current) {
                  void broadcastSignal(channelRef.current, { type: "reject", from: myUserId });
                }
                void cleanup("rejected");
              }}
            >
              <span className="grid h-16 w-16 place-items-center rounded-full bg-rose-500 shadow-lg">
                <PhoneOff className="h-7 w-7" />
              </span>
              <span className="text-xs font-medium text-white/80">Decline</span>
            </button>
            <button
              type="button"
              className="d4-btn-in flex flex-col items-center gap-2"
              style={{ animationDelay: "0.08s" }}
              onClick={() => setStatus("connecting")}
            >
              <span className="grid h-16 w-16 place-items-center rounded-full bg-emerald-500 shadow-lg">
                <Phone className="h-7 w-7" />
              </span>
              <span className="text-xs font-medium text-white/80">Accept</span>
            </button>
          </div>
        ) : (
          <div className="mx-auto flex max-w-md items-center justify-center gap-3 rounded-[2rem] bg-black/55 px-4 py-3 shadow-2xl backdrop-blur-md sm:gap-4">
            <Ctrl onClick={() => setMoreOpen(true)} className="d4-btn-in">
              <MoreHorizontal className="h-5 w-5" />
            </Ctrl>
            {isVideo ? (
              <Ctrl onClick={toggleCam} active={camOff} className="d4-btn-in" style={{ animationDelay: "0.05s" }}>
                {camOff ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
              </Ctrl>
            ) : (
              <Ctrl
                onClick={() => setCallType("video")}
                className="d4-btn-in"
                style={{ animationDelay: "0.05s" }}
              >
                <Video className="h-5 w-5" />
              </Ctrl>
            )}
            <Ctrl
              onClick={() => setSpeakerOn((v) => !v)}
              active={speakerOn}
              className="d4-btn-in"
              style={{ animationDelay: "0.1s" }}
            >
              {speakerOn ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
            </Ctrl>
            <Ctrl onClick={toggleMute} active={muted} className="d4-btn-in" style={{ animationDelay: "0.15s" }}>
              {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </Ctrl>
            <button
              type="button"
              onClick={() =>
                void cleanup(call.isCaller && status === "ringing" ? "cancelled" : "ended")
              }
              className="d4-btn-in grid h-14 w-14 place-items-center rounded-full bg-[#ef4444] text-white shadow-lg transition active:scale-90"
              style={{ animationDelay: "0.2s" }}
              aria-label="End call"
            >
              <PhoneOff className="h-6 w-6" />
            </button>
          </div>
        )}

        {status === "ringing" && call.isCaller ? (
          <p className="mt-3 flex items-center justify-center gap-2 text-xs text-white/70">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for answer
          </p>
        ) : null}
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
                    void doSwitchCamera();
                    setMoreOpen(false);
                  }}
                />
                <SheetRow
                  icon={<MonitorUp className="h-5 w-5" />}
                  label="Share screen"
                  onClick={() => {
                    void (async () => {
                      try {
                        const display = await (navigator.mediaDevices as Navigator["mediaDevices"] & {
                          getDisplayMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
                        }).getDisplayMedia?.({ video: true });
                        if (!display || !pcRef.current) return;
                        const track = display.getVideoTracks()[0];
                        const sender = pcRef.current.getSenders().find((s) => s.track?.kind === "video");
                        if (sender && track) await sender.replaceTrack(track);
                        setMoreOpen(false);
                      } catch {
                        /* user cancelled */
                      }
                    })();
                  }}
                />
              </>
            ) : (
              <SheetRow
                icon={<Video className="h-5 w-5" />}
                label="Switch to video call"
                onClick={() => {
                  setCallType("video");
                  setMoreOpen(false);
                }}
              />
            )}
            <SheetRow
              icon={<MessageCircle className="h-5 w-5" />}
              label="Send message"
              onClick={() => setMoreOpen(false)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Ctrl({
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
  style?: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={style}
      className={cn(
        "grid h-12 w-12 place-items-center rounded-full transition active:scale-90 sm:h-13 sm:w-13",
        active ? "bg-white text-[#0b1b3a]" : "bg-white/15 text-white",
        className,
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
  icon: ReactNode;
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
