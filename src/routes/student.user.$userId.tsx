import { createFileRoute, useParams } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { UserProfileView } from "@/components/profile/UserProfileView";
import { CallOverlay, type ActiveCall } from "@/components/calls/CallOverlay";
import { useSessionUser } from "@/lib/session";
import { appNavigate } from "@/lib/app-navigate";

export const Route = createFileRoute("/student/user/$userId")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Profile — D4EXAM" }],
  }),
  component: UserProfilePage,
});

function extractUserId(param: string | undefined, sessionUserId: string | undefined): string {
  const raw = (param || "").trim();
  if (raw && raw !== "undefined" && raw !== "null") {
    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      /* keep raw */
    }
    if (decoded === "me" || decoded === "self") {
      return sessionUserId || "";
    }
    if (decoded.length > 8) return decoded;
  }
  if (typeof window === "undefined") return sessionUserId || "";
  const hash = (window.location.hash || "").replace(/^#/, "");
  const path = window.location.pathname || "";
  const pathPart = hash.startsWith("/") ? hash : hash ? `/${hash}` : path;
  const parts = pathPart.split("/").filter(Boolean);
  const idx = parts.findIndex((p) => p === "user");
  if (idx >= 0 && parts[idx + 1]) {
    let seg = parts[idx + 1];
    try {
      seg = decodeURIComponent(seg);
    } catch {
      /* keep */
    }
    if (seg === "me" || seg === "self") return sessionUserId || "";
    return seg;
  }
  return sessionUserId || "";
}

function UserProfilePage() {
  const params = useParams({ strict: false }) as { userId?: string };
  const { data: session } = useSessionUser();
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);

  const userId = useMemo(
    () => extractUserId(params.userId, session?.userId),
    [params.userId, session?.userId],
  );

  if (!userId) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm font-medium text-slate-600">Loading profile…</p>
      </div>
    );
  }

  return (
    <>
      <UserProfileView
        userId={userId}
        onBack={() => {
          if (typeof window !== "undefined" && window.history.length > 1) {
            window.history.back();
          } else {
            appNavigate("/student");
          }
        }}
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
