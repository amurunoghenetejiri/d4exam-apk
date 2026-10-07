// @ts-nocheck
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchSessionUser,
  roleHome,
  seedPendingLoginRole,
  setPreferredRole,
  seedLoginSchoolContext,
  rememberLastPath,
  readPreferredRole,
  readPendingLoginRole,
  readLastPath,
  type AppRole,
} from "@/lib/session";
import { signInWithSchoolCode } from "@/lib/auth.functions";
import { clientSignInWithSchoolCode } from "@/lib/auth.client-login";
import { isNativeShell } from "@/native/platform";
import { ensureLoginAccount } from "@/lib/ensure-login.functions";
import { saveCurrentAccountToVault, consumeAddAccountFlow, listSavedAccounts } from "@/lib/account-switcher";
import { appReplace } from "@/lib/app-navigate";

import {
  Eye,
  EyeOff,
  ShieldCheck,
  Zap,
  Users,
  Cloud,
  ArrowRight,
} from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";

export const Route = createFileRoute("/login")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — D4EXAM" },
      { name: "description", content: "Sign in to your D4EXAM school account." },
    ],
    links: [
      { rel: "canonical", href: "https://d4exam.name.ng/login" },
    ],
  }),
  beforeLoad: async () => {
    try {
      if (typeof window !== "undefined") {
        const q = new URLSearchParams(window.location.search);
        if (q.get("addAccount") === "1" || q.get("switch") === "1") return;
      }
    } catch {
      /* ignore */
    }
    try {
      const user = await Promise.race([
        fetchSessionUser(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2_000)),
      ]);
      if (user?.role && user.role in roleHome) {
        throw redirect({ to: roleHome[user.role] as never });
      }
    } catch (e) {
      if (e && typeof e === "object" && "to" in e) throw e;
    }
  },
  component: LoginPage,
});

const features = [
  {
    icon: ShieldCheck,
    title: "Secure exams",
    desc: "Integrity controls and live monitoring built in.",
  },
  {
    icon: Zap,
    title: "Fast CBT",
    desc: "Smooth experience on phone and desktop.",
  },
  {
    icon: Users,
    title: "Whole school",
    desc: "Students, teachers, officers and admins together.",
  },
  {
    icon: Cloud,
    title: "Always available",
    desc: "Cloud-ready access wherever you are.",
  },
];

function friendlyLoginError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const cleaned = raw.replace(/\s+/g, " ").trim();
  const lower = cleaned.toLowerCase();

  // Offline / network — never surface raw "Failed to fetch"
  if (
    typeof navigator !== "undefined" &&
    navigator.onLine === false
  ) {
    return "You're offline. Open the app online once, then you can use it offline.";
  }
  if (
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("network request failed") ||
    lower.includes("load failed") ||
    lower.includes("err_internet") ||
    lower.includes("offline") ||
    lower.includes("unable to connect") ||
    lower.includes("net::err_") ||
    lower.includes("network error") ||
    lower.includes("timeout") ||
    lower.includes("timed out")
  ) {
    return "You're offline or the connection timed out. Try again when you have signal, or use a saved account offline.";
  }

  // Wrong credentials (Supabase + generic)
  if (
    lower.includes("invalid login") ||
    lower.includes("invalid credentials") ||
    lower.includes("invalid_grant") ||
    lower.includes("email not confirmed") ||
    lower.includes("user not found") ||
    lower.includes("wrong password") ||
    lower.includes("incorrect password") ||
    lower.includes("invalid password") ||
    lower.includes("auth api error") ||
    lower.includes("invalid email or password")
  ) {
    return "Invalid credentials.";
  }

  // Empty / validation
  if (lower.includes("enter your") || lower.includes("required")) {
    return cleaned.length <= 80 ? cleaned : "Please fill in all fields.";
  }

  // HTML / huge dumps
  if (
    lower.includes("<!doctype") ||
    lower.includes("<html") ||
    cleaned.length > 120
  ) {
    return "Unable to sign in right now. Please try again.";
  }

  return cleaned || "Unable to sign in. Please try again.";
}

