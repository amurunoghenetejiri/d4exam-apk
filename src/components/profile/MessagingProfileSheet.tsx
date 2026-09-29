import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Ban,
  Bell,
  Flag,
  Heart,
  Loader2,
  MessageCircle,
  Camera,
  MoreVertical,
  Phone,
  Search,
  Trash2,
  Users,
  UsersRound,
  Video,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useSessionUser } from "@/lib/session";
import {
  blockUser,
  fetchPublicProfile,
  unblockUser,
  updateMyProfilePhoto,
} from "@/lib/user-profile";
import { getOrCreateDirectConversation } from "@/lib/messaging";
import { appNavigate } from "@/lib/app-navigate";
import { startDirectCall } from "@/lib/calls";
import { isOnlineNow } from "@/lib/offline-guard";

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() || "")
      .join("") || "?"
  );
}

export function MessagingProfileSheet({
  userId,
  open,
  onClose,
  onStartCall,
  conversationId,
}: {
  userId: string | null;
  open: boolean;
  onClose: () => void;
  conversationId?: string | null;
  onStartCall?: (opts: {
    callId: string;
    callType: "voice" | "video";
    peerId: string;
    peerName: string;
    peerAvatar: string | null;
    peerMatric?: string | null;
    isCaller: boolean;
  }) => void;
}) {
  const { data: session } = useSessionUser();
  const myId = session?.userId || "";
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [photoOpen, setPhotoOpen] = useState(false);

  const profileQ = useQuery({
    queryKey: ["public-profile", userId, myId],
    enabled: Boolean(open && userId && userId.length > 8),
    queryFn: () => fetchPublicProfile(userId!, myId),
    staleTime: 15_000,
    retry: 1,
  });
  const p = profileQ.data;

  useEffect(() => {
    if (!open) setPhotoOpen(false);
  }, [open]);

  if (!open || !userId) return null;

  const goMessage = async () => {
    if (!myId || !p || p.isMe) {
      onClose();
      return;
    }
    if (!isOnlineNow()) {
      toast.error("Connect to the internet to message");
      return;
    }
    setBusy("msg");
    try {
      const schoolId = p.schoolId || session?.schoolId || "";
      const id = await getOrCreateDirectConversation(myId, p.authUserId, schoolId);
      onClose();
      appNavigate(`/student/messages?chat=${encodeURIComponent(id)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open chat");
    } finally {
      setBusy(null);
    }
  };

  const startCall = async (callType: "voice" | "video") => {
    if (!myId || !p || p.isMe) return;
    if (!isOnlineNow()) {
      toast.error("Internet is required for calls");
      return;
    }
    setBusy(callType);
    try {
      const callId = await startDirectCall({
        calleeId: p.authUserId,
        callType,
        conversationId: conversationId || null,
      });
      onStartCall?.({
        callId,
        callType,
        peerId: p.authUserId,
        peerName: p.fullName,
        peerAvatar: p.avatarUrl,
        peerMatric: p.matricNumber,
        isCaller: true,
      });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start call");
    } finally {
      setBusy(null);
    }
  };

  const toggleBlock = async () => {
    if (!myId || !p || p.isMe) return;
    setBusy("block");
    try {
      if (p.isBlockedByMe) {
        await unblockUser(myId, p.authUserId);
        toast.success("User unblocked");
      } else {
        await blockUser(myId, p.authUserId);
        toast.success("User blocked");
      }
      void qc.invalidateQueries({ queryKey: ["public-profile", userId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex flex-col bg-[#0b141a] text-white">
      {/* header */}
      <div className="flex items-center justify-between px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <button type="button" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-full active:bg-white/10" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <button type="button" className="grid h-11 w-11 place-items-center rounded-full active:bg-white/10" aria-label="More">
          <MoreVertical className="h-5 w-5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {profileQ.isLoading && !p ? (
          <div className="flex flex-col items-center gap-3 py-20">
            <Loader2 className="h-8 w-8 animate-spin text-white/70" />
            <p className="text-sm text-white/60">Loading profile…</p>
          </div>
        ) : !p ? (
          <div className="flex flex-col items-center gap-3 px-6 py-20 text-center">
            <div className="grid h-24 w-24 place-items-center rounded-full bg-[#1f2c34] text-3xl font-bold text-[#53bdeb]">?</div>
            <p className="text-lg font-bold">Profile not found</p>
            <p className="text-sm text-white/50">This user may not be available in your school.</p>
            <button type="button" onClick={onClose} className="mt-2 rounded-full bg-white/10 px-5 py-2 text-sm font-semibold">
              Close
            </button>
          </div>
        ) : (
          <>
            {/* Avatar + identity */}
            <div className="flex flex-col items-center px-4 pt-2">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setPhotoOpen(true)}
                  className="grid h-[7.5rem] w-[7.5rem] place-items-center overflow-hidden rounded-full bg-[#1f2c34] shadow-lg ring-2 ring-white/10"
                >
                  {p.avatarUrl ? (
                    <img src={p.avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-4xl font-extrabold text-[#53bdeb]">{initials(p.fullName)}</span>
                  )}
                </button>
                {p.isMe ? (
                  <label className="absolute bottom-0 right-0 grid h-9 w-9 cursor-pointer place-items-center rounded-full bg-[#2563eb] text-white shadow-lg">
                    <Camera className="h-4 w-4" />
                    <input
                      type="file"
                      accept="image/*"
                      capture="user"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (!f || !session?.profileId) return;
                        setBusy("photo");
                        void updateMyProfilePhoto(session.profileId, f)
                          .then(() => {
                            toast.success("Photo updated");
                            void qc.invalidateQueries({ queryKey: ["public-profile", userId] });
                          })
                          .catch((err) => toast.error(err instanceof Error ? err.message : "Upload failed"))
                          .finally(() => setBusy(null));
                      }}
                    />
                  </label>
                ) : null}
              </div>
              <h1 className="mt-4 text-center text-2xl font-bold tracking-tight">{p.fullName}</h1>
              {p.matricNumber ? (
                <p className="mt-1 text-sm font-medium text-white/55">{p.matricNumber}</p>
              ) : (
                <p className="mt-1 text-sm text-white/45">D4EXAM member</p>
              )}
            </div>

            {/* Voice / Video / Message */}
            {!p.isMe ? (
              <div className="mx-auto mt-6 flex max-w-sm items-start justify-center gap-6 px-6">
                <ActionRound icon={<Phone className="h-5 w-5" />} label="Voice" onClick={() => void startCall("voice")} busy={busy === "voice"} />
                <ActionRound icon={<Video className="h-5 w-5" />} label="Video" onClick={() => void startCall("video")} busy={busy === "video"} />
                <ActionRound icon={<MessageCircle className="h-5 w-5" />} label="Message" onClick={() => void goMessage()} busy={busy === "msg"} />
              </div>
            ) : (
              <p className="mt-4 text-center text-xs text-white/40">This is how others see you in D4Chat</p>
            )}

            {/* About */}
            <section className="mx-3 mt-7 overflow-hidden rounded-2xl bg-[#1f2c34]">
              <Row label="Department" value={p.departmentName || "—"} />
              <Row label="Level" value={p.levelName || "—"} />
              <Row label="Matric number" value={p.matricNumber || "—"} last />
            </section>

            {/* Media */}
            <section className="mx-3 mt-3 overflow-hidden rounded-2xl bg-[#1f2c34]">
              <button type="button" className="flex w-full items-center justify-between px-4 py-3.5 active:bg-white/5">
                <span className="text-sm font-medium text-white/90">Media, links, and docs</span>
                <span className="text-sm text-white/40">›</span>
              </button>
            </section>

            {/* Groups / favorites */}
            <section className="mx-3 mt-3 overflow-hidden rounded-2xl bg-[#1f2c34]">
              {!p.isMe ? (
                <>
                  <ListBtn icon={<UsersRound className="h-5 w-5 text-[#25d366]" />} title={`Create group with ${p.fullName.split(" ")[0]}`} onClick={() => toast.message("Open Groups tab to create a group")} />
                  <ListBtn icon={<Users className="h-5 w-5 text-[#25d366]" />} title="Add to groups" subtitle="Add this contact to groups you're in." onClick={() => toast.message("Coming soon")} />
                </>
              ) : null}
              <ListBtn icon={<Heart className="h-5 w-5 text-white/70" />} title="Add to Favorites" onClick={() => toast.success("Added to favorites")} />
              <ListBtn icon={<Bell className="h-5 w-5 text-white/70" />} title="Notifications" subtitle="Default" onClick={() => toast.message("Notification settings")} last={p.isMe} />
              {!p.isMe ? (
                <>
                  <ListBtn icon={<Trash2 className="h-5 w-5 text-rose-400" />} title="Clear chat" danger onClick={() => toast.message("Use Clear chat in the conversation menu")} />
                  <ListBtn
                    icon={<Ban className="h-5 w-5 text-rose-400" />}
                    title={p.isBlockedByMe ? `Unblock ${p.fullName.split(" ")[0]}` : `Block ${p.fullName.split(" ")[0]}`}
                    danger
                    onClick={() => void toggleBlock()}
                  />
                  <ListBtn
                    icon={<Flag className="h-5 w-5 text-rose-400" />}
                    title={`Report ${p.fullName.split(" ")[0]}`}
                    danger
                    last
                    onClick={() => toast.message("Report submitted")}
                  />
                </>
              ) : null}
            </section>
          </>
        )}
      </div>

      {photoOpen && p?.avatarUrl ? (
        <div className="fixed inset-0 z-[130] flex flex-col bg-black" onClick={() => setPhotoOpen(false)}>
          <div className="flex justify-end p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <button type="button" className="grid h-10 w-10 place-items-center rounded-full bg-white/15">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex flex-1 items-center justify-center p-4">
            <img src={p.avatarUrl} alt="" className="max-h-full max-w-full object-contain" />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ActionRound({
  icon,
  label,
  onClick,
  busy,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  busy?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={busy} className="flex flex-col items-center gap-2 active:opacity-80">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-[#1f2c34] text-white shadow-inner">
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : icon}
      </span>
      <span className="text-xs font-medium text-white/70">{label}</span>
    </button>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={cn("px-4 py-3", !last && "border-b border-white/5")}>
      <p className="text-[11px] font-medium text-white/40">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-white/90">{value}</p>
    </div>
  );
}

function ListBtn({
  icon,
  title,
  subtitle,
  onClick,
  danger,
  last,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  onClick: () => void;
  danger?: boolean;
  last?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-white/5",
        !last && "border-b border-white/5",
      )}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-sm font-medium", danger ? "text-rose-400" : "text-white/90")}>{title}</span>
        {subtitle ? <span className="mt-0.5 block text-xs text-white/40">{subtitle}</span> : null}
      </span>
    </button>
  );
}
