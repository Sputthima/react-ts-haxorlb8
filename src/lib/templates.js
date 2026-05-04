// ─────────────────────────────────────────────────────────────
//  templates.js — CSV Template Download
//  ใช้ในทุก app ที่มี bulk import
// ─────────────────────────────────────────────────────────────

function downloadCSV(filename, headers, rows) {
  const escape = (v) => {
    const s = String(v ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [
    headers.map(escape).join(","),
    ...rows.map(r => headers.map(h => escape(r[h] ?? r[Object.keys(r)[headers.indexOf(h)]] ?? "")).join(","))
  ].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }); // BOM for Excel Thai
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── OBD Bulk Import Template ──────────────────────────────────
// ใช้ใน OBDApp → Import CSV
export function downloadOBDTemplate() {
  const headers = ["obdNo","subConCode","releaseDate","qty","lineCount","remarks"];
  const examples = [
    { obdNo:"MN26050101", subConCode:"MON", releaseDate:"2026-05-01", qty:"300", lineCount:"3", remarks:"" },
    { obdNo:"MN26050102", subConCode:"MON", releaseDate:"2026-05-01", qty:"150", lineCount:"2", remarks:"ด่วน" },
    { obdNo:"CL26050101", subConCode:"CLS", releaseDate:"2026-05-01", qty:"200", lineCount:"1", remarks:"" },
  ];
  downloadCSV("OBD_Import_Template.csv", headers, examples);
}

// ── ASN Bulk Import Template ──────────────────────────────────
// ใช้ใน SupplierApp → Bulk Import
// หลาย row ที่มี truckPlate+date+hour+dock เดียวกัน = 1 ASN
// หลาย row ที่มี invoiceNo เดียวกัน = 1 Invoice
export function downloadASNTemplate() {
  const headers = [
    "truckPlate","bookingDate","bookingHour","dockNo",
    "shipDate","truckType","driverName","driverPhone",
    "invoiceNo","invoiceDate","poNo",
    "itemCode","itemName","unit","qtyShipped","lotNo","expiryDate"
  ];
  const examples = [
    // ASN 1: truck 80-1234 → 2 invoice, invoice 1 มี 2 items
    { truckPlate:"80-1234", bookingDate:"2026-05-02", bookingHour:"08:00", dockNo:"1",
      shipDate:"2026-05-02", truckType:"6W", driverName:"สมชาย ใจดี", driverPhone:"0812345678",
      invoiceNo:"INV-2026-001", invoiceDate:"2026-05-01", poNo:"PO-001",
      itemCode:"A001", itemName:"สินค้า A", unit:"CTN", qtyShipped:"100", lotNo:"LOT001", expiryDate:"" },
    { truckPlate:"80-1234", bookingDate:"2026-05-02", bookingHour:"08:00", dockNo:"1",
      shipDate:"2026-05-02", truckType:"6W", driverName:"สมชาย ใจดี", driverPhone:"0812345678",
      invoiceNo:"INV-2026-001", invoiceDate:"2026-05-01", poNo:"PO-001",
      itemCode:"A002", itemName:"สินค้า B", unit:"CTN", qtyShipped:"50", lotNo:"LOT001", expiryDate:"2026-12-31" },
    { truckPlate:"80-1234", bookingDate:"2026-05-02", bookingHour:"08:00", dockNo:"1",
      shipDate:"2026-05-02", truckType:"6W", driverName:"สมชาย ใจดี", driverPhone:"0812345678",
      invoiceNo:"INV-2026-002", invoiceDate:"2026-05-01", poNo:"PO-002",
      itemCode:"B001", itemName:"สินค้า C", unit:"PCS", qtyShipped:"200", lotNo:"", expiryDate:"" },
    // ASN 2: truck อีกคัน
    { truckPlate:"กข-5678", bookingDate:"2026-05-02", bookingHour:"10:00", dockNo:"2",
      shipDate:"2026-05-02", truckType:"10W", driverName:"วิชัย รักดี", driverPhone:"0898765432",
      invoiceNo:"INV-2026-003", invoiceDate:"2026-05-01", poNo:"PO-003",
      itemCode:"C001", itemName:"สินค้า D", unit:"BOX", qtyShipped:"300", lotNo:"LOT002", expiryDate:"" },
  ];
  downloadCSV("ASN_Import_Template.csv", headers, examples);
}

// ── Inbound Booking Template (GateApp / InboundApp) ───────────
export function downloadInboundTemplate() {
  const headers = [
    "bookingDate","bookingHour","dockNo","supplierCode",
    "truckPlate","truckType","driverName","driverPhone","remarks"
  ];
  const examples = [
    { bookingDate:"2026-05-02", bookingHour:"09:00", dockNo:"3",
      supplierCode:"SUP001", truckPlate:"ชม-1234", truckType:"6W",
      driverName:"ประสิทธิ์ มั่นคง", driverPhone:"0856789012", remarks:"" },
  ];
  downloadCSV("Inbound_Booking_Template.csv", headers, examples);
}
