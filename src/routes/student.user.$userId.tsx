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

function extractUserId(param?: string): string {
  if (param && param.length > 8 && param !== "undefined") {
    try {
      return decodeURIComponent(param);
    } catch {
      return param;
    }
  }
  if (typeof window === "undefined") return "";
  const hash = (window.location.hash || "").replace(/^#/, "");
  const path = window.location.pathname || "";
  const raw = hash.startsWith("/") ? hash : hash ? `/${hash}` : path;
  const parts = raw.split("/").filter(Boolean);
  const idx = parts.findIndex((p) => p === "user");
  if (idx >= 0 && parts[idx + 1]) {
    try {
      return decodeURIComponent(parts[idx + 1]);
    } catch {
      return parts[idx + 1];
    }
  }
  return "";
}

function UserProfilePage() {
  const params = useParams({ strict: false }) as { userId?: string };
  const { data: session } = useSessionUser();
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);

  const userId = useMemo(() => extractUserId(params.userId), [params.userId]);

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
