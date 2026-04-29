import React, { useState, useEffect, useCallback } from "react";
import { supabase, today, nowISO, auditLog } from "../lib/supabase";
import { Alert, Spinner, StatusBadge, SectionHeader, Card, Table } from "../components/UI";
import { T, BTN } from "../theme";

const GATE_ACTIONS = {
  RESERVED:       { label: "✓ Check-in เข้า Yard", next: "ON_YARD",        color: T.green  },
  ON_YARD:        { label: "📢 Call to Dock",        next: "CALLED_TO_DOCK", color: T.amber  },
  CALLED_TO_DOCK: { label: "🚛 Confirm Docked",      next: "TRUCK_DOCKED",   color: T.purple },
  TRUCK_DOCKED:   { label: "⬆ Start Loading",        next: "LOADING",        color: T.blue   },
  LOADING:        { label: "✓ Complete & Release",   next: "COMPLETED",      color: T.green  },
};

const ORDER_ACTIONS = {
  ORDER_CREATED:     { label: "เริ่ม Picking",     next: "PICKING",           color: T.blue   },
  PICKING:           { label: "Ready for Loading", next: "READY_FOR_LOADING", color: T.purple },
  READY_FOR_LOADING: null,
  LOADING:           null,
  COMPLETED:         null,
};

const ALLOWED_ORDER_STATUSES = ["PICKING", "READY_FOR_LOADING"];
const BLOCKED_ORDER_STATUSES = ["BOOKING_PENDING", "COMPLETED"];
const GROUP_SYNC_STATUSES    = ["ON_YARD", "CALLED_TO_DOCK", "TRUCK_DOCKED"];

const STATUS_BG = {
  ON_YARD: "#FEF9C3", CALLED_TO_DOCK: "#FFF7ED",
  TRUCK_DOCKED: "#F5F3FF", LOADING: "#EFF6FF", RESERVED: T.bg,
};
const STATUS_BL = {
  ON_YARD: T.amber, CALLED_TO_DOCK: T.amber,
  TRUCK_DOCKED: T.purple, LOADING: T.blue, RESERVED: T.border,
};

