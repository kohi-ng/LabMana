// ============ Audit log (chỉ thêm). Ghi từ client — best-effort, không chặn thao tác chính ============
// Rules cho phép tạo khi actor_uid == uid hiện tại và (group_id null, Super Admin, hoặc Group Admin của nhóm đó).
// Không chứa secret/token. Giới hạn: không có backend nên không ép được "bắt buộc phải ghi".
import { db } from "./firebase.js";
import { session } from "./auth.js";
import { collection, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export function logAudit(action, targetType, targetId, groupId = null, detail = null) {
  try {
    const uid = session.user?.uid;
    if (!uid) return;
    setDoc(doc(collection(db, "audit_logs")), {
      actor_uid: uid, actor_email: session.user?.email || "", action,
      target_type: targetType, target_id: String(targetId ?? ""), group_id: groupId,
      detail: detail || null, timestamp_ms: Date.now()
    }).catch(err => console.warn("audit:", err.code || err.message));
  } catch (e) { console.warn(e); }
}
