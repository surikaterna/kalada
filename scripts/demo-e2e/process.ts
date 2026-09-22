import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { DEMO_BASE, LOCAL_ORIGIN, ROOT } from "./config.js";

export interface PreviewProcess {
  readonly child: ChildProcessWithoutNullStreams;
  readonly output: () => string;
}

export function startPreview(): PreviewProcess {
  const child = spawn("bun", ["scripts/demo-e2e/preview.ts"], {
    cwd: ROOT,
    env: { ...process.env, DEMO_BASE },
    stdio: "pipe",
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += String(chunk);
  });
  return { child, output: () => output };
}

export async function waitForPreview(preview: PreviewProcess): Promise<void> {
  const target = `${LOCAL_ORIGIN}${DEMO_BASE}`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (preview.child.exitCode !== null || preview.child.signalCode !== null) {
      throw new Error(`Preview exited before readiness: ${preview.output()}`);
    }
    try {
      const response = await fetch(target);
      if (response.ok) {
        await assertNoFallback();
        return;
      }
    } catch {}
    await delay(100);
  }
  throw new Error(`Preview readiness timed out: ${preview.output()}`);
}

async function assertNoFallback(): Promise<void> {
  const missing = await fetch(`${LOCAL_ORIGIN}${DEMO_BASE}unsupported-route`);
  const root = await fetch(LOCAL_ORIGIN, { redirect: "manual" });
  if (missing.status !== 404 || root.status !== 404) {
    throw new Error("Strict preview exposed an unsupported SPA/root fallback");
  }
}

export async function stopPreview(preview: PreviewProcess): Promise<void> {
  if (preview.child.exitCode === null && preview.child.signalCode === null)
    preview.child.kill("SIGTERM");
  const exited = await waitForExit(preview.child, 5_000);
  if (!exited) {
    preview.child.kill("SIGKILL");
    if (!(await waitForExit(preview.child, 2_000))) throw new Error("Preview ignored SIGKILL");
  }
  if (preview.child.exitCode !== 0) {
    throw new Error(`Preview did not exit cleanly: ${preview.output()}`);
  }
}

async function waitForExit(
  child: ChildProcessWithoutNullStreams,
  timeout: number,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return await new Promise((resolveExit) => {
    const timer = setTimeout(() => resolveExit(false), timeout);
    child.once("exit", () => {
      clearTimeout(timer);
      resolveExit(true);
    });
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
