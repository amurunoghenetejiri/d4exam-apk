import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Ban,
  Flag,
  MessageCircle,
  MoreVertical,
  Phone,
  Video,
  X,
  Camera,
  Loader2,
  GraduationCap,
  Hash,
  Building2,
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

export function UserProfileView({
  userId,
  onBack,
  groupContext,
  onStartCall,
}: {
  userId: string;
  onBack?: () => void;
  groupContext?: { id: string; name: string } | null;
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
  const [photoOpen, setPhotoOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const profileQ = useQuery({
    queryKey: ["public-profile", userId, myId],
    enabled: Boolean(userId && userId.length > 8),
    queryFn: () => fetchPublicProfile(userId, myId),
    staleTime: 20_000,
    retry: 1,
  });

  const p = profileQ.data;
  const loading = profileQ.isLoading || profileQ.isFetching;

  const goMessage = async () => {
    if (!myId || !p || p.isMe) return;
    if (!isOnlineNow()) {
      toast.error("Connect to the internet to message");
      return;
    }
    setBusy("msg");
    try {
      const schoolId = p.schoolId || session?.schoolId || "";
      const id = await getOrCreateDirectConversation(myId, p.authUserId, schoolId);
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
      toast.error("Internet connection is required for calls");
      return;
    }
    if (p.isBlockedByMe || p.isBlockedMe) {
      toast.error("You cannot call this user");
      return;
    }
    setBusy(callType);
    try {
      const callId = await startDirectCall({
        calleeId: p.authUserId,
        callType,
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
      setMoreOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  const onPickPhoto = async (file: File) => {
    if (!session?.profileId || !p?.isMe) return;
    setBusy("photo");
    try {
      await updateMyProfilePhoto(session.profileId, file);
      toast.success("Photo updated");
      void qc.invalidateQueries({ queryKey: ["public-profile", userId] });
      void qc.invalidateQueries({ queryKey: ["session-user"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  };

  if (loading && !p) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 bg-gradient-to-b from-[#0b1b3a] to-[#1a3a6e]">
        <Loader2 className="h-9 w-9 animate-spin text-white" />
        <p className="text-sm font-medium text-white/70">Loading profile…</p>
      </div>
    );
  }

  if (!p) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 bg-gradient-to-b from-[#0b1b3a] to-[#122a52] px-6 text-center text-white">
        <div className="grid h-16 w-16 place-items-center rounded-full bg-white/10 text-2xl font-bold">
          ?
        </div>
        <div>
          <p className="text-lg font-bold">Profile not found</p>
          <p className="mt-1 text-sm text-white/60">
            This user may be offline or not in your school.
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="rounded-full bg-white/15 px-5 py-2.5 text-sm font-semibold backdrop-blur"
        >
          Go back
        </button>
      </div>
    );
  }

  return (
    <div className="relative min-h-full overflow-hidden bg-[#0b1b3a] text-white">
      {/* soft watermark */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 50% 30%, rgba(96,165,250,0.35), transparent 55%)",
        }}
      />

      <div className="relative z-10 flex items-center justify-between px-3 pb-1 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={onBack}
          className="grid h-10 w-10 place-items-center rounded-full bg-white/10 active:scale-95"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <p className="text-sm font-semibold tracking-wide text-white/90">
          {p.isMe ? "My Profile" : "Profile"}
        </p>
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className="grid h-10 w-10 place-items-center rounded-full bg-white/10 active:scale-95"
          aria-label="More"
        >
          <MoreVertical className="h-5 w-5" />
        </button>
      </div>

      {/* Avatar + radial actions */}
      <div className="relative mx-auto mt-6 flex h-[210px] w-[210px] items-center justify-center sm:h-[240px] sm:w-[240px]">
        {!p.isMe ? (
          <>
            <Orb className="absolute left-1/2 top-0 -translate-x-1/2" label="Video" onClick={() => void startCall("video")} busy={busy === "video"}>
              <Video className="h-5 w-5" />
            </Orb>
            <Orb className="absolute left-0 top-1/2 -translate-y-1/2" label="Chat" onClick={() => void goMessage()} busy={busy === "msg"}>
              <MessageCircle className="h-5 w-5" />
            </Orb>
            <Orb className="absolute right-0 top-1/2 -translate-y-1/2" label="Call" onClick={() => void startCall("voice")} busy={busy === "voice"}>
              <Phone className="h-5 w-5" />
            </Orb>
            <Orb className="absolute bottom-0 left-1/2 -translate-x-1/2" label="More" onClick={() => setMoreOpen(true)}>
              <MoreVertical className="h-5 w-5" />
            </Orb>
          </>
        ) : null}

        <button
          type="button"
          onClick={() => setPhotoOpen(true)}
          className="relative z-10 grid h-28 w-28 place-items-center overflow-hidden rounded-full bg-[#1e3a6e] shadow-[0_0_0_4px_rgba(255,255,255,0.2),0_12px_40px_rgba(0,0,0,0.35)] ring-2 ring-[#60a5fa]/50 sm:h-32 sm:w-32"
        >
          {p.avatarUrl ? (
            <img src={p.avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-3xl font-extrabold tracking-wide">{initials(p.fullName)}</span>
          )}
          {p.isMe ? (
            <label className="absolute inset-x-0 bottom-0 cursor-pointer bg-black/55 py-1.5 text-center text-[10px] font-bold">
              <Camera className="mx-auto h-3.5 w-3.5" />
              <input
                type="file"
                accept="image/*"
                capture="user"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onPickPhoto(f);
                }}
              />
            </label>
          ) : null}
        </button>
      </div>

      <div className="relative z-10 mt-3 px-5 text-center">
        <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">{p.fullName}</h1>
        {p.matricNumber ? (
          <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-0.5 text-xs font-semibold text-blue-100">
            <Hash className="h-3 w-3" />
            {p.matricNumber}
          </p>
        ) : null}
        <p className="mt-2 text-sm text-blue-100/85">
          {[p.departmentName, p.levelName].filter(Boolean).join(" · ") || "D4EXAM member"}
        </p>
        {groupContext ? (
          <p className="mt-1 text-xs text-blue-200/60">Member of {groupContext.name}</p>
        ) : null}
      </div>

      {/* Sheet */}
      <div className="relative z-10 mt-6 rounded-t-[1.75rem] bg-white px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5 text-slate-900 shadow-2xl">
        <div className="space-y-2">
          <InfoRow icon={<Building2 className="h-4 w-4 text-[#2563eb]" />} label="Department" value={p.departmentName || "—"} />
          <InfoRow icon={<GraduationCap className="h-4 w-4 text-[#2563eb]" />} label="Level" value={p.levelName || "—"} />
          <InfoRow icon={<Hash className="h-4 w-4 text-[#2563eb]" />} label="Matric number" value={p.matricNumber || "—"} />
        </div>

        {!p.isMe ? (
          <div className="mt-5 grid grid-cols-3 gap-2">
            <ActionBtn icon={<MessageCircle className="h-4 w-4" />} label="Message" onClick={() => void goMessage()} />
            <ActionBtn icon={<Phone className="h-4 w-4" />} label="Voice" onClick={() => void startCall("voice")} />
            <ActionBtn icon={<Video className="h-4 w-4" />} label="Video" onClick={() => void startCall("video")} />
          </div>
        ) : (
          <p className="mt-4 text-center text-xs text-slate-500">
            This is how others see you in D4Chat.
          </p>
        )}
      </div>

      {photoOpen ? (
        <div className="fixed inset-0 z-[100] flex flex-col bg-black">
          <div className="flex items-center justify-between px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <button type="button" onClick={() => setPhotoOpen(false)} className="grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white">
              <X className="h-5 w-5" />
            </button>
            <p className="text-sm font-semibold text-white">{p.fullName}</p>
            <span className="w-10" />
          </div>
          <div className="flex flex-1 items-center justify-center p-4">
            {p.avatarUrl ? (
              <img src={p.avatarUrl} alt="" className="max-h-full max-w-full object-contain" />
            ) : (
              <div className="grid h-48 w-48 place-items-center rounded-full bg-[#1e3a6e] text-5xl font-extrabold text-white">
                {initials(p.fullName)}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {moreOpen ? (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/45 sm:items-center" onClick={() => setMoreOpen(false)}>
          <div className="mb-[max(0.5rem,env(safe-area-inset-bottom))] w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="border-b px-4 py-3 text-sm font-bold text-slate-800">Actions</p>
            {!p.isMe ? (
              <>
                <SheetBtn onClick={() => void goMessage()}>Message</SheetBtn>
                <SheetBtn onClick={() => void startCall("voice")}>Voice call</SheetBtn>
                <SheetBtn onClick={() => void startCall("video")}>Video call</SheetBtn>
                <SheetBtn danger onClick={() => void toggleBlock()} icon={p.isBlockedByMe ? undefined : <Ban className="h-4 w-4" />}>
                  {p.isBlockedByMe ? "Unblock" : "Block user"}
                </SheetBtn>
                <SheetBtn danger icon={<Flag className="h-4 w-4" />} onClick={() => { toast.message("Report submitted"); setMoreOpen(false); }}>
                  Report user
                </SheetBtn>
              </>
            ) : (
              <SheetBtn onClick={() => { appNavigate("/student/settings"); setMoreOpen(false); }}>
                Account settings
              </SheetBtn>
            )}
            <SheetBtn onClick={() => setMoreOpen(false)}>Cancel</SheetBtn>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Orb({ className, children, label, onClick, busy }: { className?: string; children: ReactNode; label: string; onClick: () => void; busy?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={busy} className={cn("flex flex-col items-center gap-1 transition active:scale-90", className)}>
      <span className="grid h-11 w-11 place-items-center rounded-full bg-white text-[#1d4ed8] shadow-lg shadow-black/25 ring-2 ring-white/50">
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : children}
      </span>
      <span className="text-[10px] font-semibold text-white/90">{label}</span>
    </button>
  );
}

function ActionBtn({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-center gap-1 rounded-2xl border border-blue-100 bg-[#eff6ff] py-3 text-[#1d4ed8] transition active:scale-[0.97]">
      {icon}
      <span className="text-[11px] font-bold">{label}</span>
    </button>
  );
}

function InfoRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/90 px-3 py-2.5">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-white shadow-sm">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
        <p className="truncate text-sm font-bold text-slate-900">{value}</p>
      </div>
    </div>
  );
}

function SheetBtn({ children, onClick, danger, icon }: { children: ReactNode; onClick: () => void; danger?: boolean; icon?: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex w-full items-center gap-2 border-b border-slate-100 px-4 py-3.5 text-left text-sm font-semibold last:border-0", danger ? "text-rose-600" : "text-slate-800")}>
      {icon}
      {children}
    </button>
  );
}
