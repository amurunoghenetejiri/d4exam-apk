import type { CapacitorConfig } from "@capacitor/cli";

/**
 * D4EXAM Capacitor Android — standalone APK (local bundled assets).
 *
 * Production runtime:
 *   APK → native splash → dist/ (webDir) → Capacitor bridge → native plugins → Supabase online
 *
 * APK production build injects server.url → https://d4exam.name.ng (live UI from Vercel)
 * while native plugins handle fingerprint, notifications, and screen share.
 * Source config stays without server.url; scripts/force-local-capacitor-assets.py sets hybrid mode.
 */
const config: CapacitorConfig = {
  appId: "com.d4exam.app",
  appName: "D4EXAM",
  webDir: "dist",
  server: {
    androidScheme: "https",
    cleartext: false,
    hostname: "localhost",
    // SPA fallback for deep paths when offline / local shell
    errorPath: "index.html",
    allowNavigation: [
      "*.supabase.co",
      "*.googleapis.com",
      "*.gstatic.com",
      "*.firebaseio.com",
      "*.firebasestorage.app",
      "*.firebaseapp.com",
      "localhost",
    ],
  },
  android: {
    allowMixedContent: false,
    backgroundColor: "#0b1b3a",
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
      launchAutoHide: true,
      backgroundColor: "#0b1b3a",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
      launchFadeOutDuration: 0,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#0b1b3a",
      overlaysWebView: false,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
    LocalNotifications: {
      smallIcon: "ic_stat_d4exam",
      iconColor: "#0b1b3a",
      sound: "default",
    },
  },
};

export default config;
