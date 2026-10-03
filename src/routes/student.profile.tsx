import { createFileRoute } from "@tanstack/react-router";
import { ProfilePage } from "@/components/pages/ProfilePage";

export const Route = createFileRoute("/student/profile")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Profile — D4EXAM" }],
  }),
  component: ProfilePage,
});
