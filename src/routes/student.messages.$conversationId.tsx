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
  Forward,
  MoreVertical,
  UserMinus,
  LogOut,
  VolumeX,
  Volume2,
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
import {
  enqueueOutbox,
  listOutbox,
  removeOutbox,
  markOutboxFailed,
  markOutboxUploading,
  canRetry,
  subscribeOutbox,
  dataUrlToBlob,
} from "@/lib/message-outbox";
import {
  forwardCampusMessage,
  listMyConversations,
  listConversationMembers,
  updateGroupMeta,
  addGroupMembers,
  removeGroupMember,
  leaveGroup,
  setGroupMuted,
  discoverStudents,
  deleteGroup,
  getConversationMeta,
} from "@/lib/messaging";
import { toast } from "sonner";

function ConversationChatRoute() {
  const { conversationId } = useParams({ from: "/student/messages/$conversationId" });
  return <ConversationChat conversationId={conversationId} />;
}

export const Route = createFileRoute("/student/messages/$conversationId")({
  head: () => ({ meta: [{ title: "Chat — D4EXAM" }] }),
  component: ConversationChatRoute,
});

/** Shared chat UI — used by route and inline from Messages hub (APK-safe). */
export function ConversationChat({
  conversationId,
  onBack,
}: {
  conversationId: string;
  onBack?: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: session } = useSessionUser();
  const userId = session?.userId || "";

  const goBack = () => {
    if (onBack) {
      onBack();
      return;
    }
    try {
      void navigate({ to: "/student/messages" });
    } catch {
      if (typeof window !== "undefined") {
        window.location.hash = "/student/messages";
      }
    }
  };

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
  const [forwardMsg, setForwardMsg] = useState<CampusMessage | null>(null);
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameVal, setRenameVal] = useState("");
  const [addMembersOpen, setAddMembersOpen] = useState(false);

  const metaQuery = useQuery({
    queryKey: ["campus-conv-meta", conversationId, userId],
    enabled: Boolean(conversationId && userId),
    queryFn: async () => {
      const rich = await getConversationMeta(conversationId, userId);
      if (rich) {
        return {
          title: rich.title,
          subtitle: rich.subtitle,
          avatar: rich.avatar,
          isGroup: rich.isGroup,
          creatorName: rich.creatorName,
          created_at: rich.created_at,
          description: rich.description,
          memberCount: rich.memberCount,
          myRole: rich.myRole,
        };
      }
      return null;
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

  // Flush campus outbox when back online
  useEffect(() => {
    if (!userId || !conversationId) return;
    const flush = async () => {
      if (!isOnlineNow()) return;
      const items = listOutbox("student").filter(
        (x) => x.conversationId === conversationId && canRetry(x),
      );
      for (const item of items) {
        try {
          markOutboxUploading(item.clientId);
          let mediaUrl = item.mediaUrl || null;
          if (!mediaUrl && item.blobDataUrl) {
            const blob = dataUrlToBlob(item.blobDataUrl);
            if (blob) {
              const up = await uploadMessageMedia(
                blob,
                item.mediaType || blob.type || "application/octet-stream",
                `campus/${conversationId}`,
              );
              mediaUrl = up.url;
            }
          }
          await sendCampusMessage({
            conversationId,
            senderId: userId,
            body: item.text || null,
            attachmentUrl: mediaUrl,
            attachmentType: item.mediaType || null,
            clientId: item.clientId,
            durationSec: item.durationSec ?? null,
            forwardedFromId: item.forwardedFromId || null,
            replyToId: item.replyToId || null,
          });
          removeOutbox(item.clientId);
        } catch (e) {
          markOutboxFailed(item.clientId, e instanceof Error ? e.message : "fail");
        }
      }
      void qc.invalidateQueries({ queryKey: ["campus-messages", conversationId] });
    };
    void flush();
    const unsub = subscribeOutbox(() => { void flush(); });
    const onOnline = () => { void flush(); };
    window.addEventListener("online", onOnline);
    return () => {
      unsub();
      window.removeEventListener("online", onOnline);
    };
  }, [userId, conversationId, qc]);

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
            if (!isOnlineNow()) {
              const { blobToDataUrlIfSmall } = await import("@/lib/message-outbox");
              const dataUrl = await blobToDataUrlIfSmall(blob);
              enqueueOutbox({
                clientId,
                kind: "campus_audio",
                text: "",
                mediaType: "audio",
                blobDataUrl: dataUrl,
                role: "student",
                userId,
                conversationId,
                durationSec,
              });
              toast.message("Voice queued — waiting for connection");
              return;
            }
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
        enqueueOutbox({
          clientId,
          kind: "campus_text",
          text: t,
          role: "student",
          userId,
          conversationId,
        });
        toast.message("Waiting for connection — queued");
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
      if (!isOnlineNow()) {
        const { blobToDataUrlIfSmall } = await import("@/lib/message-outbox");
        const dataUrl = await blobToDataUrlIfSmall(file);
        enqueueOutbox({
          clientId,
          kind: "campus_media",
          text: "",
          mediaType: attType,
          blobDataUrl: dataUrl,
          role: "student",
          userId,
          conversationId,
        });
        toast.message("Attachment queued — waiting for connection");
        return;
      }
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
    <div className="relative flex h-dvh min-h-0 flex-col bg-[#e8f4fc]">
      {/* Soft sky-blue chat wallpaper + D4EXAM logo watermark */}
      <div
        className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
        aria-hidden
      >
        <div className="absolute inset-0 bg-gradient-to-b from-[#dbeafe]/80 via-[#e8f4fc] to-[#f0f9ff]" />
        <img
          src="/logo.png"
          alt=""
          className="absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 object-contain opacity-[0.07]"
          style={{
            animation: "d4ChatLogoFloat 8s ease-in-out infinite",
          }}
        />
        <style>{`@keyframes d4ChatLogoFloat { 0%,100% { transform: translate(-50%, -50%) scale(1); opacity: 0.06; } 50% { transform: translate(-50%, -52%) scale(1.06); opacity: 0.1; } }`}</style>
      </div>
      <header
        className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-[#0b1b3a] px-3 py-2.5 text-white"
        style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top, 0px))" }}
      >
        <button
          type="button"
          onClick={() => goBack()}
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
        {meta?.isGroup ? (
          <button
            type="button"
            onClick={() => setGroupMenuOpen(true)}
            className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/10"
            aria-label="Group menu"
          >
            <MoreVertical className="h-5 w-5" />
          </button>
        ) : null}
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
                onContextMenu={(e) => {
                  e.preventDefault();
                  setForwardMsg(m);
                }}
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

      {forwardMsg ? (
        <ForwardSheet
          userId={userId}
          source={forwardMsg}
          onClose={() => setForwardMsg(null)}
          onDone={() => {
            setForwardMsg(null);
            toast.success("Message forwarded");
          }}
        />
      ) : null}

      {meta?.isGroup && (meta.creatorName || meta.created_at) ? (
        <div className="shrink-0 border-b border-blue-50 bg-[#eff6ff] px-4 py-2 text-center text-[11px] text-slate-600">
          <span className="font-semibold text-[#2563eb]">Study group</span>
          {meta.creatorName ? (
            <span>
              {" "}
              · Created by <span className="font-semibold text-slate-800">{meta.creatorName}</span>
            </span>
          ) : null}
          {meta.created_at ? (
            <span>
              {" "}
              ·{" "}
              {new Date(meta.created_at).toLocaleDateString([], {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </span>
          ) : null}
          {meta.memberCount ? (
            <span> · {meta.memberCount} members</span>
          ) : null}
        </div>
      ) : null}

      {groupMenuOpen && meta?.isGroup ? (
        <GroupMenuSheet
          conversationId={conversationId}
          userId={userId}
          title={meta.title}
          creatorName={meta.creatorName}
          createdAt={meta.created_at}
          onClose={() => setGroupMenuOpen(false)}
          onLeft={() => goBack()}
        />
      ) : null}
    </div>
  );
}

function formatTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function ForwardSheet({
  userId,
  source,
  onClose,
  onDone,
}: {
  userId: string;
  source: CampusMessage;
  onClose: () => void;
  onDone: () => void;
}) {
  const { data: convs = [], isLoading } = useQuery({
    queryKey: ["campus-conversations", userId, "forward"],
    enabled: Boolean(userId),
    queryFn: () => listMyConversations(userId),
  });
  const [busy, setBusy] = useState<string | null>(null);

  const sendTo = async (targetId: string) => {
    if (busy) return;
    setBusy(targetId);
    try {
      const clientId = `fwd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      if (!isOnlineNow()) {
        enqueueOutbox({
          clientId,
          kind: "campus_forward",
          text: source.body || "",
          mediaUrl: source.attachment_url,
          mediaType: source.attachment_type,
          role: "student",
          userId,
          conversationId: targetId,
          durationSec: source.duration_sec,
          forwardedFromId: source.id,
        });
        toast.message("Queued — will send when online");
        onDone();
        return;
      }
      await forwardCampusMessage({
        targetConversationId: targetId,
        senderId: userId,
        source,
        clientId,
      });
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Forward failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="flex max-h-[70dvh] w-full max-w-md flex-col rounded-t-3xl bg-white shadow-xl sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <Forward className="h-4 w-4 text-[#2563eb]" />
            <h2 className="text-sm font-bold">Forward to…</h2>
          </div>
          <button type="button" onClick={onClose} className="text-sm font-semibold text-slate-500">
            Cancel
          </button>
        </div>
        <div className="relative z-10 min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <p className="px-4 py-8 text-center text-sm text-slate-400">Loading…</p>
          ) : convs.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">No chats yet</p>
          ) : (
            convs.map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={busy === c.id || c.id === source.conversation_id}
                onClick={() => void sendTo(c.id)}
                className="flex w-full items-center gap-3 border-b border-slate-50 px-4 py-3 text-left hover:bg-slate-50 disabled:opacity-40"
              >
                <div className="grid h-10 w-10 place-items-center rounded-full bg-[#0b1b3a] text-xs font-bold text-white">
                  {c.isGroup ? <UsersRound className="h-4 w-4" /> : c.title.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{c.title}</p>
                  <p className="truncate text-[11px] text-slate-500">{c.isGroup ? "Group" : "Chat"}</p>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function GroupMenuSheet({
  conversationId,
  userId,
  title,
  creatorName,
  createdAt,
  onClose,
  onLeft,
}: {
  conversationId: string;
  userId: string;
  title: string;
  creatorName?: string | null;
  createdAt?: string | null;
  onClose: () => void;
  onLeft: () => void;
}) {
  const qc = useQueryClient();
  const [rename, setRename] = useState(title);
  const [renaming, setRenaming] = useState(false);
  const membersQ = useQuery({
    queryKey: ["campus-members", conversationId],
    queryFn: () => listConversationMembers(conversationId),
  });
  const me = (membersQ.data || []).find((m) => m.user_id === userId);
  const isAdmin = me?.role === "admin" || me?.role === "owner";

  const saveRename = async () => {
    if (!rename.trim()) return;
    try {
      await updateGroupMeta(conversationId, { title: rename.trim() });
      void qc.invalidateQueries({ queryKey: ["campus-conv-meta", conversationId] });
      void qc.invalidateQueries({ queryKey: ["campus-conversations"] });
      toast.success("Group renamed");
      setRenaming(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Rename failed");
    }
  };

  const doLeave = async () => {
    try {
      await leaveGroup(conversationId, userId);
      toast.success("Left group");
      onLeft();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not leave");
    }
  };

  const doDelete = async () => {
    if (!isAdmin) return;
    if (!window.confirm("Delete this group for everyone?")) return;
    try {
      await deleteGroup(conversationId);
      toast.success("Group deleted");
      onLeft();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const [addOpen, setAddOpen] = useState(false);
  const [addQ, setAddQ] = useState("");
  const addStudentsQ = useQuery({
    queryKey: ["group-add-students", addQ],
    enabled: addOpen,
    queryFn: () =>
      discoverStudents({
        schoolId: "",
        query: addQ,
        excludeUserId: userId,
        limit: 30,
      }),
  });

  const addOne = async (authUserId: string | null) => {
    if (!authUserId) {
      toast.error("Student account not linked");
      return;
    }
    try {
      await addGroupMembers(conversationId, [authUserId]);
      void membersQ.refetch();
      toast.success("Member added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add");
    }
  };

  const toggleMute = async () => {
    try {
      await setGroupMuted(conversationId, userId, !me?.muted);
      void membersQ.refetch();
      toast.success(me?.muted ? "Unmuted" : "Muted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const removeMember = async (uid: string) => {
    try {
      await removeGroupMember(conversationId, uid);
      void membersQ.refetch();
      toast.success("Member removed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Remove failed");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="flex max-h-[80dvh] w-full max-w-md flex-col rounded-t-3xl bg-white shadow-xl sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-bold">Group settings</h2>
          <button type="button" onClick={onClose} className="text-sm font-semibold text-slate-500">
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {(creatorName || createdAt) && (
            <div className="rounded-xl bg-[#eff6ff] px-3 py-2 text-xs text-slate-600">
              {creatorName ? (
                <p>
                  Created by <span className="font-semibold text-slate-900">{creatorName}</span>
                </p>
              ) : null}
              {createdAt ? (
                <p className="mt-0.5 text-slate-500">
                  {new Date(createdAt).toLocaleString()}
                </p>
              ) : null}
            </div>
          )}
          {isAdmin ? (
            <div>
              <p className="text-xs font-semibold text-slate-500">Group name</p>
              {renaming ? (
                <div className="mt-1 flex gap-2">
                  <input
                    value={rename}
                    onChange={(e) => setRename(e.target.value)}
                    className="h-10 flex-1 rounded-xl border border-slate-200 px-3 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => void saveRename()}
                    className="rounded-xl bg-[#2563eb] px-3 text-xs font-bold text-white"
                  >
                    Save
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setRenaming(true)}
                  className="mt-1 text-sm font-semibold text-[#2563eb]"
                >
                  {title} · Rename
                </button>
              )}
            </div>
          ) : (
            <p className="text-sm font-semibold text-slate-800">{title}</p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void toggleMute()}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 py-2.5 text-xs font-bold text-slate-700"
            >
              {me?.muted ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              {me?.muted ? "Unmute" : "Mute"}
            </button>
            <button
              type="button"
              onClick={() => void doLeave()}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-rose-200 py-2.5 text-xs font-bold text-rose-600"
            >
              <LogOut className="h-4 w-4" />
              Leave
            </button>
          </div>

          {isAdmin ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAddOpen((v) => !v)}
                className="flex flex-1 items-center justify-center rounded-xl border border-slate-200 py-2.5 text-xs font-bold text-slate-800"
              >
                Add members
              </button>
              <button
                type="button"
                onClick={() => void doDelete()}
                className="flex flex-1 items-center justify-center rounded-xl border border-red-200 bg-red-50 py-2.5 text-xs font-bold text-red-700"
              >
                Delete group
              </button>
            </div>
          ) : null}

          {addOpen ? (
            <div className="rounded-xl border border-slate-100 p-2">
              <input
                value={addQ}
                onChange={(e) => setAddQ(e.target.value)}
                placeholder="Search name or matric..."
                className="mb-2 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"
              />
              <div className="max-h-40 space-y-1 overflow-y-auto">
                {(addStudentsQ.data || []).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => void addOne(s.auth_user_id)}
                    className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50"
                  >
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{s.full_name}</span>
                      {s.matric_number ? (
                        <span className="ml-1 text-[10px] text-slate-400">{s.matric_number}</span>
                      ) : null}
                    </span>
                    <span className="text-[10px] font-bold text-[#2563eb]">Add</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Members ({(membersQ.data || []).length})
            </p>
            {(membersQ.data || []).map((m) => (
              <div key={m.user_id} className="relative z-10 flex items-center gap-2 border-b border-slate-50 py-2">
                <div className="grid h-8 w-8 place-items-center rounded-full bg-slate-200 text-[10px] font-bold">
                  {m.full_name.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{m.full_name}</p>
                  <p className="text-[10px] text-slate-500">{m.role}</p>
                </div>
                {isAdmin && m.user_id !== userId ? (
                  <button
                    type="button"
                    onClick={() => void removeMember(m.user_id)}
                    className="grid h-8 w-8 place-items-center rounded-full text-rose-500 hover:bg-rose-50"
                    aria-label="Remove"
                  >
                    <UserMinus className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
