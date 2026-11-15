import assert from "node:assert/strict";
import fs from "node:fs";
import { plan } from "./plan.mjs";
// Dùng backup thật nếu truyền đường dẫn; mặc định dùng dữ liệu giả (không đưa dữ liệu cá nhân vào repo).
const raw = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], "utf8")) : {
  config: { lab: { team_members: ["A"], team_ids: { A: "1" } }, gemini: { apiKey: "x" } },
  experiments: { e1: { title: "t" }, e2: { title: "u" } },
  runs: { experiment_e1: { exp_id: "e1" } },
  execution_logs: { experiment_e1__s1: { run_id: "experiment_e1", step_id: "s1", executed_by_name: "A" } }
};
const arr = o => Object.entries(o || {}).map(([id, v]) => ({ id, ...v }));
const data = { experiments: arr(raw.experiments), runs: arr(raw.runs), execution_logs: arr(raw.execution_logs), config: raw.config };
const p = plan(data, { ownerUid: "OWNER", groupId: null });
console.log({ updates: p.updates.length, skipped: p.skipped.length, problems: p.problems, settings: !!p.settings, secrets: p.secrets.length });
assert.equal(p.updates.length, data.experiments.length + data.runs.length + data.execution_logs.length);
// idempotent: áp dụng rồi chạy lại → không còn gì để sửa
for (const u of p.updates) Object.assign(data[u.col].find(d => d.id === u.id), u.set);
assert.equal(plan(data, { ownerUid: "OWNER", groupId: null }).updates.length, 0);
assert.throws(() => plan(data, {}), /owner-uid/);
console.log("OK");
