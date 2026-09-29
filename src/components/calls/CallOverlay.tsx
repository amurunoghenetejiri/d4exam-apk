import { useCallback, useEffect, useRef, useState } from "react";
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
    call.isCaller ? "ringing" : "ringing",
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

  const cleanup = useCallback(async (endStatus: "ended" | "cancelled" | "rejected" | "missed" = "ended") => {
    if (timerRef.current) clearInterval(timerRef.current);
    try {
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
    } catch { /* ignore */ }
    try {
      pcRef.current?.close();
    } catch { /* ignore */ }
    if (channelRef.current) {
      void channelRef.current.unsubscribe();
    }
    try {
      await updateCallStatus(call.callId, endStatus);
      await updateParticipantStatus(call.callId, myUserId, "left");
    } catch { /* ignore */ }
    setStatus("ended");
    onClose();
  }, [call.callId, myUserId, onClose]);

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
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        const pc = createPeerConnection();
        pcRef.current = pc;
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));

        pc.ontrack = (ev) => {
          const [remote] = ev.streams;
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = remote;
          }
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
              } catch { /* ignore */ }
            } else if (ev.type === "hangup" || ev.type === "reject") {
              await cleanup(ev.type === "reject" ? "rejected" : "ended");
            } else if (ev.type === "busy") {
              await cleanup("busy");
            }
          })();
        });
        channelRef.current = ch;

        // Caller creates offer after channel is up
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

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  const isVideo = call.callType === "video";

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-[#0b1b3a] text-white">
      {isVideo ? (
        <>
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="absolute inset-0 h-full w-full object-cover"
          />
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="absolute right-3 top-[max(3.5rem,env(safe-area-inset-top))] h-36 w-28 rounded-xl border-2 border-white/30 object-cover shadow-xl"
          />
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <div className="grid h-28 w-28 place-items-center overflow-hidden rounded-full bg-[#1e3a6e] ring-4 ring-white/20">
            {call.peerAvatar ? (
              <img src={call.peerAvatar} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="text-3xl font-extrabold">
                {call.peerName.slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>
          <audio ref={localAudioRef} autoPlay />
        </div>
      )}

      <div className="relative z-10 flex flex-col items-center px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
        <p className="text-lg font-extrabold">{call.peerName}</p>
        <p className="mt-1 text-sm text-blue-100/80">
          {status === "ringing"
            ? call.isCaller
              ? "Calling…"
              : isVideo
                ? "Incoming video call"
                : "Incoming voice call"
            : status === "connecting"
              ? "Connecting…"
              : status === "active"
                ? `${mm}:${ss}`
                : "Call ended"}
        </p>

        <div className="mt-auto flex items-center justify-center gap-4 pt-10">
          <CtrlBtn onClick={toggleMute} active={muted}>
            {muted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
          </CtrlBtn>
          {isVideo ? (
            <CtrlBtn onClick={toggleCam} active={camOff}>
              {camOff ? <VideoOff className="h-6 w-6" /> : <Video className="h-6 w-6" />}
            </CtrlBtn>
          ) : (
            <CtrlBtn onClick={() => {}}>
              <Volume2 className="h-6 w-6" />
            </CtrlBtn>
          )}
          <button
            type="button"
            onClick={() => void cleanup(call.isCaller && status === "ringing" ? "cancelled" : "ended")}
            className="grid h-16 w-16 place-items-center rounded-full bg-rose-500 text-white shadow-lg shadow-rose-900/40 transition active:scale-95"
          >
            <PhoneOff className="h-7 w-7" />
          </button>
          {isVideo ? (
            <CtrlBtn onClick={() => {}}>
              <SwitchCamera className="h-6 w-6" />
            </CtrlBtn>
          ) : null}
        </div>

        {!call.isCaller && status === "ringing" ? (
          <div className="mt-6 flex gap-4">
            <button
              type="button"
              className="rounded-full bg-rose-500 px-6 py-3 text-sm font-bold"
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
              className="rounded-full bg-emerald-500 px-6 py-3 text-sm font-bold"
              onClick={() => setStatus("connecting")}
            >
              Accept
            </button>
          </div>
        ) : null}

        {status === "ringing" && call.isCaller ? (
          <p className="mt-4 flex items-center gap-2 text-xs text-blue-100/70">
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
        "grid h-12 w-12 place-items-center rounded-full transition active:scale-95",
        active ? "bg-white text-[#0b1b3a]" : "bg-white/15 text-white",
      )}
    >
      {children}
    </button>
  );
}
