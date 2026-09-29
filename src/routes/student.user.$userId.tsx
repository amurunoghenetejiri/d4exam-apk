import { createFileRoute, useParams } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { UserProfileView } from "@/components/profile/UserProfileView";
import { CallOverlay, type ActiveCall } from "@/components/calls/CallOverlay";
import { useSessionUser } from "@/lib/session";
import { appNavigate } from "@/lib/app-navigate";

export const Route = createFileRoute("/student/user/$userId")({
  head: () => ({
    meta: [{ title: "Profile — D4EXAM" }],
  }),
  component: UserProfilePage,
});

function UserProfilePage() {
  const params = useParams({ strict: false }) as { userId?: string };
  const { data: session } = useSessionUser();
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);

  const userId = useMemo(() => {
    if (params.userId) return params.userId;
    if (typeof window === "undefined") return "";
    const path = window.location.pathname || "";
    const hash = (window.location.hash || "").replace(/^#/, "");
    const parts = (hash.startsWith("/") ? hash : path).split("/").filter(Boolean);
    const idx = parts.indexOf("user");
    if (idx >= 0 && parts[idx + 1]) return decodeURIComponent(parts[idx + 1]);
    return parts[parts.length - 1] || "";
  }, [params.userId]);

  return (
    <>
      <UserProfileView
        userId={userId}
        onBack={() => appNavigate("/student/messages")}
        onStartCall={(opts) => setActiveCall(opts)}
      />
      {activeCall && session?.userId ? (
        <CallOverlay
          call={activeCall}
          myUserId={session.userId}
          onClose={() => setActiveCall(null)}
        />
      ) : null}
    </>
  );
}
