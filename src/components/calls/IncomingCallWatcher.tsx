import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSessionUser } from "@/lib/session";
import {
  getCallSession,
  notifyIncomingCall,
  subscribeCallSession,
} from "@/lib/call-session";
import { fetchPublicProfile } from "@/lib/user-profile";

/**
 * Listens for incoming call_participants rows (Realtime) + personal broadcast
 * so the callee sees ring UI even when push is delayed.
 */
export function IncomingCallWatcher({
  onIncoming,
}: {
  onIncoming?: (call: {
    callId: string;
    callType: "voice" | "video";
    peerId: string;
    peerName: string;
    peerAvatar: string | null;
    peerMatric?: string | null;
    conversationId?: string | null;
  }) => void;
}) {
  const { data: session } = useSessionUser();
  const myId = session?.userId || null;
  const handled = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!myId) return;

    const handleInvite = async (payload: {
      callId: string;
      callType?: string;
      fromUserId?: string;
      conversationId?: string | null;
      callerName?: string;
    }) => {
      const callId = String(payload.callId || "");
      if (!callId || handled.current.has(callId)) return;
      const cur = getCallSession();
      if (cur && !["ended", "no_answer", "missed", "failed", "declined", "idle"].includes(cur.phase)) {
        return;
      }
      handled.current.add(callId);
      const peerId = String(payload.fromUserId || "");
      let peerName = payload.callerName || "Incoming call";
      let peerAvatar: string | null = null;
      let peerMatric: string | null = null;
      if (peerId) {
        try {
          const p = await fetchPublicProfile(peerId, myId);
          if (p) {
            peerName = p.fullName || peerName;
            peerAvatar = p.avatarUrl;
            peerMatric = p.matricNumber;
          }
        } catch {
          /* ignore */
        }
      }
      const callType = payload.callType === "video" ? "video" : "voice";
      await notifyIncomingCall({
        callId,
        callType,
        peerId: peerId || "unknown",
        peerName,
        peerAvatar,
        peerMatric,
        conversationId: payload.conversationId || null,
        myUserId: myId,
      });
      onIncoming?.({
        callId,
        callType,
        peerId: peerId || "unknown",
        peerName,
        peerAvatar,
        peerMatric,
        conversationId: payload.conversationId || null,
      });
    };

    // Personal broadcast channel — caller invites here
    const personal = supabase.channel(`user-calls:${myId}`, {
      config: { broadcast: { self: false } },
    });
    personal
      .on("broadcast", { event: "incoming_call" }, ({ payload }) => {
        void handleInvite(payload as {
          callId: string;
          callType?: string;
          fromUserId?: string;
          conversationId?: string | null;
          callerName?: string;
        });
      })
      .subscribe();

    // Postgres Realtime on call_participants
    const db = supabase
      .channel(`incoming-calls-db:${myId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "call_participants",
          filter: `user_id=eq.${myId}`,
        },
        (payload) => {
          const row = payload.new as {
            call_id?: string;
            role?: string;
            status?: string;
          };
          if (!row?.call_id) return;
          if (row.role === "caller") return;
          if (row.status && row.status !== "ringing") return;
          void (async () => {
            const { data: cs } = await supabase
              .from("call_sessions")
              .select("id, call_type, initiator_id, conversation_id, status")
              .eq("id", row.call_id)
              .maybeSingle();
            if (!cs || (cs as { status?: string }).status === "ended") return;
            await handleInvite({
              callId: String((cs as { id: string }).id),
              callType: String((cs as { call_type?: string }).call_type || "voice"),
              fromUserId: String((cs as { initiator_id?: string }).initiator_id || ""),
              conversationId: (cs as { conversation_id?: string | null }).conversation_id || null,
            });
          })();
        },
      )
      .subscribe();

    return () => {
      void personal.unsubscribe();
      void db.unsubscribe();
    };
  }, [myId, onIncoming]);

  // Keep session subscription warm
  useEffect(() => subscribeCallSession(() => {}), []);

  return null;
}
