// @ts-nocheck
import type { StudentContext, StudentCourse } from "@/lib/student";

function isOfflineNow(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Resolve student context (local-first on APK):
 * offline → null (caller uses IndexedDB/SQLite cache)
 * online → RPC → direct Supabase client (never hang on Vercel server fn)
 */
export async function fetchStudentContextClient(session: {
  userId?: string | null;
  profileId?: string | null;
  schoolId?: string | null;
  schoolName?: string | null;
  email?: string | null;
  fullName?: string | null;
  status?: string | null;
} | null): Promise<StudentContext | null> {
  const uid = session?.userId;
  if (!uid) return null;

  // Fully offline: do not touch network — withOfflineCache will serve IndexedDB/SQLite
  if (isOfflineNow()) return null;

  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const rpcRes = await withTimeout(
      supabase.rpc("get_my_student_context" as never),
      4_000,
    );
    if (!rpcRes) {
      console.warn("[student-context] rpc timed out");
    }
    const rpcData = rpcRes?.data;
    const rpcErr = rpcRes?.error;
    if (rpcErr) console.warn("[student-context] rpc", rpcErr.message);
    if (rpcData && typeof rpcData === "object") {
      const raw = rpcData as Record<string, unknown>;
      const studentId = String(raw.studentId || raw.student_id || "");
      if (studentId) {
        const coursesRaw = (raw.courses as StudentCourse[] | null) || [];
        const courseIdsRaw =
          (raw.courseIds as string[] | null) ||
          (raw.course_ids as string[] | null) ||
          coursesRaw.map((c) => c.id);
        return {
          studentId,
          matric: (raw.matric as string | null) ?? null,
          schoolId: String(raw.schoolId || raw.school_id || session?.schoolId || ""),
          profileId: String(raw.profileId || raw.profile_id || session?.profileId || ""),
          fullName: String(raw.fullName || raw.full_name || "").trim(),
          email: String(raw.email || session?.email || ""),
          schoolName: (raw.schoolName as string | null) ?? session?.schoolName ?? null,
          departmentId:
            (raw.departmentId as string | null) ?? (raw.department_id as string | null) ?? null,
          levelId: (raw.levelId as string | null) ?? (raw.level_id as string | null) ?? null,
          facultyId: (raw.facultyId as string | null) ?? (raw.faculty_id as string | null) ?? null,
          departmentName: (raw.departmentName as string | null) ?? null,
          facultyName: (raw.facultyName as string | null) ?? null,
          levelName: (raw.levelName as string | null) ?? null,
          status: String(raw.status || "active"),
          isActive: Boolean(
            raw.isActive ?? String(raw.status || "active").toLowerCase() === "active",
          ),
          sessionName: (raw.sessionName as string | null) ?? null,
          semesterName: (raw.semesterName as string | null) ?? null,
          semesterId: (raw.semesterId as string | null) ?? null,
          courses: coursesRaw,
          courseIds: (courseIdsRaw || []).map(String),
        } as StudentContext;
      }
    }
  } catch (e) {
    console.warn("[student-context] rpc failed", e);
  }

  // Capacitor SPA: server fns are stubs — skip to avoid freeze / empty waits
  // (RPC + direct client below cover online; offline uses withOfflineCache)
  if (!isOfflineNow() && typeof window !== "undefined") {
    const isNative =
      Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()) ||
      Boolean((window as unknown as { __D4_CAP_SPA?: boolean }).__D4_CAP_SPA);
    if (!isNative) {
      try {
        const { getMyStudentContext } = await import("@/lib/student.server");
        const ctx = (await withTimeout(
          getMyStudentContext() as Promise<StudentContext | { error?: string } | null>,
          3_000,
        )) as StudentContext | { error?: string } | null;
        if (ctx && (ctx as StudentContext).studentId) return ctx as StudentContext;
      } catch (e) {
        console.warn("[student-context] server fn failed", e);
      }
    }
  }

  try {
    const { supabase } = await import("@/integrations/supabase/client");
    let profileQ = await supabase
      .from("profiles")
      .select("id, full_name, email, status, school_id")
      .eq("auth_user_id", uid)
      .maybeSingle();
    let profile = profileQ.data;
    if (!profile && session?.profileId) {
      const byId = await supabase
        .from("profiles")
        .select("id, full_name, email, status, school_id")
        .eq("id", session.profileId)
        .maybeSingle();
      profile = byId.data;
    }
    if (!profile) {
      profile = {
        id: session?.profileId || uid,
        full_name: session?.fullName || null,
        email: session?.email || null,
        status: session?.status || "active",
        school_id: session?.schoolId || null,
      } as typeof profile;
    }
    const schoolId = (profile.school_id as string) || session?.schoolId || "";
    let studentQ = await supabase
      .from("students")
      .select(
        "id, matric_number, student_id, school_id, profile_id, department_id, level_id, faculty_id, status, full_name, departments(name), faculties(name), levels(name)",
      )
      .eq("profile_id", profile.id)
      .maybeSingle();
    if (studentQ.error && /full_name/i.test(studentQ.error.message || "")) {
      studentQ = await supabase
        .from("students")
        .select(
          "id, matric_number, student_id, school_id, profile_id, department_id, level_id, faculty_id, status, departments(name), faculties(name), levels(name)",
        )
        .eq("profile_id", profile.id)
        .maybeSingle();
    }
    let student = studentQ.data as Record<string, unknown> | null;
    if (!student && schoolId) {
      const alt = await supabase
        .from("students")
        .select(
          "id, matric_number, student_id, school_id, profile_id, department_id, level_id, faculty_id, status, full_name, departments(name), faculties(name), levels(name)",
        )
        .eq("school_id", schoolId)
        .limit(500);
      const rows = (alt.data ?? []) as Record<string, unknown>[];
      student = rows.find((r) => String(r.profile_id || "") === String(profile!.id)) ?? null;
    }
    if (!student) return null;
    const departments = student.departments as { name?: string } | null;
    const faculties = student.faculties as { name?: string } | null;
    const levels = student.levels as { name?: string } | null;
    const status = String(student.status || "active");
    const studentId = String(student.id);
    let courses: StudentCourse[] = [];
    const mapRows = (rows: unknown[]): StudentCourse[] =>
      (rows ?? [])
        .map((row) => {
          const c = (row as { courses?: { id?: string; code?: string; name?: string } | null }).courses;
          if (!c?.id) return null;
          return { id: String(c.id), code: String(c.code || ""), name: String(c.name || "") };
        })
        .filter(Boolean) as StudentCourse[];
    try {
      const { data: sc } = await supabase
        .from("student_courses")
        .select("course_id, courses(id, code, name)")
        .eq("student_id", studentId)
        .limit(300);
      courses = mapRows(sc ?? []);
    } catch {
      courses = [];
    }
    if (!courses.length) {
      try {
        const { data: en } = await supabase
          .from("course_enrollments")
          .select("course_id, courses(id, code, name)")
          .eq("student_id", studentId)
          .limit(300);
        courses = mapRows(en ?? []);
      } catch {
        /* ignore */
      }
    }
    const seen = new Set<string>();
    courses = courses.filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
    return {
      studentId,
      matric:
        (student.matric_number as string | null) ?? (student.student_id as string | null) ?? null,
      schoolId: String(student.school_id || schoolId),
      profileId: String(profile.id),
      fullName:
        (profile.full_name || "").trim() ||
        String((student as { full_name?: string | null }).full_name || "").trim() ||
        String(student.matric_number || ""),
      email: (profile.email as string) || "",
      schoolName: session?.schoolName ?? null,
      departmentId: (student.department_id as string | null) ?? null,
      levelId: (student.level_id as string | null) ?? null,
      facultyId: (student.faculty_id as string | null) ?? null,
      departmentName: departments?.name ?? null,
      facultyName: faculties?.name ?? null,
      levelName: levels?.name ?? null,
      status,
      isActive: status.toLowerCase() === "active",
      sessionName: null,
      semesterName: null,
      semesterId: null,
      courses,
      courseIds: courses.map((c) => c.id),
    };
  } catch (e) {
    console.warn("[student-context] client fallback failed", e);
    return null;
  }
}
