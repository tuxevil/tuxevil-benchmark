import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Each test file owns a database, including when Vitest reuses a worker.
process.env.SQLITE_PATH = join(tmpdir(), `tuxevil-benchmark-test-${randomUUID()}.db`);
