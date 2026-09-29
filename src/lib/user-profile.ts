import { supabase } from "@/integrations/supabase/client";

export type PublicUserProfile = {
  authUserId: string;
  profileId: string | null;
  fullName: string;
  avatarUrl: string | null;
  phone: string | null;
  schoolId: string | null;
  matricNumber: string | null;
  departmentId: string | null;
  departmentName: string | null;
  levelId: string | null;
  levelName: string | null;
  studentId: string | null;
  status: string | null;
  isMe: boolean;
  isBlockedByMe: boolean;
  isBlockedMe: boolean;
};

function mapRow(
  row: Record<string, unknown>,
  targetUserId: string,
  myUserId?: string | null,
  extras?: { departmentName?: string | null; levelName?: string | null },
): PublicUserProfile {
  const authUserId = String(row.auth_user_id || targetUserId);
  return {
    authUserId,
    profileId: (row.profile_id as string) || (row.id as string) || null,
    fullName:
      String(row.full_name || "").trim() ||
      [row.first_name, row.last_name].filter(Boolean).join(" ").trim() ||
      "Student",
    avatarUrl:
      (row.avatar_url as string) ||
      (row.profile_photo_url as string) ||
      null,
    phone: (row.phone as string) || null,
    schoolId: (row.school_id as string) || null,
    matricNumber: (row.matric_number as string) || null,
    departmentId: (row.department_id as string) || null,
    departmentName: extras?.departmentName ?? null,
    levelId: (row.level_id as string) || null,
    levelName: extras?.levelName ?? null,
    studentId: (row.student_id as string) || null,
    status: (row.status as string) || null,
    isMe: Boolean(myUserId && myUserId === authUserId),
    isBlockedByMe: false,
    isBlockedMe: false,
  };
}

async function enrichDeptLevel(p: PublicUserProfile): Promise<PublicUserProfile> {
  let departmentName = p.departmentName;
  let levelName = p.levelName;
  if (p.departmentId && !departmentName) {
    const { data: d } = await supabase
      .from("departments")
      .select("name")
      .eq("id", p.departmentId)
      .maybeSingle();
    departmentName = (d as { name?: string } | null)?.name || null;
  }
  if (p.levelId && !levelName) {
    const { data: l } = await supabase
      .from("levels")
      .select("name")
      .eq("id", p.levelId)
      .maybeSingle();
    levelName = (l as { name?: string } | null)?.name || null;
  }
  return { ...p, departmentName, levelName };
}

async function attachBlocks(
  p: PublicUserProfile,
  myUserId?: string | null,
): Promise<PublicUserProfile> {
  if (!myUserId || myUserId === p.authUserId) return p;
  try {
    const { data: blocks } = await supabase
      .from("user_blocks")
      .select("blocker_id, blocked_id")
      .or(
        `and(blocker_id.eq.${myUserId},blocked_id.eq.${p.authUserId}),and(blocker_id.eq.${p.authUserId},blocked_id.eq.${myUserId})`,
      );
    let isBlockedByMe = false;
    let isBlockedMe = false;
    for (const b of blocks || []) {
      if (b.blocker_id === myUserId) isBlockedByMe = true;
      if (b.blocker_id === p.authUserId) isBlockedMe = true;
    }
    return { ...p, isBlockedByMe, isBlockedMe };
  } catch {
    return p;
  }
}