function readQueryPrefill(): { email: string; isSwitch: boolean; isAdd: boolean } {
  if (typeof window === "undefined") return { email: "", isSwitch: false, isAdd: false };
  try {
    const q = new URLSearchParams(window.location.search);
    const email = (q.get("email") || "").trim();
    const isSwitch = q.get("switch") === "1";
    const isAdd = q.get("addAccount") === "1";
    return { email, isSwitch, isAdd };
  } catch {
    return { email: "", isSwitch: false, isAdd: false };
  }
}

/** Full page load so Capacitor WebView always applies the new session. */
async function seedSchoolFromCode(schoolCode: string | null | undefined) {
  const code = (schoolCode || "").trim().toUpperCase();
  if (!code || code === "SUPER" || code === "PLATFORM") return null;
  try {
    const { data: rpcSchool } = await supabase.rpc("resolve_school_for_login", {
      _school_code: code,
    });
    const row = Array.isArray(rpcSchool) ? rpcSchool[0] : rpcSchool;
    const id =
      row && typeof row === "object" && (row as { id?: string }).id
        ? String((row as { id: string }).id)
        : null;
    if (id) {
      seedLoginSchoolContext(id, code);
      return id;
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function goToRoleHome(role: string, rememberDevice = true, loginSchool?: { schoolId?: string | null; schoolCode?: string | null }) {
  try {
    if (loginSchool?.schoolId) seedLoginSchoolContext(loginSchool.schoolId, loginSchool.schoolCode || null);
  } catch { /* ignore */ }

  const home = roleHome[role as AppRole];
  try {
    setPreferredRole(role as AppRole);
    rememberLastPath(home, role);
  } catch {
    /* ignore */
  }
  if (!home) return false;
  const last = readLastPath();
  const prefix = home;
  const path = last && last.startsWith(prefix) ? last : home;
  try {
    seedPendingLoginRole(role);
  } catch {
    /* ignore */
  }
  // Warm session so dashboards have schoolId before first paint (retry hard after auth)
  try {
    const needsSchool = role !== "super_admin";
    // Let auth tokens settle in the client
    try {
      await supabase.auth.getSession();
    } catch {
      /* ignore */
    }
    // Ensure school context from login school-code is available before fetchSessionUser
    try {
      const { readLoginSchoolContext } = await import("@/lib/session");
      if (!readLoginSchoolContext()?.schoolId && loginSchool?.schoolCode) {
        await seedSchoolFromCode(loginSchool.schoolCode);
      }
    } catch {
      /* ignore */
    }
    for (let i = 0; i < (needsSchool ? 3 : 1); i++) {
      const u = await Promise.race([
        fetchSessionUser(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3_500)),
      ]);
      if (u && (!needsSchool || u.schoolId)) {
        try {
          if (u.userId) {
            const { offlineSet, OfflineKeys } = await import("@/lib/offline-cache");
            await offlineSet(u.userId, OfflineKeys.sessionUser, u, { schoolId: u.schoolId });
          }
        } catch {
          /* ignore */
        }
        break;
      }
      // Explicit repair if still missing school
      if (needsSchool) {
        try {
          const { repairMySessionSchool } = await import("@/lib/repair-session-school.functions");
          const fixed = await repairMySessionSchool();
          if (fixed?.schoolId) {
            seedLoginSchoolContext(fixed.schoolId, fixed.schoolCode);
          }
        } catch {
          /* ignore */
        }
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  } catch {
    /* ignore */
  }
  try {
    const addFlow = consumeAddAccountFlow();
    if (rememberDevice || addFlow || listSavedAccounts().length > 0) {
      await saveCurrentAccountToVault();
    }
  } catch {
    /* ignore */
  }
  try {
    appReplace(path);
  } catch {
    try {
      window.location.replace(path);
    } catch {
      window.location.href = path;
    }
  }
  return true;
}

function LoginPage() {
  const loginFn = useServerFn(signInWithSchoolCode);
  const ensureLoginFn = useServerFn(ensureLoginAccount);
  const prefill = readQueryPrefill();
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [identifier, setIdentifier] = useState(prefill.email);
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const inFlight = useRef(false);
  const isAddAccount = prefill.isAdd;
  const isSwitchRefresh = prefill.isSwitch;
  const savedCount = typeof window !== "undefined" ? listSavedAccounts().length : 0;

  useEffect(() => {
    if (prefill.email && !identifier) {
      setIdentifier(prefill.email);
    }
  }, [prefill.email]); // eslint-disable-line react-hooks/exhaustive-deps

  async function resolveRoleAndGoHome(): Promise<boolean> {
    const priority = [
      "super_admin",
      "school_admin",
      "examination_officer",
      "teacher",
      "student",
    ] as const;

    // Prefer session user (allow enough time after setSession)
    try {
      await new Promise((r) => setTimeout(r, 150));
      const user = await Promise.race([
        fetchSessionUser(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 4_000)),
      ]);
      if (user?.role && user.role in roleHome) {
        return await goToRoleHome(user.role, remember);
      }
      // Role list without primaryRole still counts
      if (user?.roles?.length) {
        const found = priority.find((r) => user.roles.map((x) => String(x).toLowerCase()).includes(r));
        if (found) return await goToRoleHome(found, remember);
      }
    } catch {
      /* continue */
    }

    try {
      const { data: myRoles } = await supabase.rpc("get_my_roles");
      const list = Array.isArray(myRoles)
        ? myRoles.map((r: { role?: string } | string) =>
            typeof r === "string" ? r : String((r as { role?: string }).role || ""),
          )
        : [];
      const found = priority.find((r) => list.map((x) => x.toLowerCase()).includes(r));
      if (found) return await goToRoleHome(found, remember);
    } catch {
      /* ignore */
    }

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user?.id) {
        // user_roles may key on auth uid OR profiles.id
        const { data: roles } = await supabase
          .from("user_roles")
          .select("role")
          .or(`user_id.eq.${user.id}`)
          .limit(20);
        const list = (roles ?? []).map((r) => String(r.role).toLowerCase());
        let found = priority.find((r) => list.includes(r));
        if (found) return await goToRoleHome(found, remember);

        // Table probes for officer / teacher / student
        const { data: prof } = await supabase
          .from("profiles")
          .select("id")
          .or(`id.eq.${user.id},auth_user_id.eq.${user.id}`)
          .maybeSingle();
        const pid = prof?.id || user.id;
        const checks: { table: string; role: (typeof priority)[number] }[] = [
          { table: "examination_officers", role: "examination_officer" },
          { table: "teachers", role: "teacher" },
          { table: "students", role: "student" },
        ];
        for (const c of checks) {
          const { data: row } = await supabase
            .from(c.table)
            .select("id")
            .eq("profile_id", pid)
            .limit(1)
            .maybeSingle();
          if (row?.id) return await goToRoleHome(c.role, remember);
        }
        // school admin: role in user_roles only — also check school_admins if table exists
        try {
          const { data: sa } = await supabase
            .from("school_admins")
            .select("id")
            .eq("profile_id", pid)
            .limit(1)
            .maybeSingle();
          if (sa?.id) return await goToRoleHome("school_admin", remember);
        } catch {
          /* table may not exist */
        }
      }
    } catch {
      /* ignore */
    }

    // Last: preferred / pending role if we have a live session
    try {
      const { data: sess } = await supabase.auth.getSession();
      if (sess.session?.user) {
        const pref = readPreferredRole() || readPendingLoginRole();
        if (pref && pref in roleHome) return await goToRoleHome(pref, remember);
      }
    } catch {
      /* ignore */
    }

    return false;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (inFlight.current || loading) {
      // If a previous attempt left the button stuck, a second tap resets it
      setLoading(false);
      inFlight.current = false;
      setError("");
      return;
    }
    setError("");
    if (!identifier.trim() || !password.trim()) {
      setError("Please enter your login details.");
      return;
    }
    inFlight.current = true;
    setLoading(true);
    let navigated = false;
    let lastServerMsg = "";
    const offlineNow =
      typeof navigator !== "undefined" && navigator.onLine === false;
    const nativeShell = isNativeShell();

    /** Resume from local SQLite / auth session — no Vercel, no network. */
    async function tryOfflineResume(): Promise<boolean> {
      // 1) Live Supabase session still in WebView storage
      try {
        const { data: sess } = await Promise.race([
          supabase.auth.getSession(),
          new Promise<{ data: { session: null } }>((resolve) =>
            setTimeout(() => resolve({ data: { session: null } }), 600),
          ),
        ]);
        if (sess?.session?.user) {
          if (await resolveRoleAndGoHome()) return true;
          const pref = readPreferredRole() || readPendingLoginRole() || "student";
          if (pref in roleHome) {
            await goToRoleHome(pref as AppRole, remember);
            return true;
          }
        }
      } catch { /* ignore */ }

      // 2) Local SQLite session (saved after a previous online login)
      try {
        const { getLocalSessionByEmail, getMostRecentLocalSession } = await import(
          "@/lib/local-db/repositories/sessionRepo"
        );
        const ident = identifier.trim().toLowerCase();
        let row = ident.includes("@") ? await getLocalSessionByEmail(ident) : null;
        if (!row && ident) {
          // Also try matching full_name loosely / most recent on device
          row = await getMostRecentLocalSession();
          if (row?.email && ident.includes("@") && String(row.email).toLowerCase() !== ident) {
            row = null; // wrong account
          }
        }
        if (row) {
          let role = (row.primary_role as string) || "";
          if (!role && row.roles_json) {
            try {
              const roles = JSON.parse(String(row.roles_json)) as string[];
              role = roles[0] || "";
            } catch { /* ignore */ }
          }
          if (!role) role = readPreferredRole() || readPendingLoginRole() || "student";
          if (role && role in roleHome) {
            try {
              seedPendingLoginRole(role);
              setPreferredRole(role as AppRole);
              if (row.school_id) seedLoginSchoolContext(String(row.school_id), null);
              // Warm React Query session cache so shell does not freeze on empty user
              try {
                const { offlineSet, OfflineKeys } = await import("@/lib/offline-cache");
                const snap = {
                  userId: String(row.user_id),
                  profileId: String(row.profile_id || row.user_id),
                  email: String(row.email || ""),
                  fullName: String(row.full_name || ""),
                  status: String(row.status || "active"),
                  schoolId: row.school_id ? String(row.school_id) : null,
                  schoolName: row.school_name ? String(row.school_name) : null,
                  schoolCode: null,
                  schoolLogoUrl: null,
                  avatarUrl: null,
                  roles: role ? [role as AppRole] : [],
                  role: role as AppRole,
                  identifier: String(row.email || ""),
                  identifierLabel: "Email",
                };
                await offlineSet(String(row.user_id), OfflineKeys.sessionUser, snap, {
                  schoolId: row.school_id ? String(row.school_id) : null,
                });
              } catch { /* ignore */ }
            } catch { /* ignore */ }
            await goToRoleHome(role as AppRole, remember);
            return true;
          }
        }
      } catch { /* ignore */ }
      return false;
    }

    // Offline APK: resume from saved session — no Vercel / no network required
    if (offlineNow) {
      try {
        if (await tryOfflineResume()) {
          navigated = true;
          setLoading(false);
          inFlight.current = false;
          return;
        }
      } catch { /* ignore */ }
      setLoading(false);
      inFlight.current = false;
      setError(
        "You're offline. Open the app online once to sign in, then you can use it offline.",
      );
      return;
    }

    // Hard ceiling — native must never freeze (max 6s)
    const hardCeilingMs = nativeShell ? 6_000 : 10_000;
    const loginTimeout = window.setTimeout(() => {
      if (navigated) return;
      setLoading(false);
      inFlight.current = false;
      // Soft message only — never "Failed to fetch"
      setError(
        offlineNow || (typeof navigator !== "undefined" && navigator.onLine === false)
          ? "You're offline. Open the app online once, then you can use it offline."
          : "Sign-in is taking longer than usual. Please try again.",
      );
    }, hardCeilingMs);

    try {
      const schoolCode = code.trim().toUpperCase();
      const ident = identifier.trim();
      const pass = password;
      const looksEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ident);

      try {
        // Always try client Supabase login first (APK has no reliable SSR; website benefits too)
        {
          const nativeResult = await Promise.race([
            clientSignInWithSchoolCode({
              schoolCode: schoolCode || "",
              identifier: ident,
              password: pass,
            }),
            new Promise<null>((resolve) =>
              setTimeout(() => resolve(null), nativeShell ? 4_500 : 8_000),
            ),
          ]);
          if (nativeResult && "ok" in nativeResult && nativeResult.ok && nativeResult.accessToken) {
            const { error: sessErr } = await supabase.auth.setSession({
              access_token: nativeResult.accessToken,
              refresh_token: nativeResult.refreshToken || "",
            });
            if (!sessErr) {
              try {
                if (nativeResult.schoolId) {
                  seedLoginSchoolContext(nativeResult.schoolId, nativeResult.schoolCode || schoolCode);
                } else if (schoolCode) {
                  await seedSchoolFromCode(schoolCode);
                }
              } catch { /* ignore */ }
              if (await resolveRoleAndGoHome()) {
                navigated = true;
                return;
              }
              // Session is valid — never leave user stuck on login
              navigated = true;
              await goToRoleHome(readPreferredRole() || "student", remember);
              return;
            }
          } else if (nativeResult && "error" in nativeResult && nativeResult.error) {
            lastServerMsg = String(nativeResult.error);
            // Fatal client errors (wrong school / invalid key) — do not mask with server path
            const fatal = String(nativeResult.error).toLowerCase();
            if (
              fatal.includes("school code not found") ||
              fatal.includes("invalid api key") ||
              fatal.includes("invalid email") ||
              fatal.includes("invalid credentials") ||
              fatal.includes("invalid password")
            ) {
              setError(String(nativeResult.error));
              return;
            }
          }
        }

        // APK / native: never depend on Vercel server functions — client login only
        const result = isNativeShell()
          ? null
          : await Promise.race([
              loginFn({
                data: {
                  schoolCode: schoolCode || "",
                  identifier: ident,
                  password: pass,
                },
              }),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 5_000)),
            ]);

        if (result && "session" in result && result.session?.access_token) {
          if (result.role && result.role in roleHome) {
            try {
              seedPendingLoginRole(String(result.role));
            } catch {
              /* ignore */
            }
          }
          const loginSchool = {
            schoolId: (result as { schoolId?: string | null }).schoolId || null,
            schoolCode: (result as { schoolCode?: string | null }).schoolCode || schoolCode || null,
          };
          try {
            if (loginSchool.schoolId) {
              seedLoginSchoolContext(loginSchool.schoolId, loginSchool.schoolCode);
            } else if (schoolCode) {
              await seedSchoolFromCode(schoolCode);
            }
          } catch {
            /* ignore */
          }
          const { error: sessErr } = await supabase.auth.setSession({
            access_token: result.session.access_token,
            refresh_token: result.session.refresh_token,
          });
          if (!sessErr) {
            if (result.role && result.role in roleHome) {
              navigated = true;
              await goToRoleHome(String(result.role), remember, loginSchool);
              return;
            }
            await seedSchoolFromCode(schoolCode);
            if (await resolveRoleAndGoHome()) {
              navigated = true;
              return;
            }
            // Session exists — never bounce back to login form
            navigated = true;
            await goToRoleHome(
              readPreferredRole() || readPendingLoginRole() || "student",
              remember,
              loginSchool,
            );
            return;
          } else if (result.role && result.role in roleHome) {
            navigated = true;
            await goToRoleHome(String(result.role), remember, loginSchool);
            return;
          }
        }
        if (result && "error" in result && result.error) {
          lastServerMsg = String(result.error);
        }
      } catch (serverErr) {
        console.warn("[login] server fn failed, trying client fallback", serverErr);
        lastServerMsg = friendlyLoginError(serverErr);
      }

      // Client-side auth fallback (works even if server fn is slow/unavailable)
      const emailsToTry: string[] = [];
      if (looksEmail) emailsToTry.push(ident.toLowerCase());
      if (!looksEmail && schoolCode) {
        const safeCode = schoolCode.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
        const build = (raw: string) => {
          const safe = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
          const safeDot = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, ".");
          return [
            `${safe}@${safeCode || "school"}.student.d4exam.local`,
            `${safeDot}@placeholder.local`,
            `${safe}@placeholder.local`,
          ];
        };
        for (const em of [...build(ident), ...build(pass)]) {
          if (em && !emailsToTry.includes(em)) emailsToTry.push(em);
        }
      }

      for (const email of emailsToTry) {
        try {
          const authPromise = supabase.auth.signInWithPassword({
            email,
            password: pass,
          });
          const raced = await Promise.race([
            authPromise,
            new Promise<{ data: { session: null }; error: { message: string } }>((resolve) =>
              setTimeout(() => resolve({ data: { session: null }, error: { message: "timeout" } }), 4_000),
            ),
          ]);
          const data = raced.data;
          const authErr = raced.error;
          if (!authErr && data?.session) {
            await seedSchoolFromCode(schoolCode); if (await resolveRoleAndGoHome()) {
              navigated = true;
              return;
            }
            if (looksEmail) {
              navigated = true;
              await goToRoleHome("school_admin", remember);
              return;
            }
          }
          if (authErr?.message && authErr.message !== "timeout") lastServerMsg = authErr.message;
        } catch {
          /* try next */
        }
      }

      if (looksEmail && !isNativeShell()) {
        try {
          const fixed = await Promise.race([
            ensureLoginFn({
              data: {
                email: ident.toLowerCase(),
                password: pass,
                schoolCode: schoolCode || null,
              },
            }),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 6_000)),
          ]);
          if (fixed && "ok" in fixed && fixed.ok) {
            const { data: again, error: againErr } = await supabase.auth.signInWithPassword({
              email: ident.toLowerCase(),
              password: pass,
            });
            if (!againErr && again.session) {
              await seedSchoolFromCode(schoolCode); if (await resolveRoleAndGoHome()) {
                navigated = true;
                return;
              }
              navigated = true;
              await goToRoleHome("school_admin", remember);
              return;
            }
          }
        } catch {
          /* ignore */
        }
      }

      // Soft offline resume before any error (network may have dropped mid-login)
      try {
        if (await tryOfflineResume()) {
          navigated = true;
          return;
        }
      } catch { /* ignore */ }
      // Never show raw Failed / network spam
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        setError(
          "You're offline. Sign in once while online, then the app works offline.",
        );
      } else {
        setError(friendlyLoginError(lastServerMsg || "Invalid login credentials."));
      }
    } catch (err) {
      console.error("[login] sign-in failed:", err);
      setError(friendlyLoginError(err));
    } finally {
      window.clearTimeout(loginTimeout);
      // Always release the button. Successful navigations leave the page;
      // if replace is delayed, user can still retry after a short moment.
      if (!navigated) {
        setLoading(false);
        inFlight.current = false;
      } else {
        // Safety: if navigation is slow, unstick after 2s
        window.setTimeout(() => {
          setLoading(false);
          inFlight.current = false;
        }, 2_000);
      }
    }
  }

  const heading = isSwitchRefresh
    ? "Refresh account"
    : isAddAccount
      ? "Add account"
      : "Sign in";
  const sub =
    isSwitchRefresh
      ? "Sign in once to refresh this saved account on this device."
      : isAddAccount
        ? "Sign in with another D4EXAM account. Existing accounts stay on this device."
        : "Enter your credentials to continue.";

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto grid min-h-screen max-w-6xl lg:grid-cols-2">
        <div className="relative hidden overflow-hidden bg-slate-950 lg:flex lg:flex-col lg:justify-between lg:p-12">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-blue-600/30 via-slate-950 to-slate-950" />
          <div className="relative">
            <Logo className="h-10 w-auto text-white" />
            <p className="mt-8 max-w-sm text-lg font-semibold leading-snug text-white">
              Examination platform for modern schools
            </p>
            <p className="mt-3 max-w-sm text-sm text-slate-300">
              Secure CBT, results, and school operations in one place.
            </p>
          </div>
          <div className="relative grid gap-4">
            {features.map((f) => (
              <div key={f.title} className="flex gap-3 rounded-xl border border-white/10 bg-white/5 p-4">
                <f.icon className="mt-0.5 h-5 w-5 shrink-0 text-blue-300" />
                <div>
                  <p className="text-sm font-semibold text-white">{f.title}</p>
                  <p className="text-xs text-slate-300">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col justify-center px-4 py-10 sm:px-8">
          <div className="mx-auto w-full max-w-md">
            <div className="mb-8 flex items-center gap-2 lg:hidden">
              <Logo className="h-9 w-auto" />
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">{heading}</h1>
            <p className="mt-1 text-sm text-slate-500">{sub}</p>
            {savedCount > 0 ? (
              <p className="mt-2 text-xs font-medium text-slate-500">
                {savedCount} account{savedCount === 1 ? "" : "s"} saved on this device — switch
                anytime from Settings.
              </p>
            ) : null}

            {error ? (
              <Alert variant="destructive" className="mt-4">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="school-code">School code</Label>
                <Input
                  id="school-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="e.g. ABC123"
                  className="h-11"
                  autoComplete="organization"
                  disabled={loading}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="identifier">Email / matric / staff ID</Label>
                <Input
                  id="identifier"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="you@email.com or matric number"
                  className="h-11"
                  autoComplete="username"
                  required
                  disabled={loading}
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <Link
                    to="/forgot-password"
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-11 pr-10"
                    autoComplete="current-password"
                    required
                    disabled={loading}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
                    onClick={() => setShowPassword((v) => !v)}
                    tabIndex={-1}
                    disabled={loading}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="remember"
                  checked={remember}
                  onCheckedChange={(v) => setRemember(v === true)}
                  disabled={loading}
                />
                <Label htmlFor="remember" className="text-sm font-normal text-slate-600">
                  Save this account on this device (for quick switch)
                </Label>
              </div>
              <Button type="submit" className="h-11 w-full font-semibold" disabled={loading}>
                {loading ? (
                  <>
                    <img src="/logo.png" alt="" className="mr-2 h-5 w-5 object-contain opacity-90" />{" "}
                    Signing in…
                  </>
                ) : (
                  <>
                    {isSwitchRefresh ? "Refresh & continue" : isAddAccount ? "Add account" : "Sign in"}{" "}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </form>

            <p className="mt-6 text-center text-sm text-slate-500">
              New institution?{" "}
              <Link to="/school-application" className="font-semibold text-primary hover:underline">
                Apply for school
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
