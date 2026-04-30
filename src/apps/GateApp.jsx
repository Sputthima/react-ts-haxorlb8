import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase, today, nowISO, auditLog } from "../lib/supabase";
import { Alert, Spinner, StatusBadge, SectionHeader } from "../components/UI";
import { T, BTN } from "../theme";

// ─────────────────────────────────────────────────────────────
//  GateApp v3 — UI redesign + responsive
//
//  Status flow:
//  TRUCK:  RESERVED → ON_YARD → CALLED_TO_DOCK → TRUCK_DOCKED → LOADING → COMPLETED
//  ORDER:  ORDER_CREATED → PICKING → READY_FOR_LOADING → LOADING → COMPLETED
//
//  UI แก้:
//  1. Warehouse tab: stack vertically บน mobile, 2-col บน desktop
//  2. Active Groups panel: accordion แทน sticky side panel
//  3. Group detail: card-based แทน grid บน mobile
//  4. Stepper: scroll แนวนอนได้ ไม่เกิน screen
//  5. เพิ่ม: ปุ่ม Gate action ใน Active list โดยตรง (ไม่ต้อง scan)
// ─────────────────────────────────────────────────────────────

const GATE_ACTIONS = {
  RESERVED:       { label:"✓ Check-in เข้า Yard", next:"ON_YARD",        color:"#16a34a" },
  ON_YARD:        { label:"📢 Call to Dock",        next:"CALLED_TO_DOCK", color:"#d97706" },
  CALLED_TO_DOCK: { label:"🚛 Confirm Docked",      next:"TRUCK_DOCKED",   color:"#7c3aed" },
};
const ORDER_ACTIONS = {
  ORDER_CREATED:     { label:"เริ่ม Picking",     next:"PICKING",           color:"#1d4ed8" },
  PICKING:           { label:"Ready for Loading", next:"READY_FOR_LOADING", color:"#7c3aed" },
  READY_FOR_LOADING: null,
  LOADING:           null,
  COMPLETED:         null,
};
const ACTIVE_TRUCK_STATUSES = ["RESERVED","ON_YARD","CALLED_TO_DOCK","TRUCK_DOCKED","LOADING"];
const GROUP_SYNC_STATUSES   = ["ON_YARD","CALLED_TO_DOCK","TRUCK_DOCKED"];
const TRUCK_STEPS = ["BOOKED","ON_YARD","CALLED_TO_DOCK","TRUCK_DOCKED","LOADING","COMPLETED"];
const ORDER_STEPS = ["ORDER_CREATED","PICKING","READY_FOR_LOADING","LOADING","COMPLETED"];

const STATUS_BG = {
  RESERVED:"#f8fafc", ON_YARD:"#fef9c3", CALLED_TO_DOCK:"#fff7ed",
  TRUCK_DOCKED:"#f5f3ff", LOADING:"#eff6ff", BOOKED:"#f0fdf4",
};
const STATUS_BL = {
  RESERVED:"#e5e7eb", ON_YARD:"#fbbf24", CALLED_TO_DOCK:"#f59e0b",
  TRUCK_DOCKED:"#8b5cf6", LOADING:"#3b82f6", BOOKED:"#22c55e",
};

