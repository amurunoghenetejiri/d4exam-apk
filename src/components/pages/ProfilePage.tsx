import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { PageHeader, SectionCard, EmptyState } from "@/components/dashboard/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { initials, useSessionUser } from "@/lib/session";
import { supabase } from "@/integrations/supabase/client";
import {
  Building2,
  GraduationCap,
  Loader2,
  Shield,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { SchoolLogo } from "@/components/brand/SchoolLogo";
import { useSchoolIdentity } from "@/lib/school-identity";
import { useQueryClient } from "@tanstack/react-query";
import { useStudentContext } from "@/lib/student";
import { friendlyError } from "@/lib/friendly-error";
import { cn } from "@/lib/utils";

const roleLabel: Record<string, string> = {
  student: "Student",
  teacher: "Teacher",
  school_admin: "School Administrator",
  examination_officer: "Departmental Officer",
  super_admin: "Super Administrator",
};

const roleBadgeStyles: Record<
  string,
  { className: string; icon: typeof UserRound }
> = {
  student: {
    className:
      "border-sky-200/80 bg-sky-50 text-sky-800 shadow-sm shadow-sky-100/80",
    icon: GraduationCap,
  },
  teacher: {
    className:
      "border-violet-200/80 bg-violet-50 text-violet-800 shadow-sm shadow-violet-100/80",
    icon: UserRound,
  },
  school_admin: {
    className:
      "border-emerald-200/80 bg-emerald-50 text-emerald-800 shadow-sm shadow-emerald-100/80",
    icon: Building2,
  },
  examination_officer: {
    className:
      "border-amber-200/80 bg-amber-50 text-amber-900 shadow-sm shadow-amber-100/80",
    icon: Shield,
  },
  super_admin: {
    className:
      "border-indigo-200/80 bg-indigo-50 text-indigo-900 shadow-sm shadow-indigo-100/80",
    icon: ShieldCheck,
  },
};

function ProfileField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="border-b border-slate-100 py-2.5 last:border-0 last:pb-0 first:pt-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 sm:text-[11px]">
        {label}
      </p>
      <p className="mt-0.5 break-words text-sm font-semibold leading-snug text-slate-900 [overflow-wrap:anywhere]">
        {value ?? "—"}
      </p>
    </div>
  );
}

