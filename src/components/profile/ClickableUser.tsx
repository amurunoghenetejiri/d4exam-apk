import { cn } from "@/lib/utils";

export const D4_OPEN_PROFILE_EVENT = "d4-open-profile";

export type OpenProfileDetail = {
  userId: string;
  name?: string | null;
  avatar?: string | null;
  matric?: string | null;
};

/** Open messaging profile sheet for a user (WhatsApp-style). */
export function openUserProfile(
  userId: string | null | undefined,
  seed?: { name?: string | null; avatar?: string | null; matric?: string | null },
) {
  if (!userId) return;
  try {
    window.dispatchEvent(
      new CustomEvent(D4_OPEN_PROFILE_EVENT, {
        detail: {
          userId: String(userId),
          name: seed?.name || null,
          avatar: seed?.avatar || null,
          matric: seed?.matric || null,
        } satisfies OpenProfileDetail,
      }),
    );
  } catch {
    /* ignore */
  }
}

export function ClickableUser({
  userId,
  children,
  className,
  stopPropagation = true,
  seedName,
  seedAvatar,
}: {
  userId: string | null | undefined;
  children: React.ReactNode;
  className?: string;
  stopPropagation?: boolean;
  seedName?: string | null;
  seedAvatar?: string | null;
}) {
  if (!userId) return <>{children}</>;
  return (
    <button
      type="button"
      className={cn("text-left", className)}
      onClick={(e) => {
        if (stopPropagation) {
          e.preventDefault();
          e.stopPropagation();
        }
        openUserProfile(userId, { name: seedName, avatar: seedAvatar });
      }}
    >
      {children}
    </button>
  );
}
