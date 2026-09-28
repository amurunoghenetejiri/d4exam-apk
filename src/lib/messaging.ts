/**
 * D4EXAM campus messaging helpers.
 * Uses conversations / conversation_members / campus_messages.
 * Officer channel remains on student_officer_reports.
 */
import { supabase } from "@/integrations/supabase/client";

export type ConversationType = "direct" | "group";
export type GroupKind = "study" | "course" | "class" | "project" | "general";

export type ConversationRow = {
  id: string;
  school_id: string;
  type: ConversationType;
  title: string | null;
  description: string | null;
  avatar_url: string | null;
  group_kind: GroupKind | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_sender_id: string | null;
};

export type CampusMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string | null;
  attachment_url: string | null;
  attachment_type: string | null;
  reply_to_id: string | null;
  forwarded_from_id: string | null;
  client_id: string | null;
  duration_sec: number | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
};

export type StudentDiscover = {
  id: string;
  profile_id: string | null;
  auth_user_id: string | null;
  full_name: string;
  matric_number: string | null;
  department: string | null;
  level: string | null;
  department_id: string | null;
  level_id: string | null;
  school_id: string | null;
  avatar_url?: string | null;
};

export type ConversationListItem = {
  id: string;
  type: ConversationType;
  title: string;
  subtitle: string;
  preview: string;
  avatar_url: string | null;
  time: string | null;
  unread: number;
  isGroup: boolean;
  peerUserId?: string | null;
  online?: boolean;
};

function previewFromMessage(m: {
  body?: string | null;
  attachment_type?: string | null;
}): string {
  const t = (m.body || "").trim();
  if (t && t !== "(attachment)") return t.slice(0, 120);
  const at = (m.attachment_type || "").toLowerCase();
  if (at.includes("audio") || at === "voice") return "🎤 Voice note";
  if (at.includes("image") || at === "photo") return "📷 Photo";
  if (at.includes("video")) return "🎥 Video";
  if (at) return "📄 Document";
  return "";
}

/** List conversations the current user belongs to. */
export async function listMyConversations(
  userId: string,
): Promise<ConversationListItem[]> {
  const { data: memberships, error: mErr } = await supabase
    .from("conversation_members")
    .select("conversation_id, last_read_at, muted")
    .eq("user_id", userId)
    .is("left_at", null);

  if (mErr || !memberships?.length) return [];

  const ids = memberships.map((m) => m.conversation_id);
  const readMap = new Map(
    memberships.map((m) => [m.conversation_id, m.last_read_at as string | null]),
  );

  const { data: convs, error: cErr } = await supabase
    .from("conversations")
    .select("*")
    .in("id", ids)
    .order("last_message_at", { ascending: false, nullsFirst: false });

  if (cErr || !convs?.length) return [];

  // For direct chats, resolve peer names
  const directIds = (convs as ConversationRow[])
    .filter((c) => c.type === "direct")
    .map((c) => c.id);

  const peerName = new Map<string, { name: string; userId: string; avatar?: string | null }>();
  if (directIds.length) {
    const { data: peers } = await supabase
      .from("conversation_members")
      .select("conversation_id, user_id")
      .in("conversation_id", directIds)
      .neq("user_id", userId)
      .is("left_at", null);

    const peerUserIds = [...new Set((peers || []).map((p) => p.user_id))];
    if (peerUserIds.length) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("auth_user_id, full_name, avatar_url")
        .in("auth_user_id", peerUserIds);

      const nameByUser = new Map(
        (profiles || []).map((p) => [
          p.auth_user_id as string,
          {
            name: (p.full_name as string) || "Student",
            avatar: (p.avatar_url as string) || null,
          },
        ]),
      );

      for (const p of peers || []) {
        const info = nameByUser.get(p.user_id);
        peerName.set(p.conversation_id, {
          name: info?.name || "Student",
          userId: p.user_id,
          avatar: info?.avatar,
        });
      }
    }
  }

  // Unread counts (approx: messages after last_read_at)
  const unreadMap = new Map<string, number>();
  for (const id of ids) {
    const since = readMap.get(id);
    let q = supabase
      .from("campus_messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", id)
      .neq("sender_id", userId)
      .is("deleted_at", null);
    if (since) q = q.gt("created_at", since);
    const { count } = await q;
    unreadMap.set(id, count || 0);
  }

  return (convs as ConversationRow[]).map((c) => {
    const peer = peerName.get(c.id);
    const isGroup = c.type === "group";
    return {
      id: c.id,
      type: c.type,
      title: isGroup
        ? c.title || "Group"
        : peer?.name || c.title || "Chat",
      subtitle: isGroup ? "Group" : "",
      preview: c.last_message_preview || "",
      avatar_url: isGroup ? c.avatar_url : peer?.avatar || null,
      time: c.last_message_at || c.updated_at,
      unread: unreadMap.get(c.id) || 0,
      isGroup,
      peerUserId: peer?.userId || null,
    };
  });
}

