// 把 src 同步为 lib。本包是纯 JS（ESM）插件，无 TS 编译步骤，
// 改动 src/index.js 或 src/client.js 后运行 `node scripts/sync.mjs`（或 `npm run build`）。
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "lib"), { recursive: true });
cpSync(join(root, "src", "index.js"), join(root, "lib", "index.js"));
cpSync(join(root, "src", "client.js"), join(root, "lib", "client.js"));
console.log("synced src -> lib");
