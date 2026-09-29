import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  Info,
  Loader2,
  MessageCircle,
  MoreVertical,
  Phone,
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
} from "@/lib/user-profile";
import { getOrCreateDirectConversation } from "@/lib/messaging";
import { appNavigate } from "@/lib/app-navigate";
import { startDirectCall } from "@/lib/calls";
import { isOnlineNow } from "@/lib/offline-guard";
import { ProfilePhotoViewer } from "@/components/profile/ProfilePhotoViewer";
import {
  isFavorite,
  toggleFavorite,
} from "@/lib/profile-favorites";

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

/**
 * Centered PROFILE QUICK VIEW modal (not full-screen).
 * Avatar / chat list / directory → this sheet.
 * Info → full profile page.
 */
export function MessagingProfileSheet({
  userId,
  open,
  onClose,
  onStartCall,
  conversationId,
  seedName,
  seedAvatar,
  seedMatric,
}: {
  userId: string | null;
  open: boolean;
  onClose: () => void;
  conversationId?: string | null;
  /** Instant display while network profile loads */
  seedName?: string | null;
  seedAvatar?: string | null;
  seedMatric?: string | null;
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [fav, setFav] = useState(false);

  const profileQ = useQuery({
    queryKey: ["public-profile", userId, myId],
    enabled: Boolean(open && userId && userId.length > 8),
    queryFn: () => fetchPublicProfile(userId!, myId),
    staleTime: 15_000,
    retry: 1,
  });
  const p = profileQ.data;

  useEffect(() => {
    if (!open) {
      setPhotoOpen(false);
      setMenuOpen(false);
    }
  }, [open]);

  useEffect(() => {
    if (open && myId && userId) setFav(isFavorite(myId, userId));
  }, [open, myId, userId]);

  if (!open || !userId) return null;

  const deptLevel = [p?.departmentName, p?.levelName].filter(Boolean).join(" · ");

  const peerId = p?.authUserId || userId || "";
  const peerName = p?.fullName || seedName || "Student";
  const peerAvatar = p?.avatarUrl ?? seedAvatar ?? null;
  const peerMatric = p?.matricNumber ?? seedMatric ?? null;

  const goMessage = async () => {
    if (!myId || !peerId || (p?.isMe)) {
      onClose();
      return;
    }
    if (!isOnlineNow()) {
      toast.error("Connect to the internet to message");
      return;
    }
    setBusy("msg");
    try {
      const schoolId = p?.schoolId || session?.schoolId || "";
      const id = await getOrCreateDirectConversation(myId, peerId, schoolId);
      onClose();
      appNavigate(`/student/messages?chat=${encodeURIComponent(id)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open chat");
    } finally {
      setBusy(null);
    }
  };

  const startCall = async (callType: "voice" | "video") => {
    if (!myId || !peerId || p?.isMe) return;
    if (!isOnlineNow()) {
      toast.error("Internet is required for calls");
      return;
    }
    setBusy(callType);
    try {
      const callId = await startDirectCall({
        calleeId: peerId,
        callType,
        conversationId: conversationId || null,
      });
      onStartCall?.({
        callId,
        callType,
        peerId,
        peerName,
        peerAvatar,
        peerMatric,
        isCaller: true,
      });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start call");
    } finally {
      setBusy(null);
    }
  };

  const goInfo = () => {
    if (!userId) return;
    onClose();
    appNavigate(`/student/user/${encodeURIComponent(userId)}`);
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
      setMenuOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  const onToggleFav = () => {
    if (!myId || !userId || !p || p.isMe) return;
    const next = toggleFavorite(myId, userId);
    setFav(next);
    toast.success(next ? "Added to favorites" : "Removed from favorites");
    setMenuOpen(false);
  };

  return (
    <>
      <div
        className="fixed inset-0 z-[120] flex items-center justify-center bg-[#0b1b3a]/55 px-4 backdrop-blur-[3px] animate-in fade-in duration-200"
        role="dialog"
        aria-modal="true"
        aria-label="Profile preview"
        onClick={onClose}
      >
        <div
          className={cn(
            "relative w-full max-w-[22rem] overflow-hidden rounded-[1.75rem]",
            "bg-gradient-to-b from-[#0d213f] via-[#0b1b3a] to-[#071225]",
            "shadow-2xl shadow-blue-950/50 ring-1 ring-white/10",
            "animate-in zoom-in-95 fade-in duration-200",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {/* soft glow */}
          <div
            aria-hidden
            className="pointer-events-none absolute -top-16 left-1/2 h-40 w-40 -translate-x-1/2 rounded-full bg-[#2563eb]/25 blur-3xl"
          />

          <div className="relative flex items-center justify-between px-3 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white active:bg-white/20"
              aria-label="Cancel"
            >
              <X className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white active:bg-white/20"
              aria-label="More"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </div>

          {menuOpen && p && !p.isMe ? (
            <div className="absolute right-3 top-12 z-10 min-w-[11rem] overflow-hidden rounded-xl border border-white/10 bg-[#122a52] py-1 shadow-xl">
              <MenuItem label={fav ? "Remove favorite" : "Add to favorites"} onClick={onToggleFav} />
              <MenuItem label="Message" onClick={() => void goMessage()} />
              <MenuItem
                label={p.isBlockedByMe ? "Unblock" : "Block"}
                danger
                onClick={() => void toggleBlock()}
              />
              <MenuItem label="View full profile" onClick={goInfo} />
            </div>
          ) : null}

          <div className="relative flex flex-col items-center px-5 pb-6 pt-1">
            {profileQ.isLoading && !p ? (
              <div className="flex flex-col items-center gap-3 py-12">
                <Loader2 className="h-8 w-8 animate-spin text-[#60a5fa]" />
                <p className="text-sm text-white/60">Loading profile…</p>
              </div>
            ) : !p && (seedName || seedAvatar) ? (
              <>
                <button type="button" className="relative mt-1" onClick={() => seedAvatar && setPhotoOpen(true)}>
                  <span className="absolute inset-0 rounded-full bg-[#2563eb]/40 blur-md" />
                  <span className="relative grid h-[6.75rem] w-[6.75rem] place-items-center overflow-hidden rounded-full bg-[#1e3a5f] ring-[3px] ring-[#3b82f6]/80 ring-offset-2 ring-offset-[#0b1b3a]">
                    {seedAvatar ? (
                      <img src={seedAvatar} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-3xl font-extrabold text-[#93c5fd]">
                        {initials(seedName || "?")}
                      </span>
                    )}
                  </span>
                  <span className="absolute bottom-1 right-1 h-3.5 w-3.5 rounded-full border-2 border-[#0b1b3a] bg-emerald-400" />
                </button>
                <h2 className="mt-4 text-center text-xl font-bold tracking-tight text-white">
                  {seedName || "Student"}
                </h2>
                {seedMatric ? (
                  <p className="mt-1 text-sm font-medium text-white/55">{seedMatric}</p>
                ) : null}
                <p className="mt-1 text-[11px] text-white/40">Loading full profile…</p>
                <div className="mt-5 grid w-full grid-cols-4 gap-2">
                  <QuickAction icon={<MessageCircle className="h-5 w-5" />} label="Message" tone="blue" busy={busy === "msg"} onClick={() => void goMessage()} />
                  <QuickAction icon={<Phone className="h-5 w-5" />} label="Voice Call" tone="green" busy={busy === "voice"} onClick={() => void startCall("voice")} />
                  <QuickAction icon={<Video className="h-5 w-5" />} label="Video Call" tone="blue" busy={busy === "video"} onClick={() => void startCall("video")} />
                  <QuickAction icon={<Info className="h-5 w-5" />} label="Info" tone="navy" onClick={goInfo} />
                </div>
              </>
            ) : !p ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <div className="grid h-24 w-24 place-items-center rounded-full bg-white/10 text-3xl font-bold text-[#60a5fa]">
                  ?
                </div>
                <p className="text-base font-bold text-white">Could not load profile</p>
                <p className="text-xs text-white/50">Check connection and try again.</p>
                <button
                  type="button"
                  onClick={() => void profileQ.refetch()}
                  className="mt-2 rounded-full bg-[#2563eb] px-4 py-2 text-xs font-semibold text-white"
                >
                  Retry
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => p.avatarUrl && setPhotoOpen(true)}
                  className="relative mt-1"
                  aria-label="View photo"
                >
                  <span className="absolute inset-0 rounded-full bg-[#2563eb]/40 blur-md" />
                  <span className="relative grid h-[6.75rem] w-[6.75rem] place-items-center overflow-hidden rounded-full bg-[#1e3a5f] ring-[3px] ring-[#3b82f6]/80 ring-offset-2 ring-offset-[#0b1b3a]">
                    {p.avatarUrl ? (
                      <img src={p.avatarUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-3xl font-extrabold text-[#93c5fd]">
                        {initials(p.fullName)}
                      </span>
                    )}
                  </span>
                  <span className="absolute bottom-1 right-1 h-3.5 w-3.5 rounded-full border-2 border-[#0b1b3a] bg-emerald-400" />
                </button>

                <h2 className="mt-4 text-center text-xl font-bold tracking-tight text-white">
                  {p.fullName}
                </h2>
                {p.matricNumber ? (
                  <p className="mt-1 text-sm font-medium text-white/55">{p.matricNumber}</p>
                ) : null}
                {deptLevel ? (
                  <p className="mt-0.5 text-center text-xs font-medium text-white/45">
                    {deptLevel}
                  </p>
                ) : (
                  <p className="mt-0.5 text-xs text-white/40">D4EXAM member</p>
                )}

                <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Online
                </span>

                {!p.isMe ? (
                  <div className="mt-5 grid w-full grid-cols-4 gap-2">
                    <QuickAction
                      icon={<MessageCircle className="h-5 w-5" />}
                      label="Message"
                      tone="blue"
                      busy={busy === "msg"}
                      onClick={() => void goMessage()}
                    />
                    <QuickAction
                      icon={<Phone className="h-5 w-5" />}
                      label="Voice Call"
                      tone="green"
                      busy={busy === "voice"}
                      onClick={() => void startCall("voice")}
                    />
                    <QuickAction
                      icon={<Video className="h-5 w-5" />}
                      label="Video Call"
                      tone="blue"
                      busy={busy === "video"}
                      onClick={() => void startCall("video")}
                    />
                    <QuickAction
                      icon={<Info className="h-5 w-5" />}
                      label="Info"
                      tone="navy"
                      onClick={goInfo}
                    />
                  </div>
                ) : (
                  <p className="mt-4 text-center text-xs text-white/40">
                    This is how others see you in Messages
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <ProfilePhotoViewer
        open={photoOpen}
        src={p?.avatarUrl}
        name={p?.fullName}
        subtitle={[p?.matricNumber, deptLevel].filter(Boolean).join(" · ")}
        onClose={() => setPhotoOpen(false)}
      />
    </>
  );
}

function QuickAction({
  icon,
  label,
  onClick,
  busy,
  tone,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  busy?: boolean;
  tone: "blue" | "green" | "navy";
}) {
  const bg =
    tone === "green"
      ? "bg-emerald-500 text-white shadow-emerald-500/30"
      : tone === "navy"
        ? "bg-[#1e3a5f] text-white shadow-blue-900/30"
        : "bg-[#2563eb] text-white shadow-blue-500/30";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="flex flex-col items-center gap-1.5 active:scale-95 disabled:opacity-60"
    >
      <span
        className={cn(
          "grid h-12 w-12 place-items-center rounded-2xl shadow-lg",
          bg,
        )}
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : icon}
      </span>
      <span className="text-[10px] font-semibold leading-tight text-white/75">{label}</span>
    </button>
  );
}

function MenuItem({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "block w-full px-3 py-2.5 text-left text-sm font-medium active:bg-white/10",
        danger ? "text-rose-400" : "text-white/90",
      )}
    >
      {label}
    </button>
  );
}
