// ─────────────────────────────────────────────────────────────
//  pdf.js — Booking Slip + Inbound Slip + Queue TV
//  v2: เพิ่ม SVG Barcode (Code128) จริง — Gate scan ได้
// ─────────────────────────────────────────────────────────────

// ── Code128 SVG Barcode generator (ไม่ใช้ library ภายนอก) ───
// Subset B: ASCII 32-127
function code128B(text) {
  const CODE = {
    ' ':0,  '!':1,  '"':2,  '#':3,  '$':4,  '%':5,  '&':6,  "'":7,
    '(':8,  ')':9,  '*':10, '+':11, ',':12, '-':13, '.':14, '/':15,
    '0':16, '1':17, '2':18, '3':19, '4':20, '5':21, '6':22, '7':23,
    '8':24, '9':25, ':':26, ';':27, '<':28, '=':29, '>':30, '?':31,
    '@':32, 'A':33, 'B':34, 'C':35, 'D':36, 'E':37, 'F':38, 'G':39,
    'H':40, 'I':41, 'J':42, 'K':43, 'L':44, 'M':45, 'N':46, 'O':47,
    'P':48, 'Q':49, 'R':50, 'S':51, 'T':52, 'U':53, 'V':54, 'W':55,
    'X':56, 'Y':57, 'Z':58, '[':59, '\\':60, ']':61, '^':62, '_':63,
    '`':64, 'a':65, 'b':66, 'c':67, 'd':68, 'e':69, 'f':70, 'g':71,
    'h':72, 'i':73, 'j':74, 'k':75, 'l':76, 'm':77, 'n':78, 'o':79,
    'p':80, 'q':81, 'r':82, 's':83, 't':84, 'u':85, 'v':86, 'w':87,
    'x':88, 'y':89, 'z':90, '{':91, '|':92, '}':93, '~':94,
  };
  // Code128 bar patterns (11 bits each, 1=bar 0=space)
  const PATTERNS = [
    '11011001100','11001101100','11001100110','10010011000','10010001100',
    '10001001100','10011001000','10011000100','10001100100','11001001000',
    '11001000100','11000100100','10110011100','10011011100','10011001110',
    '10111001100','10011101100','10011100110','11001110010','11001011100',
    '11001001110','11011100100','11001110100','11101101110','11101001100',
    '11100101100','11100100110','11101100100','11100110100','11100110010',
    '11011011000','11011000110','11000110110','10100011000','10001011000',
    '10001000110','10110001000','10001101000','10001100010','11010001000',
    '11000101000','11000100010','10110111000','10110001110','10001101110',
    '10111011000','10111000110','10001110110','11101110110','11010001110',
    '11000101110','11011101000','11011100010','11011101110','11101011000',
    '11101000110','11100010110','11101101000','11101100010','11100011010',
    '11101111010','11001000010','11110001010','10100110000','10100001100',
    '10010110000','10010000110','10000101100','10000100110','10110010000',
    '10110000100','10011010000','10011000010','10000110100','10000110010',
    '11000010010','11001010000','11110111010','11000010100','10001111010',
    '10100111100','10010111100','10010011110','10111100100','10011110100',
    '10011110010','11110100100','11110010100','11110010010','11011011110',
    '11011110110','11110110110','10101111000','10100011110','10001011110',
    '10111101000','10111100010','11110101000','11110100010','10111011110',
    '10111101110','11101011110','11110101110','11010000100','11010010000',
    '11010011100','11000111010',
  ];
  const START_B  = 104;
  const STOP     = 106;
  const STOP_PAT = '1100011101011';

  const vals = [START_B];
  for (let i = 0; i < text.length; i++) {
    const v = CODE[text[i]];
    if (v === undefined) throw new Error('Code128B: unsupported char: ' + text[i]);
    vals.push(v);
  }

  // checksum
  let check = START_B;
  for (let i = 1; i < vals.length; i++) check = (check + i * vals[i]) % 103;
  vals.push(check);

  // build bit string
  let bits = '';
  for (const v of vals) bits += PATTERNS[v];
  bits += STOP_PAT;

  return bits;
}

