export function printBookingSlip(booking) {
  const w = window.open("","_blank","width=700,height=900");
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>
    body{font-family:Arial,sans-serif;padding:32px;max-width:600px;margin:0 auto}
    .hdr{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #0f4bd7;padding-bottom:12px;margin-bottom:16px}
    .title{font-size:20px;font-weight:900;color:#0a2a6e}
    p{margin:6px 0;font-size:13px}.lbl{font-weight:700;display:inline-block;width:130px;color:#374151}
    hr{margin:12px 0;border:none;border-top:1px solid #e5e7eb}
    .bk-id{font-family:monospace;font-size:18px;font-weight:900;letter-spacing:2px;color:#0a2a6e}
    .barcode{text-align:center;margin:20px 0;padding:16px;border:1px solid #e5e7eb;border-radius:8px}
    .footer{font-size:10px;color:#9ca3af;text-align:center;margin-top:16px}
    @media print{button{display:none}}
  </style></head><body>
  <div class="hdr">
    <div><div class="title">🏭 Booking Slip</div><div style="font-size:11px;color:#6b7280">Dock Management System — YCH Ladkrabang</div></div>
    <button onclick="window.print()" style="background:#0f4bd7;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;font-weight:700">🖨 Print</button>
  </div>
  <p><span class="lbl">Booking ID:</span><span class="bk-id">${booking.booking_id||""}</span></p>
  <p><span class="lbl">Group No:</span>${booking.group_number||"—"}</p>
  <p><span class="lbl">SubCon:</span>${booking.subcon_name||"—"}</p>
  <hr>
  <p><span class="lbl">Dock:</span>Dock ${booking.dock_no||""}</p>
  <p><span class="lbl">Date:</span>${booking.booking_date||""}</p>
  <p><span class="lbl">Time:</span>${String(booking.booking_hour||"").slice(0,5)}</p>
  <hr>
  <p><span class="lbl">Truck Plate:</span>${booking.truck_plate||""}</p>
  <p><span class="lbl">Truck Type:</span>${booking.truck_type||"—"}</p>
  <p><span class="lbl">Driver:</span>${booking.driver_name||""}</p>
  <p><span class="lbl">Phone:</span>${booking.phone||""}</p>
  <div class="barcode">
    <div style="font-family:monospace;font-size:24px;font-weight:900;letter-spacing:4px;color:#0a2a6e">${booking.booking_id||""}</div>
    <div style="font-size:11px;color:#6b7280;margin-top:4px">กรุณาแสดง Booking ID นี้ที่ Gate</div>
  </div>
  <div class="footer">พิมพ์เมื่อ ${new Date().toLocaleString("th-TH")} • Dock Management System</div>
  </body></html>`);
  w.document.close();
}

export function printInboundSlip(booking, asn={}, invoices=[]) {
  const w = window.open("","_blank","width=700,height=900");
  const totalQty = invoices.reduce((s,inv)=>s+(inv.invoice_qty||0),0);
  const invRows = invoices.map((inv,i)=>`<tr>
    <td>${i+1}</td><td>${inv.invoice_no}</td><td>${inv.po_no||"—"}</td>
    <td>${inv.invoice_date||""}</td><td style="text-align:right;font-weight:700">${inv.invoice_qty||0}</td>
  </tr>`).join("");
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>
    body{font-family:Arial,sans-serif;padding:32px;max-width:600px;margin:0 auto}
    .hdr{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #059669;padding-bottom:12px;margin-bottom:16px}
    .title{font-size:20px;font-weight:900;color:#065f46}
    p{margin:6px 0;font-size:13px}.lbl{font-weight:700;display:inline-block;width:130px}
    hr{margin:12px 0;border:none;border-top:1px solid #e5e7eb}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th{background:#065f46;color:#fff;padding:6px 10px;text-align:left}
    td{padding:6px 10px;border-bottom:1px solid #e5e7eb}
    .bk-id{font-family:monospace;font-size:16px;font-weight:900;letter-spacing:2px;color:#065f46}
    @media print{button{display:none}}
  </style></head><body>
  <div class="hdr">
    <div><div class="title">🏭 Inbound Booking Slip</div><div style="font-size:11px;color:#6b7280">Dock Management System</div></div>
    <button onclick="window.print()" style="background:#059669;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;font-weight:700">🖨 Print</button>
  </div>
  <p><span class="lbl">Booking ID:</span><span class="bk-id">${booking.booking_id||""}</span></p>
  <p><span class="lbl">ASN No:</span>${booking.asn_no||""}</p>
  <p><span class="lbl">Supplier:</span>${asn.supplier_name||booking.supplier_code||""}</p>
  <hr>
  <p><span class="lbl">Dock:</span>Dock ${booking.dock_no||""}</p>
  <p><span class="lbl">Date:</span>${booking.booking_date||""}</p>
  <p><span class="lbl">Time:</span>${String(booking.booking_hour||"").slice(0,5)}</p>
  <hr>
  <p><span class="lbl">Truck:</span>${booking.truck_plate||""} (${booking.truck_type||""})</p>
  <p><span class="lbl">Driver:</span>${booking.driver_name||""} ${booking.driver_phone||""}</p>
  <hr>
  <b style="font-size:13px">Invoices (${invoices.length} | Total: ${totalQty} units)</b>
  <table style="margin-top:8px"><thead><tr><th>#</th><th>Invoice No</th><th>PO No</th><th>Date</th><th>Qty</th></tr></thead>
  <tbody>${invRows}</tbody>
  <tfoot><tr style="font-weight:700;background:#f0fdf4"><td colspan="4">รวม</td><td style="text-align:right">${totalQty}</td></tr></tfoot>
  </table>
  <div style="margin-top:20px;text-align:center;padding:12px;border:1px solid #e5e7eb;border-radius:8px">
    <div style="font-family:monospace;font-size:20px;font-weight:900;letter-spacing:3px;color:#065f46">${booking.booking_id||""}</div>
    <div style="font-size:11px;color:#6b7280;margin-top:4px">กรุณาแสดง Barcode นี้ที่ประตูทางเข้า (Inbound)</div>
  </div>
  </body></html>`);
  w.document.close();
}

export function printQueueTV(calling=[], recent=[], config={}) {
  const w = window.open("","_blank","width=1200,height=700");
  const callingHTML = calling.map(q=>`
    <div class="calling-card">
      <div class="plate">${q.truck_plate||"—"}</div>
      <div class="dock">Dock ${q.dock_no}</div>
      <div class="sub">${q.subcon_name||q.subcon_code||""} • ${String(q.booking_hour||"").slice(0,5)}</div>
    </div>`).join("");
  const recentHTML = recent.slice(0,8).map(q=>`
    <tr>
      <td>${q.truck_plate||"—"}</td>
      <td>Dock ${q.dock_no}</td>
      <td>${q.subcon_name||q.subcon_code||""}</td>
      <td>${String(q.called_at||"").slice(11,16)}</td>
    </tr>`).join("");
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#0a2a6e;color:#fff;font-family:Arial,sans-serif;min-height:100vh}
    .hdr{background:#060d2e;padding:16px 32px;display:flex;justify-content:space-between;align-items:center}
    .hdr-title{font-size:24px;font-weight:900}
    .hdr-time{font-size:18px;font-weight:700;color:#fde68a}
    .section{padding:24px 32px}
    .section-title{font-size:14px;font-weight:700;color:rgba(255,255,255,.5);text-transform:uppercase;letter-spacing:2px;margin-bottom:16px}
    .calling-grid{display:flex;gap:16px;flex-wrap:wrap}
    .calling-card{background:linear-gradient(135deg,#f59e0b,#d97706);border-radius:16px;padding:24px 32px;min-width:200px;text-align:center;animation:pulse 2s infinite}
    @keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(245,158,11,.4)}50%{box-shadow:0 0 0 20px rgba(245,158,11,0)}}
    .plate{font-size:36px;font-weight:900;font-family:monospace;letter-spacing:4px}
    .dock{font-size:20px;font-weight:700;margin-top:8px}
    .sub{font-size:13px;opacity:.8;margin-top:4px}
    .recent-table{width:100%;border-collapse:collapse;margin-top:8px}
    .recent-table th{padding:10px 16px;text-align:left;background:rgba(255,255,255,.1);font-size:13px;font-weight:700}
    .recent-table td{padding:10px 16px;border-bottom:1px solid rgba(255,255,255,.1);font-size:15px}
    .empty{text-align:center;padding:40px;color:rgba(255,255,255,.4);font-size:16px}
  </style></head><body>
  <div class="hdr">
    <div class="hdr-title">🏭 ${config.plant_name||"Dock Management System"} — Queue Display</div>
    <div class="hdr-time" id="clock"></div>
  </div>
  <div class="section">
    <div class="section-title">📢 กำลังเรียก</div>
    ${calling.length ? `<div class="calling-grid">${callingHTML}</div>` : '<div class="empty">ไม่มีรถที่กำลังถูกเรียก</div>'}
  </div>
  <div class="section">
    <div class="section-title">📋 ล่าสุด</div>
    ${recent.length ? `<table class="recent-table"><thead><tr><th>ทะเบียน</th><th>Dock</th><th>SubCon</th><th>เวลาเรียก</th></tr></thead><tbody>${recentHTML}</tbody></table>` : '<div class="empty">ยังไม่มีประวัติ</div>'}
  </div>
  <script>
    function tick(){document.getElementById('clock').textContent=new Date().toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit',second:'2-digit'});}
    tick(); setInterval(tick,1000);
  </script>
  </body></html>`);
  w.document.close();
}
