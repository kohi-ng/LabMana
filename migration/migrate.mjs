#!/usr/bin/env node
// Migration LabMana v2 → v3 bằng Admin SDK (bỏ qua Rules). MẶC ĐỊNH CHỈ DRY-RUN.
//
//   cd migration && npm install
//   export GOOGLE_APPLICATION_CREDENTIALS=/đường/dẫn/serviceAccount.json   # Firebase Console → Project settings → Service accounts
//   node migrate.mjs --owner-uid <UID>               # dry-run + ghi file backup
//   node migrate.mjs --owner-uid <UID> --apply                              # áp dụng
//   Tùy chọn: --group <groupId> (gán vào nhóm thay vì Personal) · --delete-gemini-config (xóa config/gemini sau khi đã rotate khóa)
//
// An toàn: (1) luôn ghi backup JSON (đã che apiKey) trước; (2) chỉ thêm trường, không xóa dữ liệu; (3) bỏ qua doc đã có scope
// (chạy lại bao nhiêu lần cũng được); (4) không đoán chủ sở hữu — --owner-uid là bắt buộc.
import fs from "node:fs";
import { plan, COLLECTIONS } from "./plan.mjs";

const args = process.argv.slice(2);
const flag = n => args.includes(`--${n}`);
const opt = n => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const ownerUid = opt("owner-uid"), groupId = opt("group"), apply = flag("apply");
if (!ownerUid) { console.error("Thiếu --owner-uid (UID chủ sở hữu dữ liệu cũ)."); process.exit(1); }

const { initializeApp, applicationDefault } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");
const { getAuth } = await import("firebase-admin/auth");
initializeApp({ credential: applicationDefault(), projectId: process.env.FIREBASE_PROJECT_ID || (() => { throw new Error("Đặt biến môi trường FIREBASE_PROJECT_ID"); })() });
const db = getFirestore(), auth = getAuth();

const read = async col => (await db.collection(col).get()).docs.map(d => ({ id: d.id, ...d.data() }));
const data = {
  experiments: await read("experiments"), runs: await read("runs"), execution_logs: await read("execution_logs"),
  config: Object.fromEntries((await db.collection("config").get()).docs.map(d => [d.id, d.data()]))
};

// 1) Backup (che khóa bí mật)
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const safeCfg = JSON.parse(JSON.stringify(data.config));
if (safeCfg.gemini?.apiKey) safeCfg.gemini.apiKey = "[REDACTED]";
const file = `backup-${stamp}.json`;
fs.writeFileSync(file, JSON.stringify({ ...data, config: safeCfg }, null, 2));
console.log(`Backup: ${file}`);

// 2) Kế hoạch
const p = plan(data, { ownerUid, groupId });
console.log(`\nSẽ gán scope cho: ${p.updates.length} document · bỏ qua (đã có scope): ${p.skipped.length}`);
for (const col of COLLECTIONS) console.log(`  ${col}: ${p.updates.filter(u => u.col === col).length}`);
if (p.settings) console.log(`Sẽ ghi workspace_settings/${p.settings.id} (${p.settings.set.team_members.length} thành viên) nếu chưa có`);
p.problems.forEach(x => console.warn("CẢNH BÁO:", x));
p.secrets.forEach(x => console.warn("BẢO MẬT:", x));

// 3) Hồ sơ người dùng chủ sở hữu (Rules cần users/{uid}.status == active; Super Admin được miễn)
const user = await auth.getUser(ownerUid).catch(() => null);
if (!user) { console.error(`Không tìm thấy UID ${ownerUid} trong Firebase Authentication.`); process.exit(1); }
console.log(`Chủ sở hữu: ${user.email || "(chưa có email — hãy liên kết email/mật khẩu trước)"} (${ownerUid})`);

if (!apply) { console.log("\nDRY-RUN: chưa ghi gì. Thêm --apply để thực hiện."); process.exit(0); }

// 4) Áp dụng
const now = Date.now();
const userRef = db.collection("users").doc(ownerUid);
if (!(await userRef.get()).exists && user.email) {
  await userRef.set({ uid: ownerUid, email: user.email.toLowerCase(), display_name: user.displayName || user.email.split("@")[0], status: "active", created_at_ms: now, updated_at_ms: now });
  await db.collection("user_emails").doc(user.email.toLowerCase()).set({ uid: ownerUid, email: user.email.toLowerCase(), updated_at_ms: now }, { merge: true });
}
for (let i = 0; i < p.updates.length; i += 400) {
  const batch = db.batch();
  for (const u of p.updates.slice(i, i + 400)) batch.set(db.collection(u.col).doc(u.id), u.set, { merge: true });
  await batch.commit();
}
if (p.settings) {
  const ref = db.collection("workspace_settings").doc(p.settings.id);
  if (!(await ref.get()).exists) await ref.set({ ...p.settings.set, updated_at_ms: now });
}
if (flag("delete-gemini-config") && data.config.gemini) { await db.collection("config").doc("gemini").delete(); console.log("Đã xóa config/gemini."); }

// 5) Kiểm tra lại
const after = { experiments: await read("experiments"), runs: await read("runs"), execution_logs: await read("execution_logs"), config: {} };
const left = plan(after, { ownerUid, groupId }).updates.length;
console.log(`\nXong. Số document còn thiếu scope: ${left}. Số lượng: experiments=${after.experiments.length}/${data.experiments.length}, runs=${after.runs.length}/${data.runs.length}, execution_logs=${after.execution_logs.length}/${data.execution_logs.length}`);
process.exit(left === 0 ? 0 : 2);
