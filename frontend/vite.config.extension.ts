import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [
    crx({
      manifest: {
        manifest_version: 3,
        name: "PRobe",
        version: "1.0.0",
        description: "GitHub PR analyzer - Spam detection & review assistance",
        icons: {
          "16": "/icons/icon16.png",
          "32": "/icons/icon32.png",
          "48": "/icons/icon48.png",
          "128": "/icons/icon128.png"
        },
        permissions: ["storage", "scripting"],
        host_permissions: [
          "https://github.com/*",
          "http://localhost:4000/*",
          "https://pr0be.onrender.com/*"
        ],
        content_scripts: [
          {
            matches: ["https://github.com/*/pull/*"],
            js: ["content-script.js"],
            css: ["content-script.css"],
            run_at: "document_idle"
          }
        ],
        action: {
          default_popup: "popup.html",
          default_icon: {
            "16": "/icons/icon16.png",
            "32": "/icons/icon32.png",
            "48": "/icons/icon48.png"
          }
        },
        options_page: "options.html",
        background: {
          service_worker: "background.js"
        },
        web_accessible_resources: [
          {
            resources: [
              "icons/icon16.png",
              "icons/icon32.png",
              "icons/icon48.png",
              "icons/icon128.png"
            ],
            matches: ["<all_urls>"]
          }
        ]
      }
    }),
    react()
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src")
    }
  },
  build: {
    outDir: path.resolve(__dirname, "../extension/dist"),
    emptyOutDir: true
  }
});