import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const workspaceRoot = resolve(__dirname, "..", "..");
const dataDir = resolve(workspaceRoot, "data");
const devCsvPath = resolve(dataDir, "2025.csv").replace(/\\/g, "/");

export default defineConfig({
    plugins: [
        solidPlugin(),
        viteStaticCopy({
            targets: [
                {
                    src: resolve(dataDir, "2025.csv"),
                    dest: "data",
                },
                {
                    src: resolve(dataDir, "draft-metrics.json"),
                    dest: "data",
                },
            ],
        }),
    ],
    define: {
        APP_VERSION: JSON.stringify(process.env.npm_package_version),
        __DATA_VIZ_DEV_CSV__: JSON.stringify(devCsvPath),
    },
    server: {
        port: 3000,
        fs: {
            allow: [__dirname, workspaceRoot, dataDir],
        },
    },
    build: {
        target: "esnext",
    },
});

