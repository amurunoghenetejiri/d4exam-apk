import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { initLocalDb, getLocalDbCapability } from "@/lib/local-db";

/**
 * Initializes local SQLite (native) or memory fallback (web).
 * Does not alter UI/UX. Safe no-op if init fails.
 */
export function LocalDbBootstrap() {
  useEffect(() => {
    let cancelled = false;
    const native = Capacitor.isNativePlatform();
    // Native APK: init SQLite immediately so offline login can resume without freeze
    const delay = native ? 0 : 400;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          await initLocalDb({ forceMemory: !native });
          if (!cancelled && typeof console !== "undefined") {
            const cap = getLocalDbCapability();
            if (cap.available) {
              console.info("[local-db] ready", cap.backend, cap.dbName, `v${cap.version}`);
            }
          }
        } catch (e) {
          console.warn("[local-db] bootstrap failed", e);
        }
      })();
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);
  return null;
}
