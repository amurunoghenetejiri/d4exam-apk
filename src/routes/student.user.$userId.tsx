import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { UserProfileView } from "@/components/profile/UserProfileView";
import { CallOverlay, type ActiveCall } from "@/components/calls/CallOverlay";
import { useSessionUser } from "@/lib/session";

export const Route = createFileRoute("/student/user/$userId")({
  head: () => ({
    meta: [{ title: "Profile — D4EXAM" }],
  }),
  component: UserProfilePage,
});

function UserProfilePage() {
  const { userId } = useParams({ from: "/student/user/$userId" });
  const navigate = useNavigate();
  const { data: session } = useSessionUser();
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);

  return (
    <>
      <UserProfileView
        userId={userId}
        onBack={() => {
          if (window.history.length > 1) navigate({ to: ".." } as never);
          else navigate({ to: "/student/messages" });
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
