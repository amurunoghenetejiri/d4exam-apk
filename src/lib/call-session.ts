/**
 * Global call session — owns WebRTC + signaling outside React lifecycle.
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
  nativeStopCallService,
  nativeShowIncoming,
} from "@/lib/native-call";
import { startCallRingtone, stopCallRingtone } from "@/lib/ringtone";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type CallPhase =
  | "idle"
  | "calling"
  | "ringing"
  | "connecting"
  | "active"
  | "minimized"
  | "no_answer"
  | "ended"
  | "declined"
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
  isCaller: boolean;
  conversationId?: string | null;
  myUserId: string;
  muted: boolean;
  camOff: boolean;
  speakerOn: boolean;
  facing: "user" | "environment";
  seconds: number;
  sharingScreen: boolean;
  error?: string | null;
};

type Listener = (s: CallSessionState | null) => void;

let state: CallSessionState | null = null;
let pc: RTCPeerConnection | null = null;
let localStream: MediaStream | null = null;
let remoteStream: MediaStream | null = null;
let channel: RealtimeChannel | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let ringTimeout: ReturnType<typeof setTimeout> | null = null;
let listeners = new Set<Listener>();
let localVideoEl: HTMLVideoElement | null = null;
let remoteVideoEl: HTMLVideoElement | null = null;

const RING_MS = 30_000;

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

function clearTimers() {
  if (timer) clearInterval(timer);
  timer = null;
  if (ringTimeout) clearTimeout(ringTimeout);
  ringTimeout = null;
}

async function hardTeardown() {
  clearTimers();
  await stopCallRingtone();
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
  if (state) await endCall("cancelled");

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
    error: null,
  };
  emit();
  void nativeStartCallService(
    opts.peerName,
    opts.callType === "video" ? "Video call · Calling…" : "Voice call · Calling…",
  );

  try {
    localStream = await getLocalMedia(opts.callType === "video", "user");
    if (localVideoEl) localVideoEl.srcObject = localStream;
  } catch (e) {
    const msg =
      opts.callType === "video"
        ? "Camera/microphone permission is required for video calls."
        : "Microphone permission is required for voice calls.";
    if (state) {
      state.error = msg;
      state.phase = "failed";
      emit();
    }
    console.error(e);
    return;
  }

  try {
    pc = createPeerConnection();
    localStream.getTracks().forEach((t) => pc!.addTrack(t, localStream!));

    pc.ontrack = (ev) => {
      remoteStream = ev.streams[0] || null;
      if (remoteVideoEl && remoteStream) remoteVideoEl.srcObject = remoteStream;
      if (state) {
        clearTimers();
        state.phase = "active";
        state.error = null;
        emit();
        void nativeStartCallService(
          state.peerName,
          state.callType === "video" ? "Video call" : "Voice call",
        );
        timer = setInterval(() => {
          if (state && (state.phase === "active" || state.phase === "minimized")) {
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

    window.setTimeout(() => {
      void (async () => {
        if (!pc || !channel || !state) return;
        try {
          const offer = await pc.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: opts.callType === "video",
          });
          await pc.setLocalDescription(offer);
          await broadcastSignal(channel, {
            type: "offer",
            sdp: offer,
            from: state.myUserId,
          });
        } catch (e) {
          console.error(e);
        }
      })();
    }, 300);

    // 30s no-answer
    ringTimeout = setTimeout(() => {
      if (
        state &&
        state.isCaller &&
        (state.phase === "calling" || state.phase === "connecting" || state.phase === "ringing")
      ) {
        void markNoAnswer();
      }
    }, RING_MS);
  } catch (e) {
    console.error(e);
    if (state) {
      state.error = "Could not start the call. Check your connection.";
      state.phase = "failed";
      emit();
    }
  }
}

async function markNoAnswer() {
  if (!state) return;
  state.phase = "no_answer";
  emit();
  await stopCallRingtone();
  try {
    await updateCallStatus(state.callId, "missed");
  } catch {
    /* ignore */
  }
  await postSystemMessage(
    state.conversationId,
    state.myUserId,
    state.callType === "video" ? "Missed video call · No answer" : "Missed voice call · No answer",
  );
  // Keep UI on no_answer; media can stop
  try {
    localStream?.getTracks().forEach((t) => t.stop());
  } catch {
    /* ignore */
  }
  try {
    pc?.close();
  } catch {
    /* ignore */
  }
  pc = null;
  if (channel) {
    try {
      await broadcastSignal(channel, { type: "hangup", from: state.myUserId });
      await channel.unsubscribe();
    } catch {
      /* ignore */
    }
    channel = null;
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
  await stopCallRingtone();

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
    error: null,
  };
  emit();
  void nativeStartCallService(
    opts.peerName,
    opts.callType === "video" ? "Video call · Calling…" : "Voice call · Calling…",
  );

  try {
    localStream = await getLocalMedia(opts.callType === "video", "user");
    if (localVideoEl) localVideoEl.srcObject = localStream;
  } catch (e) {
    if (state) {
      state.error =
        opts.callType === "video"
          ? "Camera/microphone permission is required."
          : "Microphone permission is required.";
      state.phase = "failed";
      emit();
    }
    return;
  }

  try {
    pc = createPeerConnection();
    localStream.getTracks().forEach((t) => pc!.addTrack(t, localStream!));
    pc.ontrack = (ev) => {
      remoteStream = ev.streams[0] || null;
      if (remoteVideoEl && remoteStream) remoteVideoEl.srcObject = remoteStream;
      if (state) {
        state.phase = "active";
        emit();
        void nativeStartCallService(state.peerName, "In call");
        clearTimers();
        timer = setInterval(() => {
          if (state && (state.phase === "active" || state.phase === "minimized")) {
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
    if (state) {
      state.error = "Could not answer the call.";
      state.phase = "failed";
      emit();
    }
  }
}

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
  if (state && !["idle", "ended", "no_answer", "failed", "declined", "missed"].includes(state.phase)) {
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
    error: null,
  };
  emit();
  await startCallRingtone();
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
  ringTimeout = setTimeout(() => {
    if (state && state.phase === "ringing" && !state.isCaller) {
      void markMissed();
    }
  }, RING_MS);
}

async function markMissed() {
  if (!state) return;
  state.phase = "missed";
  emit();
  await stopCallRingtone();
  await postSystemMessage(
    state.conversationId,
    state.myUserId,
    state.callType === "video" ? "Missed video call" : "Missed voice call",
  );
  try {
    await updateCallStatus(state.callId, "missed");
  } catch {
    /* ignore */
  }
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
        if (state?.isCaller) await endCall("ended");
        else await markMissed();
      } else if (ev.type === "reject") {
        if (state) {
          state.phase = "declined";
          emit();
          await hardTeardown();
          await postSystemMessage(
            state.conversationId,
            state.myUserId,
            state.callType === "video" ? "Video call declined" : "Voice call declined",
          );
        }
      } else if (ev.type === "busy") {
        await endCall("ended");
      }
    } catch (e) {
      console.error(e);
    }
  })();
}

