// Logic thuần (không gọi mạng) để lập kế hoạch migration — có thể test offline.
export const COLLECTIONS = ["experiments", "runs", "execution_logs"];

/**
 * @param data  { experiments:[{id,...}], runs:[], execution_logs:[], config:{lab?:{}, gemini?:{}} }
 * @param opts  { ownerUid, groupId|null }
 * Tài liệu đã có `scope` được BỎ QUA (idempotent). Không bao giờ đoán chủ sở hữu: ownerUid là tham số bắt buộc.
 */
export function plan(data, opts) {
  if (!opts.ownerUid) throw new Error("Thiếu --owner-uid");
  const scope = opts.groupId
    ? { scope: "group", group_id: opts.groupId, owner_uid: opts.ownerUid, created_by: opts.ownerUid }
    : { scope: "personal", group_id: null, owner_uid: opts.ownerUid, created_by: opts.ownerUid };
  const updates = [], skipped = [], problems = [];
  const expIds = new Set((data.experiments || []).map(d => d.id));
  const runIds = new Set((data.runs || []).map(d => d.id));
  for (const col of COLLECTIONS) {
    for (const d of data[col] || []) {
      if (d.scope) { skipped.push({ col, id: d.id, reason: "đã có scope" }); continue; }
      updates.push({ col, id: d.id, set: { ...scope } });
      if (col === "runs" && d.exp_id && !expIds.has(d.exp_id)) problems.push(`runs/${d.id}: exp_id ${d.exp_id} không có trong experiments`);
      if (col === "execution_logs") {
        if (d.run_id && !runIds.has(d.run_id)) problems.push(`execution_logs/${d.id}: run_id ${d.run_id} không có trong runs`);
        if (typeof d.step_id !== "string" || typeof d.executed_by_name !== "string") problems.push(`execution_logs/${d.id}: thiếu step_id/executed_by_name`);
      }
    }
  }
  const lab = data.config?.lab;
  const settingsId = opts.groupId ? `group_${opts.groupId}` : `personal_${opts.ownerUid}`;
  const settings = lab ? {
    id: settingsId,
    set: { team_members: (lab.team_members || []).map(String), team_ids: lab.team_ids || {}, updated_at_ms: 0 }
  } : null;
  const secrets = data.config?.gemini && Object.keys(data.config.gemini).some(k => /key|secret|token/i.test(k))
    ? ["config/gemini chứa khóa API → rotate khóa, đặt vào Script properties, rồi xóa config/gemini (--delete-gemini-config)"] : [];
  return { updates, skipped, problems, settings, secrets };
}
