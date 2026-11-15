// Bộ test allow/deny cho firestore.rules (Firestore Emulator). Chạy: npm i && npm run test:rules
// Ánh xạ test-case trong docs/ARCHITECTURE.md §Kiểm thử (GRP/RBAC/ACL/DATA/SEC).
import { before, after, beforeEach, describe, it } from "node:test";
import fs from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs, writeBatch, arrayUnion } from "firebase/firestore";

const SUPER = "Eq1ueE9VHoYIbNk3UU5gnQOwJBg1";
let env;
const as = (uid, extra = {}) => env.authenticatedContext(uid, { email: `${uid}@x.com`, firebase: { sign_in_provider: "password" }, ...extra }).firestore();
const seed = fn => env.withSecurityRulesDisabled(async ctx => fn(ctx.firestore()));
const user = (uid, status = "active") => ({ uid, email: `${uid}@x.com`, status });

before(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-labmana", firestore: { rules: fs.readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 } });
});
after(() => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await seed(async db => {
    for (const u of ["alice", "bob", "carol", "dave"]) await setDoc(doc(db, "users", u), user(u));
    await setDoc(doc(db, "users", "eve"), user("eve", "suspended"));
    await setDoc(doc(db, "groups", "gA"), { name: "A", status: "active" });
    await setDoc(doc(db, "groups", "gB"), { name: "B", status: "active" });
    await setDoc(doc(db, "memberships", "gA__alice"), { uid: "alice", group_id: "gA", role: "group_admin", status: "active" });
    await setDoc(doc(db, "memberships", "gA__bob"), { uid: "bob", group_id: "gA", role: "member", status: "active" });
    await setDoc(doc(db, "memberships", "gA__carol"), { uid: "carol", group_id: "gA", role: "member", status: "active" });
    await setDoc(doc(db, "memberships", "gB__dave"), { uid: "dave", group_id: "gB", role: "group_admin", status: "active" });
    await setDoc(doc(db, "experiments", "eBob"), { scope: "group", group_id: "gA", owner_uid: "bob", created_by: "bob", title: "t" });
    await setDoc(doc(db, "experiments", "eAlicePersonal"), { scope: "personal", group_id: null, owner_uid: "alice", created_by: "alice", title: "p" });
  });
});

const newExp = (uid, scope = "group", g = "gA") => ({ scope, group_id: scope === "group" ? g : null, owner_uid: uid, created_by: uid, title: "n" });
const groupQ = (db, g) => getDocs(query(collection(db, "experiments"), where("scope", "==", "group"), where("group_id", "==", g)));

describe("AUTH / account", () => {
  it("anonymous bị từ chối mọi dữ liệu", async () => {
    const db = env.authenticatedContext("anon", { firebase: { sign_in_provider: "anonymous" } }).firestore();
    await assertFails(getDoc(doc(db, "experiments", "eBob")));
  });
  it("tài khoản suspended bị từ chối", async () => {
    await assertFails(setDoc(doc(as("eve"), "experiments", "x"), newExp("eve", "personal")));
  });
  it("SEC: user không tự đổi status của mình", async () => {
    await assertFails(updateDoc(doc(as("bob"), "users", "bob"), { status: "suspended" }));
    await assertSucceeds(updateDoc(doc(as("bob"), "users", "bob"), { display_name: "Bob" }));
  });
});

describe("GRP", () => {
  it("GRP-01 user gửi yêu cầu lập nhóm (pending) nhưng không tự tạo group", async () => {
    await assertSucceeds(setDoc(doc(as("bob"), "group_requests", "r1"), { requested_name: "Nhóm mới", requested_by: "bob", status: "pending" }));
    await assertFails(setDoc(doc(as("bob"), "groups", "gX"), { name: "X", status: "active" }));
  });
  it("GRP-02 chỉ Super Admin duyệt/tạo nhóm", async () => {
    await assertSucceeds(setDoc(doc(as(SUPER), "groups", "gX"), { name: "X", status: "active" }));
    await assertFails(updateDoc(doc(as("bob"), "group_requests", "r1"), { status: "approved" }));
  });
  it("GRP-03 Group Admin thêm Member; Member thì không", async () => {
    const m = { uid: "dave", group_id: "gA", role: "member", status: "active", added_by: "alice" };
    await assertSucceeds(setDoc(doc(as("alice"), "memberships", "gA__dave"), m));
    await assertFails(setDoc(doc(as("bob"), "memberships", "gA__dave"), { ...m, added_by: "bob" }));
  });
  it("GRP-04 biết groupId nhưng không có membership → bị từ chối", async () => {
    await assertFails(getDoc(doc(as("dave"), "experiments", "eBob")));
    await assertFails(groupQ(as("dave"), "gA"));
    await assertFails(getDoc(doc(as("dave"), "groups", "gA")));
  });
  it("Group Admin không tự phong admin khác", async () => {
    await assertFails(setDoc(doc(as("alice"), "memberships", "gA__bob"), { uid: "bob", group_id: "gA", role: "group_admin", status: "active", added_by: "alice" }));
  });
  it("DATA-01 Member bị xóa (revoked) mất quyền ngay", async () => {
    await assertSucceeds(groupQ(as("bob"), "gA"));
    await assertSucceeds(updateDoc(doc(as("alice"), "memberships", "gA__bob"), { status: "revoked" }));
    await assertFails(groupQ(as("bob"), "gA"));
  });
  it("nhóm bị đình chỉ → không ai truy cập tài nguyên nhóm", async () => {
    await assertSucceeds(updateDoc(doc(as(SUPER), "groups", "gA"), { status: "suspended" }));
    await assertFails(groupQ(as("alice"), "gA"));
  });
});

