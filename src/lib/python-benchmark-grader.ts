import { execFile } from "node:child_process";
import { join } from "node:path";

export function runPythonBenchmarkGrader(
  directory: "ifstruct" | "math500",
  executable: string,
  payload: object,
  timeout: number,
): Promise<unknown> {
  const input = JSON.stringify(payload);
  if (Buffer.byteLength(input) > 128 * 1024) return Promise.resolve(null);
  return new Promise((resolve) => {
    const script = join(process.cwd(), "scripts", directory, "grade.py");
    const processHandle = execFile(executable, ["-I", "-B", script], {
      timeout,
      killSignal: "SIGKILL",
      maxBuffer: 64 * 1024,
      env: { NODE_ENV: "production", PATH: process.env.PATH, LC_ALL: "C.UTF-8" },
    }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve(null);
      }
    });
    processHandle.stdin?.on("error", () => resolve(null));
    processHandle.stdin?.end(input);
  });
}
