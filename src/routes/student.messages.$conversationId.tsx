/**
 * Campus conversation chat (direct + group).
 * Reuses MessageMedia; stores in campus_messages.
 */
import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  Mic,
  Paperclip,
  Send,
  UsersRound,
  X,
  Pause,
  Play,
} from "lucide-react";
import { useSessionUser } from "@/lib/session";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  listMessages,
  markConversationRead,
  sendCampusMessage,
  type CampusMessage,
} from "@/lib/messaging";
import { uploadMessageMedia } from "@/lib/message-media";
import {
  VoiceBubble,
  ImageBubble,
  ImageLightbox,
  VideoBubble,
  FileBubble,
  VideoLightbox,
  stopAllVoices,
  parseMediaUrls,
} from "@/components/messaging/MessageMedia";
import { isOnlineNow } from "@/lib/offline-sync";
import { toast } from "sonner";

export const Route = createFileRoute("/student/messages/$conversationId")({
  head: () => ({ meta: [{ title: "Chat — D4EXAM" }] }),
  component: ConversationChat,
});

function ConversationChat() {
  const { conversationId } = useParams({ from: "/student/messages/$conversationId" });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: session } = useSessionUser();
  const userId = session?.userId || "";

  const [text, setText] = useState("");
  const [optimistic, setOptimistic] = useState<CampusMessage[]>([]);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [showScroll, setShowScroll] = useState(false);

  // Voice recording (matches VoiceRecorderBar state model)
  const [recording, setRecording] = useState(false);
  const [recPaused, setRecPaused] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const mediaRec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const recTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const endRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const sendLock = useRef(false);

  const metaQuery = useQuery({
    queryKey: ["campus-conv-meta", conversationId, userId],
    enabled: Boolean(conversationId && userId),
    queryFn: async () => {
      const { data: conv } = await supabase
        .from("conversations")
        .select("id, type, title, avatar_url")
        .eq("id", conversationId)
        .maybeSingle();
      if (!conv) return null;
      if (conv.type === "group") {
        return {
          title: (conv.title as string) || "Group",
          subtitle: "Group",
          avatar: (conv.avatar_url as string) || null,
          isGroup: true,
        };
      }
      const { data: members } = await supabase
        .from("conversation_members")
        .select("user_id")
        .eq("conversation_id", conversationId)
        .neq("user_id", userId)
        .is("left_at", null)
        .limit(1);
      const peerId = members?.[0]?.user_id as string | undefined;
      let name = "Chat";
      let avatar: string | null = null;
      if (peerId) {
        const { data: p } = await supabase
          .from("profiles")
          .select("full_name, avatar_url")
          .eq("auth_user_id", peerId)
          .maybeSingle();
        name = (p?.full_name as string) || "Student";
        avatar = (p?.avatar_url as string) || null;
      }
      return { title: name, subtitle: "Student", avatar, isGroup: false };
    },
  });

  const msgQuery = useQuery({
    queryKey: ["campus-messages", conversationId],
    enabled: Boolean(conversationId),
    staleTime: 5_000,
    queryFn: () => listMessages(conversationId, 120),
  });

  useEffect(() => {
    if (!conversationId) return;
    const ch = supabase
      .channel(`campus-msg-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "campus_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          void qc.invalidateQueries({ queryKey: ["campus-messages", conversationId] });
          void qc.invalidateQueries({ queryKey: ["campus-conversations"] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [conversationId, qc]);

  useEffect(() => {
    if (userId && conversationId) {
      void markConversationRead(conversationId, userId);
    }
  }, [userId, conversationId, msgQuery.dataUpdatedAt]);

  const serverMsgs = msgQuery.data || [];
  const merged = useMemo(() => {
    const byClient = new Set(
      serverMsgs.map((m) => m.client_id).filter(Boolean) as string[],
    );
    const pending = optimistic.filter(
      (o) => o.client_id && !byClient.has(o.client_id),
    );
    return [...serverMsgs, ...pending].sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
  }, [serverMsgs, optimistic]);

  const scrollToEnd = useCallback((smooth = true) => {
    endRef.current?.scrollIntoView({
      behavior: smooth ? "smooth" : "auto",
      block: "end",
    });
  }, []);

  useEffect(() => {
    if (!showScroll) scrollToEnd(false);
  }, [merged.length, showScroll, scrollToEnd]);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScroll(dist > 120);
  };

  const stopRecTimer = () => {
    if (recTimer.current) {
      clearInterval(recTimer.current);
      recTimer.current = null;
    }
  };

  const cleanupStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    mediaRec.current = null;
    chunks.current = [];
  };

  const cancelRecording = () => {
    stopRecTimer();
    try {
      mediaRec.current?.stop();
    } catch {
      /* ignore */
    }
    cleanupStream();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setRecording(false);
    setRecPaused(false);
    setRecSecs(0);
  };

  const startRecording = async () => {
    stopAllVoices();
    cancelRecording();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream);
      chunks.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunks.current, { type: "audio/webm" });
        if (blob.size > 0) {
          setPreviewUrl(URL.createObjectURL(blob));
        }
      };
      mediaRec.current = rec;
      rec.start(200);
      setRecording(true);
      setRecPaused(false);
      setRecSecs(0);
      recTimer.current = setInterval(() => setRecSecs((s) => s + 1), 1000);
    } catch {
      toast.error("Microphone permission required");
    }
  };

  const pauseRecording = () => {
    try {
      mediaRec.current?.pause();
    } catch {
      /* ignore */
    }
    stopRecTimer();
    setRecPaused(true);
  };

  const continueRecording = () => {
    try {
      mediaRec.current?.resume();
    } catch {
      /* ignore */
    }
    setRecPaused(false);
    recTimer.current = setInterval(() => setRecSecs((s) => s + 1), 1000);
  };

  const finishAndSendVoice = async () => {
    stopRecTimer();
    const durationSec = recSecs;
    await new Promise<void>((resolve) => {
      const rec = mediaRec.current;
      if (!rec || rec.state === "inactive") {
        resolve();
        return;
      }
      rec.onstop = () => {
        const blob = new Blob(chunks.current, { type: "audio/webm" });
        cleanupStream();
        void (async () => {
          const localUrl = URL.createObjectURL(blob);
          const clientId = `opt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          setOptimistic((p) => [
            ...p,
            {
              id: clientId,
              conversation_id: conversationId,
              sender_id: userId,
              body: null,
              attachment_url: localUrl,
              attachment_type: "audio",
              reply_to_id: null,
              forwarded_from_id: null,
              client_id: clientId,
              duration_sec: durationSec,
              created_at: new Date().toISOString(),
              edited_at: null,
              deleted_at: null,
            },
          ]);
          setRecording(false);
          setRecPaused(false);
          setRecSecs(0);
          setPreviewUrl(null);
          try {
            const up = await uploadMessageMedia(
              blob,
              "audio/webm",
              `campus/${conversationId}`,
            );
            await sendCampusMessage({
              conversationId,
              senderId: userId,
              attachmentUrl: up.url,
              attachmentType: "audio",
              clientId,
              durationSec,
            });
            void qc.invalidateQueries({
              queryKey: ["campus-messages", conversationId],
            });
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Voice send failed");
          }
        })();
        resolve();
      };
      try {
        rec.stop();
      } catch {
        resolve();
      }
    });
  };

  const doSendText = async () => {
    const t = text.trim();
    if (!t || !userId || !conversationId || sendLock.current) return;
    const clientId = `opt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setOptimistic((p) => [
      ...p,
      {
        id: clientId,
        conversation_id: conversationId,
        sender_id: userId,
        body: t,
        attachment_url: null,
        attachment_type: null,
        reply_to_id: null,
        forwarded_from_id: null,
        client_id: clientId,
        duration_sec: null,
        created_at: new Date().toISOString(),
        edited_at: null,
        deleted_at: null,
      },
    ]);
    setText("");
    scrollToEnd();
    sendLock.current = true;
    try {
      if (!isOnlineNow()) {
        toast.message("Waiting for connection");
        return;
      }
      await sendCampusMessage({
        conversationId,
        senderId: userId,
        body: t,
        clientId,
      });
      void qc.invalidateQueries({ queryKey: ["campus-messages", conversationId] });
      void qc.invalidateQueries({ queryKey: ["campus-conversations"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Send failed");
    } finally {
      sendLock.current = false;
    }
  };

  const onFile = async (file: File) => {
    const kind = file.type || "";
    const localUrl = URL.createObjectURL(file);
    const attType = kind.startsWith("image/")
      ? "image"
      : kind.startsWith("video/")
        ? "video"
        : kind.startsWith("audio/")
          ? "audio"
          : "file";
    const clientId = `opt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setOptimistic((p) => [
      ...p,
      {
        id: clientId,
        conversation_id: conversationId,
        sender_id: userId,
        body: null,
        attachment_url: localUrl,
        attachment_type: attType,
        reply_to_id: null,
        forwarded_from_id: null,
        client_id: clientId,
        duration_sec: null,
        created_at: new Date().toISOString(),
        edited_at: null,
        deleted_at: null,
      },
    ]);
    try {
      const up = await uploadMessageMedia(file, kind, `campus/${conversationId}`);
      await sendCampusMessage({
        conversationId,
        senderId: userId,
        attachmentUrl: up.url,
        attachmentType:
          up.type === "image" ? "image" : up.type === "audio" ? "audio" : attType,
        clientId,
      });
      void qc.invalidateQueries({ queryKey: ["campus-messages", conversationId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    }
  };

  const meta = metaQuery.data;
  const mm = String(Math.floor(recSecs / 60)).padStart(2, "0");
  const ss = String(recSecs % 60).padStart(2, "0");

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-slate-50">
      <header
        className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-[#0b1b3a] px-3 py-2.5 text-white"
        style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top, 0px))" }}
      >
        <button
          type="button"
          onClick={() => navigate({ to: "/student/messages" })}
          className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/10"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-white/15">
          {meta?.avatar ? (
            <img src={meta.avatar} alt="" className="h-full w-full object-cover" />
          ) : meta?.isGroup ? (
            <UsersRound className="h-4 w-4" />
          ) : (
            <span className="text-xs font-bold">
              {(meta?.title || "?").slice(0, 2).toUpperCase()}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{meta?.title || "Chat"}</p>
          <p className="truncate text-[11px] text-white/70">{meta?.subtitle || ""}</p>
        </div>
      </header>

      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="relative min-h-0 flex-1 overflow-y-auto px-3 py-3"
      >
        <div className="mx-auto flex max-w-2xl flex-col gap-2">
          {merged.map((m) => {
            const mine = m.sender_id === userId;
            const urls = parseMediaUrls(m.attachment_url);
            const att = (m.attachment_type || "").toLowerCase();
            const isVoice = att.includes("audio") || att === "voice";
            const isImage = att.includes("image") || att === "photo";
            const isVideo = att.includes("video");
            const isFile =
              Boolean(m.attachment_url) && !isVoice && !isImage && !isVideo;
            const pending =
              m.id.startsWith("opt-") || Boolean(m.client_id?.startsWith("opt-"));
            const timeLabel = formatTime(m.created_at);
            const tick = pending ? "pending" : "delivered";

            return (
              <div
                key={m.id}
                className={cn("flex w-full", mine ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-3 py-2 shadow-sm",
                    mine
                      ? "rounded-br-md border border-slate-200 bg-white text-slate-800"
                      : "rounded-bl-md bg-[#2563eb] text-white",
                    (isImage || isVideo) && "overflow-hidden p-1",
                  )}
                >
                  {isVoice && m.attachment_url ? (
                    <VoiceBubble
                      src={m.attachment_url}
                      mine={mine}
                      timeLabel={timeLabel}
                      tick={tick}
                      id={m.id}
                      durationSec={m.duration_sec}
                    />
                  ) : isImage && (urls[0] || m.attachment_url) ? (
                    <ImageBubble
                      src={urls[0] || m.attachment_url!}
                      mine={mine}
                      timeLabel={timeLabel}
                      tick={tick}
                      onOpen={() => setLightboxSrc(urls[0] || m.attachment_url!)}
                    />
                  ) : isVideo && m.attachment_url ? (
                    <VideoBubble
                      src={m.attachment_url}
                      mine={mine}
                      timeLabel={timeLabel}
                      tick={tick}
                      onOpen={() => setVideoSrc(m.attachment_url!)}
                    />
                  ) : isFile && m.attachment_url ? (
                    <FileBubble
                      src={m.attachment_url}
                      mine={mine}
                      timeLabel={timeLabel}
                      tick={tick}
                    />
                  ) : (
                    <>
                      <p className="whitespace-pre-wrap text-[15px] leading-snug">
                        {m.body}
                      </p>
                      <div
                        className={cn(
                          "mt-1 flex items-center justify-end gap-1 text-[10px]",
                          mine ? "text-slate-400" : "text-white/70",
                        )}
                      >
                        <span>{timeLabel}</span>
                        {mine ? (
                          pending ? (
                            <Check className="h-3 w-3" />
                          ) : (
                            <CheckCheck className="h-3 w-3" />
                          )
                        ) : null}
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>

        {showScroll ? (
          <button
            type="button"
            onClick={() => scrollToEnd(true)}
            className="absolute bottom-3 left-1/2 z-10 grid h-10 w-10 -translate-x-1/2 place-items-center rounded-full bg-[#2563eb] text-lg font-bold text-white shadow-lg animate-pulse"
            aria-label="Scroll to latest"
          >
            ↓
          </button>
        ) : null}
      </div>

      <div
        className="shrink-0 border-t border-slate-200 bg-white px-2 py-2"
        style={{
          paddingBottom: "max(0.5rem, env(safe-area-inset-bottom, 0px))",
        }}
      >
        {recording ? (
          <div className="mx-auto max-w-2xl rounded-xl border border-blue-200/80 bg-gradient-to-b from-[#eff6ff] to-white px-3 py-2.5">
            <div className="mb-2 text-center">
              <p className="text-sm font-bold tabular-nums text-slate-800">
                {mm}:{ss}
              </p>
              <p className="text-[10px] text-slate-500">
                {recPaused ? "Paused" : "Recording…"}
              </p>
            </div>
            <div className="flex items-center justify-center gap-4">
              <button
                type="button"
                onClick={cancelRecording}
                className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-slate-600"
                aria-label="Cancel"
              >
                <X className="h-5 w-5" />
              </button>
              {recPaused ? (
                <button
                  type="button"
                  onClick={continueRecording}
                  className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-slate-700"
                  aria-label="Continue"
                >
                  <Play className="h-5 w-5" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={pauseRecording}
                  className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-slate-700"
                  aria-label="Pause"
                >
                  <Pause className="h-5 w-5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => void finishAndSendVoice()}
                className="grid h-10 w-10 place-items-center rounded-full bg-[#2563eb] text-white"
                aria-label="Send"
              >
                <Send className="h-5 w-5" />
              </button>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-2xl items-end gap-1.5">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-slate-500 hover:bg-slate-100"
              aria-label="Attach"
            >
              <Paperclip className="h-5 w-5" />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,video/*,audio/*,.pdf,.doc,.docx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
                e.target.value = "";
              }}
            />
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={1}
              placeholder="Message…"
              className="max-h-28 min-h-[2.75rem] flex-1 resize-none rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/25"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void doSendText();
                }
              }}
            />
            {text.trim() ? (
              <button
                type="button"
                onClick={() => void doSendText()}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#2563eb] text-white"
                aria-label="Send"
              >
                <Send className="h-5 w-5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void startRecording()}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#2563eb] text-white"
                aria-label="Record voice"
              >
                <Mic className="h-5 w-5" />
              </button>
            )}
          </div>
        )}
      </div>

      {lightboxSrc ? (
        <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      ) : null}
      {videoSrc ? (
        <VideoLightbox src={videoSrc} onClose={() => setVideoSrc(null)} />
      ) : null}
    </div>
  );
}

function formatTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
