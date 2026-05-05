// ─────────────────────────────────────────────────────────────
//  permissions.js — Role & Permission Control
//
//  Roles:
//    cs        = staff ของ YCH (ทำ OBD/Group/Booking แทน subcon)
//    gate      = พนักงานหน้า Gate
//    warehouse = พนักงาน Warehouse
//    queue     = Operator เรียกคิว
//    manager   = Supervisor/Manager
//    admin     = System Admin
//    supplier  = Subcon/Supplier (เห็นแค่ข้อมูลของตัวเอง)
// ─────────────────────────────────────────────────────────────

// ── Role groups ───────────────────────────────────────────────
export const isInternal = (role) =>
  ["cs","gate","warehouse","queue","manager","admin"].includes(role);

// subcon = บริษัทขนส่ง (MON, CLS) → เห็น OBD/Booking ของตัวเอง
// supplier = ผู้ส่งสินค้า Inbound → เห็นแค่ Supplier Portal
export const isSubcon   = (role) => role === "subcon";
export const isSupplier = (role) => role === "supplier";

// ── Permissions ───────────────────────────────────────────────
export const can = {
  // OBD — cs + subcon (ของตัวเอง), manager/admin (ทั้งหมด)
  createOBD:    (role) => ["cs","manager","admin"].includes(role),  // subcon ไม่สร้างเอง
  cancelOBD:    (role) => ["cs","subcon","manager","admin"].includes(role),
  createGroup:  (role) => ["cs","subcon","manager","admin"].includes(role),
  cancelGroup:  (role) => ["manager","admin"].includes(role),
  viewAllOBD:   (role) => ["cs","manager","admin"].includes(role),

  // Booking — subcon จอง Dock ได้ (ของตัวเอง)
  createBooking:  (role) => ["cs","subcon","manager","admin"].includes(role),
  cancelBooking:  (role) => ["cs","subcon","manager","admin"].includes(role),
  viewAllBookings:(role) => ["cs","manager","admin","gate","warehouse"].includes(role),

  // Gate / Warehouse
  gateAction:   (role) => ["gate","manager","admin"].includes(role),
  whAction:     (role) => ["warehouse","manager","admin"].includes(role),
  viewGate:     (role) => ["gate","warehouse","manager","admin"].includes(role),

  // Queue
  callQueue:    (role) => ["queue","manager","admin"].includes(role),

  // Admin
  adminPanel:   (role) => ["admin"].includes(role),
  configEdit:   (role) => ["admin"].includes(role),

  // Supplier Portal (inbound)
  createASN:    (role) => ["supplier","manager","admin"].includes(role),
};

// ── Data filter — subcon เห็นแค่ของตัวเอง ────────────────────
// ใช้กับ Supabase query
// ถ้า isSubcon → filter by subcon_code
// ถ้า internal → เห็นทั้งหมด
export function applySubconFilter(query, user, column = "subcon_code") {
  // ทั้ง subcon และ supplier เห็นแค่ข้อมูลของตัวเอง
  if ((isSubcon(user.role) || isSupplier(user.role)) && user.subcon_code) {
    return query.eq(column, user.subcon_code);
  }
  return query;
}

// ── Helper สำหรับ UI ──────────────────────────────────────────
export function usePermissions(user) {
  const role = user?.role || "";
  return {
    role,
    isSubcon:    isSubcon(role),
    isSupplier:  isSupplier(role),
    isInternal:  isInternal(role),
    subconCode:  user?.subcon_code || "",

    canCreateOBD:    can.createOBD(role),
    canCancelOBD:    can.cancelOBD(role),
    canCreateGroup:  can.createGroup(role),
    canCancelGroup:  can.cancelGroup(role),
    canViewAllOBD:   can.viewAllOBD(role),

    canCreateBooking:   can.createBooking(role),
    canCancelBooking:   can.cancelBooking(role),
    canViewAllBookings: can.viewAllBookings(role),

    canGateAction:  can.gateAction(role),
    canWhAction:    can.whAction(role),
    canCallQueue:   can.callQueue(role),
    canAdminPanel:  can.adminPanel(role),
    canCreateASN:   can.createASN(role),
  };
}