// ── Stepper — horizontal scroll safe ─────────────────────────
function Stepper({ steps, current }) {
  const idx = steps.indexOf(current);
  return (
    <div style={{overflowX:"auto",paddingBottom:6}}>
      <div style={{display:"flex",alignItems:"center",minWidth:"max-content",gap:0}}>
        {steps.map((s,i)=>{
          const done   = i<idx;
          const active = i===idx;
          const dot_bg = active?"#F5A800":done?"#16a34a":"#f3f4f6";
          const dot_c  = active||done?"#fff":"#9ca3af";
          const line_c = done?"#16a34a":"#e5e7eb";
          return (
            <React.Fragment key={s}>
              <div style={{display:"flex",flexDirection:"column",alignItems:"center",minWidth:56}}>
                <div style={{width:26,height:26,borderRadius:"50%",background:dot_bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:dot_c,border:`2px solid ${active?"#F5A800":done?"#16a34a":"#e5e7eb"}`}}>
                  {done?"✓":i+1}
                </div>
                <div style={{fontSize:8,marginTop:3,color:active?"#92400e":done?"#16a34a":"#9ca3af",fontWeight:active?800:600,textAlign:"center",whiteSpace:"nowrap",maxWidth:56}}>
                  {s.replace(/_/g," ")}
                </div>
              </div>
              {i<steps.length-1 && (
                <div style={{width:20,height:2,background:line_c,margin:"0 1px",marginBottom:14,flexShrink:0}}/>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

// ── Info row ──────────────────────────────────────────────────
function InfoRow({ label, value, mono=false, color }) {
  return (
    <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #f3f4f6",fontSize:12}}>
      <span style={{color:"#9ca3af",fontWeight:600,minWidth:90}}>{label}</span>
      <span style={{fontFamily:mono?"monospace":"inherit",fontWeight:700,color:color||"#0a2a6e",textAlign:"right"}}>{value||"—"}</span>
    </div>
  );
}

// ── Status pill ───────────────────────────────────────────────
function TruckStatusPill({ status }) {
  const ST = {
    TRUCK_DOCKED:{bg:"#ede9fe",c:"#6d28d9"},
    LOADING:{bg:"#dbeafe",c:"#1d4ed8"},
    COMPLETED:{bg:"#d1fae5",c:"#065f46"},
  };
  const s = ST[status]||{bg:"#f3f4f6",c:"#374151"};
  return (
    <span style={{background:s.bg,color:s.c,fontSize:10,fontWeight:800,padding:"2px 8px",borderRadius:999}}>
      {["TRUCK_DOCKED","LOADING","COMPLETED"].includes(status)?"✓ Truck Docked":"✗ Truck ยังไม่ Docked"}
    </span>
  );
}

export default function GateApp({ user, onBack }) {
  const [tab, setTab]       = useState("gate");
  const isMobile            = typeof window !== "undefined" && window.innerWidth < 768;

  // Gate state
  const [scanId, setScanId]       = useState("");
  const [found, setFound]         = useState(null);
  const [group, setGroup]         = useState(null);
  const [activeList, setActiveList] = useState([]);
  const [gateLoading, setGateLoading] = useState(false);
  const [gateMsg, setGateMsg]     = useState(null);
  const [acting, setActing]       = useState(false);
  const scanRef = useRef();

  // Warehouse state
  const [whScanId, setWhScanId]   = useState("");
  const [whGroup, setWhGroup]     = useState(null);
  const [whGroupDetails, setWhGroupDetails] = useState([]);
  const [whOrder, setWhOrder]     = useState(null);
  const [whBooking, setWhBooking] = useState(null);
  const [whLoading, setWhLoading] = useState(false);
  const [whMsg, setWhMsg]         = useState(null);
  const [whActing, setWhActing]   = useState(false);
  const [activeGroups, setActiveGroups] = useState([]);
  // FIX: accordion state สำหรับ Active Groups panel บน mobile
  const [showActiveGroups, setShowActiveGroups] = useState(true);

  const isGate = ["gate","admin","manager"].includes(user?.role);
  const isWH   = ["warehouse","admin","manager"].includes(user?.role);

  // ── LOADERS ─────────────────────────────────────────────────
  const loadActive = useCallback(async () => {
    // FIX: ดึงทุกคันที่อยู่ใน yard จริง — ไม่ filter booking_date
    // เพื่อให้เห็นรถที่มาค้างคืน / มาก่อนกำหนด ด้วย
    const [{ data: bk }, { data: go }] = await Promise.all([
      supabase.from("bookings")
        .select("booking_id,group_number,booking_date,booking_hour,dock_no,truck_plate,driver_name,subcon_code,status,check_in_time")
        .in("status", ACTIVE_TRUCK_STATUSES)
        .order("check_in_time",{ascending:true}), // เรียงตามเวลา check-in
      supabase.from("group_orders").select("group_number,status"),
    ]);
    const orderMap = {};
    (go||[]).forEach(o=>{ orderMap[o.group_number]=o.status; });
    setActiveList((bk||[]).map(b=>({...b, orderStatus:orderMap[b.group_number]||""})));
  },[]);

  const loadActiveGroups = useCallback(async () => {
    // ตัด COMPLETED ออก + join booking เพื่อดู booking_hour, dock_no
    const [{ data: grp }, { data: go }, { data: bk }] = await Promise.all([
      supabase.from("group_header")
        .select("group_number,subcon_code,subcon_name,status,dock_no,total_qty,total_obd,booking_id")
        .in("status",["BOOKED","ON_YARD","CALLED_TO_DOCK","TRUCK_DOCKED","LOADING"])
        .order("group_number",{ascending:false}).limit(100),
      supabase.from("group_orders").select("group_number,status"),
      supabase.from("bookings")
        .select("booking_id,booking_hour,booking_date,dock_no,truck_plate,check_in_time,status")
        .in("status",["RESERVED","ON_YARD","CALLED_TO_DOCK","TRUCK_DOCKED","LOADING"]),
    ]);
    const orderMap = {};
    (go||[]).forEach(o=>{ orderMap[o.group_number]=o.status; });
    const bookingMap = {};
    (bk||[]).forEach(b=>{ bookingMap[b.booking_id]=b; });
    setActiveGroups((grp||[]).map(g=>{
      const booking = g.booking_id ? (bookingMap[g.booking_id]||null) : null;
      return {
        ...g,
        orderStatus:orderMap[g.group_number]||"",
        booking_hour: booking?.booking_hour||"",
        booking_date: booking?.booking_date||"",
        dock_no_actual: booking?.dock_no||g.dock_no||"",
        truck_plate:  booking?.truck_plate||"",
        check_in_time:booking?.check_in_time||"",
      };
    // sort ตาม booking_hour แล้ว dock_no — ops เห็นลำดับงานถูกเสมอ
    }).sort((a,b)=>{
      const ta = String(a.booking_hour).slice(0,5);
      const tb = String(b.booking_hour).slice(0,5);
      if (ta!==tb) return ta<tb?-1:1;
      return (a.dock_no_actual||0)-(b.dock_no_actual||0);
    }));
  },[]);

  useEffect(()=>{ loadActive(); },[loadActive]);
  useEffect(()=>{ if(tab==="warehouse") loadActiveGroups(); },[tab,loadActiveGroups]);

  useEffect(()=>{
    const ch = supabase.channel("gate_live")
      .on("postgres_changes",{event:"*",schema:"public",table:"bookings"},()=>{ loadActive(); if(tab==="warehouse") loadActiveGroups(); })
      .on("postgres_changes",{event:"*",schema:"public",table:"group_header"},()=>loadActiveGroups())
      .on("postgres_changes",{event:"*",schema:"public",table:"group_orders"},()=>loadActiveGroups())
      .subscribe(s=>{ if(s==="CHANNEL_ERROR") console.warn("Gate realtime error"); });
    return()=>{ try{supabase.removeChannel(ch);}catch(e){} };
  },[loadActive,loadActiveGroups,tab]);

  // ── GATE SCAN ────────────────────────────────────────────────
  const handleGateScan = async (e, overrideId) => {
    if (e) e.preventDefault();
    const id = (overrideId || scanId).trim();
    if (!id) return;
    setGateLoading(true); setGateMsg(null); setFound(null); setGroup(null);
    const { data: bk } = await supabase.from("bookings").select("*").eq("booking_id",id).maybeSingle();
    if (!bk) { setFound("not_found"); setGateLoading(false); return; }
    if (bk.group_number) {
      const { data: gh } = await supabase.from("group_header").select("*").eq("group_number",bk.group_number).maybeSingle();
      setGroup(gh||null);
    }
    setFound(bk);
    setGateLoading(false);
  };

  const doGateAction = async (bookingId, newStatus, bkRow, grpRow) => {
    setActing(true); setGateMsg(null);
    const upd = { status:newStatus, updated_at:nowISO() };
    if (newStatus==="ON_YARD") upd.check_in_time = nowISO();
    const { error } = await supabase.from("bookings").update(upd).eq("booking_id",bookingId);
    if (error) { setGateMsg({type:"err",msg:error.message}); setActing(false); return; }
    const grp = grpRow || group;
    const bk  = bkRow  || found;
    if (bk?.group_number && GROUP_SYNC_STATUSES.includes(newStatus)) {
      await supabase.from("group_header").update({status:newStatus}).eq("group_number",bk.group_number);
    }
    await auditLog({module:"GATE",action:newStatus,targetType:"BOOKING",targetId:bookingId,
      subconCode:grp?.subcon_code||"",groupNumber:bk?.group_number||"",
      bookingId,actor:user.username,remark:`→ ${newStatus}`});
    setGateMsg({type:"ok",msg:`✅ ${newStatus} สำเร็จ`});
    if (found && found.booking_id===bookingId) setFound(p=>({...p,...upd}));
    loadActive();
    setActing(false);
  };

  // ── WAREHOUSE LOAD GROUP ──────────────────────────────────────
  const loadWhGroup = async (gn) => {
    setWhLoading(true); setWhMsg(null);
    setWhGroup(null); setWhGroupDetails([]); setWhOrder(null); setWhBooking(null);
    if (!gn?.trim()) { setWhLoading(false); return; }
    const [{ data: gh }, { data: gd }, { data: go }] = await Promise.all([
      supabase.from("group_header").select("*").eq("group_number",gn.trim()).maybeSingle(),
      supabase.from("group_detail").select("*").eq("group_number",gn.trim()),
      supabase.from("group_orders").select("*").eq("order_no","GO-"+gn.trim()).maybeSingle(),
    ]);
    if (!gh) { setWhMsg({type:"err",msg:`ไม่พบ Group: ${gn}`}); setWhLoading(false); return; }
    setWhGroup(gh); setWhGroupDetails(gd||[]); setWhOrder(go||null);
    if (gh.booking_id) {
      const { data: bk } = await supabase.from("bookings").select("*").eq("booking_id",gh.booking_id).maybeSingle();
      setWhBooking(bk||null);
    }
    setWhLoading(false);
  };

  const clearWh = () => {
    setWhScanId(""); setWhGroup(null); setWhGroupDetails([]);
    setWhOrder(null); setWhBooking(null); setWhMsg(null);
  };

  // ── ORDER ACTIONS ─────────────────────────────────────────────
  const createOrder = async () => {
    if (!whGroup) return;
    const orderNo = "GO-"+whGroup.group_number;
    const { error } = await supabase.from("group_orders").insert({
      order_no:orderNo, group_number:whGroup.group_number,
      total_obd:whGroup.total_obd||0, total_qty:whGroup.total_qty||0,
      status:"ORDER_CREATED", created_by:user.username,
    });
    if (error) return setWhMsg({type:"err",msg:error.message});
    const { data: o } = await supabase.from("group_orders").select("*").eq("order_no",orderNo).maybeSingle();
    setWhOrder(o||null);
    await auditLog({module:"WAREHOUSE",action:"CREATE_ORDER",targetType:"ORDER",targetId:orderNo,
      subconCode:whGroup.subcon_code||"",groupNumber:whGroup.group_number,
      bookingId:whGroup.booking_id||"",actor:user.username});
    setWhMsg({type:"ok",msg:`✅ สร้าง Order ${orderNo} สำเร็จ`});
    loadActiveGroups();
  };

  const updateOrder = async (newStatus) => {
    if (!whOrder) return;
    const { error } = await supabase.from("group_orders")
      .update({status:newStatus,updated_at:nowISO()}).eq("order_no",whOrder.order_no);
    if (error) return setWhMsg({type:"err",msg:error.message});
    setWhOrder(p=>({...p,status:newStatus}));
    await auditLog({module:"WAREHOUSE",action:"UPDATE_ORDER",targetType:"ORDER",
      targetId:whOrder.order_no,groupNumber:whGroup?.group_number||"",actor:user.username,remark:`→ ${newStatus}`});
    setWhMsg({type:"ok",msg:`✅ Order → ${newStatus}`});
    loadActiveGroups();
  };

  const startLoading = async () => {
    if (!whGroup) return;
    if (!whOrder || whOrder.status!=="READY_FOR_LOADING")
      return setWhMsg({type:"err",msg:"ต้อง Pick order ให้เสร็จ (READY_FOR_LOADING) ก่อน"});
    if (!["TRUCK_DOCKED","LOADING"].includes(whGroup.status))
      return setWhMsg({type:"err",msg:`Truck ต้อง TRUCK_DOCKED ก่อน (ปัจจุบัน: ${whGroup.status})`});
    setWhActing(true);
    const now = nowISO();
    const ops = [
      supabase.from("group_header").update({status:"LOADING"}).eq("group_number",whGroup.group_number),
      supabase.from("group_orders").update({status:"LOADING",updated_at:now}).eq("order_no",whOrder.order_no),
    ];
    if (whGroup.booking_id)
      ops.push(supabase.from("bookings").update({status:"LOADING",updated_at:now}).eq("booking_id",whGroup.booking_id));
    const results = await Promise.all(ops);
    const err = results.find(r=>r.error)?.error;
    if (err) { setWhMsg({type:"err",msg:err.message}); setWhActing(false); return; }
    await auditLog({module:"WAREHOUSE",action:"START_LOADING",targetType:"GROUP",targetId:whGroup.group_number,
      subconCode:whGroup.subcon_code||"",groupNumber:whGroup.group_number,
      bookingId:whGroup.booking_id||"",actor:user.username});
    setWhMsg({type:"ok",msg:"✅ เริ่ม Loading สำเร็จ"});
    setWhGroup(p=>({...p,status:"LOADING"}));
    setWhOrder(p=>({...p,status:"LOADING"}));
    loadActive(); loadActiveGroups();
    setWhActing(false);
  };

  const releaseDock = async () => {
    if (!whGroup?.booking_id) return;
    setWhActing(true);
    const now = nowISO();
    const { data: bk } = await supabase.from("bookings").select("slot_key").eq("booking_id",whGroup.booking_id).maybeSingle();
    const ops = [
      supabase.from("bookings").update({status:"COMPLETED",updated_at:now}).eq("booking_id",whGroup.booking_id),
      supabase.from("group_header").update({status:"COMPLETED"}).eq("group_number",whGroup.group_number),
    ];
    if (bk?.slot_key)
      ops.push(supabase.from("dock_slots").update({status:"AVAILABLE",booking_id:null}).eq("slot_key",bk.slot_key));
    if (whOrder)
      ops.push(supabase.from("group_orders").update({status:"COMPLETED",updated_at:now}).eq("order_no",whOrder.order_no));
    const results = await Promise.all(ops);
    const err = results.find(r=>r.error)?.error;
    if (err) { setWhMsg({type:"err",msg:err.message}); setWhActing(false); return; }
    await auditLog({module:"DOCK",action:"RELEASE_DOCK",targetType:"BOOKING",targetId:whGroup.booking_id,
      subconCode:whGroup.subcon_code||"",groupNumber:whGroup.group_number,
      bookingId:whGroup.booking_id,actor:user.username});
    setWhMsg({type:"ok",msg:"✅ Complete & Release Dock สำเร็จ"});
    setWhGroup(p=>({...p,status:"COMPLETED"}));
    if (whOrder) setWhOrder(p=>({...p,status:"COMPLETED"}));
    loadActive(); loadActiveGroups();
    setWhActing(false);
  };

  // ── STATUS color helpers ─────────────────────────────────────
  const truckStatusColor = (st) => ({
    RESERVED:"#6b7280",ON_YARD:"#d97706",CALLED_TO_DOCK:"#ea580c",
    TRUCK_DOCKED:"#7c3aed",LOADING:"#1d4ed8",COMPLETED:"#16a34a",
  }[st]||"#6b7280");

  // ── Urgency classifier ───────────────────────────────────────
  const getUrgency = (booking) => {
    const bDate = booking.booking_date;
    const todayStr = today();
    const now = new Date();
    const [h,m] = String(booking.booking_hour||"00:00").split(":").map(Number);
    const slotTime = new Date(now.getFullYear(),now.getMonth(),now.getDate(),h,m||0);
    if (bDate < todayStr)
      return { label:"Overdue", icon:"🔴", bg:"#fee2e2", color:"#991b1b", border:"#fca5a5", priority:0 };
    if (bDate > todayStr)
      return { label:`Early`, icon:"📋", bg:"#f8fafc", color:"#6b7280", border:"#e5e7eb", priority:3, sub:bDate };
    const minsLate = Math.floor((now - slotTime) / 60000);
    if (minsLate > 15)
      return { label:`Late ${minsLate}m`, icon:"⚠️", bg:"#fff7ed", color:"#c2410c", border:"#fed7aa", priority:1 };
    if (minsLate >= -30)
      return { label:"On Time", icon:"🟢", bg:"#f0fdf4", color:"#15803d", border:"#86efac", priority:2 };
    return { label:"Waiting", icon:"⏳", bg:"#fafafa", color:"#6b7280", border:"#e5e7eb", priority:3 };
  };

  // ─────────────────────────────────────────────────────────────
  return (
    <div style={{minHeight:"100vh",background:"#f0f4fb"}}>

      {/* TOPBAR */}
      <div style={{background:"linear-gradient(90deg,#0a2a6e,#1d4ed8)",color:"#fff",
        padding:"12px 16px",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",
        position:"sticky",top:0,zIndex:40,borderBottom:"3px solid #F5A800"}}>
        <button onClick={onBack} style={{border:"1px solid rgba(255,255,255,.2)",background:"transparent",color:"#fff",borderRadius:8,padding:"4px 10px",cursor:"pointer",fontSize:12}}>← Back</button>
        <div style={{width:26,height:26,background:"#F5A800",borderRadius:5,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:900,color:"#0a2a6e"}}>YCH</div>
        <span style={{fontWeight:800,fontSize:14}}>Gate & Warehouse</span>
        {/* Tab strip */}
        <div style={{display:"flex",gap:3,background:"rgba(255,255,255,.12)",borderRadius:8,padding:3}}>
          {[["gate","🔍 Gate"],["warehouse","🏭 Warehouse"]].map(([t,l])=>(
            <button key={t} onClick={()=>setTab(t)}
              style={{border:"none",borderRadius:6,padding:"4px 12px",fontWeight:700,fontSize:11,cursor:"pointer",background:tab===t?"#fff":"transparent",color:tab===t?"#d97706":"rgba(255,255,255,.85)"}}>
              {l}
            </button>
          ))}
        </div>
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:5}}>
          <span style={{width:7,height:7,borderRadius:"50%",background:"#4ADE80",display:"inline-block"}}/>
          <span style={{fontSize:10,fontWeight:700,color:"#86EFAC"}}>LIVE</span>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════
          GATE TAB
      ══════════════════════════════════════════════════════ */}
      {tab==="gate" && (
        <div style={{padding:14,maxWidth:700,margin:"0 auto"}}>
          {gateMsg && <Alert type={gateMsg.type} msg={gateMsg.msg}/>}

          {/* Scan bar */}
          <div style={{background:"#fff",borderRadius:14,padding:16,marginBottom:14,boxShadow:"0 4px 20px rgba(0,0,0,.07)"}}>
            <div style={{fontWeight:800,color:"#0a2a6e",fontSize:14,marginBottom:4}}>Gate Check-In</div>
            <div style={{fontSize:11,color:"#9ca3af",marginBottom:10}}>Scan Barcode หรือพิมพ์ Booking ID แล้วกด Enter</div>
            <form onSubmit={handleGateScan} style={{display:"flex",gap:8}}>
              <input ref={scanRef} value={scanId} onChange={e=>setScanId(e.target.value)}
                placeholder="BOOKING ID" autoCapitalize="characters"
                style={{flex:1,padding:"12px 14px",border:"2.5px solid #F5A800",borderRadius:10,fontSize:15,fontWeight:700,fontFamily:"monospace",letterSpacing:2,outline:"none",textAlign:"center"}}/>
              <button type="submit" disabled={gateLoading}
                style={{background:"#F5A800",color:"#fff",border:"none",borderRadius:10,padding:"0 18px",fontWeight:700,cursor:"pointer",fontSize:13}}>
                Lookup
              </button>
              <button type="button" onClick={()=>{setScanId("");setFound(null);setGroup(null);setGateMsg(null);}}
                style={{background:"#e5e7eb",color:"#374151",border:"none",borderRadius:10,padding:"0 12px",fontWeight:700,cursor:"pointer",fontSize:13}}>
                Clear
              </button>
            </form>

            {gateLoading && <div style={{marginTop:12,textAlign:"center"}}><Spinner/></div>}
            {found==="not_found" && <div style={{marginTop:10}}><Alert type="err" msg="ไม่พบ Booking ID นี้"/></div>}

            {found && found!=="not_found" && (
              <div style={{marginTop:12,background:STATUS_BG[found.status]||"#f8fafc",border:`2px solid ${STATUS_BL[found.status]||"#e5e7eb"}`,borderRadius:12,padding:14}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10,gap:8}}>
                  <div>
                    <div style={{fontFamily:"monospace",fontSize:15,fontWeight:900,color:"#0a2a6e"}}>{found.booking_id}</div>
                    <div style={{fontSize:12,color:"#374151",marginTop:3}}>
                      Group: <b>{found.group_number||"—"}</b> • Dock {found.dock_no} • {String(found.booking_hour||"").slice(0,5)}
                    </div>
                    <div style={{fontSize:11,color:"#6b7280",marginTop:2}}>
                      {found.truck_plate} • {found.driver_name} • {found.phone}
                    </div>
                    {found.check_in_time && (
                      <div style={{fontSize:11,color:"#16a34a",fontWeight:700,marginTop:2}}>
                        Check-in: {new Date(found.check_in_time).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit"})}
                      </div>
                    )}
                  </div>
                  <StatusBadge status={found.status}/>
                </div>

                {/* Truck stepper */}
                <div style={{marginBottom:12}}>
                  <Stepper steps={TRUCK_STEPS} current={found.status}/>
                </div>

                {isGate && GATE_ACTIONS[found.status] && (
                  <button onClick={()=>doGateAction(found.booking_id,GATE_ACTIONS[found.status].next)} disabled={acting}
                    style={{width:"100%",padding:"11px",border:"none",borderRadius:10,fontWeight:800,cursor:"pointer",fontSize:13,opacity:acting?.6:1,background:GATE_ACTIONS[found.status].color,color:"#fff"}}>
                    {acting?"กำลังดำเนินการ…":GATE_ACTIONS[found.status].label}
                  </button>
                )}
                {found.status==="TRUCK_DOCKED" && (
                  <div style={{marginTop:8,padding:"8px 12px",background:"#ede9fe",borderRadius:8,fontSize:12,color:"#6d28d9",fontWeight:700}}>
                    🏭 Truck Docked แล้ว — ดำเนินการต่อที่ Warehouse tab
                  </div>
                )}
                {found.status==="LOADING" && (
                  <div style={{marginTop:8,padding:"8px 12px",background:"#dbeafe",borderRadius:8,fontSize:12,color:"#1d4ed8",fontWeight:700}}>
                    ⬆ กำลัง Loading — Release Dock ที่ Warehouse tab
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Active truck list — FIX: เพิ่มปุ่ม action โดยตรง */}
          <div style={{background:"#fff",borderRadius:14,overflow:"hidden",boxShadow:"0 4px 20px rgba(0,0,0,.07)"}}>
            <div style={{padding:"12px 16px",borderBottom:"1px solid #e5e7eb",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontWeight:800,color:"#0a2a6e",fontSize:13}}>รถในลาน ({activeList.length} คัน)</span>
              <button onClick={loadActive} style={{background:"#e5e7eb",color:"#374151",border:"none",borderRadius:7,padding:"3px 10px",cursor:"pointer",fontSize:11,fontWeight:700}}>↻</button>
            </div>
            {/* FIX: sort by urgency priority (overdue first) */}
            {activeList.length===0 ? (
              <div style={{padding:32,textAlign:"center",color:"#9ca3af",fontSize:13}}>ไม่มีรถในลานขณะนี้</div>
            ) : (
              <div style={{display:"flex",flexDirection:"column",gap:0}}>
                {/* Summary bar */}
                {(() => {
                  const overdue  = activeList.filter(b=>getUrgency(b).priority===0).length;
                  const late     = activeList.filter(b=>getUrgency(b).priority===1).length;
                  const ontime   = activeList.filter(b=>getUrgency(b).priority===2).length;
                  const other    = activeList.filter(b=>getUrgency(b).priority===3).length;
                  const todayCount = activeList.filter(b=>b.booking_date===today()).length;
                  return (
                    <div style={{display:"flex",gap:8,padding:"8px 14px",background:"#f8fafc",borderBottom:"1px solid #e5e7eb",flexWrap:"wrap",alignItems:"center"}}>
                      <span style={{fontSize:11,color:"#374151",fontWeight:700}}>รวม {activeList.length} คัน</span>
                      <span style={{fontSize:10,color:"#6b7280"}}>|</span>
                      <span style={{fontSize:10,color:"#374151"}}>แผนวันนี้ {todayCount}</span>
                      {overdue>0 && <span style={{fontSize:10,background:"#fee2e2",color:"#991b1b",borderRadius:999,padding:"1px 8px",fontWeight:700}}>🔴 Overdue {overdue}</span>}
                      {late>0    && <span style={{fontSize:10,background:"#fff7ed",color:"#c2410c",borderRadius:999,padding:"1px 8px",fontWeight:700}}>⚠️ Late {late}</span>}
                      {ontime>0  && <span style={{fontSize:10,background:"#f0fdf4",color:"#15803d",borderRadius:999,padding:"1px 8px",fontWeight:700}}>🟢 On Time {ontime}</span>}
                      {other>0   && <span style={{fontSize:10,background:"#f8fafc",color:"#9ca3af",borderRadius:999,padding:"1px 8px",fontWeight:700}}>⏳ {other}</span>}
                    </div>
                  );
                })()}
                {[...activeList].sort((a,b)=>getUrgency(a).priority-getUrgency(b).priority).map((b,i)=>{
                  const act = GATE_ACTIONS[b.status];
                  const bc  = truckStatusColor(b.status);
                  const urg = getUrgency(b);
                  const isToday = b.booking_date===today();
                  return (
                    <div key={b.booking_id}
                      style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderBottom:"1px solid #f3f4f6",flexWrap:"wrap",background:urg.bg,borderLeft:`3px solid ${urg.border}`}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                          <span style={{fontFamily:"monospace",fontWeight:800,fontSize:12,color:"#0a2a6e"}}>{b.booking_id}</span>
                          <span style={{fontSize:10,background:"#dbeafe",color:"#1d4ed8",borderRadius:999,padding:"1px 6px",fontWeight:700}}>{b.subcon_code||"—"}</span>
                          {/* Urgency badge */}
                          <span style={{fontSize:10,background:urg.bg,color:urg.color,borderRadius:999,padding:"1px 7px",fontWeight:700,border:`1px solid ${urg.border}`}}>
                            {urg.icon} {urg.label}
                          </span>
                          {!isToday && (
                            <span style={{fontSize:10,color:"#9ca3af"}}>นัด {b.booking_date}</span>
                          )}
                        </div>
                        <div style={{fontSize:11,color:"#6b7280",marginTop:2,display:"flex",gap:8}}>
                          <span>{b.truck_plate}</span>
                          <span>D{b.dock_no}</span>
                          <span>{String(b.booking_hour||"").slice(0,5)}</span>
                          {b.check_in_time && <span style={{color:"#9ca3af"}}>เข้า {new Date(b.check_in_time).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit"})}</span>}
                        </div>
                      </div>
                      <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0,flexWrap:"wrap"}}>
                        <StatusBadge status={b.status}/>
                        {isGate && act && (
                          <button onClick={()=>doGateAction(b.booking_id,act.next,b,null)} disabled={acting}
                            style={{background:act.color,color:"#fff",border:"none",borderRadius:7,padding:"4px 10px",fontWeight:700,cursor:"pointer",fontSize:11,opacity:acting?.7:1,whiteSpace:"nowrap"}}>
                            {act.label.split(" ").slice(1).join(" ")||act.next.replace(/_/g," ")}
                          </button>
                        )}
                        <button onClick={()=>{setScanId(b.booking_id);handleGateScan(null,b.booking_id);}}
                          style={{background:"#e5e7eb",color:"#374151",border:"none",borderRadius:7,padding:"4px 8px",cursor:"pointer",fontSize:11,fontWeight:700}}>
                          Open
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          WAREHOUSE TAB — FIX: stack vertically, accordion panel
      ══════════════════════════════════════════════════════ */}
      {tab==="warehouse" && (
        <div style={{padding:14,maxWidth:1100,margin:"0 auto"}}>
          {whMsg && <Alert type={whMsg.type} msg={whMsg.msg}/>}

          {/* ─── ACTIVE GROUPS — List view เรียงตามเวลา+Dock ────── */}
          <div style={{background:"#fff",borderRadius:14,overflow:"hidden",boxShadow:"0 4px 20px rgba(0,0,0,.07)",marginBottom:14}}>
            {/* Header */}
            <div style={{padding:"11px 16px",borderBottom:"1px solid #e5e7eb",display:"flex",justifyContent:"space-between",alignItems:"center",background:"#0a2a6e"}}>
              <div>
                <span style={{fontWeight:800,color:"#fff",fontSize:13}}>Active Groups ({activeGroups.length})</span>
                <span style={{fontSize:10,color:"rgba(255,255,255,.4)",marginLeft:8}}>เรียงตามเวลานัด → Dock</span>
              </div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                {/* Mini KPI */}
                {[
                  {label:"BOOKED",    val:activeGroups.filter(g=>g.status==="BOOKED").length,    c:"#86efac"},
                  {label:"ON YARD",   val:activeGroups.filter(g=>g.status==="ON_YARD").length,   c:"#fcd34d"},
                  {label:"AT DOCK",   val:activeGroups.filter(g=>["CALLED_TO_DOCK","TRUCK_DOCKED","LOADING"].includes(g.status)).length, c:"#c4b5fd"},
                ].map(k=>k.val>0&&(
                  <div key={k.label} style={{textAlign:"center"}}>
                    <div style={{fontSize:14,fontWeight:900,color:k.c,fontFamily:"monospace",lineHeight:1}}>{k.val}</div>
                    <div style={{fontSize:8,color:"rgba(255,255,255,.4)",letterSpacing:.5}}>{k.label}</div>
                  </div>
                ))}
                <button onClick={loadActiveGroups} style={{background:"rgba(255,255,255,.1)",color:"#fff",border:"none",borderRadius:6,padding:"3px 8px",fontSize:11,fontWeight:700,cursor:"pointer",marginLeft:4}}>↻</button>
              </div>
            </div>

            {/* Column headers */}
            {activeGroups.length>0 && (
              <div style={{display:"grid",gridTemplateColumns:"46px 70px 1fr 80px 70px 80px 70px",gap:0,padding:"5px 12px",background:"#f8fafc",borderBottom:"1px solid #e5e7eb"}}>
                {["Dock","เวลา","Group","SubCon","Truck Status","Order","Plate"].map(h=>(
                  <div key={h} style={{fontSize:9,fontWeight:700,color:"#9ca3af",letterSpacing:.5}}>{h}</div>
                ))}
              </div>
            )}

            {/* List rows */}
            <div style={{maxHeight:360,overflowY:"auto"}}>
              {activeGroups.length===0 ? (
                <div style={{padding:24,textAlign:"center",color:"#9ca3af",fontSize:12}}>ไม่มี Active Group</div>
              ) : activeGroups.map((g,i)=>{
                const dot = truckStatusColor(g.status);
                const isAtDock  = ["TRUCK_DOCKED","LOADING"].includes(g.status);
                const isCalled  = g.status==="CALLED_TO_DOCK";
                const isOnYard  = g.status==="ON_YARD";
                const rowBg     = isAtDock?"#f5f3ff":isCalled?"#fff7ed":isOnYard?"#fefce8":"#fff";
                const rowBorder = isAtDock?"#7c3aed22":isCalled?"#f59e0b22":isOnYard?"#fbbf2422":"#f3f4f6";
                const nowTime   = new Date();
                const [hh,mm]   = String(g.booking_hour||"00:00").split(":").map(Number);
                const slotTime  = new Date(nowTime.getFullYear(),nowTime.getMonth(),nowTime.getDate(),hh,mm||0);
                const minsLeft  = Math.floor((slotTime-nowTime)/60000);
                const timeColor = minsLeft<0?"#dc2626":minsLeft<30?"#d97706":"#374151";

                return (
                  <div key={g.group_number}
                    onClick={()=>{ setWhScanId(g.group_number); loadWhGroup(g.group_number); }}
                    style={{display:"grid",gridTemplateColumns:"46px 70px 1fr 80px 70px 80px 70px",
                      gap:0,padding:"8px 12px",borderBottom:`1px solid ${rowBorder}`,
                      background:rowBg,cursor:"pointer",alignItems:"center",
                      borderLeft:`3px solid ${dot}`,
                      transition:"background .15s"}}>

                    {/* Dock */}
                    <div style={{fontWeight:900,fontSize:15,color:"#0a2a6e",fontFamily:"monospace"}}>
                      {g.dock_no_actual||"—"}
                    </div>

                    {/* เวลา */}
                    <div>
                      <div style={{fontWeight:800,fontSize:13,color:timeColor,fontFamily:"monospace"}}>
                        {String(g.booking_hour||"").slice(0,5)||"—"}
                      </div>
                      {g.booking_hour && (
                        <div style={{fontSize:9,color:timeColor,fontWeight:600}}>
                          {minsLeft<0?`เลย${-minsLeft}m`:minsLeft<60?`${minsLeft}m`:minsLeft<120?`${Math.floor(minsLeft/60)}h${minsLeft%60}m`:""}
                        </div>
                      )}
                    </div>

                    {/* Group */}
                    <div>
                      <div style={{fontFamily:"monospace",fontWeight:700,fontSize:11,color:"#0a2a6e"}}>{g.group_number}</div>
                      <div style={{fontSize:9,color:"#9ca3af"}}>{g.total_obd||0} OBD · {g.total_qty||0} pcs</div>
                    </div>

                    {/* SubCon */}
                    <div style={{fontSize:11,fontWeight:700,color:"#374151"}}>{g.subcon_code}</div>

                    {/* Truck Status */}
                    <div>
                      <div style={{display:"flex",alignItems:"center",gap:4}}>
                        <div style={{width:6,height:6,borderRadius:"50%",background:dot,flexShrink:0}}/>
                        <span style={{fontSize:9,fontWeight:700,color:dot}}>
                          {g.status.replace(/_/g," ")}
                        </span>
                      </div>
                      {g.check_in_time && (
                        <div style={{fontSize:9,color:"#9ca3af",marginTop:1}}>
                          เข้า {new Date(g.check_in_time).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit"})}
                        </div>
                      )}
                    </div>

                    {/* Order */}
                    <div style={{fontSize:9,fontWeight:700,
                      color:g.orderStatus==="READY_FOR_LOADING"?"#16a34a":
                           g.orderStatus==="LOADING"?"#1d4ed8":
                           g.orderStatus?"#374151":"#d1d5db"}}>
                      {g.orderStatus?g.orderStatus.replace(/_/g," "):"—"}
                    </div>

                    {/* Plate */}
                    <div style={{fontFamily:"monospace",fontSize:10,fontWeight:700,
                      color:"#374151"}}>{g.truck_plate||"—"}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Group search + detail */}
          <div style={{background:"#fff",borderRadius:14,padding:16,boxShadow:"0 4px 20px rgba(0,0,0,.07)"}}>
            <div style={{fontWeight:800,color:"#0a2a6e",fontSize:14,marginBottom:10}}>Group Detail</div>
            <form onSubmit={e=>{e.preventDefault();loadWhGroup(whScanId);}} style={{display:"flex",gap:8,marginBottom:14}}>
              <input value={whScanId} onChange={e=>setWhScanId(e.target.value)}
                placeholder="Group Number เช่น MON26043001"
                style={{flex:1,padding:"10px 14px",border:"2px solid #e5e7eb",borderRadius:10,fontSize:13,fontWeight:700,fontFamily:"monospace",outline:"none"}}/>
              <button type="submit" disabled={whLoading}
                style={{background:"#F5A800",color:"#fff",border:"none",borderRadius:10,padding:"0 16px",fontWeight:700,cursor:"pointer",fontSize:13}}>
                Load
              </button>
              <button type="button" onClick={clearWh}
                style={{background:"#e5e7eb",color:"#374151",border:"none",borderRadius:10,padding:"0 10px",fontWeight:700,cursor:"pointer",fontSize:13}}>
                ✕
              </button>
            </form>

            {whLoading && <div style={{textAlign:"center",padding:24}}><Spinner/></div>}

            {whGroup && (
              <div>
                {/* Truck stepper */}
                <div style={{marginBottom:16}}>
                  <div style={{fontSize:11,fontWeight:700,color:"#9ca3af",marginBottom:6}}>🚛 TRUCK TRACK</div>
                  <Stepper steps={TRUCK_STEPS} current={whGroup.status}/>
                </div>

                {/* Order stepper */}
                <div style={{marginBottom:16}}>
                  <div style={{fontSize:11,fontWeight:700,color:"#9ca3af",marginBottom:6}}>📋 ORDER TRACK</div>
                  <Stepper steps={ORDER_STEPS} current={whOrder?.status||"—"}/>
                </div>

                {/* Status pills */}
                <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
                  <span style={{fontSize:11,fontWeight:700,padding:"4px 10px",borderRadius:8,
                    background:["TRUCK_DOCKED","LOADING","COMPLETED"].includes(whGroup.status)?"#d1fae5":"#fee2e2",
                    color:["TRUCK_DOCKED","LOADING","COMPLETED"].includes(whGroup.status)?"#065f46":"#991b1b"}}>
                    {["TRUCK_DOCKED","LOADING","COMPLETED"].includes(whGroup.status)?"✓ Truck Docked":"✗ Truck ยังไม่ Docked"}
                  </span>
                  <span style={{fontSize:11,fontWeight:700,padding:"4px 10px",borderRadius:8,
                    background:whOrder?.status==="READY_FOR_LOADING"?"#d1fae5":"#fef3c7",
                    color:whOrder?.status==="READY_FOR_LOADING"?"#065f46":"#92400e"}}>
                    {whOrder?.status==="READY_FOR_LOADING"?"✓ Order Ready":"⏳ Order ยังไม่ Ready"}
                  </span>
                </div>

                {/* Info cards — FIX: responsive wrap */}
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:8,marginBottom:16}}>
                  {[
                    {label:"GROUP",    val:whGroup.group_number,     mono:true, color:"#0a2a6e"},
                    {label:"SUBCON",   val:`${whGroup.subcon_code}`,            color:"#d97706"},
                    {label:"TRUCK",    val:whGroup.status,                      badge:true},
                    {label:"ORDER",    val:whOrder?.status||"—",                badge:!!whOrder},
                    {label:"QTY",      val:`${whGroup.total_qty} pcs`,          color:"#374151"},
                    {label:"DOCK/เวลา",val:whGroup.dock_no?`D${whGroup.dock_no} • ${String(whBooking?.booking_hour||"").slice(0,5)}`:"—", color:"#1d4ed8"},
                  ].map(({label,val,mono,color,badge})=>(
                    <div key={label} style={{background:"#f8fafc",borderRadius:8,padding:"8px 10px"}}>
                      <div style={{fontSize:9,fontWeight:700,color:"#9ca3af",marginBottom:3}}>{label}</div>
                      {badge
                        ? <StatusBadge status={val}/>
                        : <div style={{fontSize:12,fontWeight:700,color:color||"#374151",fontFamily:mono?"monospace":"inherit"}}>{val}</div>
                      }
                    </div>
                  ))}
                </div>

                {/* ORDER ACTIONS */}
                <div style={{background:"#eff6ff",borderRadius:10,padding:"12px 14px",marginBottom:12}}>
                  <div style={{fontWeight:800,color:"#1d4ed8",fontSize:12,marginBottom:8}}>ORDER ACTIONS</div>
                  {!whOrder ? (
                    <button onClick={createOrder}
                      style={{background:"#1d4ed8",color:"#fff",border:"none",borderRadius:8,padding:"8px 16px",fontWeight:700,cursor:"pointer",fontSize:12}}>
                      + สร้าง Order
                    </button>
                  ) : (
                    <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                      <span style={{fontFamily:"monospace",fontSize:12,fontWeight:700,color:"#1d4ed8"}}>{whOrder.order_no}</span>
                      <StatusBadge status={whOrder.status}/>
                      {ORDER_ACTIONS[whOrder.status] && (
                        <button onClick={()=>updateOrder(ORDER_ACTIONS[whOrder.status].next)}
                          style={{border:"none",borderRadius:7,padding:"6px 12px",fontWeight:700,cursor:"pointer",fontSize:11,
                            background:ORDER_ACTIONS[whOrder.status].color,color:"#fff"}}>
                          {ORDER_ACTIONS[whOrder.status].label}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Start Loading / Release Dock — big prominent buttons */}
                {isWH && whGroup.status==="TRUCK_DOCKED" && (
                  <button onClick={startLoading} disabled={whActing}
                    style={{width:"100%",padding:"12px",marginBottom:8,border:"none",borderRadius:10,fontWeight:800,cursor:"pointer",fontSize:14,opacity:whActing?.6:1,background:"#1d4ed8",color:"#fff"}}>
                    {whActing?"กำลังดำเนินการ…":"⬆ Start Loading"}
                  </button>
                )}
                {isWH && whGroup.status==="LOADING" && (
                  <button onClick={releaseDock} disabled={whActing}
                    style={{width:"100%",padding:"12px",border:"none",borderRadius:10,fontWeight:800,cursor:"pointer",fontSize:14,opacity:whActing?.6:1,background:"#16a34a",color:"#fff"}}>
                    {whActing?"กำลังดำเนินการ…":"✓ Complete & Release Dock"}
                  </button>
                )}

                {/* OBD ใน Group */}
                {whGroupDetails.length>0 && (
                  <div style={{marginTop:14}}>
                    <div style={{fontWeight:700,color:"#0a2a6e",fontSize:13,marginBottom:8}}>OBD ใน Group ({whGroupDetails.length})</div>
                    <div style={{overflowX:"auto",borderRadius:8,border:"1px solid #e5e7eb"}}>
                      <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                        <thead>
                          <tr style={{background:"#0a2a6e",color:"#fff"}}>
                            {["OBD No","Qty","Lines"].map(h=>(
                              <th key={h} style={{padding:"7px 10px",textAlign:"left",fontWeight:700,fontSize:11}}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {whGroupDetails.map((d,i)=>(
                            <tr key={i} style={{borderBottom:"1px solid #f3f4f6",background:i%2===0?"#fff":"#f8fafc"}}>
                              <td style={{padding:"7px 10px",fontFamily:"monospace",fontWeight:700,fontSize:11}}>{d.obd_no||"—"}</td>
                              <td style={{padding:"7px 10px",fontWeight:700}}>{d.qty||0}</td>
                              <td style={{padding:"7px 10px",color:"#6b7280"}}>{d.line_count||0}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
