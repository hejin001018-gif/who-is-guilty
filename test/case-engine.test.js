import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SEARCHES,
  buildSearchQueue,
  createLocalCaseFile,
  createPublicCaseFile,
  hasDistinctCaseBackground,
  parseCaseFile
} from "../case-engine.js";

test("local cases satisfy the four-search evidence contract", () => {
  for (let run = 0; run < 50; run += 1) {
    const caseFile = createLocalCaseFile();
    const queue = buildSearchQueue(caseFile);
    assert.equal(queue.length, MAX_SEARCHES);
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
  }
});

test("public case files contain only revealed, non-secret data", () => {
  const caseFile = createLocalCaseFile();
  const revealed = new Set(caseFile.evidence.filter((item) => item.revealed).map((item) => item.id));
  const publicCase = createPublicCaseFile(caseFile, revealed);
  const serialized = JSON.stringify(publicCase);
  assert.equal(publicCase.evidence.length, 4);
  assert.doesNotMatch(serialized, /hiddenTruth|guiltyIds|secretRole|"guilty"|protectLine|selfSaveLine|pressure/);
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