/** Get or create a 1:1 direct conversation between two users in the same school. */
export async function getOrCreateDirectConversation(
  myUserId: string,
  peerUserId: string,
  schoolId: string,
): Promise<string> {
  if (myUserId === peerUserId) throw new Error("Cannot message yourself");

  // Find existing direct conversation sharing both members
  const { data: myMemberships } = await supabase
    .from("conversation_members")
    .select("conversation_id")
    .eq("user_id", myUserId)
    .is("left_at", null);

  const myConvIds = (myMemberships || []).map((m) => m.conversation_id);
  if (myConvIds.length) {
    const { data: shared } = await supabase
      .from("conversation_members")
      .select("conversation_id")
      .eq("user_id", peerUserId)
      .in("conversation_id", myConvIds)
      .is("left_at", null);

    if (shared?.length) {
      // Prefer a direct-type conversation
      const { data: directs } = await supabase
        .from("conversations")
        .select("id, type")
        .in(
          "id",
          shared.map((s) => s.conversation_id),
        )
        .eq("type", "direct");
      if (directs?.[0]?.id) return directs[0].id as string;
    }
  }

  // Create new
  const { data: conv, error: cErr } = await supabase
    .from("conversations")
    .insert({
      school_id: schoolId,
      type: "direct",
      created_by: myUserId,
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (cErr || !conv?.id) throw new Error(cErr?.message || "Could not create chat");

  const cid = conv.id as string;
  const { error: mErr } = await supabase.from("conversation_members").insert([
    { conversation_id: cid, user_id: myUserId, role: "member" },
    { conversation_id: cid, user_id: peerUserId, role: "member" },
  ]);
  if (mErr) throw new Error(mErr.message);
  return cid;
}

/** Create a group conversation. */
export async function createGroup(opts: {
  schoolId: string;
  creatorId: string;
  title: string;
  description?: string;
  groupKind?: GroupKind;
  memberUserIds: string[];
  avatarUrl?: string | null;
}): Promise<string> {
  const { data: conv, error: cErr } = await supabase
    .from("conversations")
    .insert({
      school_id: opts.schoolId,
      type: "group",
      title: opts.title.trim(),
      description: opts.description?.trim() || null,
      group_kind: opts.groupKind || "study",
      avatar_url: opts.avatarUrl || null,
      created_by: opts.creatorId,
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (cErr || !conv?.id) throw new Error(cErr?.message || "Could not create group");

  const cid = conv.id as string;
  const members = [
    {
      conversation_id: cid,
      user_id: opts.creatorId,
      role: "owner" as const,
    },
    ...opts.memberUserIds
      .filter((id) => id !== opts.creatorId)
      .map((id) => ({
        conversation_id: cid,
        user_id: id,
        role: "member" as const,
      })),
  ];

  const { error: mErr } = await supabase.from("conversation_members").insert(members);
  if (mErr) throw new Error(mErr.message);
  return cid;
}

/** Send a campus message (idempotent via client_id). */
export async function sendCampusMessage(opts: {
  conversationId: string;
  senderId: string;
  body?: string | null;
  attachmentUrl?: string | null;
  attachmentType?: string | null;
  replyToId?: string | null;
  forwardedFromId?: string | null;
  clientId: string;
  durationSec?: number | null;
}): Promise<CampusMessage> {
  const row = {
    conversation_id: opts.conversationId,
    sender_id: opts.senderId,
    body: opts.body || null,
    attachment_url: opts.attachmentUrl || null,
    attachment_type: opts.attachmentType || null,
    reply_to_id: opts.replyToId || null,
    forwarded_from_id: opts.forwardedFromId || null,
    client_id: opts.clientId,
    duration_sec: opts.durationSec ?? null,
  };

  const { data, error } = await supabase
    .from("campus_messages")
    .upsert(row, { onConflict: "conversation_id,client_id", ignoreDuplicates: false })
    .select("*")
    .maybeSingle();

  // Fallback insert if unique constraint naming differs
  if (error || !data) {
    const ins = await supabase.from("campus_messages").insert(row).select("*").single();
    if (ins.error) throw new Error(ins.error.message);
    await touchConversation(opts.conversationId, opts.senderId, previewFromMessage(row));
    return ins.data as CampusMessage;
  }

  await touchConversation(opts.conversationId, opts.senderId, previewFromMessage(row));
  return data as CampusMessage;
}

async function touchConversation(
  conversationId: string,
  senderId: string,
  preview: string,
) {
  const now = new Date().toISOString();
  await supabase
    .from("conversations")
    .update({
      updated_at: now,
      last_message_at: now,
      last_message_preview: preview.slice(0, 140),
      last_message_sender_id: senderId,
    })
    .eq("id", conversationId);
}

/** Mark conversation as read for current user. */
export async function markConversationRead(
  conversationId: string,
  userId: string,
) {
  await supabase
    .from("conversation_members")
    .update({ last_read_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .eq("user_id", userId);
}

/** Load messages for a conversation. */
export async function listMessages(
  conversationId: string,
  limit = 80,
): Promise<CampusMessage[]> {
  const { data, error } = await supabase
    .from("campus_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data || []) as CampusMessage[];
}

/** Discover students in the same school (name / matric / department / level). */
export async function discoverStudents(opts: {
  schoolId: string;
  query?: string;
  departmentId?: string | null;
  levelId?: string | null;
  excludeUserId?: string | null;
  limit?: number;
}): Promise<StudentDiscover[]> {
  let q = supabase
    .from("students")
    .select(
      "id, profile_id, matric_number, student_id, school_id, department_id, level_id, full_name, status, departments(name), levels(name), profiles(auth_user_id, full_name, avatar_url)",
    )
    .eq("school_id", opts.schoolId)
    .limit(opts.limit ?? 40);

  if (opts.departmentId) q = q.eq("department_id", opts.departmentId);
  if (opts.levelId) q = q.eq("level_id", opts.levelId);

  const { data, error } = await q;
  if (error) {
    // Fallback without nested relations
    const fb = await supabase
      .from("students")
      .select(
        "id, profile_id, matric_number, student_id, school_id, department_id, level_id, full_name, status",
      )
      .eq("school_id", opts.schoolId)
      .limit(opts.limit ?? 40);
    if (fb.error) return [];
    return mapStudents(fb.data || [], opts);
  }

  return mapStudents(data || [], opts);
}

function mapStudents(
  rows: Record<string, unknown>[],
  opts: { query?: string; excludeUserId?: string | null },
): StudentDiscover[] {
  const q = (opts.query || "").trim().toLowerCase();
  const out: StudentDiscover[] = [];

  for (const r of rows) {
    const profiles = r.profiles as
      | { auth_user_id?: string; full_name?: string; avatar_url?: string }
      | null
      | undefined;
    const depts = r.departments as { name?: string } | null | undefined;
    const levels = r.levels as { name?: string } | null | undefined;
    const authUserId = profiles?.auth_user_id || null;
    if (opts.excludeUserId && authUserId === opts.excludeUserId) continue;

    const name =
      (r.full_name as string) ||
      profiles?.full_name ||
      "Student";
    const matric =
      (r.matric_number as string) ||
      (r.student_id as string) ||
      null;
    const department = depts?.name || null;
    const level = levels?.name || null;

    if (q) {
      const hay = [name, matric || "", department || "", level || ""]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) continue;
    }

    out.push({
      id: r.id as string,
      profile_id: (r.profile_id as string) || null,
      auth_user_id: authUserId,
      full_name: name,
      matric_number: matric,
      department,
      level,
      department_id: (r.department_id as string) || null,
      level_id: (r.level_id as string) || null,
      school_id: (r.school_id as string) || null,
      avatar_url: profiles?.avatar_url || null,
    });
  }

  return out;
}

/** Department officers for the student's school (profiles with officer role). */
export async function listDepartmentOfficers(schoolId: string) {
  // Prefer user_roles / profiles with examination_officer role
  const { data: roles } = await supabase
    .from("user_roles")
    .select("user_id, role")
    .eq("role", "examination_officer")
    .limit(50);

  const userIds = (roles || []).map((r) => r.user_id as string).filter(Boolean);
  if (!userIds.length) return [];

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, auth_user_id, full_name, school_id, avatar_url")
    .eq("school_id", schoolId)
    .in("auth_user_id", userIds);

  return (profiles || []).map((p) => ({
    id: p.auth_user_id as string,
    full_name: (p.full_name as string) || "Departmental Officer",
    avatar_url: (p.avatar_url as string) || null,
    roleLabel: "Departmental Officer",
  }));
}
