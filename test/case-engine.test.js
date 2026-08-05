import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SEARCHES,
  buildSearchQueue,
  chooseGuiltyIds,
  createLocalCaseFile,
  createPublicCaseFile,
  hasDistinctCaseBackground,
  parseCaseFile
} from "../case-engine.js";

test("local cases satisfy the four-search evidence contract", () => {
  let recentCases = [];
  const observedCounts = new Set();
  for (let run = 0; run < 50; run += 1) {
    const caseFile = createLocalCaseFile(recentCases);
    recentCases = [...recentCases, caseFile].slice(-3);
    observedCounts.add(caseFile.subjects.length);
    const queue = buildSearchQueue(caseFile);
    assert.equal(queue.length, MAX_SEARCHES);
    assert.equal(caseFile.evidence.length, 12);
    assert.ok(caseFile.subjects.length >= 2 && caseFile.subjects.length <= 3);
    assert.ok(caseFile.guiltyIds.length >= 1 && caseFile.guiltyIds.length < caseFile.subjects.length);
    assert.ok(caseFile.subjects.some((subject) => !subject.protected));
    const queuedEvidence = queue.map((id) => caseFile.evidence.find((item) => item.id === id));
    caseFile.subjects.forEach((subject) => {
      const expectedStrength = subject.guilty ? "strong" : "exonerating";
      assert.ok(queuedEvidence.some((item) => item.target === subject.id && item.strength === expectedStrength));
    });
    assert.ok(queuedEvidence.some((item) => item.target === null));
    assert.ok(caseFile.evidence.filter((item) => item.misleading).length >= 2);
    assert.ok(caseFile.evidence.some((item) => item.revealed && item.misleading));
    assert.ok(caseFile.caseReport.motive);
    assert.ok(caseFile.caseReport.method);
    assert.ok(caseFile.caseReport.emotionalCore);
    assert.equal(caseFile.caseReport.emotionalTurns.length >= 3, true);
  }
  assert.deepEqual([...observedCounts].sort(), [2, 3]);
});

test("public case files contain only revealed, non-secret data", () => {
  const caseFile = createLocalCaseFile();
  const revealed = new Set(caseFile.evidence.filter((item) => item.revealed).map((item) => item.id));
  const publicCase = createPublicCaseFile(caseFile, revealed);
  const serialized = JSON.stringify(publicCase);
  assert.equal(publicCase.evidence.length, 4);
  assert.doesNotMatch(serialized, /hiddenTruth|guiltyIds|secretRole|privateSecret|knowledgeBoundary|deceptionStrategy|"guilty"|protectLine|selfSaveLine|pressure/);
});

test("guilt allocation uses only active subjects and always leaves an innocent", () => {
  for (const subjectIds of [["ai1", "ai2"], ["ai1", "ai2", "ai3"]]) {
    for (let run = 0; run < 30; run += 1) {
      const guiltyIds = chooseGuiltyIds([], subjectIds);
      assert.ok(guiltyIds.length >= 1 && guiltyIds.length < subjectIds.length);
      assert.ok(guiltyIds.every((id) => subjectIds.includes(id)));
    }
  }
});

test("consecutive local cases use clearly different backgrounds", () => {
  let recentCases = [];
  for (let run = 0; run < 24; run += 1) {
    const caseFile = createLocalCaseFile(recentCases);
    assert.equal(hasDistinctCaseBackground(caseFile, recentCases), true);
    recentCases = [...recentCases, caseFile].slice(-3);
  }
});

test("generated case validation rejects contradictory guilt declarations", () => {
  const caseFile = createLocalCaseFile();
  const invalid = structuredClone(caseFile);
  invalid.guiltyIds = invalid.guiltyIds.includes("ai1") ? ["ai2"] : ["ai1"];
  assert.throws(() => parseCaseFile(invalid), /guiltyIds must match/);
});

test("two-person cases reject evidence aimed at an inactive AI slot", () => {
  const first = createLocalCaseFile();
  const second = createLocalCaseFile([first]);
  const third = createLocalCaseFile([first, second]);
  const caseFile = [first, second, third].find((item) => item.subjects.length === 2);
  assert.ok(caseFile);
  const invalid = structuredClone(caseFile);
  invalid.evidence.find((item) => !item.revealed).target = "ai3";
  assert.throws(() => parseCaseFile(invalid), /inactive subject/);
});