describe("RBAC", () => {
  it("Member xem tài nguyên nhóm", async () => { await assertSucceeds(getDoc(doc(as("carol"), "experiments", "eBob"))); });
  it("RBAC-01 Member sửa/xóa tài nguyên của mình", async () => {
    await assertSucceeds(updateDoc(doc(as("bob"), "experiments", "eBob"), { title: "mới" }));
    await assertSucceeds(deleteDoc(doc(as("bob"), "experiments", "eBob")));
  });
  it("RBAC-02 Member khác không sửa/xóa", async () => {
    await assertFails(updateDoc(doc(as("carol"), "experiments", "eBob"), { title: "hack" }));
    await assertFails(deleteDoc(doc(as("carol"), "experiments", "eBob")));
  });
  it("RBAC-03 Group Admin quản lý tài nguyên nhóm", async () => {
    await assertSucceeds(updateDoc(doc(as("alice"), "experiments", "eBob"), { title: "admin sửa" }));
  });
  it("Member tạo tài nguyên nhóm của mình; không giả danh chủ khác / nhóm khác", async () => {
    await assertSucceeds(setDoc(doc(as("carol"), "experiments", "c1"), newExp("carol")));
    await assertFails(setDoc(doc(as("carol"), "experiments", "c2"), newExp("bob")));
    await assertFails(setDoc(doc(as("carol"), "experiments", "c3"), newExp("carol", "group", "gB")));
  });
  it("SEC-01 không đổi owner_uid/scope/group_id/created_by", async () => {
    const db = as("bob");
    await assertFails(updateDoc(doc(db, "experiments", "eBob"), { owner_uid: "carol" }));
    await assertFails(updateDoc(doc(db, "experiments", "eBob"), { scope: "personal", group_id: null }));
    await assertFails(updateDoc(doc(db, "experiments", "eBob"), { group_id: "gB" }));
  });
  it("DATA-02 Group Admin không đọc Personal của thành viên; Super Admin cũng không", async () => {
    await seed(db => setDoc(doc(db, "experiments", "eBobP"), newExp("bob", "personal")));
    await assertFails(getDoc(doc(as("alice"), "experiments", "eBobP")));
    await assertFails(getDoc(doc(as(SUPER), "experiments", "eBobP")));
    await assertSucceeds(getDoc(doc(as("bob"), "experiments", "eBobP")));
  });
  it("list Personal phải kèm owner_uid của chính mình", async () => {
    await assertSucceeds(getDocs(query(collection(as("alice"), "experiments"), where("scope", "==", "personal"), where("owner_uid", "==", "alice"))));
    await assertFails(getDocs(collection(as("alice"), "experiments")));
  });
});

describe("runs / execution_logs kế thừa scope", () => {
  const run = (uid, g = "gA") => ({ scope: "group", group_id: g, owner_uid: uid, created_by: uid, exp_id: "eBob", name: "r" });
  const log = (uid, g = "gA") => ({ scope: "group", group_id: g, owner_uid: uid, created_by: uid, exp_id: "eBob", run_id: "r1", step_id: "s1", executed_by_name: "n" });
  it("tạo run/log trong nhóm; sai nhóm cha bị từ chối", async () => {
    await assertSucceeds(setDoc(doc(as("carol"), "runs", "r1"), run("carol")));
    await assertSucceeds(setDoc(doc(as("carol"), "execution_logs", "r1__s1"), log("carol")));
    await assertFails(setDoc(doc(as("dave"), "runs", "r9"), run("dave", "gB")));          // gB không phải nhóm của experiment cha
    await assertFails(setDoc(doc(as("carol"), "execution_logs", "r1__s2"), { ...log("carol"), executed_by_name: 5 }));
  });
  it("thành viên khác cùng nhóm ghi tiếp log (giữ nguyên chủ)", async () => {
    await seed(async db => { await setDoc(doc(db, "runs", "r1"), run("carol")); await setDoc(doc(db, "execution_logs", "r1__s1"), log("carol")); });
    await assertSucceeds(setDoc(doc(as("bob"), "execution_logs", "r1__s1"), { ...log("carol"), input_data: 5 }));
    await assertFails(setDoc(doc(as("bob"), "execution_logs", "r1__s1"), { ...log("bob") }));   // đổi created_by
  });
});

