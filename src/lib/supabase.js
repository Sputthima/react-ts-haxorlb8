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

// ── Audit log ─────────────────────────────────────────────────────────────
export async function auditLog({
  module, action, targetType, targetId,
  subconCode="", groupNumber="", bookingId="", actor="", remark=""
}) {
  await supabase.from("audit_log").insert({
    module, action, target_type: targetType, target_id: targetId,
    subcon_code: subconCode, group_number: groupNumber,
    booking_id: bookingId, actor, remark,
    timestamp: nowISO(),
  });
}

// ── Send Email via Edge Function ──────────────────────────────────────────
// type: "booking" | "asn" | "booking_cancelled" | "custom"
export async function sendEmail({ to, type, data, subject, html, text }) {
  if (!to) return;
  try {
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ to, type, data, subject, html, text }),
      }
    );
    const result = await res.json();
    if (!result.success) console.warn("Email failed:", result.error);
    return result;
  } catch (e) {
    console.warn("sendEmail error:", e.message);
  }
}

// ── Trigger Auto Slot Generation (Admin manual call) ──────────────────────
export async function triggerAutoSlots() {
  try {
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auto-slots`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({}),
      }
    );
    return await res.json();
  } catch (e) {
    console.warn("triggerAutoSlots error:", e.message);
    return { success: false, error: e.message };
  }
}
