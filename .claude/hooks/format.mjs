// PostToolUse(Edit|Write) formatter hook. Reads the hook JSON from stdin, formats the edited file with
// rustfmt or prettier when the tool is available, and stays silent otherwise. Never fails the tool call.
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

let input = "";
try {
  input = readFileSync(0, "utf8");
} catch {
  process.exit(0);
}
let file;
try {
  const j = JSON.parse(input);
  file = j?.tool_response?.filePath ?? j?.tool_input?.file_path;
} catch {
  process.exit(0);
}
if (!file || !existsSync(file)) process.exit(0);

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ext = extname(file).toLowerCase();
const run = (cmd, args) => {
  try {
    spawnSync(cmd, args, { stdio: "ignore", shell: process.platform === "win32", timeout: 20000 });
  } catch {
    /* tool missing or failed: ignore */
  }
};

if (ext === ".rs") {
  run("rustfmt", ["--edition", "2021", file]);
} else if ([".ts", ".tsx", ".js", ".mjs", ".css", ".json", ".md", ".html"].includes(ext)) {
  const local = resolve(repo, "node_modules", ".bin", process.platform === "win32" ? "prettier.cmd" : "prettier");
  if (existsSync(local)) run(local, ["--log-level", "silent", "--write", file]);
}
process.exit(0);
