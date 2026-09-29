import { cn } from "@/lib/utils";

export const D4_OPEN_PROFILE_EVENT = "d4-open-profile";

/** Open messaging profile sheet for a user (WhatsApp-style). */
export function openUserProfile(userId: string | null | undefined) {
  if (!userId) return;
  try {
    window.dispatchEvent(
      new CustomEvent(D4_OPEN_PROFILE_EVENT, { detail: { userId: String(userId) } }),
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
}: {
  userId: string | null | undefined;
  children: React.ReactNode;
  className?: string;
  stopPropagation?: boolean;
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
        openUserProfile(userId);
      }}
    >
      {children}
    </button>
  );
}
