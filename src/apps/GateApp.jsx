import React, { useState, useEffect, useCallback } from "react";
import { supabase, today, nowISO, auditLog } from "../lib/supabase";
import { Alert, Spinner, StatusBadge, SectionHeader } from "../components/UI";
import { T, BTN } from "../theme";

// ── Status flows ──────────────────────────────────────────────────────────
// TRUCK:  RESERVED → ON_YARD → CALLED_TO_DOCK → TRUCK_DOCKED → LOADING → COMPLETED
// ORDER:  ORDER_CREATED → PICKING → READY_FOR_LOADING → (LOADING via startLoading) → COMPLETED

const GATE_ACTIONS = {
  RESERVED:       { label: "✓ Check-in เข้า Yard", next: "ON_YARD",        color: T.green  },
  ON_YARD:        { label: "📢 Call to Dock",        next: "CALLED_TO_DOCK", color: T.amber  },
  CALLED_TO_DOCK: { label: "🚛 Confirm Docked",      next: "TRUCK_DOCKED",   color: T.purple },
  // TRUCK_DOCKED → LOADING handled by startLoading_ (requires READY_FOR_LOADING)
  // LOADING → COMPLETED handled by releaseDock_
};

const ORDER_ACTIONS = {
  ORDER_CREATED: { label: "เริ่ม Picking",     next: "PICKING",           color: T.blue   },
  PICKING:       { label: "Ready for Loading", next: "READY_FOR_LOADING", color: T.purple },
  READY_FOR_LOADING: null,
  LOADING:           null,
  COMPLETED:         null,
};

const ALLOWED_ORDER_STATUSES = ["PICKING", "READY_FOR_LOADING"];
// ชีวิตจริง: สร้าง order ได้ตั้งแต่ BOOKED (ก่อน truck check-in)
const BLOCKED_ORDER_STATUSES = ["COMPLETED"];
const GROUP_SYNC_STATUSES    = ["ON_YARD", "CALLED_TO_DOCK", "TRUCK_DOCKED"];

// Truck status ที่แสดงใน Active list
const ACTIVE_TRUCK_STATUSES = ["RESERVED","ON_YARD","CALLED_TO_DOCK","TRUCK_DOCKED","LOADING"];

const TRUCK_STEPS = ["BOOKED","ON_YARD","CALLED_TO_DOCK","TRUCK_DOCKED","LOADING","COMPLETED"];
const ORDER_STEPS = ["ORDER_CREATED","PICKING","READY_FOR_LOADING","COMPLETED"];

const STATUS_BG = {
  ON_YARD: "#FEF9C3", CALLED_TO_DOCK: "#FFF7ED",
  TRUCK_DOCKED: "#F5F3FF", LOADING: "#EFF6FF",
  RESERVED: T.bg, BOOKED: T.greenBg,
};
const STATUS_BL = {
  ON_YARD: T.amber, CALLED_TO_DOCK: T.amber,
  TRUCK_DOCKED: T.purple, LOADING: T.blue,
  RESERVED: T.border, BOOKED: T.green,
};

