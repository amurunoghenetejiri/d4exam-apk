/**
 * Global call session — owns WebRTC + signaling outside React lifecycle
 * so minimize / navigate does not kill the call.
 */
import { supabase } from "@/integrations/supabase/client";
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
import {
  nativeSetSpeaker,
  nativeStartCallService,
  nativeStartRing,
  nativeStopCallService,
  nativeStopRing,
  nativeShowIncoming,
} from "@/lib/native-call";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type CallPhase =
  | "idle"
  | "calling"
  | "ringing"
  | "connecting"
  | "active"
  | "minimized"
  | "ended"
  | "declined"
  | "no_answer"
  | "missed"
  | "failed";

export type CallSessionState = {
  callId: string;
  callType: "voice" | "video";
  phase: CallPhase;
  peerId: string;
  peerName: string;
  peerAvatar: string | null;
  peerMatric?: string | null;
  peerDepartment?: string | null;
  peerLevel?: string | null;
  isCaller: boolean;
  conversationId?: string | null;
  myUserId: string;
  muted: boolean;
  camOff: boolean;
  speakerOn: boolean;
  facing: "user" | "environment";
  seconds: number;
  sharingScreen: boolean;
};

type Listener = (s: CallSessionState | null) => void;

let state: CallSessionState | null = null;
let pc: RTCPeerConnection | null = null;
let localStream: MediaStream | null = null;
let remoteStream: MediaStream | null = null;
let channel: RealtimeChannel | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let listeners = new Set<Listener>();
let localVideoEl: HTMLVideoElement | null = null;
let remoteVideoEl: HTMLVideoElement | null = null;

function emit() {
  for (const l of listeners) {
    try {
      l(state ? { ...state } : null);
    } catch {
      /* ignore */
    }
  }
}

export function subscribeCallSession(fn: Listener) {
  listeners.add(fn);
  fn(state ? { ...state } : null);
  return () => {
    listeners.delete(fn);
  };
}

export function getCallSession() {
  return state ? { ...state } : null;
}

export function attachCallVideos(localEl: HTMLVideoElement | null, remoteEl: HTMLVideoElement | null) {
  localVideoEl = localEl;
  remoteVideoEl = remoteEl;
  if (localEl && localStream) localEl.srcObject = localStream;
  if (remoteEl && remoteStream) remoteEl.srcObject = remoteStream;
}

async function postSystemMessage(
  conversationId: string | null | undefined,
  myUserId: string,
  body: string,
) {
  if (!conversationId) return;
  try {
    await supabase.from("campus_messages").insert({
      conversation_id: conversationId,
      sender_id: myUserId,
      body,
      attachment_type: "call",
      attachment_url: null,
    } as never);
  } catch {
    /* ignore */
  }
}

function clearTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

async function teardown(endStatus: "ended" | "cancelled" | "rejected" | "missed" | "busy" = "ended") {
  clearTimer();
  await nativeStopRing();
  await nativeStopCallService();
  try {
    localStream?.getTracks().forEach((t) => t.stop());
  } catch {
    /* ignore */
  }
  localStream = null;
  remoteStream = null;
  try {
    pc?.close();
  } catch {
    /* ignore */
  }
  pc = null;
  if (channel) {
    try {
      await channel.unsubscribe();
    } catch {
      /* ignore */
    }
  }
  channel = null;

  if (state) {
    try {
      await updateCallStatus(state.callId, endStatus === "cancelled" ? "cancelled" : endStatus);
      await updateParticipantStatus(state.callId, state.myUserId, "left");
    } catch {
      /* ignore */
    }

    const answered = state.phase === "active" || state.phase === "minimized";
    if (!answered) {
      if (endStatus === "rejected") {
        await postSystemMessage(
          state.conversationId,
          state.myUserId,
          state.callType === "video" ? "Video call declined" : "Voice call declined",
        );
      } else if (state.isCaller) {
        await postSystemMessage(
          state.conversationId,
          state.myUserId,
          state.callType === "video" ? "Video call · No answer" : "Voice call · No answer",
        );
      } else {
        await postSystemMessage(
          state.conversationId,
          state.myUserId,
          state.callType === "video" ? "Missed video call" : "Missed voice call",
        );
      }
    } else {
      await postSystemMessage(
        state.conversationId,
        state.myUserId,
        state.callType === "video" ? "Video call ended" : "Voice call ended",
      );
    }
  }

  state = null;
  emit();
}