/** Direct table fallback when RPC returns null */
async function fetchProfileFallback(
  targetUserId: string,
): Promise<Record<string, unknown> | null> {
  // By auth_user_id
  const byAuth = await supabase
    .from("profiles")
    .select(
      "id, auth_user_id, full_name, first_name, last_name, profile_photo_url, phone, school_id, status",
    )
    .eq("auth_user_id", targetUserId)
    .maybeSingle();
  let profile = byAuth.data as Record<string, unknown> | null;

  // By profile id
  if (!profile) {
    const byId = await supabase
      .from("profiles")
      .select(
        "id, auth_user_id, full_name, first_name, last_name, profile_photo_url, phone, school_id, status",
      )
      .eq("id", targetUserId)
      .maybeSingle();
    profile = byId.data as Record<string, unknown> | null;
  }

  if (!profile) return null;

  const profileId = profile.id as string;
  const { data: student } = await supabase
    .from("students")
    .select("id, matric_number, department_id, level_id, status")
    .eq("profile_id", profileId)
    .limit(1)
    .maybeSingle();

  return {
    auth_user_id: profile.auth_user_id,
    profile_id: profile.id,
    full_name: profile.full_name,
    first_name: profile.first_name,
    last_name: profile.last_name,
    avatar_url: profile.profile_photo_url,
    profile_photo_url: profile.profile_photo_url,
    phone: profile.phone,
    school_id: profile.school_id,
    status: profile.status,
    matric_number: (student as { matric_number?: string } | null)?.matric_number,
    department_id: (student as { department_id?: string } | null)?.department_id,
    level_id: (student as { level_id?: string } | null)?.level_id,
    student_id: (student as { id?: string } | null)?.id,
  };
}

export async function fetchPublicProfile(
  targetUserId: string,
  myUserId?: string | null,
): Promise<PublicUserProfile | null> {
  const id = (targetUserId || "").trim();
  if (!id || id === "undefined" || id === "null") return null;

  let row: Record<string, unknown> | null = null;

  try {
    const { data, error } = await supabase.rpc("get_user_public_profile", {
      p_user_id: id,
    });
    if (!error && data && typeof data === "object") {
      row = data as Record<string, unknown>;
      // empty jsonb object without auth_user_id
      if (!row.auth_user_id && !row.full_name && !row.profile_id) {
        row = null;
      }
    }
  } catch {
    row = null;
  }

  if (!row) {
    try {
      row = await fetchProfileFallback(id);
    } catch {
      row = null;
    }
  }

  if (!row) return null;

  let profile = mapRow(row, id, myUserId);
  profile = await enrichDeptLevel(profile);
  profile = await attachBlocks(profile, myUserId);
  return profile;
}

export async function blockUser(blockerId: string, blockedId: string) {
  const { error } = await supabase.from("user_blocks").insert({
    blocker_id: blockerId,
    blocked_id: blockedId,
  });
  if (error) throw new Error(error.message);
}

export async function unblockUser(blockerId: string, blockedId: string) {
  const { error } = await supabase
    .from("user_blocks")
    .delete()
    .eq("blocker_id", blockerId)
    .eq("blocked_id", blockedId);
  if (error) throw new Error(error.message);
}

export async function listBlockedUsers(myUserId: string) {
  const { data, error } = await supabase
    .from("user_blocks")
    .select("blocked_id, created_at")
    .eq("blocker_id", myUserId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const profiles: PublicUserProfile[] = [];
  for (const r of data || []) {
    try {
      const p = await fetchPublicProfile(r.blocked_id as string, myUserId);
      if (p) profiles.push(p);
    } catch {
      /* skip */
    }
  }
  return profiles;
}

export async function updateMyProfilePhoto(profileId: string, file: File) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `profiles/${profileId}/${Date.now()}.${ext}`;
  const buckets = ["avatars", "profile-photos", "public", "media"];
  let publicUrl: string | null = null;
  for (const bucket of buckets) {
    const { error } = await supabase.storage.from(bucket).upload(path, file, {
      upsert: true,
      contentType: file.type || "image/jpeg",
    });
    if (!error) {
      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      publicUrl = data.publicUrl;
      break;
    }
  }
  if (!publicUrl) throw new Error("Upload failed");
  const { error: updErr } = await supabase
    .from("profiles")
    .update({ profile_photo_url: publicUrl } as never)
    .eq("id", profileId);
  if (updErr) throw new Error(updErr.message);
  return publicUrl;
}
