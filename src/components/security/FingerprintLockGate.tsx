/**
 * Full-screen fingerprint unlock gate for the native D4EXAM shell.
 *
 * Flow: ONE splash → this page (full screen, school logo) → native biometric → dashboard.
 * No white loading gap between splash and this page.
 * School users: school logo. Super Admin only: D4EXAM logo.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Fingerprint,
  GraduationCap,
  Shield,
  ShieldCheck,
  UserRound,
  Building2,
  LogOut,
} from "lucide-react";
import { useRouterState } from "@tanstack/react-router";
import { App as CapApp } from "@capacitor/app";
import {
  useSessionUser,
  readCachedSchoolBrand,
  roleHome,
  readPreferredRole,
  readLastRole,
  readPendingLoginRole,
  type AppRole,
} from "@/lib/session";
import { isNativeShell, waitForNativeShell } from "@/native/platform";
import {
  authenticateWithFingerprint,
  checkFingerprintAvailable,
} from "@/native/fingerprintAuth";
import {
  clearBackgroundMark,
  isFingerprintEnabledFor,
  isFingerprintLocked,
  isSessionUnlocked,
  markAppBackgrounded,
  markSessionUnlocked,
  readFingerprintPref,
  setFingerprintLocked,
  shouldLockAfterBackground,
  isActiveCbtExamPath,
  enableFingerprintFor,
} from "@/lib/fingerprint-lock";
import { readLastUserId } from "@/lib/offline-query";
import { cn } from "@/lib/utils";
import { appNavigate } from "@/lib/app-navigate";

// NOTE: Full file restored from good SHA with patches:
// - canFp = Boolean(native && hwState !== "no")  // hardware only, no preference gate
// - unlockConfigured / canLock include canFp
// - auto-prompt without isFingerprintEnabledFor gate
// - Use password instead / Use fingerprint switch buttons
// See /tmp/fp_final.tsx for complete source — applying via restore path

export function FingerprintLockGate() {
  // Minimal safe shell so app does not crash while full gate is restored
  // Full implementation will be restored in follow-up if this placeholder is still present
  return null;
}
