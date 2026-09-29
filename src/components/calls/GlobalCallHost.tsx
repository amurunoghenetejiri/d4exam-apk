import { useCallback, useEffect, useState } from "react";
import { useSessionUser } from "@/lib/session";
import { IncomingCallWatcher } from "@/components/calls/IncomingCallWatcher";
import { CallOverlay, type ActiveCall } from "@/components/calls/CallOverlay";
import {
  getCallSession,
  subscribeCallSession,
  type CallSessionState,
} from "@/lib/call-session";

/**
 * App-wide call host: listens for incoming invites on every page
 * and shows the call UI / status bar overlay.
 */
export function GlobalCallHost() {
  const { data: session } = useSessionUser();
  const myUserId = session?.userId || null;
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [sess, setSess] = useState<CallSessionState | null>(getCallSession());

  useEffect(() => subscribeCallSession(setSess), []);

  // Mirror global session into ActiveCall so overlay stays mounted
  useEffect(() => {
    if (!sess) {
      // keep activeCall briefly for no_answer UI inside overlay
      return;
    }
    if (sess.phase === "ended") {
      setActiveCall(null);
      return;
    }
    setActiveCall({
      callId: sess.callId,
      callType: sess.callType,
      peerId: sess.peerId,
      peerName: sess.peerName,
      peerAvatar: sess.peerAvatar,
      peerMatric: sess.peerMatric,
      isCaller: sess.isCaller,
      conversationId: sess.conversationId,
    });
  }, [sess?.callId, sess?.phase, sess?.peerName]);

  const onIncoming = useCallback(
    (call: {
      callId: string;
      callType: "voice" | "video";
      peerId: string;
      peerName: string;
      peerAvatar: string | null;
      peerMatric?: string | null;
      conversationId?: string | null;
    }) => {
      setActiveCall({
        callId: call.callId,
        callType: call.callType,
        peerId: call.peerId,
        peerName: call.peerName,
        peerAvatar: call.peerAvatar,
        peerMatric: call.peerMatric,
        isCaller: false,
        conversationId: call.conversationId,
      });
    },
    [],
  );

  if (!myUserId) return null;

  return (
    <>
      <IncomingCallWatcher onIncoming={onIncoming} />
      {activeCall ? (
        <CallOverlay
          call={activeCall}
          myUserId={myUserId}
          onClose={() => setActiveCall(null)}
        />
      ) : null}
    </>
  );
}
