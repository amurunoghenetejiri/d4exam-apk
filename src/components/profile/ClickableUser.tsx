import { appNavigate } from "@/lib/app-navigate";
import { cn } from "@/lib/utils";

/** Makes any user identity open the profile page. */
export function openUserProfile(userId: string | null | undefined) {
  if (!userId) return;
  // appNavigate accepts a path STRING only (not { to, params })
  appNavigate(`/student/user/${encodeURIComponent(userId)}`);
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
