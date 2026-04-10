import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();
const cliPath = path.join(projectRoot, "src", "cli.ts");

test("help output mentions list, bind, watch, and daemon", async () => {
  const { stdout } = await execFileAsync("npx", ["tsx", cliPath, "--help"], {
    cwd: projectRoot,
  });

  assert.match(stdout, /\blist\b/);
  assert.match(stdout, /\bbind\b/);
  assert.match(stdout, /\bwatch\b/);
  assert.match(stdout, /\bdaemon\b/);
});