function RoleBadge({ roleKey }: { roleKey: string }) {
  const label = roleLabel[roleKey] ?? roleKey;
  const style = roleBadgeStyles[roleKey] ?? {
    className: "border-slate-200 bg-slate-50 text-slate-700 shadow-sm",
    icon: UserRound,
  };
  const Icon = style.icon;

  return (
    <Badge
      variant="outline"
      className={cn(
        "mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide sm:text-xs",
        style.className,
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {label}
    </Badge>
  );
}

export function ProfilePage() {
  const { data: user, isLoading, error } = useSessionUser();
  const { data: school } = useSchoolIdentity(user?.schoolId);
  const { data: student } = useStudentContext();
  const qc = useQueryClient();
  const [photoBusy, setPhotoBusy] = useState(false);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    const roleLike = /^(school\s*admin|examination\s*officer|departmental\s*officer|teacher|student|super\s*admin|user)$/i;
    const seed = (user.fullName || student?.fullName || "").trim();
    setFullName(seed && !roleLike.test(seed) ? seed : "");
    void (async () => {
      try {
        let data: { phone?: string | null; full_name?: string | null } | null = null;
        const byAuth = await supabase
          .from("profiles")
          .select("phone, full_name")
          .eq("auth_user_id", user.userId)
          .maybeSingle();
        data = byAuth.data;
        if ((!data?.full_name || roleLike.test(String(data.full_name || "").trim())) && user.profileId) {
          const byId = await supabase
            .from("profiles")
            .select("phone, full_name")
            .eq("id", user.profileId)
            .maybeSingle();
          if (byId.data) data = { ...(data || {}), ...byId.data };
        }
        if (data?.phone) setPhone(String(data.phone));
        const name = String(data?.full_name || "").trim();
        if (name && !roleLike.test(name)) setFullName(name);
      } catch {
        /* ignore */
      }
    })();
  }, [user, student?.fullName]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!user?.userId) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { full_name: fullName.trim() };
      if (phone.trim()) payload.phone = phone.trim();
      const { error: upErr } = await supabase
        .from("profiles")
        .update(payload as never)
        .eq("auth_user_id", user.userId);
      if (upErr) {
        const { error: up2 } = await supabase
          .from("profiles")
          .update({ full_name: fullName.trim() } as never)
          .eq("auth_user_id", user.userId);
        if (up2) throw up2;
      }
      // Production students table has no full_name — name stays on profiles only

      await qc.invalidateQueries({ queryKey: ["session-user"] });
      await qc.invalidateQueries({ queryKey: ["student-context"] });
      toast.success("Profile saved");
    } catch (err) {
      toast.error(friendlyError(err, "Could not save profile"));
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading profile…
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        title="Could not load profile"
        description="Try signing out and signing back in."
      />
    );
  }

  if (!user) {
    return (
      <EmptyState title="Not signed in" description="Sign in to view and edit your profile." />
    );
  }

  const avatar = initials(user.fullName || user.email || "U");
  const roleKey = user.role || "user";
  const isSuperAdmin = roleKey === "super_admin";
  const logoUrl = isSuperAdmin ? null : (school?.logoUrl ?? user.schoolLogoUrl);
  const schoolName = isSuperAdmin ? null : (school?.name ?? user.schoolName);
  const displayName = fullName || user.fullName || "—";
  const statusLabel = (user.status || "active").replace(/_/g, " ");

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader title="Profile" description={isSuperAdmin ? "Your platform administrator account" : "Your account details for this school portal"} />

      <div className="grid gap-3 sm:gap-4 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
        <SectionCard className="overflow-hidden p-0">
          <div className="relative bg-gradient-to-br from-primary/12 via-sky-50/80 to-white px-4 pb-5 pt-6 sm:px-5 sm:pb-6 sm:pt-7">
            <div
              className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/15 via-transparent to-transparent"
              aria-hidden
            />
            <div className="relative flex flex-col items-center text-center">
              <div className="relative flex flex-col items-center">
                <div className="relative">
                  {user.avatarUrl ? (
                    <img
                      src={user.avatarUrl}
                      alt=""
                      className="h-20 w-20 rounded-full object-cover shadow-md ring-2 ring-white sm:h-24 sm:w-24"
                    />
                  ) : (
                    <span className="grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-primary to-primary/80 font-display text-xl font-bold text-white shadow-md shadow-primary/25 ring-2 ring-white sm:h-24 sm:w-24 sm:text-2xl">
                      {avatar}
                    </span>
                  )}
                </div>
                <label className="mt-2 inline-flex cursor-pointer items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60">
                  {photoBusy ? "Uploading…" : user.avatarUrl ? "Change photo" : "Upload photo"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    disabled={photoBusy}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file || !user.profileId) return;
                      if (file.size > 3 * 1024 * 1024) {
                        toast.error("Image must be 3 MB or smaller.");
                        return;
                      }
                      setPhotoBusy(true);
                      try {
                        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
                        const path = `profiles/${user.profileId}/avatar-${Date.now()}.${ext}`;
                        const buckets = ["avatars", "public"];
                        let publicUrl: string | null = null;
                        let lastErr = "";
                        for (const bucket of buckets) {
                          const { error } = await supabase.storage
                            .from(bucket)
                            .upload(path, file, { upsert: true, contentType: file.type || "image/jpeg" });
                          if (!error) {
                            const { data } = supabase.storage.from(bucket).getPublicUrl(path);
                            publicUrl = data.publicUrl;
                            break;
                          }
                          lastErr = error.message || "upload failed";
                        }
                        if (!publicUrl) throw new Error(lastErr || "Upload failed");
                        const { error: updErr } = await supabase
                          .from("profiles")
                          .update({ profile_photo_url: publicUrl } as never)
                          .eq("id", user.profileId);
                        if (updErr) {
                          const { error: upd2 } = await supabase
                            .from("profiles")
                            .update({ profile_photo_url: publicUrl } as never)
                            .eq("auth_user_id", user.userId);
                          if (upd2) throw upd2;
                        }
                        toast.success("Profile photo updated");
                        void qc.invalidateQueries({ queryKey: ["session-user"] });
                        void qc.invalidateQueries({ queryKey: ["public-profile"] });
                      } catch (err) {
                        toast.error((err as Error).message || "Could not upload photo");
                      } finally {
                        setPhotoBusy(false);
                      }
                    }}
                  />
                </label>
              </div>

              <h2 className="mt-3 max-w-full break-words text-base font-extrabold leading-snug text-slate-900 sm:mt-3.5 sm:text-lg [overflow-wrap:anywhere]">
                {displayName}
              </h2>

              <RoleBadge roleKey={roleKey} />

              {schoolName ? (
                <p className="mt-2.5 max-w-full break-words text-[11px] font-semibold leading-snug text-slate-600 sm:text-xs [overflow-wrap:anywhere]">
                  {schoolName}
                </p>
              ) : null}
            </div>
          </div>

          <div className="px-4 pb-4 pt-1 sm:px-5 sm:pb-5">
            {!isSuperAdmin ? (
              <ProfileField
                label={user.identifierLabel || "Matric number"}
                value={user.identifier || student?.matric || "—"}
              />
            ) : null}
            <ProfileField label="Email" value={user.email || "—"} />
            <ProfileField
              label="Status"
              value={
                <span className="inline-flex items-center gap-1.5 capitalize">
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      statusLabel === "active" ? "bg-emerald-500" : "bg-slate-400",
                    )}
                    aria-hidden
                  />
                  {statusLabel}
                </span>
              }
            />
            {user.schoolCode && !isSuperAdmin ? <ProfileField label="School code" value={user.schoolCode} /> : null}
            {student?.departmentName ? (
              <ProfileField label="Department" value={student.departmentName} />
            ) : null}
            {student?.facultyName ? (
              <ProfileField label="Faculty / College" value={student.facultyName} />
            ) : null}
            {student?.levelName ? <ProfileField label="Level" value={student.levelName} /> : null}
            {student?.sessionName ? (
              <ProfileField label="Session" value={student.sessionName} />
            ) : null}
            {student?.semesterName ? (
              <ProfileField label="Semester" value={student.semesterName} />
            ) : null}
          </div>
        </SectionCard>

        <SectionCard
          title="Edit details"
          description="Only fields you are allowed to change are editable"
        >
          <form className="grid gap-3 sm:grid-cols-2 sm:gap-4" onSubmit={save}>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="fullname">Full name</Label>
              <Input
                id="fn"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                className="w-full"
              />
            </div>
            <div className="space-y-1.5 min-w-0">
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                type="email"
                value={user.email}
                readOnly
                className="w-full bg-slate-50 text-xs sm:text-sm"
              />
            </div>
            <div className="space-y-1.5 min-w-0">
              <Label htmlFor="phone">Phone number</Label>
              <Input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Optional phone"
                className="w-full"
              />
            </div>
            <div className="space-y-1.5 min-w-0 sm:col-span-2">
              <Label htmlFor="ident">{user.identifierLabel || "Matric number"}</Label>
              <Input
                id="ident"
                value={user.identifier || student?.matric || "—"}
                readOnly
                className="w-full bg-slate-50 text-xs sm:text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <Button
                type="submit"
                disabled={saving}
                className={cn("w-full font-semibold sm:w-auto")}
              >
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save profile
              </Button>
            </div>
          </form>
        </SectionCard>
      </div>
    </div>
  );
}
