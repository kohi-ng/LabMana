// ============ Media registry: metadata ảnh dùng chung toàn LabMana ============
import { db } from "./firebase.js";
import { doc, setDoc, deleteDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/** Ghi metadata sau khi Drive đã xác nhận file và quyền Anyone-with-link. */
export async function registerMediaAsset(file, context) {
  if (!file?.file_id) throw new Error("MEDIA_FILE_ID_REQUIRED");
  const now = Date.now();
  const ref = doc(db, "media_assets", file.file_id);
  await setDoc(ref, {
    schema_version: 1,
    asset_id: file.file_id,
    file_id: file.file_id,
    experiment_id: context.experiment_id || null,
    run_id: context.run_id || null,
    section_id: context.section_id || null,
    step_id: context.step_id || null,
    context: context.context || "execution",
    name: file.name || "anh-thi-nghiem",
    mime_type: file.mime_type || "",
    size_bytes: Number(file.size_bytes) || 0,
    storage: "google_drive",
    url: file.url || "",
    status: "ready",
    uploaded_by: context.uploaded_by || null,
    created_at_ms: now,
    updated_at_ms: now
  }, { merge: true });
  return ref.id;
}

/** Đánh dấu trước khi xóa; chỉ xóa metadata sau khi Drive xác nhận. */
export async function removeMediaAsset(fileId, driveDelete) {
  if (!fileId) return;
  const ref = doc(db, "media_assets", fileId);
  await updateDoc(ref, { status: "deleting", updated_at_ms: Date.now() }).catch(() => {});
  try {
    await driveDelete(fileId);
    await deleteDoc(ref).catch(() => {});
  } catch (error) {
    await updateDoc(ref, { status: "delete_failed", updated_at_ms: Date.now() }).catch(() => {});
    throw error;
  }
}