describe("ACL — Viewer", () => {
  const share = (type, rid, extra = {}) => ({
    resource_collection: "experiments", resource_id: "eBob", source_scope: "group", source_group_id: "gA", source_owner_uid: "bob",
    recipient_type: type, recipient_id: rid, permission: "read", status: "active", created_by: "alice", approved_by: "alice", ...extra });
  const grant = async (type, rid) => {
    const field = type === "user" ? "shared_user_ids" : "shared_group_ids";
    const b = writeBatch(as("alice"));
    b.set(doc(as("alice"), "resource_shares", `${type === "user" ? "u" : "g"}_${rid}__eBob`), share(type, rid));
    b.update(doc(as("alice"), "experiments", "eBob"), { [field]: arrayUnion(rid) });
    await assertSucceeds(b.commit());
  };
  it("ACL-01 chia sẻ cho nhóm B → thành viên B chỉ xem đúng bài đó", async () => {
    await seed(db => setDoc(doc(db, "experiments", "eOther"), newExp("alice")));
    await grant("group", "gB");
    await assertSucceeds(getDoc(doc(as("dave"), "experiments", "eBob")));
    await assertFails(getDoc(doc(as("dave"), "experiments", "eOther")));      // ACL-02
    await assertFails(groupQ(as("dave"), "gA"));
  });
  it("chia sẻ cho user → chỉ user đó xem", async () => {
    await grant("user", "dave");
    await assertSucceeds(getDoc(doc(as("dave"), "experiments", "eBob")));
    await assertFails(getDoc(doc(as("eve"), "experiments", "eBob")));
  });
  it("ACL-03 Viewer không sửa/xóa/chia sẻ tiếp", async () => {
    await grant("user", "dave");
    await assertFails(updateDoc(doc(as("dave"), "experiments", "eBob"), { title: "x" }));
    await assertFails(deleteDoc(doc(as("dave"), "experiments", "eBob")));
    await assertFails(setDoc(doc(as("dave"), "resource_shares", "u_carol__eBob"), share("user", "carol", { created_by: "dave", approved_by: "dave" })));
  });
  it("ACL-04 thu hồi → từ chối ở lần đọc kế tiếp", async () => {
    await grant("user", "dave");
    await assertSucceeds(updateDoc(doc(as("alice"), "resource_shares", "u_dave__eBob"), { status: "revoked", approved_by: "alice" }));
    await assertFails(getDoc(doc(as("dave"), "experiments", "eBob")));
  });
  it("grant hết hạn bị từ chối", async () => {
    await grant("user", "dave");
    await seed(db => updateDoc(doc(db, "resource_shares", "u_dave__eBob"), { expires_at: new Date(Date.now() - 1000) }));
    await assertFails(getDoc(doc(as("dave"), "experiments", "eBob")));
  });
  it("Member chỉ gửi yêu cầu pending, không tự duyệt", async () => {
    await assertSucceeds(setDoc(doc(as("bob"), "resource_shares", "u_dave__eBob"), share("user", "dave", { status: "pending", created_by: "bob", approved_by: null })));
    await assertFails(setDoc(doc(as("carol"), "resource_shares", "u_dave__eBob"), share("user", "dave", { status: "active", created_by: "carol", approved_by: "carol" })));
    await assertFails(getDoc(doc(as("dave"), "experiments", "eBob")));        // pending chưa có hiệu lực
  });
});

describe("config & legacy", () => {
  it("config chỉ Super Admin đọc; không ai ghi", async () => {
    await seed(db => setDoc(doc(db, "config", "gemini"), { apiKey: "secret" }));
    await assertFails(getDoc(doc(as("alice"), "config", "gemini")));
    await assertSucceeds(getDoc(doc(as(SUPER), "config", "gemini")));
    await assertFails(setDoc(doc(as(SUPER), "config", "gemini"), { apiKey: "x" }));
  });
  it("document legacy (chưa có scope) không ai đọc được qua client", async () => {
    await seed(db => setDoc(doc(db, "experiments", "old"), { title: "cũ" }));
    await assertFails(getDoc(doc(as("alice"), "experiments", "old")));
  });
  it("audit_logs chỉ thêm, không sửa/xóa", async () => {
    await assertSucceeds(setDoc(doc(as("bob"), "audit_logs", "a1"), { actor_uid: "bob", action: "x", group_id: null }));
    await assertFails(updateDoc(doc(as("bob"), "audit_logs", "a1"), { action: "y" }));
    await assertFails(setDoc(doc(as("bob"), "audit_logs", "a2"), { actor_uid: "alice", action: "x", group_id: null }));
  });
});