export async function endCall(
  reason: "ended" | "cancelled" | "rejected" | "missed" | "busy" = "ended",
) {
  const snap = state;
  if (channel && snap) {
    try {
      await broadcastSignal(channel, {
        type: reason === "rejected" ? "reject" : "hangup",
        from: snap.myUserId,
      });
    } catch {
      /* ignore */
    }
  }
  if (snap && reason === "rejected") {
    await postSystemMessage(
      snap.conversationId,
      snap.myUserId,
      snap.callType === "video" ? "Video call declined" : "Voice call declined",
    );
  }
  await hardTeardown();
  try {
    if (snap) {
      await updateCallStatus(
        snap.callId,
        reason === "cancelled" ? "cancelled" : reason === "rejected" ? "rejected" : "ended",
      );
      await updateParticipantStatus(snap.callId, snap.myUserId, "left");
    }
  } catch {
    /* ignore */
  }
  state = null;
  emit();
}

export function dismissCallUi() {
  void hardTeardown();
  state = null;
  emit();
}

export function minimizeCall() {
  if (!state) return;
  if (state.phase === "active" || state.phase === "calling" || state.phase === "connecting") {
    state.phase = "minimized";
    emit();
  }
}

export function restoreCall() {
  if (!state) return;
  if (state.phase === "minimized") {
    state.phase = state.seconds > 0 ? "active" : "calling";
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
    const display = await (
      navigator.mediaDevices as MediaDevices & {
        getDisplayMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
      }
    ).getDisplayMedia?.({ video: true, audio: false });
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
