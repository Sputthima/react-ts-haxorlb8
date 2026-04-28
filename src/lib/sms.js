// SMS ส่งผ่าน Supabase Edge Function ที่ wrap SEPSMS API
// เพราะ SEPSMS ต้องการ API token ที่ไม่ควรอยู่ใน frontend

export async function sendSMS({ phone, message, bookingId="" }) {
  try {
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-sms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ phone, message, bookingId }),
    });
    const data = await res.json();
    return data;
  } catch (e) {
    console.error("SMS error:", e);
    return { success: false, error: e.message };
  }
}

export function buildQueueSMS({ truckPlate, driverName, dockNo, groupNumber, siteName="DMS" }) {
  return `[${siteName}] เรียนคุณ ${driverName}\nทะเบียน ${truckPlate}\nกรุณานำรถเข้า Dock ${dockNo} ได้เลยครับ\nGroup: ${groupNumber}`;
}

export function buildRecallSMS({ truckPlate, dockNo, recallCount, siteName="DMS" }) {
  return `[${siteName}] เรียกซ้ำครั้งที่ ${recallCount}\nทะเบียน ${truckPlate} กรุณาเข้า Dock ${dockNo} ด่วน`;
}

export function buildReminderSMS({ truckPlate, driverName, dockNo, bookingHour, minsUntil, siteName="DMS", plantName="" }) {
  return `[${siteName}] แจ้งเตือน: คุณ ${driverName}\nมีคิวเข้า Dock ${dockNo} เวลา ${bookingHour}\nอีก ${minsUntil} นาที กรุณาเข้าแถวรอที่ ${plantName}\nทะเบียน ${truckPlate}`;
}

export function buildInboundCalledSMS({ truckPlate, driverName, dockNo, bookingId, siteName="DMS" }) {
  return `[${siteName}] แจ้งเตือน: คุณ ${driverName}\nกรุณานำรถทะเบียน ${truckPlate}\nเข้า Dock ${dockNo} ได้เลยครับ\nBooking: ${bookingId}`;
}
