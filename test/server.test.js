import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let child;
let baseUrl;

before(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DISABLE_AI: "true" },
    stdio: "ignore"
  });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch (error) {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("test server did not start");
});

after(() => {
  if (child && !child.killed) child.kill();
});

test("only browser assets are publicly served", async () => {
  const home = await fetch(baseUrl);
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /mindCanvas/);
  assert.match(html, /verdictOverlay/);
  assert.match(html, /查看案件完整记录/);
  assert.doesNotMatch(html, /runtimeBadge/);
  for (const file of ["key.txt", "server.js", "case-engine.js", "package.json", ".env.example", "node_modules/express/package.json"]) {
    const response = await fetch(`${baseUrl}/${file}`);
    assert.equal(response.status, 404, `${file} should not be public`);
  }
});

test("case creation never sends hidden answers to the browser", async () => {
  const created = await createCase();
  assert.ok(created.caseFile.subjects.length >= 2 && created.caseFile.subjects.length <= 3);
  assert.equal(created.caseFile.evidence.length, 4);
  assert.doesNotMatch(JSON.stringify(created), /hiddenTruth|guiltyIds|secretRole|privateSecret|knowledgeBoundary|deceptionStrategy|"guilty"|pressure|runtimeMode/);
});

test("a continued exploration does not repeat the previous case background", async () => {
  const first = await createCase();
  const response = await post("/api/cases", { previousCaseIds: [first.caseId] });
  assert.equal(response.status, 201);
  const second = await response.json();
  assert.notEqual(second.caseFile.title, first.caseFile.title);
  assert.notEqual(second.caseFile.publicBrief, first.caseFile.publicBrief);
});

test("four searches cover all subjects and a fifth search is rejected", async () => {
  const created = await createCase();
  const evidenceIds = new Set();
  const subjectIds = created.caseFile.subjects.map((subject) => subject.id);
  const searchTargets = Array.from({ length: 4 }, (_, index) => subjectIds[index % subjectIds.length]);
  for (const subjectId of searchTargets) {
    const response = await post(`/api/cases/${created.caseId}/search`, { subjectId });
    assert.equal(response.status, 200);
    const data = await response.json();
    evidenceIds.add(data.evidence.id);
    assert.equal("target" in data.evidence, false);
    assert.equal("strength" in data.evidence, false);
  }
  assert.equal(evidenceIds.size, 4);
  const rejected = await post(`/api/cases/${created.caseId}/search`, { subjectId: subjectIds[0] });
  assert.equal(rejected.status, 409);
});

test("interrogation requires player text and returns a deceptive external expression", async () => {
  const created = await createCase();
  const blank = await post(`/api/cases/${created.caseId}/interrogate`, { subjectId: "ai1", question: "   " });
  assert.equal(blank.status, 400);
  const response = await post(`/api/cases/${created.caseId}/interrogate`, { subjectId: "ai1", question: "请解释你的时间线。" });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.source, "local");
  assert.ok(data.reply.length > 0);
  assert.ok(data.visual.mood);
  assert.ok(data.visual.caption);
  assert.doesNotMatch(JSON.stringify(data.visual), /thought|内心活动|心理活动/);
  assert.equal(data.state.turns, 1);
});

test("an early verdict closes the case", async () => {
  const created = await createCase();
  const response = await post(`/api/cases/${created.caseId}/verdict`, { selectedIds: ["ai1"] });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.state.gameOver, true);
  assert.ok(data.caseReport.motive);
  assert.ok(data.caseReport.method);
  assert.ok(data.investigationRecord);
  const afterVerdict = await post(`/api/cases/${created.caseId}/search`, { subjectId: "ai1" });
  assert.equal(afterVerdict.status, 409);
});

test("the twentieth action locks further investigation", async () => {
  const created = await createCase();
  const unrestrictedSubject = created.caseFile.subjects.find((subject) => !subject.protected);
  assert.ok(unrestrictedSubject);
  for (let turn = 1; turn <= 20; turn += 1) {
    const response = await post(`/api/cases/${created.caseId}/interrogate`, { subjectId: unrestrictedSubject.id, question: `第 ${turn} 次确认时间线。` });
    assert.equal(response.status, 200);
  }
  const rejected = await post(`/api/cases/${created.caseId}/interrogate`, { subjectId: unrestrictedSubject.id, question: "继续审问。" });
  assert.equal(rejected.status, 409);
  const payload = await rejected.json();
  assert.equal(payload.state.turns, 20);
});

async function createCase() {
  const response = await post("/api/cases", {});
  assert.equal(response.status, 201);
  return response.json();
}

function post(route, body) {
  return fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}