export async function startOutgoingCall(opts: {
  callId: string;
  callType: "voice" | "video";
  peerId: string;
  peerName: string;
  peerAvatar: string | null;
  peerMatric?: string | null;
  conversationId?: string | null;
  myUserId: string;
}) {
  if (state) await teardown("cancelled");

  state = {
    callId: opts.callId,
    callType: opts.callType,
    phase: "calling",
    peerId: opts.peerId,
    peerName: opts.peerName,
    peerAvatar: opts.peerAvatar,
    peerMatric: opts.peerMatric,
    isCaller: true,
    conversationId: opts.conversationId,
    myUserId: opts.myUserId,
    muted: false,
    camOff: false,
    speakerOn: opts.callType === "video",
    facing: "user",
    seconds: 0,
    sharingScreen: false,
  };
  emit();

  try {
    localStream = await getLocalMedia(opts.callType === "video", "user");
    if (localVideoEl) localVideoEl.srcObject = localStream;

    pc = createPeerConnection();
    localStream.getTracks().forEach((t) => pc!.addTrack(t, localStream!));

    pc.ontrack = (ev) => {
      remoteStream = ev.streams[0] || null;
      if (remoteVideoEl && remoteStream) remoteVideoEl.srcObject = remoteStream;
      if (state) {
        state.phase = "active";
        emit();
        void nativeStartCallService(
          state.peerName,
          state.callType === "video" ? "Video call" : "Voice call",
        );
        clearTimer();
        timer = setInterval(() => {
          if (state) {
            state.seconds += 1;
            emit();
          }
        }, 1000);
        void updateCallStatus(state.callId, "active");
      }
    };

    pc.onicecandidate = (ev) => {
      if (ev.candidate && channel && state) {
        void broadcastSignal(channel, {
          type: "ice",
          candidate: ev.candidate.toJSON(),
          from: state.myUserId,
        });
      }
    };

    channel = subscribeCallChannel(opts.callId, handleSignal);

    // Create offer after short delay
    window.setTimeout(() => {
      void (async () => {
        if (!pc || !channel || !state) return;
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await broadcastSignal(channel, {
          type: "offer",
          sdp: offer,
          from: state.myUserId,
        });
      })();
    }, 350);

    // Auto no-answer timeout 45s
    window.setTimeout(() => {
      if (state && (state.phase === "calling" || state.phase === "ringing" || state.phase === "connecting")) {
        void endCall("missed");
      }
    }, 45_000);
  } catch (e) {
    console.error(e);
    await teardown("cancelled");
    throw e;
  }
}

export async function acceptIncomingCall(opts: {
  callId: string;
  callType: "voice" | "video";
  peerId: string;
  peerName: string;
  peerAvatar: string | null;
  peerMatric?: string | null;
  conversationId?: string | null;
  myUserId: string;
}) {
  await nativeStopRing();
  if (state && state.callId !== opts.callId) await teardown("busy");

  state = {
    callId: opts.callId,
    callType: opts.callType,
    phase: "connecting",
    peerId: opts.peerId,
    peerName: opts.peerName,
    peerAvatar: opts.peerAvatar,
    peerMatric: opts.peerMatric,
    isCaller: false,
    conversationId: opts.conversationId,
    myUserId: opts.myUserId,
    muted: false,
    camOff: false,
    speakerOn: opts.callType === "video",
    facing: "user",
    seconds: 0,
    sharingScreen: false,
  };
  emit();

  try {
    localStream = await getLocalMedia(opts.callType === "video", "user");
    if (localVideoEl) localVideoEl.srcObject = localStream;
    pc = createPeerConnection();
    localStream.getTracks().forEach((t) => pc!.addTrack(t, localStream!));
    pc.ontrack = (ev) => {
      remoteStream = ev.streams[0] || null;
      if (remoteVideoEl && remoteStream) remoteVideoEl.srcObject = remoteStream;
      if (state) {
        state.phase = "active";
        emit();
        void nativeStartCallService(state.peerName, "In call");
        clearTimer();
        timer = setInterval(() => {
          if (state) {
            state.seconds += 1;
            emit();
          }
        }, 1000);
        void updateCallStatus(state.callId, "active");
      }
    };
    pc.onicecandidate = (ev) => {
      if (ev.candidate && channel && state) {
        void broadcastSignal(channel, {
          type: "ice",
          candidate: ev.candidate.toJSON(),
          from: state.myUserId,
        });
      }
    };
    channel = subscribeCallChannel(opts.callId, handleSignal);
    await updateParticipantStatus(opts.callId, opts.myUserId, "joined");
  } catch (e) {
    console.error(e);
    await teardown("cancelled");
    throw e;
  }
}