export default function GateApp({ user, onBack }) {
  const [tab, setTab]                   = useState("gate");
  const [scanId, setScanId]             = useState("");
  const [found, setFound]               = useState(null);
  const [group, setGroup]               = useState(null);
  const [groupDetails, setGroupDetails] = useState([]);
  const [order, setOrder]               = useState(null);
  const [activeList, setActiveList]     = useState([]);
  const [auditRows, setAuditRows]       = useState([]);
  const [loading, setLoading]           = useState(false);
  const [msg, setMsg]                   = useState(null);
  const [acting, setActing]             = useState(false);

  const isGate = ["gate", "admin", "manager"].includes(user?.role);
  const isWH   = ["warehouse", "admin", "manager"].includes(user?.role);

  // ── loadActive: bookings + group_orders join ──────────────────────────
  const loadActive = useCallback(async () => {
    const [{ data: bookings }, { data: groupOrders }] = await Promise.all([
      supabase.from("bookings")
        .select("*")
        .in("status", ["RESERVED","ON_YARD","CALLED_TO_DOCK","TRUCK_DOCKED","LOADING"])
        .eq("booking_date", today())
        .order("booking_hour"),
      supabase.from("group_orders").select("group_number, status"),
    ]);
    const orderMap = {};
    (groupOrders || []).forEach(o => { orderMap[o.group_number] = o.status; });
    setActiveList(
      (bookings || []).map(b => ({ ...b, orderStatus: orderMap[b.group_number] || "" }))
    );
  }, []);

  // ── loadAuditLogs ─────────────────────────────────────────────────────
  const loadAuditLogs = useCallback(async () => {
    const { data } = await supabase
      .from("audit_log")
      .select("*")
      .order("timestamp", { ascending: false })
      .limit(500);
    setAuditRows(data || []);
  }, []);

  useEffect(() => { loadActive(); }, [loadActive]);
  useEffect(() => { if (tab === "audit") loadAuditLogs(); }, [tab, loadAuditLogs]);

  useEffect(() => {
    const ch = supabase.channel("gate_live")
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, loadActive)
      .on("postgres_changes", { event: "*", schema: "public", table: "group_header" }, loadActive)
      .subscribe(s => { if (s === "CHANNEL_ERROR") console.warn("Gate realtime error"); });
    return () => supabase.removeChannel(ch);
  }, [loadActive]);

  // ── handleScan ────────────────────────────────────────────────────────
  const handleScan = async e => {
    e.preventDefault();
    setLoading(true); setMsg(null);
    setFound(null); setGroup(null); setGroupDetails([]); setOrder(null);
    const id = scanId.trim();

    if (id.startsWith("IN")) {
      // ── Inbound path ──
      // inbound_bookings columns: booking_id, asn_no, supplier_code,
      //   booking_date, booking_hour, dock_no, slot_key, truck_plate,
      //   truck_type, driver_name, driver_phone, status, check_in_time
      const { data: bk } = await supabase
        .from("inbound_bookings").select("*").eq("booking_id", id).single();
      if (!bk) { setFound("not_found"); setLoading(false); return; }

      const [{ data: asn }, { data: invoices }, { data: details }] = await Promise.all([
        supabase.from("asn_header").select("*").eq("asn_no", bk.asn_no).single(),
        supabase.from("asn_invoice").select("*").eq("asn_no", bk.asn_no),
        supabase.from("asn_detail").select("*").eq("asn_no", bk.asn_no),
      ]);
      setGroup(asn || null);
      setGroupDetails(details || []);
      setFound({ ...bk, _type: "inbound", _invoices: invoices || [] });

    } else {
      // ── Outbound path ──
      const { data: bk } = await supabase
        .from("bookings").select("*").eq("booking_id", id).single();
      if (!bk) { setFound("not_found"); setLoading(false); return; }

      if (bk.group_number) {
        const [{ data: gh }, { data: gd }, { data: go }] = await Promise.all([
          supabase.from("group_header").select("*").eq("group_number", bk.group_number).single(),
          // group_detail columns: id, group_number, obd_no, qty, line_count, status
          supabase.from("group_detail").select("*").eq("group_number", bk.group_number),
          supabase.from("group_orders").select("*").eq("order_no", "GO-" + bk.group_number).single(),
        ]);
        setGroup(gh || null);
        setGroupDetails(gd || []);
        setOrder(go || null);
      }
      setFound({ ...bk, _type: "outbound" });
    }
    setLoading(false);
  };

  const clearScan = () => {
    setScanId(""); setFound(null); setGroup(null);
    setGroupDetails([]); setOrder(null); setMsg(null);
  };

  // ── doAction: gate steps ──────────────────────────────────────────────
  const doAction = async (bookingId, newStatus, type = "outbound") => {
    setActing(true); setMsg(null);

    if (newStatus === "LOADING"   && type === "outbound") { await startLoading(bookingId); setActing(false); return; }
    if (newStatus === "COMPLETED" && type === "outbound") { await releaseDock(bookingId);  setActing(false); return; }

    const update = { status: newStatus, updated_at: nowISO() };
    if (newStatus === "ON_YARD") update.check_in_time = nowISO();

    const table = type === "inbound" ? "inbound_bookings" : "bookings";
    const { error } = await supabase.from(table).update(update).eq("booking_id", bookingId);
    if (error) { setMsg({ type: "err", msg: error.message }); setActing(false); return; }

    // group_header: ไม่มี updated_at column — ส่งแค่ status
    if (type === "outbound" && found?.group_number && GROUP_SYNC_STATUSES.includes(newStatus)) {
      await supabase.from("group_header")
        .update({ status: newStatus })
        .eq("group_number", found.group_number);
    }

    // Inbound COMPLETED: mark ASN received + release slot
    if (type === "inbound" && newStatus === "COMPLETED") {
      await supabase.from("asn_header")
        .update({ status: "RECEIVED", updated_at: nowISO() })
        .eq("asn_no", found.asn_no);
      if (found.slot_key)
        await supabase.from("dock_slots")
          // dock_slots: group_ref ไม่ใช่ group_number
          .update({ status: "AVAILABLE", booking_id: null, group_ref: null })
          .eq("slot_key", found.slot_key);
    }

    await auditLog({
      module: "GATE", action: newStatus,
      targetType: type === "inbound" ? "INBOUND_BOOKING" : "BOOKING",
      targetId: bookingId,
      subconCode:  group?.subcon_code   || "",
      groupNumber: found?.group_number  || "",
      bookingId,
      actor: user.username,
      remark: `→ ${newStatus}`,
    });

    setMsg({ type: "ok", msg: `✅ อัปเดตสถานะเป็น ${newStatus} สำเร็จ` });
    setFound(p => ({ ...p, ...update }));
    loadActive();
    setActing(false);
  };

  // ── startLoading_ ─────────────────────────────────────────────────────
  const startLoading = async bookingId => {
    if (!["TRUCK_DOCKED", "LOADING"].includes(found?.status)) {
      setMsg({ type: "err", msg: `Truck ต้องเป็น TRUCK_DOCKED ก่อน (ปัจจุบัน: ${found?.status})` });
      return;
    }
    const now = nowISO();
    const gn  = found?.group_number;

    const ops = [
      supabase.from("bookings")
        .update({ status: "LOADING", updated_at: now })
        .eq("booking_id", bookingId),
      // group_header ไม่มี updated_at
      supabase.from("group_header")
        .update({ status: "LOADING" })
        .eq("group_number", gn),
    ];
    if (order)
      ops.push(supabase.from("group_orders")
        .update({ status: "LOADING", updated_at: now })
        .eq("order_no", order.order_no));

    const results = await Promise.all(ops);
    const err = results.find(r => r.error)?.error;
    if (err) { setMsg({ type: "err", msg: err.message }); return; }

    await auditLog({
      module: "WAREHOUSE", action: "START_LOADING",
      targetType: "GROUP", targetId: gn,
      subconCode:  group?.subcon_code || "",
      groupNumber: gn,
      bookingId,
      actor: user.username, remark: "Loading started",
    });
    setMsg({ type: "ok", msg: "✅ เริ่ม Loading สำเร็จ" });
    setFound(p => ({ ...p, status: "LOADING", updated_at: now }));
    if (order) setOrder(p => ({ ...p, status: "LOADING" }));
    loadActive();
  };

  // ── releaseDock_ ──────────────────────────────────────────────────────
  const releaseDock = async bookingId => {
    const now = nowISO();
    const gn  = found?.group_number;

    const ops = [
      supabase.from("bookings")
        .update({ status: "RELEASED", updated_at: now })
        .eq("booking_id", bookingId),
      // group_header: ไม่มี updated_at, clear dock_no ด้วย (mirrors GAS v2 fix)
      supabase.from("group_header")
        .update({ status: "COMPLETED", dock_no: null })
        .eq("group_number", gn),
    ];

    if (found?.slot_key)
      ops.push(supabase.from("dock_slots")
        // dock_slots: group_ref ไม่ใช่ group_number
        .update({ status: "AVAILABLE", booking_id: null, group_ref: null })
        .eq("slot_key", found.slot_key));

    if (order)
      ops.push(supabase.from("group_orders")
        .update({ status: "COMPLETED", updated_at: now })
        .eq("order_no", order.order_no));

    const results = await Promise.all(ops);
    const err = results.find(r => r.error)?.error;
    if (err) { setMsg({ type: "err", msg: err.message }); return; }

    await auditLog({
      module: "DOCK", action: "RELEASE_DOCK",
      targetType: "BOOKING", targetId: bookingId,
      subconCode:  group?.subcon_code || "",
      groupNumber: gn,
      bookingId,
      actor: user.username, remark: "Dock released",
    });
    setMsg({ type: "ok", msg: "✅ Release Dock สำเร็จ" });
    setFound(p => ({ ...p, status: "COMPLETED", dock_no: null }));
    if (order) setOrder(p => ({ ...p, status: "COMPLETED" }));
    loadActive();
  };

  // ── createGroupOrder_ ─────────────────────────────────────────────────
  const createOrder = async () => {
    if (!found || found._type !== "outbound") return;
    if (BLOCKED_ORDER_STATUSES.includes(group?.status)) {
      setMsg({ type: "err", msg: `ไม่สามารถสร้าง Order ที่ status: ${group?.status}` });
      return;
    }
    const orderNo = "GO-" + found.group_number;
    const { error } = await supabase.from("group_orders").insert({
      order_no:     orderNo,
      group_number: found.group_number,
      total_obd:    group?.total_obd || 0,
      total_qty:    group?.total_qty || 0,
      status:       "ORDER_CREATED",
      created_by:   user.username,
    });
    if (error) return setMsg({ type: "err", msg: error.message });

    const { data: o } = await supabase
      .from("group_orders").select("*").eq("order_no", orderNo).single();
    setOrder(o || null);

    await auditLog({
      module: "WAREHOUSE", action: "CREATE_ORDER",
      targetType: "ORDER", targetId: orderNo,
      subconCode:  group?.subcon_code  || "",
      groupNumber: found.group_number,
      bookingId:   found.booking_id,
      actor: user.username, remark: "Order created",
    });
    setMsg({ type: "ok", msg: `✅ สร้าง Order ${orderNo} สำเร็จ` });
  };

  // ── updateOrderStatus_ ────────────────────────────────────────────────
  const updateOrder = async newStatus => {
    if (!order) return;
    if (!ALLOWED_ORDER_STATUSES.includes(newStatus)) {
      setMsg({ type: "err", msg: `Invalid order status: ${newStatus}` });
      return;
    }
    const { error } = await supabase.from("group_orders")
      .update({ status: newStatus, updated_at: nowISO() })
      .eq("order_no", order.order_no);
    if (error) return setMsg({ type: "err", msg: error.message });

    setOrder(p => ({ ...p, status: newStatus }));
    await auditLog({
      module: "WAREHOUSE", action: "UPDATE_ORDER",
      targetType: "ORDER", targetId: order.order_no,
      groupNumber: found?.group_number || "",
      bookingId:   found?.booking_id   || "",
      actor: user.username, remark: `→ ${newStatus}`,
    });
    setMsg({ type: "ok", msg: `✅ Order status → ${newStatus}` });
  };

  // ── Tab strip ─────────────────────────────────────────────────────────
  const TabStrip = () => (
    <div style={{ display: "flex", gap: 4, background: "rgba(255,255,255,.15)", borderRadius: 8, padding: 3 }}>
      {[["gate","🔍 Gate"],["active","📋 Active"],["audit","📜 Audit"]].map(([t, l]) => (
        <button key={t} onClick={() => setTab(t)} style={{
          border: "none", borderRadius: 6, padding: "4px 10px",
          fontWeight: 700, fontSize: 11, cursor: "pointer",
          background: tab === t ? T.white : "transparent",
          color: tab === t ? T.goldDark : "rgba(255,255,255,.85)",
        }}>{l}</button>
      ))}
    </div>
  );

  // ── RENDER ────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: T.bg }}>

      {/* Topbar — inline pattern เหมือน BookingApp */}
      <div style={{
        background: T.topbarGrad, color: T.white,
        padding: "13px 18px", display: "flex", alignItems: "center",
        gap: 10, flexWrap: "wrap", position: "sticky", top: 0, zIndex: 40,
        boxShadow: "0 2px 12px rgba(18,40,80,.25)",
        borderBottom: `3px solid ${T.gold}`,
      }}>
        <button onClick={onBack} style={{ border: "1px solid rgba(255,255,255,.25)", background: "rgba(255,255,255,.08)", color: T.white, borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>← Back</button>
        <div style={{ width: 28, height: 28, borderRadius: 6, background: T.gold, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 11, color: T.navy, flexShrink: 0 }}>YCH</div>
        <span style={{ fontWeight: 800, fontSize: 15 }}>🏭 Gate & Warehouse</span>
        <TabStrip />
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#4ADE80", display: "inline-block", boxShadow: "0 0 0 3px rgba(74,222,128,.25)" }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: "#86EFAC" }}>LIVE</span>
        </div>
      </div>

      <div style={{ padding: 14, maxWidth: 900, margin: "0 auto" }}>
        {msg && <Alert type={msg.type} msg={msg.msg} />}

        {/* ── GATE TAB ─────────────────────────────────────────── */}
        {tab === "gate" && (
          <div style={{ background: T.bgCard, borderRadius: 14, padding: 18, marginBottom: 14, boxShadow: T.shadow, border: `1px solid ${T.border}` }}>
            <SectionHeader title="🔍 Scan Booking ID" />
            <form onSubmit={handleScan} style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <input
                value={scanId} onChange={e => setScanId(e.target.value)}
                placeholder="BOOKING ID" autoCapitalize="characters"
                style={{ flex: 1, padding: "12px 14px", border: `2.5px solid ${T.gold}`, borderRadius: 10, fontSize: 14, fontWeight: 700, fontFamily: "monospace", letterSpacing: 2, outline: "none" }}
              />
              <button type="submit" disabled={loading} style={{ ...BTN.primary, padding: "0 18px" }}>ค้นหา</button>
              <button type="button" onClick={clearScan} style={{ ...BTN.ghost, padding: "0 12px" }}>✕</button>
            </form>

            {loading && <Spinner />}
            {found === "not_found" && <Alert type="err" msg="ไม่พบ Booking ID นี้" />}

            {found && found !== "not_found" && (
              <div style={{ padding: 14, background: T.goldPale, border: `1.5px solid ${T.goldLight}`, borderRadius: 10 }}>

                {/* Booking info */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                  <div>
                    <div style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 900, color: T.navy }}>{found.booking_id}</div>
                    <div style={{ fontSize: 12, color: T.textSecond, marginTop: 2 }}>
                      {found._type === "inbound" ? `ASN: ${found.asn_no}` : `Group: ${found.group_number}`}
                      {" • "} Dock {found.dock_no} • {String(found.booking_hour || "").slice(0, 5)} • {found.booking_date}
                    </div>
                    <div style={{ fontSize: 11, color: T.textMuted, marginTop: 1 }}>
                      {found.truck_plate} • {found.driver_name}
                      {/* inbound_bookings ใช้ driver_phone, bookings ใช้ phone */}
                      {" • "}{found._type === "inbound" ? found.driver_phone : found.phone}
                    </div>
                    {found.check_in_time && (
                      <div style={{ fontSize: 11, color: T.green, fontWeight: 700, marginTop: 1 }}>
                        Check-in: {new Date(found.check_in_time).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    )}
                    <div style={{ marginTop: 5 }}>
                      <span style={{ fontSize: 10, background: found._type === "inbound" ? T.greenBg : T.blueBg, color: found._type === "inbound" ? T.green : T.blue, borderRadius: 999, padding: "1px 8px", fontWeight: 700 }}>
                        {found._type === "inbound" ? "📥 INBOUND" : "📤 OUTBOUND"}
                      </span>
                    </div>
                  </div>
                  <StatusBadge status={found.status} size={11} />
                </div>

                {/* group_detail rows — column จริงคือ obd_no, qty */}
                {found._type === "outbound" && groupDetails.length > 0 && (
                  <div style={{ marginBottom: 10, padding: 10, background: "rgba(255,255,255,.7)", borderRadius: 8 }}>
                    <div style={{ fontWeight: 700, color: T.navy, fontSize: 12, marginBottom: 6 }}>
                      รายการ OBD ({groupDetails.length} รายการ)
                    </div>
                    {groupDetails.map((d, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: `1px solid ${T.border}`, fontSize: 12 }}>
                        <span style={{ color: T.textSecond }}>{d.obd_no || "—"}</span>
                        {/* column จริงคือ qty ไม่ใช่ total_qty */}
                        <span style={{ color: T.textMuted }}>{d.qty || 0} pcs</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* ASN detail rows — inbound */}
                {found._type === "inbound" && groupDetails.length > 0 && (
                  <div style={{ marginBottom: 10, padding: 10, background: "rgba(255,255,255,.7)", borderRadius: 8 }}>
                    <div style={{ fontWeight: 700, color: T.navy, fontSize: 12, marginBottom: 6 }}>
                      รายการสินค้า ({groupDetails.length} รายการ)
                    </div>
                    {groupDetails.map((d, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: `1px solid ${T.border}`, fontSize: 12 }}>
                        <span style={{ color: T.textSecond }}>{d.item_code} — {d.item_name}</span>
                        <span style={{ color: T.textMuted }}>{d.qty_shipped || 0} {d.unit}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Gate action */}
                {isGate && GATE_ACTIONS[found.status] && (
                  <button
                    onClick={() => doAction(found.booking_id, GATE_ACTIONS[found.status].next, found._type)}
                    disabled={acting}
                    style={{ width: "100%", padding: 10, marginBottom: 8, border: "none", borderRadius: 9, fontWeight: 700, cursor: "pointer", fontSize: 13, opacity: acting ? 0.6 : 1, background: GATE_ACTIONS[found.status].color, color: T.white }}
                  >
                    {GATE_ACTIONS[found.status].label}
                  </button>
                )}

                {/* Warehouse order panel */}
                {isWH && found._type === "outbound" && ["TRUCK_DOCKED", "LOADING"].includes(found.status) && (
                  <div style={{ marginTop: 8, padding: 12, background: T.blueBg, borderRadius: 9, border: `1px solid #BFDBFE` }}>
                    <div style={{ fontWeight: 700, color: T.blue, fontSize: 13, marginBottom: 8 }}>📋 Warehouse Order</div>
                    {!order ? (
                      <button onClick={createOrder} style={{ ...BTN.secondary, padding: "7px 14px", fontSize: 12 }}>
                        + สร้าง Order
                      </button>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700 }}>{order.order_no}</span>
                        <StatusBadge status={order.status} size={10} />
                        {ORDER_ACTIONS[order.status] && (
                          <button
                            onClick={() => updateOrder(ORDER_ACTIONS[order.status].next)}
                            style={{ border: "none", borderRadius: 7, padding: "4px 10px", fontWeight: 700, cursor: "pointer", fontSize: 11, background: ORDER_ACTIONS[order.status].color, color: T.white }}
                          >
                            {ORDER_ACTIONS[order.status].label}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── ACTIVE TAB ───────────────────────────────────────── */}
        {tab === "active" && (
          <div style={{ background: T.bgCard, borderRadius: 14, padding: 18, boxShadow: T.shadow, border: `1px solid ${T.border}` }}>
            <SectionHeader title="🚛 Active วันนี้" count={activeList.length} onRefresh={loadActive} />
            {activeList.length === 0 ? (
              <p style={{ textAlign: "center", color: T.textMuted, padding: 20, fontSize: 12 }}>ไม่มี Active Booking วันนี้</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {activeList.map(b => {
                  const act = GATE_ACTIONS[b.status];
                  return (
                    <div key={b.booking_id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderRadius: 10, gap: 10, flexWrap: "wrap", background: STATUS_BG[b.status] || T.bg, borderLeft: "3px solid", borderLeftColor: STATUS_BL[b.status] || T.border }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 12, color: T.navy }}>{b.truck_plate || "—"}</span>
                          <span style={{ fontSize: 11, color: T.textMuted }}>D{b.dock_no} • {String(b.booking_hour || "").slice(0, 5)}</span>
                          {b.check_in_time && (
                            <span style={{ fontSize: 11, color: T.green, fontWeight: 700 }}>
                              ✓ {new Date(b.check_in_time).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          )}
                          {b.orderStatus && (
                            <span style={{ fontSize: 10, background: T.blueBg, color: T.blue, borderRadius: 999, padding: "1px 6px", fontWeight: 700 }}>
                              {b.orderStatus}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 10, color: T.textMuted, marginTop: 2, fontFamily: "monospace" }}>{b.booking_id}</div>
                      </div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <StatusBadge status={b.status} />
                        {isGate && act && (
                          <button
                            onClick={() => doAction(b.booking_id, act.next, "outbound")}
                            style={{ border: "none", borderRadius: 7, padding: "4px 10px", fontWeight: 700, cursor: "pointer", fontSize: 11, background: act.color, color: T.white }}
                          >
                            {act.label}
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setScanId(b.booking_id); setTab("gate");
                            setTimeout(() => document.querySelector("form")?.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true })), 100);
                          }}
                          style={{ ...BTN.ghost, padding: "4px 10px" }}
                        >
                          เปิด
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── AUDIT TAB ────────────────────────────────────────── */}
        {tab === "audit" && (
          <div style={{ background: T.bgCard, borderRadius: 14, padding: 18, boxShadow: T.shadow, border: `1px solid ${T.border}` }}>
            <SectionHeader title="📜 Audit Log" count={auditRows.length} onRefresh={loadAuditLogs} />
            <Table
              headers={["เวลา", "Module", "Action", "Target ID", "Actor", "Remark"]}
              emptyText="ไม่มีข้อมูล"
              rows={auditRows.map(r => [
                r.timestamp
                  ? new Date(r.timestamp).toLocaleString("th-TH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
                  : "—",
                r.module,
                r.action,
                r.target_id,
                r.actor,
                r.remark,
              ])}
            />
          </div>
        )}
      </div>
    </div>
  );
}
