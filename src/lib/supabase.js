import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// ─────────────────────────────────────────────────────────────
//  Timezone helpers — ใช้ Local time เสมอ (Asia/Bangkok UTC+7)
//
//  BUG เดิม: toISOString() คืน UTC → วันผิดถ้าใช้งานตี 0-7 น.
//    new Date().toISOString() → "2026-04-30T17:00:00Z" (UTC)
//    ทั้งที่ไทยเป็น 2026-05-01 00:00 แล้ว
//
//  FIX: ใช้ local date parts จาก getFullYear/getMonth/getDate
// ─────────────────────────────────────────────────────────────

// วันที่วันนี้ใน local timezone → "2026-05-01"
export function today() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

// local ISO timestamp → "2026-05-01T00:05:00+07:00"
// ใช้สำหรับ insert/update timestamp ใน DB
// Supabase/Postgres รับ ISO with offset ได้ถูกต้อง
export function nowISO() {
  const d = new Date();
  // offset นาที → แปลงเป็น ±HH:MM
  const off = -d.getTimezoneOffset(); // getTimezoneOffset คืนค่า inverted
  const sign   = off>=0?"+":"-";
  const absOff = Math.abs(off);
  const oh = String(Math.floor(absOff/60)).padStart(2,"0");
  const om = String(absOff%60).padStart(2,"0");
  // pad local parts
  const y  = d.getFullYear();
  const mo = String(d.getMonth()+1).padStart(2,"0");
  const dy = String(d.getDate()).padStart(2,"0");
  const hh = String(d.getHours()).padStart(2,"0");
  const mi = String(d.getMinutes()).padStart(2,"0");
  const ss = String(d.getSeconds()).padStart(2,"0");
  return `${y}-${mo}-${dy}T${hh}:${mi}:${ss}${sign}${oh}:${om}`;
}

// แปลง Date object เป็น "YYYY-MM-DD" local
export function dateToLocal(d) {
  if (!d) return "";
  const dt = typeof d==="string" ? new Date(d) : d;
  const y  = dt.getFullYear();
  const m  = String(dt.getMonth()+1).padStart(2,"0");
  const dy = String(dt.getDate()).padStart(2,"0");
  return `${y}-${m}-${dy}`;
}

// วันข้างหน้า N วัน (local)
export function addDaysLocal(n) {
  const d = new Date();
  d.setDate(d.getDate()+n);
  return dateToLocal(d);
}

// ── Audit log ─────────────────────────────────────────────────
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

// ── Send Email via Edge Function ──────────────────────────────
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

// ── Trigger Auto Slot Generation ─────────────────────────────
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
