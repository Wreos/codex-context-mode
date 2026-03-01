import { strict as assert } from "node:assert";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PolyglotExecutor } from "../src/executor.js";
import { detectRuntimes } from "../src/runtime.js";

let passed = 0;
let failed = 0;
const results: {
  name: string;
  status: "PASS" | "FAIL";
  time: number;
  error?: string;
}[] = [];

async function test(name: string, fn: () => Promise<void>) {
  const start = performance.now();
  try {
    await fn();
    const time = performance.now() - start;
    passed++;
    results.push({ name, status: "PASS", time });
    console.log(`  \u2713 ${name} (${time.toFixed(0)}ms)`);
  } catch (err: any) {
    const time = performance.now() - start;
    failed++;
    results.push({ name, status: "FAIL", time, error: err.message });
    console.log(`  \u2717 ${name} (${time.toFixed(0)}ms)`);
    console.log(`    Error: ${err.message}`);
  }
}

async function main() {
  const runtimes = detectRuntimes();

  console.log("\nStream-Level Byte Cap Tests (QA Review)");
  console.log("========================================\n");

  console.log("--- Stdout Cap ---\n");

  await test("stdout: process killed when output exceeds hard cap", async () => {
    const executor = new PolyglotExecutor({ hardCapBytes: 1024, runtimes });
    const r = await executor.execute({
      language: "javascript",
      code: 'for (let i = 0; i < 4000; i++) console.log("x".repeat(25));',
      timeout: 10_000,
    });
    assert.ok(r.stderr.includes("output capped"), "Expected cap message in stderr, got: " + r.stderr.slice(-200));
    assert.ok(r.stderr.includes("process killed"), "Expected 'process killed' in stderr");
  });

  console.log("\n--- Stderr Cap ---\n");

  await test("stderr: process killed when stderr exceeds hard cap", async () => {
    const executor = new PolyglotExecutor({ hardCapBytes: 1024, runtimes });
    const r = await executor.execute({
      language: "javascript",
      code: 'for (let i = 0; i < 4000; i++) console.error("e".repeat(25));',
      timeout: 10_000,
    });
    assert.ok(r.stderr.includes("output capped"), "Expected cap message in stderr for stderr-heavy output");
  });

  console.log("\n--- Combined Cap ---\n");

  await test("combined: cap triggers on total stdout+stderr bytes", async () => {
    const executor = new PolyglotExecutor({ hardCapBytes: 2048, runtimes });
    const r = await executor.execute({
      language: "javascript",
      code: 'for (let i = 0; i < 200; i++) process.stdout.write("o".repeat(10) + "\\n");\nfor (let i = 0; i < 200; i++) process.stderr.write("e".repeat(10) + "\\n");',
      timeout: 10_000,
    });
    assert.ok(r.stderr.includes("output capped"), "Combined output should have triggered the cap");
  });

  console.log("\n--- Normal Operation ---\n");

  await test("normal: small output below cap works correctly", async () => {
    const executor = new PolyglotExecutor({ hardCapBytes: 1024 * 1024, runtimes });
    const r = await executor.execute({
      language: "javascript",
      code: 'console.log("hello from capped executor");',
    });
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes("hello from capped executor"));
    assert.ok(!r.stderr.includes("output capped"), "Should NOT contain cap message for small output");
  });

  await test("normal: moderate output below cap preserves all content", async () => {
    const executor = new PolyglotExecutor({ hardCapBytes: 1024 * 1024, runtimes });
    const r = await executor.execute({
      language: "javascript",
      code: 'for (let i = 0; i < 50; i++) console.log("line-" + i);',
    });
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes("line-0"), "Should contain first line");
    assert.ok(r.stdout.includes("line-49"), "Should contain last line");
    assert.ok(!r.stderr.includes("output capped"));
  });

  console.log("\n--- Memory Bounding ---\n");

  await test("memory: collected stdout bytes stay bounded near cap", async () => {
    const capBytes = 4096;
    const executor = new PolyglotExecutor({ hardCapBytes: capBytes, runtimes });
    const r = await executor.execute({
      language: "javascript",
      code: 'for (let i = 0; i < 20000; i++) console.log("x".repeat(25));',
      timeout: 10_000,
    });
    assert.ok(r.stderr.includes("output capped"), "Cap should have triggered");
    const stdoutBytes = Buffer.byteLength(r.stdout);
    const tolerance = 256 * 1024;
    assert.ok(stdoutBytes < capBytes + tolerance, "Collected " + stdoutBytes + " bytes stdout; expected bounded near " + capBytes);
  });

  console.log("\n--- Cap Message Format ---\n");

  await test("format: cap message reports correct MB value for 2MB cap", async () => {
    const twoMB = 2 * 1024 * 1024;
    const executor = new PolyglotExecutor({ hardCapBytes: twoMB, runtimes });
    const r = await executor.execute({
      language: "javascript",
      code: 'for (let i = 0; i < 100000; i++) process.stdout.write("x".repeat(49) + "\\n");',
      timeout: 10_000,
    });
    assert.ok(r.stderr.includes("2MB"), "Expected '2MB' in cap message: " + r.stderr.slice(-200));
    assert.ok(r.stderr.includes("process killed"));
  });

  await test("format: cap message uses em dash and bracket format", async () => {
    const executor = new PolyglotExecutor({ hardCapBytes: 1024, runtimes });
    const r = await executor.execute({
      language: "javascript",
      code: 'for (let i = 0; i < 4000; i++) console.log("x".repeat(25));',
      timeout: 10_000,
    });
    assert.ok(r.stderr.includes("\u2014"), "Cap message should use em dash");
    assert.ok(r.stderr.includes("[output capped at"), "Cap message should start with '[output capped at'");
  });

  console.log("\n--- Timeout Independence ---\n");

  await test("timeout: still fires when output is slow and under cap", async () => {
    const executor = new PolyglotExecutor({ hardCapBytes: 100 * 1024 * 1024, runtimes });
    const r = await executor.execute({
      language: "javascript",
      code: "while(true) {}",
      timeout: 500,
    });
    assert.equal(r.timedOut, true);
    assert.ok(!r.stderr.includes("output capped"), "Should be timeout, not cap");
  });

  await test("timeout: cap fires before timeout for fast-producing process", async () => {
    const executor = new PolyglotExecutor({ hardCapBytes: 1024, runtimes });
    const r = await executor.execute({
      language: "javascript",
      code: 'for (let i = 0; i < 100000; i++) console.log("x".repeat(50));',
      timeout: 10_000,
    });
    assert.ok(r.stderr.includes("output capped"), "Cap should fire before timeout");
    assert.equal(r.timedOut, false, "timedOut should be false when cap killed the process");
  });

  console.log("\n--- Default Cap ---\n");

  await test("default: executor works with default hardCapBytes (no option)", async () => {
    const executor = new PolyglotExecutor({ runtimes });
    const r = await executor.execute({
      language: "javascript",
      code: 'console.log("default cap works");',
    });
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes("default cap works"));
  });

  console.log("\n--- Smart Truncation Interaction ---\n");

  await test("truncation: hardCap and maxOutputBytes work together", async () => {
    const executor = new PolyglotExecutor({ hardCapBytes: 50 * 1024, maxOutputBytes: 1024, runtimes });
    const r = await executor.execute({
      language: "javascript",
      code: 'for (let i = 0; i < 4000; i++) console.log("x".repeat(25));',
      timeout: 10_000,
    });
    assert.ok(r.stderr.includes("output capped"), "Hard cap should trigger");
    const stdoutBytes = Buffer.byteLength(r.stdout);
    assert.ok(stdoutBytes < 50 * 1024, "Final stdout should be truncated by smartTruncate, got " + stdoutBytes + " bytes");
  });

  console.log("\n--- Cross-Language Cap ---\n");

  await test("shell: cap works with shell scripts", async () => {
    const executor = new PolyglotExecutor({ hardCapBytes: 2048, runtimes });
    const r = await executor.execute({
      language: "shell",
      code: 'yes "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" | head -c 100000',
      timeout: 10_000,
    });
    assert.ok(r.stderr.includes("output capped"), "Cap should trigger for shell output");
  });

  if (runtimes.python) {
    await test("python: cap works with python scripts", async () => {
      const executor = new PolyglotExecutor({ hardCapBytes: 2048, runtimes });
      const r = await executor.execute({
        language: "python",
        code: 'import sys\nfor i in range(10000):\n    sys.stdout.write("x" * 50 + "\\n")',
        timeout: 10_000,
      });
      assert.ok(r.stderr.includes("output capped"), "Cap should trigger for python output");
    });
  }

  console.log("\n--- Interleaved Output ---\n");

  await test("interleaved: rapid alternating stdout/stderr triggers cap", async () => {
    const executor = new PolyglotExecutor({ hardCapBytes: 4096, runtimes });
    const r = await executor.execute({
      language: "javascript",
      code: 'for (let i = 0; i < 5000; i++) { if (i % 2 === 0) process.stdout.write("out" + i + "\\n"); else process.stderr.write("err" + i + "\\n"); }',
      timeout: 10_000,
    });
    assert.ok(r.stderr.includes("output capped"), "Interleaved output should trigger cap");
  });

  console.log("\n--- 100MB Real Cap ---\n");

  await test("100MB: default cap fires at 100MB — process killed, not OOM", async () => {
    const hundredMB = 100 * 1024 * 1024;
    const executor = new PolyglotExecutor({ hardCapBytes: hundredMB, runtimes });
    const startMem = process.memoryUsage().rss;

    const r = await executor.execute({
      language: "shell",
      // Generate ~200MB of output quickly — cap should fire at 100MB
      code: 'dd if=/dev/zero bs=1048576 count=200 2>/dev/null | tr "\\0" "x"',
      timeout: 60_000,
    });

    assert.ok(
      r.stderr.includes("output capped"),
      `Expected cap message, got stderr: ${r.stderr.slice(-200)}`,
    );
    assert.ok(
      r.stderr.includes("100MB"),
      `Expected '100MB' in cap message: ${r.stderr.slice(-200)}`,
    );
    assert.ok(
      r.stderr.includes("process killed"),
      "Expected 'process killed' in cap message",
    );

    const stdoutBytes = Buffer.byteLength(r.stdout);
    const stdoutMB = stdoutBytes / 1024 / 1024;
    // Collected stdout should be bounded at cap — not accumulate all 200MB
    assert.ok(
      stdoutMB < 110,
      `Collected ${stdoutMB.toFixed(1)}MB stdout — expected bounded near 100MB cap`,
    );

    const memGrowthMB = (process.memoryUsage().rss - startMem) / 1024 / 1024;
    console.log(`    stdout collected: ${stdoutMB.toFixed(1)}MB`);
    console.log(`    memory growth:    ${memGrowthMB.toFixed(0)}MB`);
  });

  await test("100MB: JS tight loop generating 150MB is capped — not OOM", async () => {
    const hundredMB = 100 * 1024 * 1024;
    const executor = new PolyglotExecutor({ hardCapBytes: hundredMB, runtimes });
    const startMem = process.memoryUsage().rss;

    const r = await executor.execute({
      language: "javascript",
      // Write 4KB chunks in a tight loop — aims for 150MB total
      code: `const chunk = Buffer.alloc(4096, 88); // 'X'
let written = 0;
const target = 150 * 1024 * 1024;
while (written < target) {
  process.stdout.write(chunk);
  written += chunk.length;
}`,
      timeout: 60_000,
    });

    const peakMem = process.memoryUsage().rss;
    const memGrowthMB = (peakMem - startMem) / 1024 / 1024;

    assert.ok(
      r.stderr.includes("output capped"),
      `Expected cap, got: ${r.stderr.slice(-200)}`,
    );
    assert.equal(r.timedOut, false, "Should be killed by cap, not timeout");
    assert.ok(
      memGrowthMB < 150,
      `Memory grew ${memGrowthMB.toFixed(0)}MB — expected bounded near 100MB`,
    );

    console.log(`    memory growth: ${memGrowthMB.toFixed(0)}MB`);
  });

  await test("100MB: python generating 120MB is capped correctly", async () => {
    if (!runtimes.python) {
      console.log("    SKIP: python not available");
      return;
    }
    const hundredMB = 100 * 1024 * 1024;
    const executor = new PolyglotExecutor({ hardCapBytes: hundredMB, runtimes });

    const r = await executor.execute({
      language: "python",
      code: `import sys
chunk = b'x' * 65536  # 64KB chunks
written = 0
target = 120 * 1024 * 1024
while written < target:
    sys.stdout.buffer.write(chunk)
    written += len(chunk)`,
      timeout: 60_000,
    });

    assert.ok(
      r.stderr.includes("output capped"),
      `Expected cap, got: ${r.stderr.slice(-200)}`,
    );
    assert.equal(r.timedOut, false, "Should be cap-killed, not timed out");
  });

  await test("100MB: normal 50MB output below cap passes through intact", async () => {
    const hundredMB = 100 * 1024 * 1024;
    const executor = new PolyglotExecutor({
      hardCapBytes: hundredMB,
      maxOutputBytes: hundredMB,
      runtimes,
    });

    const r = await executor.execute({
      language: "shell",
      // 50MB — below the cap, should complete normally
      code: 'dd if=/dev/zero bs=1048576 count=50 2>/dev/null | tr "\\0" "x"',
      timeout: 60_000,
    });

    assert.ok(
      !r.stderr.includes("output capped"),
      "50MB should NOT trigger the 100MB cap",
    );
    const stdoutMB = Buffer.byteLength(r.stdout) / 1024 / 1024;
    assert.ok(stdoutMB > 45, `Expected ~50MB stdout, got ${stdoutMB.toFixed(1)}MB`);
    console.log(`    stdout: ${stdoutMB.toFixed(1)}MB — passed through intact`);
  });

  console.log("\n--- executeFile Cap ---\n");

  await test("executeFile: cap applies to file execution too", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cap-test-"));
    const testFile = join(tmpDir, "data.txt");
    writeFileSync(testFile, "test content", "utf-8");

    try {
      const executor = new PolyglotExecutor({ hardCapBytes: 1024, runtimes });
      const r = await executor.executeFile({
        path: testFile,
        language: "javascript",
        code: 'for (let i = 0; i < 4000; i++) console.log("x".repeat(25));',
        timeout: 10_000,
      });
      assert.ok(r.stderr.includes("output capped"), "executeFile should also respect the hard cap");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // ===== SUMMARY =====
  console.log("\n" + "=".repeat(50));
  console.log("Results: " + passed + " passed, " + failed + " failed (" + (passed + failed) + " total)");
  console.log("=".repeat(50));

  if (failed > 0) {
    console.log("\nFailed tests:");
    for (const r of results.filter((r) => r.status === "FAIL")) {
      console.log("  \u2717 " + r.name + ": " + r.error);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