// ── Stepper component ─────────────────────────────────────────────────────
function Stepper({ steps, current, colorMap = {} }) {
  const idx = steps.indexOf(current);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0, flexWrap: "nowrap", overflowX: "auto", paddingBottom: 4 }}>
      {steps.map((s, i) => {
        const done    = i < idx;
        const active  = i === idx;
        const pending = i > idx;
        const col     = colorMap[s] || (active ? T.gold : done ? T.green : T.border);
        return (
          <React.Fragment key={s}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 60 }}>
              <div style={{
                width: 28, height: 28, borderRadius: "50%",
                background: active ? T.gold : done ? T.green : T.bg,
                border: `2px solid ${col}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 12, fontWeight: 800,
                color: active ? T.white : done ? T.white : T.textMuted,
                transition: "all .2s",
              }}>
                {done ? "✓" : i + 1}
              </div>
              <div style={{ fontSize: 9, marginTop: 3, color: active ? T.goldDark : done ? T.green : T.textMuted, fontWeight: active ? 800 : 600, textAlign: "center", whiteSpace: "nowrap" }}>
                {s.replace(/_/g, " ")}
              </div>
            </div>
            {i < steps.length - 1 && (
              <div style={{ flex: 1, height: 2, minWidth: 12, background: done ? T.green : T.border, margin: "0 2px", marginBottom: 18, transition: "background .2s" }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export default function GateApp({ user, onBack }) {
  const [tab, setTab]                   = useState("gate");

  // Gate tab state
  const [scanId, setScanId]             = useState("");
  const [found, setFound]               = useState(null);   // booking row | "not_found"
  const [group, setGroup]               = useState(null);
  const [activeList, setActiveList]     = useState([]);
  const [gateLoading, setGateLoading]   = useState(false);
  const [gateMsg, setGateMsg]           = useState(null);
  const [acting, setActing]             = useState(false);

  // Warehouse tab state
  const [whScanId, setWhScanId]         = useState("");
  const [whGroup, setWhGroup]           = useState(null);   // group_header
  const [whGroupDetails, setWhGroupDetails] = useState([]); // group_detail rows
  const [whOrder, setWhOrder]           = useState(null);   // group_orders
  const [whBooking, setWhBooking]       = useState(null);   // bookings row
  const [whLoading, setWhLoading]       = useState(false);
  const [whMsg, setWhMsg]               = useState(null);
  const [whActing, setWhActing]         = useState(false);
  const [activeGroups, setActiveGroups] = useState([]);

  const isGate = ["gate", "admin", "manager"].includes(user?.role);
  const isWH   = ["warehouse", "admin", "manager"].includes(user?.role);

  // ── loadActive: active booking list + orderStatus join ────────────────
  const loadActive = useCallback(async () => {
    const [{ data: bookings }, { data: groupOrders }] = await Promise.all([
      supabase.from("bookings")
        .select("booking_id, group_number, booking_date, booking_hour, dock_no, truck_plate, subcon_code, status, check_in_time")
        .in("status", ACTIVE_TRUCK_STATUSES)
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

  // ── loadActiveGroups: warehouse Active Groups table (right panel) ──────
  const loadActiveGroups = useCallback(async () => {
    const activeStatuses = ["BOOKED","ON_YARD","CALLED_TO_DOCK","TRUCK_DOCKED","LOADING","COMPLETED"];
    const [{ data: groups }, { data: orders }] = await Promise.all([
      supabase.from("group_header")
        .select("group_number, subcon_code, status, dock_no, total_qty, booking_id")
        .in("status", activeStatuses)
        .order("group_number", { ascending: false })
        .limit(50),
      supabase.from("group_orders").select("group_number, status"),
    ]);
    const orderMap = {};
    (orders || []).forEach(o => { orderMap[o.group_number] = o.status; });
    setActiveGroups(
      (groups || []).map(g => ({ ...g, orderStatus: orderMap[g.group_number] || "" }))
    );
  }, []);

  useEffect(() => { loadActive(); }, [loadActive]);
  useEffect(() => { if (tab === "warehouse") loadActiveGroups(); }, [tab, loadActiveGroups]);

  // Realtime
  useEffect(() => {
    const ch = supabase.channel("gate_live")
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, () => { loadActive(); if (tab === "warehouse") loadActiveGroups(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "group_header" }, () => loadActiveGroups())
      .on("postgres_changes", { event: "*", schema: "public", table: "group_orders" }, () => loadActiveGroups())
      .subscribe(s => { if (s === "CHANNEL_ERROR") console.warn("Gate realtime error"); });
    return () => supabase.removeChannel(ch);
  }, [loadActive, loadActiveGroups, tab]);

  // ── GATE: scan booking ────────────────────────────────────────────────
  const handleGateScan = async e => {
    e.preventDefault();
    setGateLoading(true); setGateMsg(null); setFound(null); setGroup(null);
    const id = scanId.trim();
    const { data: bk } = await supabase
      .from("bookings").select("*").eq("booking_id", id).single();
    if (!bk) { setFound("not_found"); setGateLoading(false); return; }
    if (bk.group_number) {
      const { data: gh } = await supabase
        .from("group_header").select("*").eq("group_number", bk.group_number).single();
      setGroup(gh || null);
    }
    setFound(bk);
    setGateLoading(false);
  };

  // ── GATE: doAction (gateCheckIn / callToDock / confirmTruckDocked) ────
  const doGateAction = async (bookingId, newStatus) => {
    setActing(true); setGateMsg(null);

    const update = { status: newStatus, updated_at: nowISO() };
    if (newStatus === "ON_YARD") update.check_in_time = nowISO();

    const { error } = await supabase.from("bookings").update(update).eq("booking_id", bookingId);
    if (error) { setGateMsg({ type: "err", msg: error.message }); setActing(false); return; }

    if (found?.group_number && GROUP_SYNC_STATUSES.includes(newStatus)) {
      await supabase.from("group_header")
        .update({ status: newStatus })
        .eq("group_number", found.group_number);
    }

    await auditLog({
      module: "GATE", action: newStatus, targetType: "BOOKING", targetId: bookingId,
      subconCode: group?.subcon_code || "", groupNumber: found?.group_number || "",
      bookingId, actor: user.username, remark: `→ ${newStatus}`,
    });

    setGateMsg({ type: "ok", msg: `✅ ${newStatus} สำเร็จ` });
    setFound(p => ({ ...p, ...update }));
    loadActive();
    setActing(false);
  };

  // ── WAREHOUSE: load group by groupNumber ──────────────────────────────
  const loadWhGroup = async (gn) => {
    setWhLoading(true); setWhMsg(null);
    setWhGroup(null); setWhGroupDetails([]); setWhOrder(null); setWhBooking(null);
    if (!gn?.trim()) { setWhLoading(false); return; }

    const [{ data: gh }, { data: gd }, { data: go }] = await Promise.all([
      supabase.from("group_header").select("*").eq("group_number", gn.trim()).single(),
      supabase.from("group_detail").select("*").eq("group_number", gn.trim()),
      supabase.from("group_orders").select("*").eq("order_no", "GO-" + gn.trim()).single(),
    ]);

    if (!gh) { setWhMsg({ type: "err", msg: `ไม่พบ Group: ${gn}` }); setWhLoading(false); return; }
    setWhGroup(gh);
    setWhGroupDetails(gd || []);
    setWhOrder(go || null);

    // load booking if exists
    if (gh.booking_id) {
      const { data: bk } = await supabase.from("bookings").select("*").eq("booking_id", gh.booking_id).single();
      setWhBooking(bk || null);
    }
    setWhLoading(false);
  };

  const handleWhScan = async e => {
    e.preventDefault();
    await loadWhGroup(whScanId);
  };

  const clearWh = () => {
    setWhScanId(""); setWhGroup(null); setWhGroupDetails([]);
    setWhOrder(null); setWhBooking(null); setWhMsg(null);
  };

  // ── WAREHOUSE: createGroupOrder_ (ได้ตั้งแต่ BOOKED) ─────────────────
  const createOrder = async () => {
    if (!whGroup) return;
    if (BLOCKED_ORDER_STATUSES.includes(whGroup.status)) {
      setWhMsg({ type: "err", msg: `ไม่สามารถสร้าง Order ที่ status: ${whGroup.status}` });
      return;
    }
    const orderNo = "GO-" + whGroup.group_number;
    const { error } = await supabase.from("group_orders").insert({
      order_no: orderNo, group_number: whGroup.group_number,
      total_obd: whGroup.total_obd || 0, total_qty: whGroup.total_qty || 0,
      status: "ORDER_CREATED", created_by: user.username,
    });
    if (error) return setWhMsg({ type: "err", msg: error.message });

    const { data: o } = await supabase.from("group_orders").select("*").eq("order_no", orderNo).single();
    setWhOrder(o || null);
    await auditLog({
      module: "WAREHOUSE", action: "CREATE_ORDER", targetType: "ORDER", targetId: orderNo,
      subconCode: whGroup.subcon_code || "", groupNumber: whGroup.group_number,
      bookingId: whGroup.booking_id || "", actor: user.username, remark: "Order created",
    });
    setWhMsg({ type: "ok", msg: `✅ สร้าง Order ${orderNo} สำเร็จ` });
    loadActiveGroups();
  };

  // ── WAREHOUSE: updateOrderStatus_ ────────────────────────────────────
  const updateOrder = async newStatus => {
    if (!whOrder) return;
    if (!ALLOWED_ORDER_STATUSES.includes(newStatus)) {
      setWhMsg({ type: "err", msg: `Invalid order status: ${newStatus}` });
      return;
    }
    const { error } = await supabase.from("group_orders")
      .update({ status: newStatus, updated_at: nowISO() }).eq("order_no", whOrder.order_no);
    if (error) return setWhMsg({ type: "err", msg: error.message });

    setWhOrder(p => ({ ...p, status: newStatus }));
    await auditLog({
      module: "WAREHOUSE", action: "UPDATE_ORDER", targetType: "ORDER", targetId: whOrder.order_no,
      groupNumber: whGroup?.group_number || "", bookingId: whGroup?.booking_id || "",
      actor: user.username, remark: `→ ${newStatus}`,
    });
    setWhMsg({ type: "ok", msg: `✅ Order → ${newStatus}` });
    loadActiveGroups();
  };

  // ── WAREHOUSE: startLoading_ (requires READY_FOR_LOADING) ────────────
  const startLoading = async () => {
    if (!whGroup) return;

    // Guard: order ต้อง READY_FOR_LOADING ก่อน
    if (!whOrder || whOrder.status !== "READY_FOR_LOADING") {
      setWhMsg({ type: "err", msg: "ต้อง Pick order ให้เสร็จ (READY_FOR_LOADING) ก่อนเริ่ม Loading" });
      return;
    }
    // Guard: truck ต้อง TRUCK_DOCKED
    if (!["TRUCK_DOCKED", "LOADING"].includes(whGroup.status)) {
      setWhMsg({ type: "err", msg: `Truck ต้องเป็น TRUCK_DOCKED ก่อน (ปัจจุบัน: ${whGroup.status})` });
      return;
    }

    setWhActing(true);
    const now = nowISO();
    const ops = [
      supabase.from("group_header").update({ status: "LOADING" }).eq("group_number", whGroup.group_number),
      supabase.from("group_orders").update({ status: "LOADING", updated_at: now }).eq("order_no", whOrder.order_no),
    ];
    if (whGroup.booking_id)
      ops.push(supabase.from("bookings").update({ status: "LOADING", updated_at: now }).eq("booking_id", whGroup.booking_id));

    const results = await Promise.all(ops);
    const err = results.find(r => r.error)?.error;
    if (err) { setWhMsg({ type: "err", msg: err.message }); setWhActing(false); return; }

    await auditLog({
      module: "WAREHOUSE", action: "START_LOADING", targetType: "GROUP", targetId: whGroup.group_number,
      subconCode: whGroup.subcon_code || "", groupNumber: whGroup.group_number,
      bookingId: whGroup.booking_id || "", actor: user.username, remark: "Loading started",
    });
    setWhMsg({ type: "ok", msg: "✅ เริ่ม Loading สำเร็จ" });
    setWhGroup(p => ({ ...p, status: "LOADING" }));
    setWhOrder(p => ({ ...p, status: "LOADING" }));
    loadActive(); loadActiveGroups();
    setWhActing(false);
  };

  // ── WAREHOUSE: releaseDock_ ───────────────────────────────────────────
  const releaseDock = async () => {
    if (!whGroup || !whGroup.booking_id) return;
    setWhActing(true);
    const now = nowISO();

    // load booking to get slot_key
    const { data: bk } = await supabase.from("bookings").select("slot_key").eq("booking_id", whGroup.booking_id).single();

    const ops = [
      supabase.from("bookings").update({ status: "RELEASED", updated_at: now }).eq("booking_id", whGroup.booking_id),
      supabase.from("group_header").update({ status: "COMPLETED", dock_no: null }).eq("group_number", whGroup.group_number),
    ];
    if (bk?.slot_key)
      ops.push(supabase.from("dock_slots")
        .update({ status: "AVAILABLE", booking_id: null, group_ref: null })
        .eq("slot_key", bk.slot_key));
    if (whOrder)
      ops.push(supabase.from("group_orders")
        .update({ status: "COMPLETED", updated_at: now }).eq("order_no", whOrder.order_no));

    const results = await Promise.all(ops);
    const err = results.find(r => r.error)?.error;
    if (err) { setWhMsg({ type: "err", msg: err.message }); setWhActing(false); return; }

    await auditLog({
      module: "DOCK", action: "RELEASE_DOCK", targetType: "BOOKING", targetId: whGroup.booking_id,
      subconCode: whGroup.subcon_code || "", groupNumber: whGroup.group_number,
      bookingId: whGroup.booking_id, actor: user.username, remark: "Dock released",
    });
    setWhMsg({ type: "ok", msg: "✅ Release Dock สำเร็จ" });
    setWhGroup(p => ({ ...p, status: "COMPLETED", dock_no: null }));
    if (whOrder) setWhOrder(p => ({ ...p, status: "COMPLETED" }));
    loadActive(); loadActiveGroups();
    setWhActing(false);
  };

  // ── Tab strip ─────────────────────────────────────────────────────────
  const TabStrip = () => (
    <div style={{ display: "flex", gap: 4, background: "rgba(255,255,255,.15)", borderRadius: 8, padding: 3 }}>
      {[["gate","🔍 Gate"], ["warehouse","🏭 Warehouse"]].map(([t, l]) => (
        <button key={t} onClick={() => setTab(t)} style={{
          border: "none", borderRadius: 6, padding: "4px 12px",
          fontWeight: 700, fontSize: 11, cursor: "pointer",
          background: tab === t ? T.white : "transparent",
          color: tab === t ? T.goldDark : "rgba(255,255,255,.85)",
        }}>{l}</button>
      ))}
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: T.bg }}>

      {/* Topbar */}
      <div style={{
        background: T.topbarGrad, color: T.white, padding: "13px 18px",
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        position: "sticky", top: 0, zIndex: 40,
        boxShadow: "0 2px 12px rgba(18,40,80,.25)", borderBottom: `3px solid ${T.gold}`,
      }}>
        <button onClick={onBack} style={{ border: "1px solid rgba(255,255,255,.25)", background: "rgba(255,255,255,.08)", color: T.white, borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>← Back</button>
        <div style={{ width: 28, height: 28, borderRadius: 6, background: T.gold, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 11, color: T.navy, flexShrink: 0 }}>YCH</div>
        <span style={{ fontWeight: 800, fontSize: 15 }}>Gate & Warehouse</span>
        <TabStrip />
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#4ADE80", display: "inline-block", boxShadow: "0 0 0 3px rgba(74,222,128,.25)" }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: "#86EFAC" }}>LIVE</span>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* GATE TAB                                                       */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {tab === "gate" && (
        <div style={{ padding: 14, maxWidth: 800, margin: "0 auto" }}>
          {gateMsg && <Alert type={gateMsg.type} msg={gateMsg.msg} />}

          {/* Scan card */}
          <div style={{ background: T.bgCard, borderRadius: 14, padding: 18, marginBottom: 14, boxShadow: T.shadow, border: `1px solid ${T.border}` }}>
            <div style={{ fontWeight: 800, color: T.navy, fontSize: 13, marginBottom: 10 }}>Gate Check-In</div>
            <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 10 }}>Scan Barcode หรือพิมพ์ Booking ID แล้วกด Enter</div>
            <form onSubmit={handleGateScan} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input
                value={scanId} onChange={e => setScanId(e.target.value)}
                placeholder="BOOKING ID" autoCapitalize="characters" autoFocus
                style={{ flex: 1, padding: "13px 16px", border: `2.5px solid ${T.gold}`, borderRadius: 10, fontSize: 15, fontWeight: 700, fontFamily: "monospace", letterSpacing: 2, outline: "none", textAlign: "center" }}
              />
              <button type="submit" disabled={gateLoading} style={{ ...BTN.primary, padding: "0 20px", fontSize: 13 }}>Lookup</button>
              <button type="button" onClick={() => { setScanId(""); setFound(null); setGroup(null); setGateMsg(null); }} style={{ ...BTN.ghost, padding: "0 12px" }}>Clear</button>
            </form>

            {gateLoading && <Spinner />}
            {found === "not_found" && <Alert type="err" msg="ไม่พบ Booking ID นี้" />}

            {found && found !== "not_found" && (
              <div style={{ marginTop: 10, padding: 14, background: T.goldPale, border: `1.5px solid ${T.goldLight}`, borderRadius: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                  <div>
                    <div style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 900, color: T.navy }}>{found.booking_id}</div>
                    <div style={{ fontSize: 12, color: T.textSecond, marginTop: 2 }}>
                      Group: {found.group_number} • Dock {found.dock_no} • {String(found.booking_hour || "").slice(0, 5)} • {found.booking_date}
                    </div>
                    <div style={{ fontSize: 11, color: T.textMuted, marginTop: 1 }}>
                      {found.truck_plate} • {found.driver_name} • {found.phone}
                    </div>
                    {found.check_in_time && (
                      <div style={{ fontSize: 11, color: T.green, fontWeight: 700, marginTop: 1 }}>
                        Check-in: {new Date(found.check_in_time).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    )}
                  </div>
                  <StatusBadge status={found.status} size={11} />
                </div>

                {/* Gate action buttons — only gate steps here */}
                {isGate && GATE_ACTIONS[found.status] && (
                  <button
                    onClick={() => doGateAction(found.booking_id, GATE_ACTIONS[found.status].next)}
                    disabled={acting}
                    style={{ width: "100%", padding: 10, border: "none", borderRadius: 9, fontWeight: 700, cursor: "pointer", fontSize: 13, opacity: acting ? 0.6 : 1, background: GATE_ACTIONS[found.status].color, color: T.white }}
                  >
                    {GATE_ACTIONS[found.status].label}
                  </button>
                )}
                {found.status === "TRUCK_DOCKED" && (
                  <div style={{ marginTop: 6, padding: "8px 12px", background: T.blueBg, borderRadius: 8, fontSize: 12, color: T.blue, fontWeight: 700 }}>
                    🏭 Truck Docked แล้ว — ดำเนินการต่อที่ Warehouse tab
                  </div>
                )}
                {found.status === "LOADING" && (
                  <div style={{ marginTop: 6, padding: "8px 12px", background: T.amberBg, borderRadius: 8, fontSize: 12, color: T.amber, fontWeight: 700 }}>
                    ⬆ กำลัง Loading — Release Dock ที่ Warehouse tab
                  </div>
                )}
              </div>
            )}
          </div>

          {/* รถในลาน table (mirrors GAS Gate tab) */}
          <div style={{ background: T.bgCard, borderRadius: 14, overflow: "hidden", boxShadow: T.shadow, border: `1px solid ${T.border}` }}>
            <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 800, color: T.navy, fontSize: 13 }}>รถในลาน ({activeList.length})</span>
              <button onClick={loadActive} style={{ ...BTN.ghost, padding: "3px 10px", fontSize: 11 }}>↻</button>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: T.navy }}>
                    {["Booking ID", "SubCon", "Dock", "เวลา", "Status", ""].map(h => (
                      <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: T.white, fontWeight: 700, fontSize: 11, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeList.length === 0 ? (
                    <tr><td colSpan={6} style={{ textAlign: "center", padding: 24, color: T.textMuted, fontSize: 12 }}>ไม่มีรถในลานวันนี้</td></tr>
                  ) : activeList.map((b, i) => {
                    const act = GATE_ACTIONS[b.status];
                    return (
                      <tr key={b.booking_id} style={{ background: i % 2 === 0 ? T.white : "#F8FAFF", borderBottom: `1px solid ${T.border}` }}>
                        <td style={{ padding: "8px 12px", fontFamily: "monospace", fontWeight: 700, fontSize: 11, color: T.navy }}>{b.booking_id}</td>
                        <td style={{ padding: "8px 12px", fontWeight: 600 }}>{b.subcon_code || "—"}</td>
                        <td style={{ padding: "8px 12px" }}>Dock {b.dock_no}</td>
                        <td style={{ padding: "8px 12px", color: T.textMuted }}>{String(b.booking_hour || "").slice(0, 5)}</td>
                        <td style={{ padding: "8px 12px" }}><StatusBadge status={b.status} size={10} /></td>
                        <td style={{ padding: "8px 12px" }}>
                          <div style={{ display: "flex", gap: 4 }}>
                            {isGate && act && (
                              <button
                                onClick={() => { setScanId(b.booking_id); setTab("gate"); setTimeout(() => document.querySelector("form")?.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true })), 80); }}
                                style={{ ...BTN.ghost, padding: "3px 8px", fontSize: 10 }}>Open</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* WAREHOUSE TAB                                                  */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {tab === "warehouse" && (
        <div style={{ padding: 14, maxWidth: 1100, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 380px", gap: 14, alignItems: "start" }}>

          {/* LEFT: Group Detail */}
          <div>
            {whMsg && <Alert type={whMsg.type} msg={whMsg.msg} />}
            <div style={{ background: T.bgCard, borderRadius: 14, padding: 18, marginBottom: 14, boxShadow: T.shadow, border: `1px solid ${T.border}` }}>
              <SectionHeader title="Group Detail" onRefresh={whGroup ? () => loadWhGroup(whGroup.group_number) : undefined} />
              <form onSubmit={handleWhScan} style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <input
                  value={whScanId} onChange={e => setWhScanId(e.target.value)}
                  placeholder="Group Number เช่น MN26042801"
                  style={{ flex: 1, padding: "10px 14px", border: `2px solid ${T.borderDark}`, borderRadius: 10, fontSize: 13, fontWeight: 700, fontFamily: "monospace", outline: "none" }}
                />
                <button type="submit" disabled={whLoading} style={{ ...BTN.primary, padding: "0 16px" }}>Load</button>
                <button type="button" onClick={clearWh} style={{ ...BTN.ghost, padding: "0 10px" }}>✕</button>
              </form>

              {whLoading && <Spinner />}

              {whGroup && (
                <>
                  {/* Truck Track stepper */}
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                      🚛 TRUCK TRACK
                    </div>
                    <Stepper steps={TRUCK_STEPS} current={whGroup.status} />
                  </div>

                  {/* Order Track stepper */}
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                      📋 ORDER TRACK
                    </div>
                    <Stepper steps={ORDER_STEPS} current={whOrder?.status || "—"} />
                  </div>

                  {/* Status indicators — mirrors GAS "Truck ยังไม่ docked" / "Order ready" */}
                  <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 8,
                      background: ["TRUCK_DOCKED","LOADING","COMPLETED"].includes(whGroup.status) ? T.greenBg : T.redBg,
                      color: ["TRUCK_DOCKED","LOADING","COMPLETED"].includes(whGroup.status) ? T.green : T.red,
                    }}>
                      {["TRUCK_DOCKED","LOADING","COMPLETED"].includes(whGroup.status) ? "✓ Truck Docked" : "✗ Truck ยังไม่ Docked"}
                    </span>
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 8,
                      background: whOrder?.status === "READY_FOR_LOADING" ? T.greenBg : T.amberBg,
                      color: whOrder?.status === "READY_FOR_LOADING" ? T.green : T.amber,
                    }}>
                      {whOrder?.status === "READY_FOR_LOADING" ? "✓ Order Ready" : "⏳ Order ยังไม่ Ready"}
                    </span>
                  </div>

                  {/* Group info */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
                    {[
                      { label: "GROUP", value: whGroup.group_number, mono: true, color: T.navy },
                      { label: "SUBCON", value: `${whGroup.subcon_name || ""} (${whGroup.subcon_code})`, color: T.amber },
                      { label: "TRUCK", value: <StatusBadge status={whGroup.status} size={10} /> },
                      { label: "ORDER", value: whOrder ? <StatusBadge status={whOrder.status} size={10} /> : <span style={{ fontSize: 11, color: T.textMuted }}>No order</span> },
                      { label: "QTY", value: `${whGroup.total_qty} pcs` },
                      { label: "DOCK / เวลา", value: whGroup.dock_no ? `Dock ${whGroup.dock_no} • ${String(whBooking?.booking_hour || "").slice(0, 5)}` : "—", color: T.blue },
                    ].map(({ label, value, mono, color }) => (
                      <div key={label} style={{ padding: "8px 10px", background: T.bg, borderRadius: 8 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: T.textMuted, marginBottom: 3 }}>{label}</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: color || T.textPrimary, fontFamily: mono ? "monospace" : undefined }}>{value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Order Actions */}
                  <div style={{ padding: 12, background: T.blueBg, borderRadius: 10, border: `1px solid #BFDBFE`, marginBottom: 12 }}>
                    <div style={{ fontWeight: 700, color: T.blue, fontSize: 12, marginBottom: 8 }}>ORDER ACTIONS</div>
                    {!whOrder ? (
                      <button onClick={createOrder} disabled={BLOCKED_ORDER_STATUSES.includes(whGroup.status)}
                        style={{ ...BTN.secondary, padding: "8px 16px", fontSize: 12, opacity: BLOCKED_ORDER_STATUSES.includes(whGroup.status) ? 0.5 : 1 }}>
                        + สร้าง Order
                      </button>
                    ) : (
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700 }}>{whOrder.order_no}</span>
                        <StatusBadge status={whOrder.status} size={10} />
                        {ORDER_ACTIONS[whOrder.status] && (
                          <button onClick={() => updateOrder(ORDER_ACTIONS[whOrder.status].next)}
                            style={{ border: "none", borderRadius: 7, padding: "5px 12px", fontWeight: 700, cursor: "pointer", fontSize: 11, background: ORDER_ACTIONS[whOrder.status].color, color: T.white }}>
                            {ORDER_ACTIONS[whOrder.status].label}
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Start Loading / Release Dock */}
                  {isWH && whGroup.status === "TRUCK_DOCKED" && (
                    <button onClick={startLoading} disabled={whActing}
                      style={{ width: "100%", padding: 10, marginBottom: 8, border: "none", borderRadius: 9, fontWeight: 700, cursor: "pointer", fontSize: 13, opacity: whActing ? 0.6 : 1, background: T.blue, color: T.white }}>
                      ⬆ Start Loading
                    </button>
                  )}
                  {isWH && whGroup.status === "LOADING" && (
                    <button onClick={releaseDock} disabled={whActing}
                      style={{ width: "100%", padding: 10, border: "none", borderRadius: 9, fontWeight: 700, cursor: "pointer", fontSize: 13, opacity: whActing ? 0.6 : 1, background: T.green, color: T.white }}>
                      ✓ Complete & Release Dock
                    </button>
                  )}

                  {/* OBD ใน GROUP table */}
                  {whGroupDetails.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontWeight: 700, color: T.navy, fontSize: 12, marginBottom: 8 }}>OBD ใน GROUP ({whGroupDetails.length})</div>
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                          <thead>
                            <tr style={{ background: T.navy }}>
                              {["OBD No", "Qty", "Lines"].map(h => (
                                <th key={h} style={{ padding: "6px 10px", textAlign: "left", color: T.white, fontWeight: 700, fontSize: 11 }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {whGroupDetails.map((d, i) => (
                              <tr key={i} style={{ background: i % 2 === 0 ? T.white : "#F8FAFF", borderBottom: `1px solid ${T.border}` }}>
                                <td style={{ padding: "6px 10px", fontFamily: "monospace", fontWeight: 600 }}>{d.obd_no || "—"}</td>
                                {/* column จริงจาก schema: qty, line_count */}
                                <td style={{ padding: "6px 10px" }}>{d.qty || 0}</td>
                                <td style={{ padding: "6px 10px", color: T.textMuted }}>{d.line_count || 0}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* RIGHT: Active Groups table */}
          <div style={{ background: T.bgCard, borderRadius: 14, overflow: "hidden", boxShadow: T.shadow, border: `1px solid ${T.border}`, position: "sticky", top: 76 }}>
            <div style={{ padding: "12px 14px", borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 800, color: T.navy, fontSize: 13 }}>Active Groups ({activeGroups.length})</span>
              <button onClick={loadActiveGroups} style={{ ...BTN.ghost, padding: "3px 8px", fontSize: 11 }}>↻</button>
            </div>
            <div style={{ maxHeight: "calc(100vh - 160px)", overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr style={{ background: T.bg, position: "sticky", top: 0 }}>
                    {["Group", "SubCon", "Truck", "Order", ""].map(h => (
                      <th key={h} style={{ padding: "7px 10px", textAlign: "left", fontWeight: 700, color: T.textSecond, fontSize: 10, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeGroups.length === 0 ? (
                    <tr><td colSpan={5} style={{ textAlign: "center", padding: 20, color: T.textMuted, fontSize: 11 }}>ไม่มี Active Group</td></tr>
                  ) : activeGroups.map((g, i) => (
                    <tr key={g.group_number} style={{ background: i % 2 === 0 ? T.white : "#F8FAFF", borderBottom: `1px solid ${T.border}` }}>
                      <td style={{ padding: "7px 10px", fontFamily: "monospace", fontWeight: 800, fontSize: 10, color: T.navy }}>{g.group_number}</td>
                      <td style={{ padding: "7px 10px", fontSize: 10 }}>{g.subcon_code}</td>
                      <td style={{ padding: "7px 10px" }}><StatusBadge status={g.status} size={9} /></td>
                      <td style={{ padding: "7px 10px" }}>
                        {g.orderStatus
                          ? <StatusBadge status={g.orderStatus} size={9} />
                          : <span style={{ fontSize: 9, color: T.textMuted }}>—</span>}
                      </td>
                      <td style={{ padding: "7px 8px" }}>
                        <button
                          onClick={() => { setWhScanId(g.group_number); loadWhGroup(g.group_number); }}
                          style={{ ...BTN.ghost, padding: "2px 7px", fontSize: 10 }}>Open</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
