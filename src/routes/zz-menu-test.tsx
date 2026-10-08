import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { superAdminNav } from "@/components/navigation/navConfig";

export const Route = createFileRoute("/zz-menu-test")({
  ssr: false,
  component: () => (
    <AppShell config={superAdminNav} user={{ name: "Test User", avatar: "TU", subtitle: "test" }}>
      <div style={{ height: 1500 }}>
        <button id="probe" onClick={() => ((window as any).__probe = ((window as any).__probe || 0) + 1)}>probe</button>
      </div>
    </AppShell>
  ),
});