function svgBarcode(text, { height=60, barWidth=1.8, color='#0a2a6e' } = {}) {
  try {
    const bits = code128B(text);
    const width = bits.length * barWidth + 20;
    let rects = '';
    let x = 10;
    for (let i = 0; i < bits.length; i++) {
      if (bits[i] === '1') {
        // find run length
        let run = 1;
        while (i + run < bits.length && bits[i + run] === '1') run++;
        rects += `<rect x="${x}" y="0" width="${run * barWidth}" height="${height}" fill="${color}"/>`;
        x += run * barWidth;
        i += run - 1;
      } else {
        x += barWidth;
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${rects}</svg>`;
  } catch(e) {
    // fallback: text only
    return `<div style="font-family:monospace;font-size:20px;font-weight:900;letter-spacing:4px;color:#0a2a6e">${text}</div>`;
  }
}

// ── BOOKING SLIP ─────────────────────────────────────────────
export function printBookingSlip(booking) {
  const w = window.open("","_blank","width=720,height=960");
  const bkId   = booking.booking_id || "";
  const barSvg = svgBarcode(bkId, { height:70, barWidth:2.0 });

  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>
    *{box-sizing:border-box}
    body{font-family:Arial,sans-serif;padding:32px;max-width:620px;margin:0 auto;color:#1a1a1a}
    .hdr{display:flex;justify-content:space-between;align-items:flex-start;
         border-bottom:3px solid #1B3A6B;padding-bottom:14px;margin-bottom:18px}
    .logo{font-size:22px;font-weight:900;color:#1B3A6B}
    .sub{font-size:11px;color:#6b7280;margin-top:2px}
    .badge{background:#F5A800;color:#1B3A6B;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:800}
    p{margin:5px 0;font-size:13px}
    .lbl{font-weight:700;display:inline-block;width:130px;color:#374151}
    .val{color:#111}
    hr{margin:12px 0;border:none;border-top:1px solid #e5e7eb}
    .bk-id{font-family:monospace;font-size:20px;font-weight:900;letter-spacing:3px;color:#1B3A6B}
    .barcode-box{text-align:center;margin:18px 0;padding:16px;border:1.5px solid #e5e7eb;border-radius:10px;background:#f8fafc}
    .barcode-label{font-size:11px;color:#6b7280;margin-top:8px;font-family:monospace;letter-spacing:1px}
    .section{background:#f8fafc;border-radius:8px;padding:10px 14px;margin:10px 0}
    .footer{font-size:10px;color:#9ca3af;text-align:center;margin-top:20px;border-top:1px solid #e5e7eb;padding-top:10px}
    @media print{button{display:none!important}.no-print{display:none}}
  </style></head><body>

  <div class="hdr">
    <div>
      <div class="logo">🏭 Dock Booking Slip</div>
      <div class="sub">Dock Management System — YCH Ladkrabang</div>
    </div>
    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
      <button onclick="window.print()" style="background:#1B3A6B;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;font-weight:700;font-size:12px">🖨 Print</button>
      <span class="badge">OUTBOUND</span>
    </div>
  </div>

  <div class="barcode-box">
    ${barSvg}
    <div class="barcode-label">${bkId}</div>
    <div style="font-size:10px;color:#9ca3af;margin-top:4px">กรุณาแสดง Barcode นี้ที่ Gate / ใช้ Scanner อ่านได้</div>
  </div>

  <div class="section">
    <p><span class="lbl">Booking ID</span><span class="val bk-id">${bkId}</span></p>
    <p><span class="lbl">Group No</span><span class="val">${booking.group_number||"—"}</span></p>
    <p><span class="lbl">SubCon</span><span class="val">${booking.subcon_name||booking.subcon_code||"—"}</span></p>
  </div>
  <hr>
  <div class="section">
    <p><span class="lbl">Dock</span><span class="val">Dock ${booking.dock_no||""}</span></p>
    <p><span class="lbl">Date</span><span class="val">${booking.booking_date||""}</span></p>
    <p><span class="lbl">Time</span><span class="val">${String(booking.booking_hour||"").slice(0,5)}</span></p>
  </div>
  <hr>
  <div class="section">
    <p><span class="lbl">Truck Plate</span><span class="val" style="font-family:monospace;font-weight:700;font-size:14px">${booking.truck_plate||""}</span></p>
    <p><span class="lbl">Truck Type</span><span class="val">${booking.truck_type||"—"}</span></p>
    <p><span class="lbl">Driver</span><span class="val">${booking.driver_name||""}</span></p>
    <p><span class="lbl">Phone</span><span class="val">${booking.phone||""}</span></p>
  </div>

  <div class="footer">
    พิมพ์เมื่อ ${new Date().toLocaleString("th-TH")} • Dock Management System • YCH Ladkrabang
  </div>
  </body></html>`);
  w.document.close();
}

// ── INBOUND SLIP ─────────────────────────────────────────────
export function printInboundSlip(booking, asn={}, invoices=[]) {
  const w = window.open("","_blank","width=720,height=960");
  const totalQty = invoices.reduce((s,inv)=>s+(inv.invoice_qty||0),0);
  const bkId    = booking.booking_id || "";
  const barSvg  = svgBarcode(bkId, { height:60, barWidth:1.8, color:'#065f46' });

  const invRows = invoices.map((inv,i)=>`<tr>
    <td>${i+1}</td><td>${inv.invoice_no}</td><td>${inv.po_no||"—"}</td>
    <td>${inv.invoice_date||""}</td>
    <td style="text-align:right;font-weight:700">${inv.invoice_qty||0}</td>
  </tr>`).join("");

  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>
    *{box-sizing:border-box}
    body{font-family:Arial,sans-serif;padding:32px;max-width:620px;margin:0 auto}
    .hdr{display:flex;justify-content:space-between;align-items:flex-start;
         border-bottom:3px solid #059669;padding-bottom:12px;margin-bottom:16px}
    .logo{font-size:20px;font-weight:900;color:#065f46}
    .badge{background:#d1fae5;color:#065f46;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:800;border:1px solid #6ee7b7}
    p{margin:5px 0;font-size:13px}
    .lbl{font-weight:700;display:inline-block;width:130px;color:#374151}
    hr{margin:12px 0;border:none;border-top:1px solid #e5e7eb}
    .section{background:#f0fdf4;border-radius:8px;padding:10px 14px;margin:10px 0}
    table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}
    th{background:#065f46;color:#fff;padding:6px 10px;text-align:left}
    td{padding:6px 10px;border-bottom:1px solid #e5e7eb}
    tfoot td{font-weight:800;background:#f0fdf4}
    .barcode-box{text-align:center;margin:14px 0;padding:12px;border:1.5px solid #6ee7b7;border-radius:10px;background:#f0fdf4}
    .barcode-label{font-family:monospace;font-size:11px;color:#065f46;margin-top:6px;letter-spacing:1px}
    .footer{font-size:10px;color:#9ca3af;text-align:center;margin-top:20px;border-top:1px solid #e5e7eb;padding-top:10px}
    @media print{button{display:none!important}}
  </style></head><body>

  <div class="hdr">
    <div>
      <div class="logo">🏭 Inbound Booking Slip</div>
      <div style="font-size:11px;color:#6b7280;margin-top:2px">Dock Management System</div>
    </div>
    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
      <button onclick="window.print()" style="background:#059669;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;font-weight:700;font-size:12px">🖨 Print</button>
      <span class="badge">INBOUND</span>
    </div>
  </div>

  <div class="barcode-box">
    ${barSvg}
    <div class="barcode-label">${bkId}</div>
    <div style="font-size:10px;color:#065f46;margin-top:4px;opacity:.7">กรุณาแสดง Barcode นี้ที่ประตูทางเข้า (Inbound)</div>
  </div>

  <div class="section">
    <p><span class="lbl">Booking ID</span><span style="font-family:monospace;font-weight:900;color:#065f46;font-size:15px">${bkId}</span></p>
    <p><span class="lbl">ASN No</span>${booking.asn_no||"—"}</p>
    <p><span class="lbl">Supplier</span>${asn.supplier_name||booking.supplier_code||"—"}</p>
  </div>
  <hr>
  <div class="section">
    <p><span class="lbl">Dock</span>Dock ${booking.dock_no||""}</p>
    <p><span class="lbl">Date</span>${booking.booking_date||""}</p>
    <p><span class="lbl">Time</span>${String(booking.booking_hour||"").slice(0,5)}</p>
  </div>
  <hr>
  <div class="section">
    <p><span class="lbl">Truck</span><span style="font-family:monospace;font-weight:700">${booking.truck_plate||""}</span> (${booking.truck_type||""})</p>
    <p><span class="lbl">Driver</span>${booking.driver_name||""} ${booking.driver_phone||""}</p>
  </div>
  <hr>
  <b style="font-size:13px">Invoices (${invoices.length} invoices | Total: ${totalQty} units)</b>
  <table>
    <thead><tr><th>#</th><th>Invoice No</th><th>PO No</th><th>Date</th><th>Qty</th></tr></thead>
    <tbody>${invRows}</tbody>
    <tfoot><tr><td colspan="4">รวม</td><td style="text-align:right">${totalQty}</td></tr></tfoot>
  </table>

  <div class="footer">พิมพ์เมื่อ ${new Date().toLocaleString("th-TH")} • Dock Management System</div>
  </body></html>`);
  w.document.close();
}

// ── QUEUE TV DISPLAY ─────────────────────────────────────────
export function printQueueTV(calling=[], recent=[], config={}) {
  const w = window.open("","_blank","width=1280,height=720");
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
    body{background:#0a2a6e;color:#fff;font-family:Arial,sans-serif;min-height:100vh;overflow:hidden}
    .hdr{background:#060d2e;padding:16px 32px;display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #F5A800}
    .hdr-title{font-size:22px;font-weight:900;letter-spacing:-.5px}
    .hdr-time{font-size:20px;font-weight:700;color:#F5A800;font-family:monospace}
    .section{padding:20px 32px}
    .section-title{font-size:12px;font-weight:700;color:rgba(255,255,255,.5);text-transform:uppercase;letter-spacing:3px;margin-bottom:14px}
    .calling-grid{display:flex;gap:14px;flex-wrap:wrap}
    .calling-card{background:linear-gradient(135deg,#F5A800,#d97706);border-radius:16px;padding:20px 28px;min-width:190px;text-align:center;animation:pulse 2s infinite;box-shadow:0 8px 32px rgba(245,168,0,.3)}
    @keyframes pulse{0%,100%{box-shadow:0 8px 32px rgba(245,168,0,.3)}50%{box-shadow:0 8px 48px rgba(245,168,0,.6)}}
    .plate{font-size:32px;font-weight:900;font-family:monospace;letter-spacing:4px;color:#1B3A6B}
    .dock{font-size:18px;font-weight:700;margin-top:6px;color:#1B3A6B}
    .sub{font-size:12px;opacity:.8;margin-top:3px;color:#1B3A6B}
    .recent-table{width:100%;border-collapse:collapse;margin-top:8px}
    .recent-table th{padding:9px 14px;text-align:left;background:rgba(255,255,255,.08);font-size:12px;font-weight:700;border-bottom:1px solid rgba(255,255,255,.1)}
    .recent-table td{padding:9px 14px;border-bottom:1px solid rgba(255,255,255,.06);font-size:14px}
    .empty{text-align:center;padding:32px;color:rgba(255,255,255,.35);font-size:14px}
    .divider{height:1px;background:rgba(255,255,255,.08);margin:0 32px}
  </style></head><body>
  <div class="hdr">
    <div class="hdr-title">🏭 ${config.PLANT_NAME||"Dock Management System"} — Queue Display</div>
    <div class="hdr-time" id="clock"></div>
  </div>
  <div class="section">
    <div class="section-title">📢 กำลังเรียก</div>
    ${calling.length
      ? `<div class="calling-grid">${callingHTML}</div>`
      : '<div class="empty">ไม่มีรถที่กำลังถูกเรียก</div>'}
  </div>
  <div class="divider"></div>
  <div class="section">
    <div class="section-title">📋 ล่าสุด</div>
    ${recent.length
      ? `<table class="recent-table"><thead><tr><th>ทะเบียน</th><th>Dock</th><th>SubCon</th><th>เวลาเรียก</th></tr></thead><tbody>${recentHTML}</tbody></table>`
      : '<div class="empty">ยังไม่มีประวัติ</div>'}
  </div>
  <script>
    function tick(){document.getElementById('clock').textContent=new Date().toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit',second:'2-digit'});}
    tick(); setInterval(tick,1000);
  </script>
  </body></html>`);
  w.document.close();
}
