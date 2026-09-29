import { supabase } from "@/integrations/supabase/client";

export type CallType = "voice" | "video";
export type CallStatus =
  | "ringing"
  | "active"
  | "ended"
  | "missed"
  | "rejected"
  | "busy"
  | "cancelled";

export type CallSession = {
  id: string;
  callType: CallType;
  status: CallStatus;
  initiatorId: string;
  conversationId: string | null;
  createdAt: string;
  answeredAt: string | null;
  endedAt: string | null;
};

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

export async function startDirectCall(opts: {
  calleeId: string;
  callType: CallType;
  conversationId?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("start_direct_call", {
    p_callee_id: opts.calleeId,
    p_call_type: opts.callType,
    p_conversation_id: opts.conversationId || null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function updateCallStatus(
  callId: string,
  status: CallStatus,
  endReason?: string,
) {
  const patch: Record<string, unknown> = { status };
  if (status === "active") patch.answered_at = new Date().toISOString();
  if (["ended", "missed", "rejected", "busy", "cancelled"].includes(status)) {
    patch.ended_at = new Date().toISOString();
    if (endReason) patch.end_reason = endReason;
  }
  const { error } = await supabase
    .from("call_sessions")
    .update(patch)
    .eq("id", callId);
  if (error) throw new Error(error.message);
}

export async function updateParticipantStatus(
  callId: string,
  userId: string,
  status: string,
) {
  const patch: Record<string, unknown> = { status };
  if (status === "joined") patch.joined_at = new Date().toISOString();
  if (status === "left" || status === "rejected" || status === "missed") {
    patch.left_at = new Date().toISOString();
  }
  const { error } = await supabase
    .from("call_participants")
    .update(patch)
    .eq("call_id", callId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

export async function listCallHistory(userId: string, limit = 40) {
  const { data: parts, error } = await supabase
    .from("call_participants")
    .select("call_id, role, status")
    .eq("user_id", userId)
    .order("call_id", { ascending: false })
    .limit(limit * 2);
  if (error) throw new Error(error.message);
  const callIds = [...new Set((parts || []).map((p) => p.call_id as string))];
  if (!callIds.length) return [];
  const { data: sessions, error: e2 } = await supabase
    .from("call_sessions")
    .select("*")
    .in("id", callIds)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (e2) throw new Error(e2.message);
  return sessions || [];
}

export function createPeerConnection() {
  return new RTCPeerConnection({ iceServers: ICE_SERVERS });
}

export async function getLocalMedia(video: boolean, facingMode: "user" | "environment" = "user") {
  return navigator.mediaDevices.getUserMedia({
    audio: true,
    video: video
      ? { facingMode: { ideal: facingMode }, width: { ideal: 640 }, height: { ideal: 480 } }
      : false,
  });
}

/** Swap front/back camera on an existing stream + peer connection. */
export async function switchCameraFacing(
  localStream: MediaStream,
  pc: RTCPeerConnection | null,
  nextFacing: "user" | "environment",
): Promise<MediaStream> {
  const oldVideo = localStream.getVideoTracks()[0];
  const newStream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { exact: nextFacing }, width: { ideal: 640 }, height: { ideal: 480 } },
  }).catch(() =>
    navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: nextFacing }, width: { ideal: 640 }, height: { ideal: 480 } },
    }),
  );
  const newTrack = newStream.getVideoTracks()[0];
  if (!newTrack) throw new Error("No camera available");

  if (pc) {
    const sender = pc.getSenders().find((s) => s.track?.kind === "video");
    if (sender) await sender.replaceTrack(newTrack);
  }
  if (oldVideo) {
    localStream.removeTrack(oldVideo);
    oldVideo.stop();
  }
  localStream.addTrack(newTrack);
  // stop extra tracks from temp stream
  newStream.getAudioTracks().forEach((t) => t.stop());
  return localStream;
}


export type SignalEvent =
  | { type: "offer"; sdp: RTCSessionDescriptionInit; from: string }
  | { type: "answer"; sdp: RTCSessionDescriptionInit; from: string }
  | { type: "ice"; candidate: RTCIceCandidateInit; from: string }
  | { type: "hangup"; from: string }
  | { type: "reject"; from: string }
  | { type: "busy"; from: string };

export function callChannelName(callId: string) {
  return `call:${callId}`;
}

export function subscribeCallChannel(
  callId: string,
  onEvent: (ev: SignalEvent) => void,
) {
  const channel = supabase.channel(callChannelName(callId), {
    config: { broadcast: { self: false } },
  });
  channel
    .on("broadcast", { event: "signal" }, ({ payload }) => {
      if (payload && typeof payload === "object") {
        onEvent(payload as SignalEvent);
      }
    })
    .subscribe();
  return channel;
}

export async function broadcastSignal(
  channel: ReturnType<typeof supabase.channel>,
  event: SignalEvent,
) {
  await channel.send({
    type: "broadcast",
    event: "signal",
    payload: event,
  });
}


/** Best-effort high-priority push so callee device wakes when app is backgrounded. */
) {
  try {
    const mod = await import("@/lib/push-send.functions");
    const fn =
      (mod as { sendUserPush?: (i: unknown) => Promise<unknown> }).sendUserPush ||
      (mod as { pushToUser?: (i: unknown) => Promise<unknown> }).pushToUser ||
      (mod as { sendPushNotification?: (i: unknown) => Promise<unknown> }).sendPushNotification;
    if (typeof fn === "function") {
      await fn({
        recipientUserId: opts.calleeId,
        title: opts.callerName || "D4EXAM",
        message:
          opts.callType === "video"
            ? `Incoming video call${opts.callerMatric ? " · " + opts.callerMatric : ""}`
            : `Incoming voice call${opts.callerMatric ? " · " + opts.callerMatric : ""}`,
        link: `/student/messages?incomingCall=${encodeURIComponent(opts.callId)}&type=${opts.callType}`,
      });
    }
  } catch {
    /* best-effort */
  }
}


/** Best-effort high-priority push so callee device wakes when app is backgrounded. */
export async function notifyCalleeOfIncomingCall(opts: {
  calleeId: string;
  callId: string;
  callType: "voice" | "video";
  callerName: string;
  callerMatric?: string | null;
}) {
  try {
    const { dispatchPushToUser } = await import("@/lib/push-send.functions");
    await dispatchPushToUser({
      data: {
        recipientUserId: opts.calleeId,
        title: opts.callerName || "D4EXAM",
        message:
          opts.callType === "video"
            ? `Incoming video call${opts.callerMatric ? " · " + opts.callerMatric : ""}`
            : `Incoming voice call${opts.callerMatric ? " · " + opts.callerMatric : ""}`,
        link: `/student/messages?incomingCall=${encodeURIComponent(opts.callId)}&type=${opts.callType}`,
      },
    });
  } catch {
    /* best-effort — Realtime still signals when app is open */
  }
}
