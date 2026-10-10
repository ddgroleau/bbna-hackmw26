/* eslint-disable @typescript-eslint/no-explicit-any */
import { fileURLToPath, URL } from "node:url";

import plugin from "@vitejs/plugin-react";
import child_process from "child_process";
import fs from "fs";
import path from "path";
import { env } from "process";
import { defineConfig } from "vite";

const baseFolder =
  env.APPDATA !== undefined && env.APPDATA !== ""
    ? `${env.APPDATA}/ASP.NET/https`
    : `${env.HOME}/.aspnet/https`;

const certificateName = "bbna-hackmw26.client";
const certFilePath = path.join(baseFolder, `${certificateName}.pem`);
const keyFilePath = path.join(baseFolder, `${certificateName}.key`);

if (!fs.existsSync(baseFolder)) {
  fs.mkdirSync(baseFolder, { recursive: true });
}

if (!fs.existsSync(certFilePath) || !fs.existsSync(keyFilePath)) {
  if (
    0 !==
    child_process.spawnSync(
      "dotnet",
      [
        "dev-certs",
        "https",
        "--export-path",
        certFilePath,
        "--format",
        "Pem",
        "--no-password",
      ],
      { stdio: "inherit" },
    ).status
  ) {
    throw new Error("Could not create certificate.");
  }
}

const target = env.ASPNETCORE_HTTPS_PORT
  ? `https://localhost:${env.ASPNETCORE_HTTPS_PORT}`
  : env.ASPNETCORE_URLS
    ? env.ASPNETCORE_URLS.split(";")[0]
    : "https://localhost:7008";

// API plugin that integrates with the API handler
function apiPlugin() {
  let handleApiRequest: any = null;

  return {
    name: "api-plugin",
    async configureServer(viteServer: any) {
      // Load the API handler
      const { handleApiRequest: handler } = await import("./src/api/index.js");
      handleApiRequest = handler;

      // Middleware that runs BEFORE Vite's default handlers
      viteServer.middlewares.use(async (req: any, res: any, next: any) => {
        try {
          const handled = await handleApiRequest(req, res);
          if (!handled) {
            next();
          }
        } catch (err) {
          console.error("❌ API error:", err);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal server error" }));
        }
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [plugin(), apiPlugin()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    proxy: {
      "^/weatherforecast": {
        target,
        secure: false,
      },
      "^/api": {
        target,
        secure: false,
      },
    },
    port: parseInt(env.DEV_SERVER_PORT || "55630"),
    https: {
      key: fs.readFileSync(keyFilePath),
      cert: fs.readFileSync(certFilePath),
    },
  },
});
