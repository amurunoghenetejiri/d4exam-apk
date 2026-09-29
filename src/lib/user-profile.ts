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

export async function fetchPublicProfile(
  targetUserId: string,
  myUserId?: string | null,
): Promise<PublicUserProfile | null> {
  if (!targetUserId) return null;
  const { data, error } = await supabase.rpc("get_user_public_profile", {
    p_user_id: targetUserId,
  });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  const authUserId = String(row.auth_user_id || targetUserId);

  let departmentName: string | null = null;
  let levelName: string | null = null;
  const deptId = (row.department_id as string) || null;
  const levelId = (row.level_id as string) || null;
  if (deptId) {
    const { data: d } = await supabase
      .from("departments")
      .select("name")
      .eq("id", deptId)
      .maybeSingle();
    departmentName = (d as { name?: string } | null)?.name || null;
  }
  if (levelId) {
    const { data: l } = await supabase
      .from("levels")
      .select("name")
      .eq("id", levelId)
      .maybeSingle();
    levelName = (l as { name?: string } | null)?.name || null;
  }

  let isBlockedByMe = false;
  let isBlockedMe = false;
  if (myUserId && myUserId !== authUserId) {
    const { data: blocks } = await supabase
      .from("user_blocks")
      .select("blocker_id, blocked_id")
      .or(
        `and(blocker_id.eq.${myUserId},blocked_id.eq.${authUserId}),and(blocker_id.eq.${authUserId},blocked_id.eq.${myUserId})`,
      );
    for (const b of blocks || []) {
      if (b.blocker_id === myUserId) isBlockedByMe = true;
      if (b.blocker_id === authUserId) isBlockedMe = true;
    }
  }

  return {
    authUserId,
    profileId: (row.profile_id as string) || null,
    fullName:
      String(row.full_name || "").trim() ||
      "Student",
    avatarUrl: (row.avatar_url as string) || null,
    phone: (row.phone as string) || null,
    schoolId: (row.school_id as string) || null,
    matricNumber: (row.matric_number as string) || null,
    departmentId: deptId,
    departmentName,
    levelId,
    levelName,
    studentId: (row.student_id as string) || null,
    status: (row.status as string) || null,
    isMe: Boolean(myUserId && myUserId === authUserId),
    isBlockedByMe,
    isBlockedMe,
  };
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
  const ids = (data || []).map((r) => r.blocked_id as string);
  const profiles: PublicUserProfile[] = [];
  for (const id of ids) {
    try {
      const p = await fetchPublicProfile(id, myUserId);
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
