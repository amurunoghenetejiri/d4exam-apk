import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const stubDir = path.join(rootDir, "scripts", ".cap-stubs");
const pathsFile = path.join(stubDir, "paths.json");

function loadStubPaths() {
  if (fs.existsSync(pathsFile)) {
    return JSON.parse(fs.readFileSync(pathsFile, "utf8")) as {
      stubFile: string;
      nodeStub: string;
    };
  }
  return {
    stubFile: path.join(stubDir, "server-shim.js"),
    nodeStub: path.join(stubDir, "node-shim.js"),
  };
}

function capacitorAliases(): Plugin {
  const { stubFile, nodeStub } = loadStubPaths();

  function shouldStub(id: string): string | null {
    if (!id) return null;
    if (id.startsWith("node:")) return nodeStub;
    if (id === "#tanstack-start-entry" || id === "#tanstack-router-entry") return stubFile;
    if (id.includes("tanstack-start-entry")) return stubFile;
    if (id.includes("@tanstack/start-server-core")) return stubFile;
    if (id.includes("@tanstack/start-storage-context")) return stubFile;
    if (id.includes("@tanstack/react-start/server")) return stubFile;
    if (id.includes("start-server-functions")) return stubFile;
    const cleaned = id.split("?")[0];
    if (/\.server(\.[cm]?[jt]sx?)?$/.test(cleaned)) return stubFile;
    if (/\.functions(\.[cm]?[jt]sx?)?$/.test(cleaned)) return stubFile;
    if (cleaned.endsWith("/server.ts") || cleaned.endsWith("/server.js")) return stubFile;
    if (cleaned.includes("push-send.functions")) return stubFile;
    if (cleaned.includes("student.server")) return stubFile;
    if (cleaned.includes("auth.functions")) return stubFile;
    return null;
  }

  return {
    name: "capacitor-alias-stubs",
    enforce: "pre",
    resolveId(id) {
      const target = shouldStub(id);
      if (target && fs.existsSync(target)) return target;
      if (id.startsWith("@/") && (id.includes(".server") || id.includes(".functions"))) {
        if (fs.existsSync(stubFile)) return stubFile;
      }
      return null;
    },
  };
}

export default defineConfig({
  base: "./",
  root: rootDir,
  plugins: [capacitorAliases(), react(), tailwindcss(), tsconfigPaths()],
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "src"),
    },
    conditions: ["import", "module", "browser", "default"],
    mainFields: ["browser", "module", "main"],
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    "import.meta.env.SSR": "false",
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("https://unojhweoayjxirngcmrm.supabase.co"),
    "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVub2pod2VvYXlqeGlybmdjbXJtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzNzIzMzksImV4cCI6MjEwNjk0ODMzOX0.2uf62fYsG1r7wt675RPpDRTuAPdeyvkX5_hU6hCQucQ",
    ),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
      "sb_publishable_PsyD0VmPUjdcR5swJrXo_g_8-gzqLCi",
    ),
    "import.meta.env.VITE_SUPABASE_PROJECT_ID": JSON.stringify("unojhweoayjxirngcmrm"),
  },
  build: {
    outDir: "dist-capacitor",
    emptyOutDir: true,
    sourcemap: false,
    cssCodeSplit: false,
    target: "es2020",
    commonjsOptions: { transformMixedEsModules: true },
    rollupOptions: {
      input: path.resolve(rootDir, "src/capacitor-main.tsx"),
      output: {
        entryFileNames: "capacitor-app.js",
        chunkFileNames: "cap-[name]-[hash].js",
        assetFileNames: "cap-[name]-[hash][extname]",
      },
      onwarn(warning, warn) {
        if (warning.code === "MODULE_LEVEL_DIRECTIVE") return;
        if (String(warning.message || "").includes("externalized for browser")) return;
        warn(warning);
      },
    },
  },
  optimizeDeps: {
    include: ["react", "react-dom", "@tanstack/react-router", "@tanstack/react-query"],
  },
});
