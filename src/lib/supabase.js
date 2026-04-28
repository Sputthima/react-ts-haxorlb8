import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function nowISO() {
  return new Date().toISOString();
}

// Audit log — เรียกหลังทุก action สำคัญ
export async function auditLog({ module, action, targetType, targetId, subconCode="", groupNumber="", bookingId="", actor="", remark="" }) {
  await supabase.from("audit_log").insert({
    module, action, target_type: targetType, target_id: targetId,
    subcon_code: subconCode, group_number: groupNumber,
    booking_id: bookingId, actor, remark,
    timestamp: nowISO(),
  });
}
