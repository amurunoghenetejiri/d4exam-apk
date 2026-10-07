import type { CapacitorConfig } from "@capacitor/cli";

/**
 * D4EXAM Capacitor Android — 100% STANDALONE APK (local bundled assets).
 *
 * Runtime:
 *   APK → native splash → dist/ (webDir) via https://localhost → JS SPA
 *   → local SQLite / IndexedDB first → Supabase when online
 *
 * NEVER set server.url — that would force the WebView to load Vercel.
 * scripts/force-local-capacitor-assets.py enforces the same on CI.
 */
const config: CapacitorConfig = {
  appId: "com.d4exam.app",
  appName: "D4EXAM",
  webDir: "dist",
  server: {
    androidScheme: "https",
    cleartext: false,
    hostname: "localhost",
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
      launchAutoHide: false,
      backgroundColor: "#0b1b3a",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
      launchFadeOutDuration: 250,
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
