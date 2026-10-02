import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSessionUser } from "@/lib/session";
import { withOfflineCache } from "@/lib/offline-query";
import { OfflineKeys } from "@/lib/offline-cache";

export type TeacherCourse = {
  id: string;
  code: string;
  name: string;
  credit_units: number;
  status: string;
};

export type TeacherContext = {
  teacherId: string;
  staffId: string;
  schoolId: string;
  profileId: string;
  fullName: string;
  email: string;
  schoolName: string | null;
  courses: TeacherCourse[];
  courseIds: string[];
};

type TeacherRow = {
  id: string;
  staff_id: string;
  school_id: string;
  profile_id: string | null;
};

/**
 * Resolve the teachers row for the signed-in user.
 * Tries profile_id + school_id, then profile_id only, then auth_user_id → profiles → teachers.
 */
async function resolveTeacherRow(
  profileId: string,
  schoolId: string | null,
  authUserId: string,
): Promise<TeacherRow | null> {
  if (profileId && schoolId) {
    const { data, error } = await supabase
      .from("teachers")
      .select("id, staff_id, school_id, profile_id")
      .eq("profile_id", profileId)
      .eq("school_id", schoolId)
      .maybeSingle();
    if (!error && data) return data as TeacherRow;
  }

  if (profileId) {
    const { data, error } = await supabase
      .from("teachers")
      .select("id, staff_id, school_id, profile_id")
      .eq("profile_id", profileId)
      .maybeSingle();
    if (!error && data) return data as TeacherRow;
  }

  if (authUserId) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("id, school_id")
      .eq("auth_user_id", authUserId)
      .maybeSingle();
    if (prof?.id && prof.id !== profileId) {
      let q = supabase
        .from("teachers")
        .select("id, staff_id, school_id, profile_id")
        .eq("profile_id", prof.id);
      if (schoolId) q = q.eq("school_id", schoolId);
      const { data, error } = await q.maybeSingle();
      if (!error && data) return data as TeacherRow;
      if (schoolId) {
        const { data: anySchool } = await supabase
          .from("teachers")
          .select("id, staff_id, school_id, profile_id")
          .eq("profile_id", prof.id)
          .maybeSingle();
        if (anySchool) return anySchool as TeacherRow;
      }
    }
  }

  return null;
}

function mapRpcContext(raw: unknown, sessionFallback: {
  fullName?: string;
  email?: string;
  schoolName?: string | null;
  profileId?: string;
}): TeacherContext | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const teacherId = o.teacherId != null ? String(o.teacherId) : "";
  const schoolId = o.schoolId != null ? String(o.schoolId) : "";
  if (!teacherId || !schoolId) return null;

  const coursesRaw = Array.isArray(o.courses) ? o.courses : [];
  const courses: TeacherCourse[] = coursesRaw
    .map((c) => {
      const x = c as Record<string, unknown>;
      if (!x?.id) return null;
      return {
        id: String(x.id),
        code: String(x.code || ""),
        name: String(x.name || ""),
        credit_units: Number(x.credit_units ?? 0),
        status: String(x.status || "active"),
      };
    })
    .filter(Boolean) as TeacherCourse[];

  const courseIds = Array.isArray(o.courseIds)
    ? o.courseIds.map((id) => String(id))
    : courses.map((c) => c.id);

  return {
    teacherId,
    staffId: String(o.staffId || ""),
    schoolId,
    profileId: String(o.profileId || sessionFallback.profileId || ""),
    fullName: String(o.fullName || sessionFallback.fullName || ""),
    email: String(o.email || sessionFallback.email || ""),
    schoolName:
      o.schoolName != null
        ? String(o.schoolName)
        : sessionFallback.schoolName ?? null,
    courses,
    courseIds,
  };
}

/**
 * Loads the signed-in teacher record and only courses assigned by admin
 * via teacher_courses. Prefers SECURITY DEFINER RPC (bypasses RLS edge cases).
 */
export function useTeacherContext() {
  const { data: session } = useSessionUser();

  const isTeacher =
    session?.role === "teacher" ||
    (Array.isArray(session?.roles) && session.roles.includes("teacher"));

  return useQuery({
    queryKey: ["teacher-context", session?.profileId, session?.schoolId, session?.userId],
    // Load when signed-in teacher; schoolId may still be hydrating
    enabled: Boolean(session?.userId && (session?.profileId || isTeacher)),
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: true,
    networkMode: "offlineFirst",
    retry: 1,
    queryFn: async (): Promise<TeacherContext | null> => {
      if (!session?.userId) return null;
      const uid = session.userId;
      const profileId: string = session.profileId || uid;
      const schoolId: string | null = session.schoolId;

      return withOfflineCache(
        uid,
        OfflineKeys.teacherContext,
        async () => {
          // 1) Preferred: SECURITY DEFINER RPC (works even when RLS/school helpers lag)
          try {
            const { data: rpcData, error: rpcErr } = await supabase.rpc(
              "get_my_teacher_context" as never,
            );
            if (!rpcErr && rpcData) {
              const mapped = mapRpcContext(rpcData, {
                fullName: session.fullName,
                email: session.email,
                schoolName: session.schoolName,
                profileId: session.profileId,
              });
              if (mapped) return mapped;
            } else if (rpcErr) {
              console.warn("[teacher-context] rpc", rpcErr.message);
            }
          } catch (e) {
            console.warn("[teacher-context] rpc failed", e);
          }

          // 2) Fallback: direct table reads
          const teacher = await resolveTeacherRow(profileId, schoolId, uid);
          if (!teacher) return null;

          const effectiveSchoolId = teacher.school_id || schoolId;
          if (!effectiveSchoolId) return null;

          const { data: links, error: lErr } = await supabase
            .from("teacher_courses")
            .select("course_id, courses(id, code, name, credit_units, status)")
            .eq("teacher_id", teacher.id)
            .eq("school_id", effectiveSchoolId);

          if (lErr) {
            console.warn("[teacher-context] courses", lErr.message);
          }

          const courses: TeacherCourse[] = [];
          for (const row of links ?? []) {
            const c = row.courses as
              | { id: string; code: string; name: string; credit_units: number; status: string }
              | null
              | undefined;
            if (c?.id) {
              courses.push({
                id: c.id,
                code: c.code,
                name: c.name,
                credit_units: c.credit_units ?? 0,
                status: c.status ?? "active",
              });
            }
          }

          courses.sort((a, b) => a.code.localeCompare(b.code));

          return {
            teacherId: teacher.id,
            staffId: teacher.staff_id,
            schoolId: effectiveSchoolId,
            profileId: teacher.profile_id ?? session.profileId ?? profileId,
            fullName: session.fullName,
            email: session.email,
            schoolName: session.schoolName,
            courses,
            courseIds: courses.map((c) => c.id),
          };
        },
        { schoolId: schoolId ?? undefined, fallback: null, localFirst: false },
      );
    },
  });
}