/** Callee: show ring UI + native ringtone when invite arrives */
export async function notifyIncomingCall(opts: {
  callId: string;
  callType: "voice" | "video";
  peerId: string;
  peerName: string;
  peerAvatar: string | null;
  peerMatric?: string | null;
  conversationId?: string | null;
  myUserId: string;
}) {
  if (state && state.phase !== "idle" && state.phase !== "ended") {
    // busy
    return;
  }
  state = {
    callId: opts.callId,
    callType: opts.callType,
    phase: "ringing",
    peerId: opts.peerId,
    peerName: opts.peerName,
    peerAvatar: opts.peerAvatar,
    peerMatric: opts.peerMatric,
    isCaller: false,
    conversationId: opts.conversationId,
    myUserId: opts.myUserId,
    muted: false,
    camOff: false,
    speakerOn: false,
    facing: "user",
    seconds: 0,
    sharingScreen: false,
  };
  emit();
  await nativeStartRing();
  await nativeShowIncoming({
    callId: opts.callId,
    callerName: opts.peerName,
    subtitle: [
      opts.peerMatric,
      opts.callType === "video" ? "Incoming video call" : "Incoming voice call",
    ]
      .filter(Boolean)
      .join(" · "),
    callType: opts.callType,
  });
}

function handleSignal(ev: SignalEvent) {
  if (!state || !pc) return;
  if (ev.from === state.myUserId) return;
  void (async () => {
    try {
      if (ev.type === "offer" && pc.signalingState !== "closed") {
        await pc.setRemoteDescription(ev.sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (channel) {
          await broadcastSignal(channel, {
            type: "answer",
            sdp: answer,
            from: state!.myUserId,
          });
        }
        if (state) {
          state.phase = "connecting";
          emit();
        }
      } else if (ev.type === "answer" && pc.signalingState !== "closed") {
        await pc.setRemoteDescription(ev.sdp);
        if (state) {
          state.phase = "connecting";
          emit();
        }
      } else if (ev.type === "ice" && ev.candidate) {
        try {
          await pc.addIceCandidate(ev.candidate);
        } catch {
          /* ignore */
        }
      } else if (ev.type === "hangup") {
        await endCall("ended");
      } else if (ev.type === "reject") {
        await endCall("rejected");
      } else if (ev.type === "busy") {
        await endCall("busy");
      }
    } catch (e) {
      console.error(e);
    }
  })();
}

export async function endCall(reason: "ended" | "cancelled" | "rejected" | "missed" | "busy" = "ended") {
  if (channel && state) {
    try {
      await broadcastSignal(channel, {
        type: reason === "rejected" ? "reject" : "hangup",
        from: state.myUserId,
      });
    } catch {
      /* ignore */
    }
  }
  await teardown(reason);
}

export function minimizeCall() {
  if (!state) return;
  if (state.phase === "active") {
    state.phase = "minimized";
    emit();
  }
}

export function restoreCall() {
  if (!state) return;
  if (state.phase === "minimized") {
    state.phase = "active";
    emit();
  }
}

export function toggleMute() {
  if (!state || !localStream) return;
  state.muted = !state.muted;
  localStream.getAudioTracks().forEach((t) => {
    t.enabled = !state!.muted;
  });
  emit();
}

export function toggleCam() {
  if (!state || !localStream) return;
  state.camOff = !state.camOff;
  localStream.getVideoTracks().forEach((t) => {
    t.enabled = !state!.camOff;
  });
  emit();
}

export async function toggleSpeaker() {
  if (!state) return;
  state.speakerOn = !state.speakerOn;
  await nativeSetSpeaker(state.speakerOn);
  emit();
}

export async function flipCamera() {
  if (!state || !localStream) return;
  const next = state.facing === "user" ? "environment" : "user";
  try {
    await switchCameraFacing(localStream, pc, next);
    state.facing = next;
    if (localVideoEl) localVideoEl.srcObject = localStream;
    emit();
  } catch (e) {
    console.error(e);
  }
}

export async function startScreenShare() {
  if (!state || !pc) return;
  try {
    // Prefer native MediaProjection via ScreenSharePlugin when available
    const display = await (navigator.mediaDevices as MediaDevices & {
      getDisplayMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
    }).getDisplayMedia?.({ video: true, audio: false });
    if (!display) return;
    const track = display.getVideoTracks()[0];
    if (!track) return;
    const sender = pc.getSenders().find((s) => s.track?.kind === "video");
    if (sender) await sender.replaceTrack(track);
    track.onended = () => {
      void stopScreenShare();
    };
    state.sharingScreen = true;
    emit();
  } catch {
    /* cancelled */
  }
}

export async function stopScreenShare() {
  if (!state || !pc || !localStream) return;
  const cam = localStream.getVideoTracks()[0];
  const sender = pc.getSenders().find((s) => s.track?.kind === "video");
  if (sender && cam) await sender.replaceTrack(cam);
  state.sharingScreen = false;
  emit();
}
