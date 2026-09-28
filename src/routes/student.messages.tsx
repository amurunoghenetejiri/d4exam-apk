/**
 * D4EXAM Messages hub — student campus messaging
 * Visual reference: Chats | Groups | Students | Officers + quick actions
 * Bottom nav is hidden via AppShell immersiveMessaging.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  Users,
  UserPlus,
  Shield,
  GraduationCap,
  MessageSquare,
  MoreVertical,
  Check,
  CheckCheck,
  Play,
  UsersRound,
  ArrowLeft,
  PenSquare,
} from "lucide-react";
import { useSessionUser } from "@/lib/session";
import { useStudentContext } from "@/lib/student";
import { cn } from "@/lib/utils";
import {
  discoverStudents,
  listMyConversations,
  getOrCreateDirectConversation,
  createGroup,
  listDepartmentOfficers,
  resolveMySchoolId,
  type ConversationListItem,
  type StudentDiscover,
  type GroupKind,
} from "@/lib/messaging";
import { toast } from "sonner";

export const Route = createFileRoute("/student/messages")({
  head: () => ({ meta: [{ title: "Messages — D4EXAM" }] }),
  component: MessagesHub,
});

type TabKey = "chats" | "groups" | "students" | "officers";

function formatListTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  const yest = new Date(now);
  yest.setDate(yest.getDate() - 1);
  if (
    d.getFullYear() === yest.getFullYear() &&
    d.getMonth() === yest.getMonth() &&
    d.getDate() === yest.getDate()
  ) {
    return "Yesterday";
  }
  return d.toLocaleDateString([], { weekday: "short" });
}

function Avatar({
  name,
  url,
  group,
}: {
  name: string;
  url?: string | null;
  group?: boolean;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("") || "?";

  if (url) {
    return (
      <img
        src={url}
        alt=""
        className="h-12 w-12 shrink-0 rounded-full object-cover ring-2 ring-white"
      />
    );
  }
  return (
    <div
      className={cn(
        "grid h-12 w-12 shrink-0 place-items-center rounded-full text-sm font-bold text-white",
        group ? "bg-[#2563eb]" : "bg-[#0b1b3a]",
      )}
    >
      {group ? <UsersRound className="h-5 w-5" /> : initials}
    </div>
  );
}

function MessagesHub() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: session } = useSessionUser();
  const { data: student } = useStudentContext();
  const userId = session?.userId || "";
  const schoolIdHint =
    student?.schoolId || session?.schoolId || "";
  const schoolQ = useQuery({
    queryKey: ["my-school-id", session?.userId, schoolIdHint],
    enabled: Boolean(session?.userId),
    staleTime: 60_000,
    queryFn: () => resolveMySchoolId(schoolIdHint || null),
  });
  const schoolId = schoolQ.data || schoolIdHint || "";

  const [tab, setTab] = useState<TabKey>("chats");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [deptOpen, setDeptOpen] = useState(false);

  const convQuery = useQuery({
    queryKey: ["campus-conversations", userId],
    enabled: Boolean(userId),
    staleTime: 15_000,
    queryFn: () => listMyConversations(userId),
  });

  const studentsQuery = useQuery({
    queryKey: [
      "campus-discover",
      schoolId,
      search,
      tab === "students" || findOpen || deptOpen,
    ],
    enabled: Boolean(schoolId) && (tab === "students" || findOpen || deptOpen),
    staleTime: 30_000,
    queryFn: () =>
      discoverStudents({
        schoolId,
        query: search,
        departmentId:
          deptOpen || tab === "students"
            ? student?.departmentId || null
            : null,
        excludeUserId: userId,
        limit: 60,
      }),
  });

  const officersQuery = useQuery({
    queryKey: ["campus-officers", schoolId],
    enabled: Boolean(schoolId) && tab === "officers",
    staleTime: 60_000,
    queryFn: () => listDepartmentOfficers(schoolId),
  });

  const conversations = convQuery.data || [];
  const chats = conversations.filter((c) => !c.isGroup);
  const groups = conversations.filter((c) => c.isGroup);

  const filteredChats = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = tab === "groups" ? groups : chats;
    if (!q) return list;
    return list.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.preview.toLowerCase().includes(q),
    );
  }, [chats, groups, search, tab]);

  const openConversation = useCallback(
    (id: string) => {
      navigate({ to: "/student/messages/$conversationId", params: { conversationId: id } });
    },
    [navigate],
  );

  const startDirect = useCallback(
    async (peer: StudentDiscover) => {
      if (!peer.auth_user_id || !schoolId || !userId) {
        toast.error("Cannot start chat — student account not linked yet");
        return;
      }
      try {
        const cid = await getOrCreateDirectConversation(
          userId,
          peer.auth_user_id,
          schoolId,
        );
        void qc.invalidateQueries({ queryKey: ["campus-conversations"] });
        navigate({
          to: "/student/messages/$conversationId",
          params: { conversationId: cid },
        });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not open chat");
      }
    },
    [userId, schoolId, navigate, qc],
  );

  const openOfficer = useCallback(() => {
    navigate({ to: "/student/contact-officer" });
  }, [navigate]);

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-slate-50">
      {/* Navy header */}
      <header
        className="shrink-0 bg-[#0b1b3a] text-white"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="flex items-center gap-2 px-3 pb-3 pt-2.5 sm:gap-3 sm:px-4">
          <button
            type="button"
            onClick={() => navigate({ to: "/student" })}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white/90 hover:bg-white/10 active:bg-white/15"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/20 bg-white/10 sm:h-10 sm:w-10">
            <span className="text-xs font-black tracking-tight sm:text-sm">D4</span>
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-bold leading-tight sm:text-lg">Messages</h1>
            <p className="text-[10px] text-white/70 sm:text-[11px]">
              Connect · Chat · Collaborate
            </p>
          </div>
          <button
            type="button"
            className="grid h-9 w-9 place-items-center rounded-full text-white/90 hover:bg-white/10"
            aria-label="Search"
            onClick={() => {
              const el = document.getElementById("msg-global-search");
              el?.focus();
            }}
          >
            <Search className="h-5 w-5" />
          </button>
          <button
            type="button"
            className="grid h-9 w-9 place-items-center rounded-full text-white/90 hover:bg-white/10"
            aria-label="Menu"
          >
            <MoreVertical className="h-5 w-5" />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Tabs */}
        <div className="shrink-0 px-3 pt-3">
          <div className="flex gap-1 rounded-2xl bg-slate-100/90 p-1">
            {(
              [
                ["chats", "Chats", MessageSquare],
                ["groups", "Groups", Users],
                ["students", "Students", GraduationCap],
                ["officers", "Officers", Shield],
              ] as const
            ).map(([key, label, Icon]) => {
              const active = tab === key;
              const badge =
                key === "chats"
                  ? chats.reduce((n, c) => n + c.unread, 0)
                  : key === "groups"
                    ? groups.reduce((n, c) => n + c.unread, 0)
                    : 0;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={cn(
                    "relative flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-xs font-semibold transition",
                    active
                      ? "bg-[#2563eb] text-white shadow-sm"
                      : "text-slate-600 hover:bg-white/80",
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span>{label}</span>
                  {badge > 0 && active ? (
                    <span className="ml-0.5 rounded-full bg-white/25 px-1.5 text-[10px] font-bold">
                      {badge > 99 ? "99+" : badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        {/* Search */}
        <div className="shrink-0 px-3 pt-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              id="msg-global-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search people, groups or messages..."
              className="h-11 w-full rounded-2xl border border-slate-200 bg-white pl-10 pr-3 text-sm text-slate-800 shadow-sm outline-none ring-[#2563eb]/30 placeholder:text-slate-400 focus:ring-2"
            />
          </div>
        </div>

        {/* Quick action cards — slim on mobile */}
        <div className="shrink-0 px-2.5 pt-2.5 sm:px-3 sm:pt-3">
          <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
            <QuickCard
              icon={<Users className="h-5 w-5 text-[#2563eb]" strokeWidth={2} />}
              title="Create Group"
              shortTitle="Create Group"
              subtitle="Study · Discuss · Grow"
              onClick={() => setCreateOpen(true)}
            />
            <QuickCard
              icon={<UserPlus className="h-5 w-5 text-[#2563eb]" strokeWidth={2} />}
              title="Find Students"
              shortTitle="Find Students"
              subtitle="Connect with peers"
              onClick={() => {
                setTab("students");
                setFindOpen(true);
              }}
            />
            <QuickCard
              icon={<Shield className="h-5 w-5 text-[#2563eb]" strokeWidth={2} />}
              title="Department Officers"
              shortTitle="Officer"
              subtitle="Get help & support"
              onClick={openOfficer}
            />
            <QuickCard
              icon={<GraduationCap className="h-5 w-5 text-[#2563eb]" strokeWidth={2} />}
              title="My Department"
              shortTitle="My Department"
              subtitle="View all members"
              onClick={() => {
                setTab("students");
                setDeptOpen(true);
                setSearch("");
              }}
            />
          </div>
        </div>

        {/* List body */}
        <div className="relative mt-2 min-h-0 flex-1 overflow-y-auto bg-white pb-20 sm:mt-3">
          {(tab === "chats" || tab === "groups") && (
            <ConversationList
              items={filteredChats}
              loading={convQuery.isLoading}
              emptyLabel={
                tab === "groups"
                  ? "No groups yet. Create a study group to get started."
                  : "No conversations yet. Find a student or message your officer."
              }
              onOpen={openConversation}
              onOfficer={openOfficer}
              showOfficerShortcut={tab === "chats"}
            />
          )}

          {tab === "students" && (
            <StudentDirectory
              students={studentsQuery.data || []}
              loading={studentsQuery.isLoading}
              departmentOnly={deptOpen}
              departmentName={student?.departmentName || "My Department"}
              onMessage={startDirect}
              onCloseDept={() => setDeptOpen(false)}
            />
          )}

          {tab === "officers" && (
            <div className="divide-y divide-slate-100">
              {(officersQuery.data || []).length === 0 && !officersQuery.isLoading ? (
                <div className="px-4 py-10 text-center text-sm text-slate-500">
                  <p className="mb-3">Contact your departmental officer for exam support.</p>
                  <button
                    type="button"
                    onClick={openOfficer}
                    className="rounded-xl bg-[#2563eb] px-4 py-2.5 text-sm font-semibold text-white"
                  >
                    Open officer chat
                  </button>
                </div>
              ) : (
                (officersQuery.data || []).map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={openOfficer}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
                  >
                    <Avatar name={o.full_name} url={o.avatar_url} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-slate-900">
                        {o.full_name}
                      </p>
                      <p className="text-xs text-slate-500">{o.roleLabel}</p>
                    </div>
                  </button>
                ))
              )}
              <button
                type="button"
                onClick={openOfficer}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
              >
                <div className="grid h-12 w-12 place-items-center rounded-full bg-[#0b1b3a] text-white">
                  <Shield className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900">
                    Departmental Officer
                  </p>
                  <p className="text-xs text-slate-500">
                    Exam support · reports · help
                  </p>
                </div>
              </button>
            </div>
          )}
        </div>
      </div>

      {createOpen && (
        <CreateGroupModal
          schoolId={schoolId}
          userId={userId}
          myDepartmentId={student?.departmentId || null}
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => {
            setCreateOpen(false);
            void qc.invalidateQueries({ queryKey: ["campus-conversations"] });
            openConversation(id);
          }}
        />
      )}

      {/* Floating compose pen (matches reference FAB) */}
      <button
        type="button"
        onClick={() => {
          setTab("students");
          setFindOpen(true);
          const el = document.getElementById("msg-global-search");
          el?.focus();
        }}
        className="fixed bottom-5 right-4 z-30 grid h-14 w-14 place-items-center rounded-full bg-[#2563eb] text-white shadow-lg shadow-blue-500/40 transition hover:bg-[#1d4ed8] active:scale-95 sm:bottom-6 sm:right-6"
        style={{ marginBottom: "env(safe-area-inset-bottom, 0px)" }}
        aria-label="New message"
      >
        <PenSquare className="h-6 w-6" />
      </button>
    </div>
  );
}

function QuickCard({
  icon,
  title,
  shortTitle,
  subtitle,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  shortTitle?: string;
  subtitle: string;
  onClick: () => void;
}) {
  const mobileLabel = shortTitle || title;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-1 rounded-xl border border-slate-200/90 bg-white px-1.5 py-2.5 text-center shadow-sm transition hover:border-[#2563eb]/40 hover:shadow-md active:scale-[0.98] sm:items-start sm:rounded-2xl sm:p-3 sm:text-left"
    >
      <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#eff6ff] sm:h-10 sm:w-10 [&_svg]:h-5 [&_svg]:w-5 sm:[&_svg]:h-[22px] sm:[&_svg]:w-[22px]">
        {icon}
      </div>
      <p className="line-clamp-2 text-[10px] font-bold leading-tight text-slate-800 sm:hidden">{mobileLabel}</p>
      <p className="hidden text-[13px] font-bold leading-tight text-slate-900 sm:block">{title}</p>
      <p className="hidden text-[10px] leading-snug text-slate-500 sm:line-clamp-2 sm:block">{subtitle}</p>
    </button>
  );
}

function ConversationList({
  items,
  loading,
  emptyLabel,
  onOpen,
  onOfficer,
  showOfficerShortcut,
}: {
  items: ConversationListItem[];
  loading: boolean;
  emptyLabel: string;
  onOpen: (id: string) => void;
  onOfficer: () => void;
  showOfficerShortcut: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-3 px-4 py-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex animate-pulse gap-3">
            <div className="h-12 w-12 rounded-full bg-slate-200" />
            <div className="flex-1 space-y-2 py-1">
              <div className="h-3 w-1/3 rounded bg-slate-200" />
              <div className="h-3 w-2/3 rounded bg-slate-100" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="px-4 py-12 text-center text-sm text-slate-500">
        <p>{emptyLabel}</p>
        {showOfficerShortcut ? (
          <button
            type="button"
            onClick={onOfficer}
            className="mt-4 rounded-xl bg-[#2563eb] px-4 py-2.5 text-sm font-semibold text-white"
          >
            Message departmental officer
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <ul className="divide-y divide-slate-100">
      {items.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            onClick={() => onOpen(c.id)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50 active:bg-slate-100"
          >
            <div className="relative">
              <Avatar name={c.title} url={c.avatar_url} group={c.isGroup} />
              {c.online ? (
                <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" />
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate font-semibold text-slate-900">{c.title}</p>
                <span className="shrink-0 text-[11px] text-slate-400">
                  {formatListTime(c.time)}
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-1.5">
                {c.preview.startsWith("🎤") ? (
                  <span className="flex min-w-0 items-center gap-1 truncate text-[13px] text-slate-500">
                    <Play className="h-3 w-3 shrink-0 text-[#2563eb]" />
                    {c.preview}
                  </span>
                ) : (
                  <p className="truncate text-[13px] text-slate-500">
                    {c.preview || "No messages yet"}
                  </p>
                )}
                {c.unread > 0 ? (
                  <span className="ml-auto shrink-0 rounded-full bg-[#2563eb] px-2 py-0.5 text-[11px] font-bold text-white">
                    {c.unread > 99 ? "99+" : c.unread}
                  </span>
                ) : (
                  <CheckCheck className="ml-auto h-3.5 w-3.5 shrink-0 text-slate-300" />
                )}
              </div>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function StudentDirectory({
  students,
  loading,
  departmentOnly,
  departmentName,
  onMessage,
  onCloseDept,
}: {
  students: StudentDiscover[];
  loading: boolean;
  departmentOnly: boolean;
  departmentName: string;
  onMessage: (s: StudentDiscover) => void;
  onCloseDept: () => void;
}) {
  const byLevel = useMemo(() => {
    const map = new Map<string, StudentDiscover[]>();
    for (const s of students) {
      const key = s.level || "Other";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [students]);

  return (
    <div>
      {departmentOnly ? (
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
          <p className="text-sm font-bold text-slate-800">{departmentName}</p>
          <button
            type="button"
            onClick={onCloseDept}
            className="text-xs font-semibold text-[#2563eb]"
          >
            Show all
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="px-4 py-8 text-center text-sm text-slate-400">
          Loading students…
        </div>
      ) : students.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-slate-500">
          <p className="font-semibold text-slate-700">No students found</p>
          <p className="mt-1 text-xs">
            Try clearing search, or open My Department. If this stays empty, run the messaging RLS fix SQL in Supabase.
          </p>
        </div>
      ) : departmentOnly ? (
        byLevel.map(([level, list]) => (
          <div key={level}>
            <p className="bg-slate-50 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
              {level}
            </p>
            {list.map((s) => (
              <StudentRow key={s.id} s={s} onMessage={onMessage} />
            ))}
          </div>
        ))
      ) : (
        students.map((s) => (
          <StudentRow key={s.id} s={s} onMessage={onMessage} />
        ))
      )}
    </div>
  );
}

function StudentRow({
  s,
  onMessage,
}: {
  s: StudentDiscover;
  onMessage: (s: StudentDiscover) => void;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-slate-50 px-4 py-3">
      <Avatar name={s.full_name} url={s.avatar_url} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-slate-900">{s.full_name}</p>
        <p className="truncate text-xs text-slate-500">
          {[s.matric_number, s.department, s.level].filter(Boolean).join(" · ")}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onMessage(s)}
        disabled={!s.auth_user_id}
        className="shrink-0 rounded-xl bg-[#2563eb] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
      >
        Message
      </button>
    </div>
  );
}

function CreateGroupModal({
  schoolId,
  userId,
  myDepartmentId,
  onClose,
  onCreated,
}: {
  schoolId: string;
  userId: string;
  myDepartmentId: string | null;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<GroupKind>("study");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<StudentDiscover[]>([]);
  const [busy, setBusy] = useState(false);

  const { data: candidates = [], isLoading } = useQuery({
    queryKey: ["group-pick-students", schoolId, q, myDepartmentId],
    enabled: Boolean(schoolId),
    queryFn: () =>
      discoverStudents({
        schoolId,
        query: q,
        departmentId: myDepartmentId,
        excludeUserId: userId,
        limit: 40,
      }),
  });

  const toggle = (s: StudentDiscover) => {
    setSelected((prev) =>
      prev.some((x) => x.id === s.id)
        ? prev.filter((x) => x.id !== s.id)
        : [...prev, s],
    );
  };

  const submit = async () => {
    if (!title.trim()) {
      toast.error("Enter a group name");
      return;
    }
    const memberIds = selected
      .map((s) => s.auth_user_id)
      .filter((id): id is string => Boolean(id));
    setBusy(true);
    try {
      const id = await createGroup({
        schoolId,
        creatorId: userId,
        title: title.trim(),
        description,
        groupKind: kind,
        memberUserIds: memberIds,
      });
      toast.success("Group created");
      onCreated(id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create group");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="flex max-h-[90dvh] w-full max-w-lg flex-col rounded-t-3xl bg-white shadow-xl sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-base font-bold text-slate-900">Create Group</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm font-semibold text-slate-500"
          >
            Cancel
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">Group name</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/30"
              placeholder="e.g. 300 Level Mathematics"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/30"
              placeholder="Optional"
            />
          </label>
          <div>
            <span className="text-xs font-semibold text-slate-600">Type</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {(
                [
                  ["study", "Study"],
                  ["course", "Course"],
                  ["class", "Class"],
                  ["project", "Project"],
                  ["general", "General"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-semibold",
                    kind === k
                      ? "bg-[#2563eb] text-white"
                      : "bg-slate-100 text-slate-600",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="text-xs font-semibold text-slate-600">
              Add members ({selected.length})
            </span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name or matric…"
              className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/30"
            />
            <div className="mt-2 max-h-48 space-y-1 overflow-y-auto">
              {isLoading ? (
                <p className="text-xs text-slate-400">Searching…</p>
              ) : (
                candidates.map((s) => {
                  const on = selected.some((x) => x.id === s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggle(s)}
                      disabled={!s.auth_user_id}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left",
                        on ? "bg-[#eff6ff]" : "hover:bg-slate-50",
                      )}
                    >
                      <Avatar name={s.full_name} url={s.avatar_url} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{s.full_name}</p>
                        <p className="truncate text-[11px] text-slate-500">
                          {[s.matric_number, s.level].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      {on ? (
                        <Check className="h-4 w-4 text-[#2563eb]" />
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
        <div className="border-t border-slate-100 p-4">
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className="h-11 w-full rounded-xl bg-[#2563eb] text-sm font-bold text-white disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create Group"}
          </button>
        </div>
      </div>
    </div>
  );
}
