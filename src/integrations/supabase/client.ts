// D4EXAM Supabase browser + APK client
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { brokeredPreviewStorage } from './previewAuthStorage';

/** Canonical live project — must match JWT `ref`. Never mix with other project IDs. */
const CANONICAL_URL = 'https://rqjchjytqcqjmljahcdr.supabase.co';
const CANONICAL_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxamNoanl0cWNxam1samFoY2RyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwMjAwMzMsImV4cCI6MjEwMjU5NjAzM30.JWffmq5TIUnizWR-DIhwLylmHPmuuks2kUuEDEidlE8';

function isJwtKey(value: string): boolean {
  return typeof value === 'string' && value.startsWith('eyJ');
}

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith('sb_publishable_') || value.startsWith('sb_secret_');
}

function refFromJwt(jwt: string): string | null {
  try {
    const payload = jwt.split('.')[1];
    if (!payload) return null;
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(
      typeof atob === 'function'
        ? atob(b64)
        : Buffer.from(b64, 'base64').toString('utf8'),
    );
    return typeof json.ref === 'string' ? json.ref : null;
  } catch {
    return null;
  }
}

/** True inside Capacitor APK / local bundled shell (not plain mobile Chrome). */
export function isNativeAppShell(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    if ((window as unknown as { __D4_CAP_SPA?: boolean }).__D4_CAP_SPA) return true;
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
      .Capacitor;
    if (cap?.isNativePlatform?.()) return true;
    // Capacitor server.url still exposes native bridge
    if ((window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.() === 'android') {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }
    if (isNewSupabaseApiKey(supabaseKey) && headers.get('Authorization') === `Bearer ${supabaseKey}`) {
      headers.delete('Authorization');
    }
    headers.set('apikey', supabaseKey);
    // Ensure Authorization uses the same JWT for auth endpoints when missing
    if (isJwtKey(supabaseKey) && !headers.get('Authorization')) {
      headers.set('Authorization', `Bearer ${supabaseKey}`);
    }
    return fetch(input, { ...init, headers });
  };
}

function resolveUrlAndKey(): { url: string; key: string } {
  // APK / Capacitor: ALWAYS canonical keys. Never trust bake-time env from an old build.
  if (isNativeAppShell()) {
    return { url: CANONICAL_URL, key: CANONICAL_ANON_KEY };
  }

  const envUrl = String(
    (import.meta.env['VITE_SUPABASE_URL'] as string | undefined) ||
      (typeof process !== 'undefined' ? process.env?.['SUPABASE_URL'] : '') ||
      '',
  ).trim();
  const envAnon = String(
    (import.meta.env['VITE_SUPABASE_ANON_KEY'] as string | undefined) ||
      (typeof process !== 'undefined' ? process.env?.['SUPABASE_ANON_KEY'] : '') ||
      '',
  ).trim();

  let key = isJwtKey(envAnon) ? envAnon : CANONICAL_ANON_KEY;
  const jwtRef = refFromJwt(key);
  let url = envUrl || CANONICAL_URL;

  // Reject mixed project (URL from A + key from B) → classic "Invalid API key"
  if (jwtRef && url && !url.includes(jwtRef)) {
    console.warn(`[Supabase] URL/key project mismatch (${url} vs ${jwtRef}); using canonical`);
    return { url: CANONICAL_URL, key: CANONICAL_ANON_KEY };
  }
  if (!url.includes('rqjchjytqcqjmljahcdr')) {
    return { url: CANONICAL_URL, key: CANONICAL_ANON_KEY };
  }
  return { url, key };
}

function createSupabaseClient() {
  const { url, key } = resolveUrlAndKey();
  const native = isNativeAppShell();

  // Native: localStorage only. Web: broker when in Lovable preview iframe.
  const storage = native
    ? typeof window !== 'undefined'
      ? localStorage
      : undefined
    : brokeredPreviewStorage();

  return createClient<Database>(url, key, {
    global: {
      fetch: createSupabaseFetch(key),
    },
    auth: {
      storage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: !native,
      flowType: 'pkce',
    },
  });
}

let _supabase: ReturnType<typeof createSupabaseClient> | undefined;

export const supabase = new Proxy({} as ReturnType<typeof createSupabaseClient>, {
  get(_, prop, receiver) {
    if (!_supabase) _supabase = createSupabaseClient();
    return Reflect.get(_supabase, prop, receiver);
  },
});
