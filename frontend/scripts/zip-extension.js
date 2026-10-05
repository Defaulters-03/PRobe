const fs = require("fs");
const path = require("path");
const archiver = require("archiver");

// Paths
const extensionRoot = path.join(__dirname, "..", "extension");
const distDir = path.join(extensionRoot, "dist");
const manifestPath = path.join(extensionRoot, "manifest.json");
const outputZip = path.join(extensionRoot, "pr0be-extension-v1.0.0.zip");

console.log("Bundling PRobe Chrome extension...");

// Ensure dist dir exists
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Copy files from extension root to dist (this is where crxjs/vite-plugin
// would also output its assets if the extension is built via Vite)
function copyFileSyncs(src, dest, excluded = new Set()) {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (excluded.has(entry.name)) {
      continue;
    }

    if (entry.isDirectory()) {
      if (!fs.existsSync(destPath)) {
        fs.mkdirSync(destPath, { recursive: true });
      }
      copyFileSyncs(srcPath, destPath, excluded);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

const excludedDirs = new Set(["node_modules"]);
copyFileSyncs(extensionRoot, distDir, excludedDirs);

// Create the zip
const output = fs.createWriteStream(outputZip);
const archive = archiver("zip", { zlib: { level: 9 } });

archive.on("error", (err) => {
  throw err;
});

archive.pipe(output);
archive.directory(distDir, false);

archive.on("finish", () => {
  console.log(`Extension bundled successfully: ${outputZip}`);
  console.log(`Size: ${(archive.pointer() / 1024).toFixed(2)} KB`);
});

archive.finalize();