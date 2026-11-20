import { expect, it } from "vitest";
import { BFCL_MULTITURN_CASES, createBfclFileSystem } from "@/lib/bfcl-v3-multiturn";

it.each(BFCL_MULTITURN_CASES)("replays the upstream reference for $sourceCaseId", (fixture) => {
  const simulator = createBfclFileSystem(fixture);
  const results = fixture.groundTruth.flatMap((turn) => turn.map(({ name, arguments: args }) => simulator.invoke(name, args)));
  expect(results).toEqual([{ current_working_directory: "Documents" }, null, null, { count: 2, type: "words" }]);
  expect(simulator.snapshot()).toEqual({
    directory: "/alex/Documents", files: [["Documents/summary.txt", "quantum computing"]],
  });
});

it("rejects invalid calls and keeps every session isolated", () => {
  const fixture = BFCL_MULTITURN_CASES[0];
  const simulator = createBfclFileSystem(fixture);
  expect(simulator.invoke("cd", { folder: "/etc" })).toEqual({ error: "DIRECTORY_NOT_FOUND" });
  expect(simulator.invoke("touch", { file_name: "../../summary.txt" })).toEqual({ error: "INVALID_FILENAME" });
  expect(simulator.invoke("touch", { file_name: "summary.txt" })).toBeNull();
  expect(simulator.invoke("touch", { file_name: "summary.txt" })).toEqual({ error: "FILE_EXISTS" });
  expect(simulator.invoke("wc", '{"file_name":false}')).toEqual({ error: "INVALID_ARGUMENTS" });
  expect(createBfclFileSystem(fixture).snapshot()).toEqual({ directory: "/alex", files: [] });
});
