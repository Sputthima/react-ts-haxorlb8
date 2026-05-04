import React, { useState, useEffect, useCallback, useMemo } from "react";
import { supabase, today } from "../lib/supabase";
import { Spinner, StatusBadge, Alert } from "../components/UI";
import { T } from "../theme";

// ─────────────────────────────────────────────────────────────
//  ManagerApp v3 — ตาม GAS App6 getDashboard_ ครบทุก section
//
//  เพิ่ม vs เดิม:
//  1. DOCK_COUNT จาก config (ไม่ hardcode 5)
//  2. slotDays — 3 วัน: วันนี้/พรุ่งนี้/มะรืน
//  3. groupRows + isLate alert
//  4. Active Groups table พร้อม late flag
//  5. Alerts ครบ: OBD open, group pending, SLA, late, skip
//  6. obdSummary.allOpen (ทุก OBD OPEN ไม่ใช่แค่วันนี้)
//  7. Auto-refresh ทุก 2 นาที
//  8. Group status pipeline visual
// ─────────────────────────────────────────────────────────────

const ACTIVE_GRP  = ["BOOKING_PENDING","BOOKED","ON_YARD","CALLED_TO_DOCK","TRUCK_DOCKED","LOADING"];
const AT_DOCK_ST  = ["TRUCK_DOCKED","LOADING"];
const ON_YARD_ST  = ["ON_YARD","CALLED_TO_DOCK"];

function fmtTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit"});
}
function dateLabel(offset) { return ["วันนี้","พรุ่งนี้","มะรืน"][offset]||""; }
function addDays(d, n) {
  const x = new Date(d); x.setDate(x.getDate()+n); const y=x.getFullYear(),m=String(x.getMonth()+1).padStart(2,"0"),dy=String(x.getDate()).padStart(2,"0"); return `${y}-${m}-${dy}`;
}

// ── KPI Card ─────────────────────────────────────────────────
function KpiCard({ label, value, color, sub }) {
  return (
    <div style={{background:"#fff",borderRadius:14,padding:"14px 16px",boxShadow:"0 4px 20px rgba(0,0,0,.06)",borderLeft:`4px solid ${color}`,minWidth:0}}>
      <div style={{fontSize:26,fontWeight:900,color,lineHeight:1}}>{value??'—'}</div>
      <div style={{fontSize:11,color:"#6b7280",fontWeight:600,marginTop:4}}>{label}</div>
      {sub && <div style={{fontSize:10,color:"#9ca3af",marginTop:2}}>{sub}</div>}
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────
function Section({ title, children, actions }) {
  return (
    <div style={{background:"#fff",borderRadius:14,padding:16,boxShadow:"0 4px 20px rgba(0,0,0,.06)",marginBottom:14}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div style={{fontWeight:800,color:"#0a2a6e",fontSize:14}}>{title}</div>
        {actions}
      </div>
      {children}
    </div>
  );
}

// ── Dock mini card ────────────────────────────────────────────
const DOCK_BG = {
  EMPTY:"#f8fafc", ON_YARD:"#fef3c7", CALLED_TO_DOCK:"#ffedd5",
  TRUCK_DOCKED:"#ede9fe", LOADING:"#dbeafe", UNLOADING:"#d1fae5", GR_PENDING:"#fce7f3",
};
const DOCK_DOT = {
  EMPTY:"#e5e7eb", ON_YARD:"#F5A800", CALLED_TO_DOCK:"#ea580c",
  TRUCK_DOCKED:"#7c3aed", LOADING:"#1d4ed8", UNLOADING:"#059669",
};
function DockMini({ dockNo, booking }) {
  const st = booking?.status||"EMPTY";
  return (
    <div style={{background:DOCK_BG[st]||"#f8fafc",borderRadius:10,padding:"10px 8px",textAlign:"center",position:"relative",border:`1.5px solid ${DOCK_DOT[st]||"#e5e7eb"}44`,minWidth:0}}>
      <div style={{fontSize:9,fontWeight:700,color:"#6b7280",position:"absolute",top:5,left:7}}>D{dockNo}</div>
      <div style={{width:8,height:8,borderRadius:"50%",background:DOCK_DOT[st]||"#e5e7eb",margin:"14px auto 4px",boxShadow:`0 0 0 3px ${DOCK_DOT[st]||"#e5e7eb"}33`}}/>
      {booking?.truck_plate
        ? <>
            <div style={{fontSize:11,fontWeight:800,fontFamily:"monospace",marginTop:2,color:"#0a2a6e"}}>{booking.truck_plate}</div>
            <div style={{fontSize:9,color:"#6b7280",marginTop:1}}>{booking.subcon_code}</div>
            <div style={{fontSize:9,color:"#9ca3af"}}>{String(booking.booking_hour||"").slice(0,5)}</div>
            <div style={{fontSize:8,fontWeight:700,color:DOCK_DOT[st]||"#9ca3af",marginTop:3,letterSpacing:.5}}>{st}</div>
          </>
        : <div style={{fontSize:10,color:"#d1d5db",fontWeight:600,marginTop:2}}>EMPTY</div>
      }
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────
export default function ManagerApp({ user, onBack }) {
  const [tab, setTab]               = useState("outbound");
  const [innerTab, setInnerTab]     = useState("overview"); // overview | groups | slots
  const [data, setData]             = useState(null);
  const [inbound, setInbound]       = useState(null);
  const [selectedDate, setSelectedDate] = useState(today());
  const [loading, setLoading]       = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  // ── LOAD OUTBOUND (ตาม GAS getDashboard_) ────────────────────
  const loadOutbound = useCallback(async (date) => {
    setLoading(true);
    const [bkRes, grpRes, obdRes, qRes, slotRes, cfgRes] = await Promise.all([
      supabase.from("bookings").select("*").eq("booking_date", date),
      supabase.from("group_header").select("*"),
      supabase.from("obd_release").select("*"),
      supabase.from("queue_log").select("*").eq("slot_date", date),
      // slotDays: วันนี้ + 2 วันข้างหน้า
      supabase.from("dock_slots").select("*")
        .gte("slot_date", date)
        .lte("slot_date", addDays(date, 2)),
      supabase.from("config").select("*"),
    ]);
    const bk     = bkRes.data    || [];
    const grp    = grpRes.data   || [];
    const obd    = obdRes.data   || [];
    const q      = qRes.data     || [];
    const slots  = slotRes.data  || [];
    const cfgRaw = cfgRes.data   || [];
    const cfg    = Object.fromEntries(cfgRaw.map(r=>[r.key,r.value]));

    // FIX 1: DOCK_COUNT จาก config
    const dockCount = parseInt(cfg.DOCK_COUNT||"5");

    // ── OBD SUMMARY ─────────────────────────────────────────────
    const dateObd = obd.filter(o=>String(o.release_date||"").slice(0,10)===date);
    const obdSummary = {
      totalToday: dateObd.length,
      open:       dateObd.filter(o=>o.status==="OPEN").length,
      grouped:    dateObd.filter(o=>o.status==="GROUPED").length,
      booked:     dateObd.filter(o=>o.status==="BOOKED").length,
      completed:  dateObd.filter(o=>o.status==="COMPLETED").length,
      allOpen:    obd.filter(o=>o.status==="OPEN").length, // FIX 6: ทุก OBD open
    };

    // ── SUBCON BREAKDOWN ─────────────────────────────────────────
    const scMap = {};
    obd.forEach(o=>{
      const sc = o.subcon_code||"—";
      if (!scMap[sc]) scMap[sc]={subcon_code:sc,subcon_name:o.subcon_name||sc,open:0,grouped:0,booked:0,completed:0};
      const st = o.status;
      if (st==="OPEN")      scMap[sc].open++;
      if (st==="GROUPED")   scMap[sc].grouped++;
      if (st==="BOOKED")    scMap[sc].booked++;
      if (st==="COMPLETED") scMap[sc].completed++;
    });
    const subconBreakdown = Object.values(scMap).sort((a,b)=>b.open-a.open);

    // ── GROUP ROWS + isLate (FIX 3) ─────────────────────────────
    const activeGroups = grp.filter(g=>ACTIVE_GRP.includes(g.status));
    const nowHHMM = new Date().toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"});
    const groupRows = activeGroups.map(g=>{
      const isLate = g.booking_date===date && g.booking_slot && nowHHMM>String(g.booking_slot).slice(0,5)
        && ["BOOKED","ON_YARD"].includes(g.status);
      return { ...g, isLate };
    });
    const groupSummary = {
      bookingPending: activeGroups.filter(g=>g.status==="BOOKING_PENDING").length,
      booked:         activeGroups.filter(g=>g.status==="BOOKED").length,
      onYard:         activeGroups.filter(g=>ON_YARD_ST.includes(g.status)).length,
      atDock:         activeGroups.filter(g=>AT_DOCK_ST.includes(g.status)).length,
    };

    // ── DOCK GRID (FIX 1: dockCount จาก config) ─────────────────
    const dockBkMap = {};
    bk.forEach(b=>{
      if (["ON_YARD","CALLED_TO_DOCK","TRUCK_DOCKED","LOADING"].includes(b.status) && b.dock_no)
        dockBkMap[String(b.dock_no)]=b;
    });
    const docks = Array.from({length:dockCount},(_,i)=>({
      dockNo:  i+1,
      booking: dockBkMap[String(i+1)]||null,
    }));

    // ── TIMELINE ─────────────────────────────────────────────────
    const todaySlots = slots.filter(s=>String(s.slot_date||"").slice(0,10)===date);
    const hourMap = {};
    todaySlots.forEach(s=>{
      const h = String(s.slot_hour).slice(0,5);
      if (!hourMap[h]) hourMap[h]={hour:h,total:0,booked:0,available:0,checkedIn:0};
      hourMap[h].total++;
      if (s.status==="BOOKED") hourMap[h].booked++; else hourMap[h].available++;
    });
    bk.forEach(b=>{
      if (b.check_in_time) {
        const h = String(b.booking_hour||"").slice(0,5);
        if (hourMap[h]) hourMap[h].checkedIn++;
      }
    });
    const timeline = Object.values(hourMap).sort((a,b)=>a.hour<b.hour?-1:1);

    // ── SLOT DAYS — 3 วัน (FIX 2) ───────────────────────────────
    const slotDays = [0,1,2].map(offset=>{
      const d = addDays(date,offset);
      const daySlots = slots.filter(s=>String(s.slot_date||"").slice(0,10)===d);
      const dayBk    = offset===0 ? bk : []; // บก วันอื่นต้องเรียกต่างหาก (เรียกแค่วันนี้ก่อน)
      return {
        date: d,
        dayLabel: dateLabel(offset),
        totalSlots: daySlots.length,
        booked: daySlots.filter(s=>s.status==="BOOKED").length,
        available: daySlots.filter(s=>s.status==="AVAILABLE").length,
      };
    });

    // ── QUEUE SUMMARY ─────────────────────────────────────────────
    const qSummary = {
      total:     q.length,
      waiting:   q.filter(r=>["WAITING","REMINDER_SENT"].includes(r.queue_status||"")).length,
      calling:   q.filter(r=>r.queue_status==="CALLING").length,
      completed: q.filter(r=>r.queue_status==="COMPLETED").length,
      skipped:   q.filter(r=>r.queue_status==="SKIPPED").length,
    };

    // ── KPI ───────────────────────────────────────────────────────
    let onTime=0, late=0;
    bk.forEach(b=>{
      if (!b.check_in_time||!b.booking_hour) return;
      const ci = new Date(b.check_in_time).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"});
      const bh = String(b.booking_hour).slice(0,5);
      if (ci<=bh) onTime++; else late++;
    });
    const SLA_MINS = parseInt(cfg.SLA_MINUTES||"120");
    let slaBreached=0;
    bk.filter(b=>b.status==="COMPLETED"&&b.check_in_time).forEach(b=>{
      const ci  = new Date(b.check_in_time).getTime();
      const upd = new Date(b.updated_at).getTime();
      if (!isNaN(ci)&&!isNaN(upd)&&(upd-ci)>SLA_MINS*60000) slaBreached++;
    });
    const kpi = {
      bookedToday: bk.length,
      onYard:      bk.filter(b=>b.status==="ON_YARD").length,
      atDock:      bk.filter(b=>AT_DOCK_ST.includes(b.status)).length,
      completed:   bk.filter(b=>b.status==="COMPLETED").length,
      onTimeRate:  (onTime+late)>0?Math.round(onTime/(onTime+late)*100):null,
      onTimeCount: onTime, lateCount: late,
      slaBreached, slaMin:SLA_MINS,
      obdOpen:obdSummary.allOpen, // FIX 6
      groupBookingPending: groupSummary.bookingPending,
    };

    // ── ALERTS (FIX 5: ครบตาม GAS) ──────────────────────────────
    const alerts = [];
    if (obdSummary.allOpen>0)
      alerts.push({level:"warn", msg:`OBD รอ Booking ${obdSummary.allOpen} รายการ (ยังไม่ได้จอง Dock)`});
    if (groupSummary.bookingPending>0)
      alerts.push({level:"warn", msg:`Group รอ Booking ${groupSummary.bookingPending} groups`});
    if (kpi.slaBreached>0)
      alerts.push({level:"danger", msg:`SLA Breach: ${kpi.slaBreached} groups ใช้เวลาเกิน ${SLA_MINS} นาที`});
    // FIX 3: late check-in alert ต่อ group
    groupRows.filter(r=>r.isLate).forEach(r=>{
      alerts.push({level:"warn", msg:`Group ${r.group_number} (${r.subcon_code}) เลยเวลา ${String(r.booking_slot||"").slice(0,5)} แต่ยังไม่ Check-in`});
    });
    if (qSummary.skipped>0)
      alerts.push({level:"info", msg:`คิว Skip ${qSummary.skipped} คัน วันนี้`});

    setData({kpi,obdSummary,subconBreakdown,groupSummary,groupRows,docks,timeline,slotDays,qSummary,alerts,cfg,dockCount});
    setLastRefresh(new Date());
    setLoading(false);
  },[]);

  // ── LOAD INBOUND ──────────────────────────────────────────────
  const loadInbound = useCallback(async () => {
    setLoading(true);
    const [bkRes, asnRes, cfgRes] = await Promise.all([
      supabase.from("inbound_bookings").select("*"),
      supabase.from("asn_header").select("*"),
      supabase.from("config").select("*"),
    ]);
    const bk  = bkRes.data  || [];
    const asn = asnRes.data || [];
    const cfg = Object.fromEntries((cfgRes.data||[]).map(r=>[r.key,r.value]));
    const dockCount = parseInt(cfg.DOCK_COUNT||"5");
    const t = today();
    const asnMap = Object.fromEntries(asn.map(a=>[a.asn_no,a]));
    const todayBk   = bk.filter(b=>String(b.booking_date).slice(0,10)===t);
    const activeStatuses = ["RESERVED","ON_YARD","CALLED_TO_DOCK","TRUCK_DOCKED","UNLOADING","GR_PENDING"];
    const activeBk  = bk.filter(b=>activeStatuses.includes(b.status));
    const kpi = {
      todayTotal:     todayBk.length,
      reserved:       todayBk.filter(b=>b.status==="RESERVED").length,
      onYard:         activeBk.filter(b=>b.status==="ON_YARD").length,
      atDock:         activeBk.filter(b=>["TRUCK_DOCKED","UNLOADING"].includes(b.status)).length,
      grPending:      activeBk.filter(b=>b.status==="GR_PENDING").length,
      completedToday: bk.filter(b=>b.status==="COMPLETED"&&String(b.updated_at||"").slice(0,10)===t).length,
    };
    const dockMap={};
    activeBk.forEach(b=>{ if(b.dock_no) dockMap[String(b.dock_no)]=b; });
    const docks=Array.from({length:dockCount},(_,i)=>{
      const b=dockMap[String(i+1)]||null;
      return {dockNo:i+1,booking:b,asn:b?asnMap[b.asn_no]||{}:{}};
    });
    const activeRows=activeBk.map(b=>({
      ...b, supplier_name:asnMap[b.asn_no]?.supplier_name||b.supplier_code||"—",
    })).sort((a,b)=>a.booking_hour<b.booking_hour?-1:1);
    setInbound({kpi,docks,activeRows});
    setLastRefresh(new Date());
    setLoading(false);
  },[]);

  useEffect(()=>{
    if (tab==="outbound") loadOutbound(selectedDate);
    else loadInbound();
  },[tab,selectedDate]);

  // Realtime
  useEffect(()=>{
    const ch=supabase.channel("manager_live")
      .on("postgres_changes",{event:"*",schema:"public",table:"bookings"},()=>tab==="outbound"&&loadOutbound(selectedDate))
      .on("postgres_changes",{event:"*",schema:"public",table:"group_header"},()=>tab==="outbound"&&loadOutbound(selectedDate))
      .on("postgres_changes",{event:"*",schema:"public",table:"inbound_bookings"},()=>tab==="inbound"&&loadInbound())
      .subscribe(s=>{ if(s==="CHANNEL_ERROR") console.warn("Manager realtime error"); });
    return()=>{ try{supabase.removeChannel(ch);}catch(e){} };
  },[tab,selectedDate]);

  // FIX 7: auto-refresh ทุก 2 นาที
  useEffect(()=>{
    const id=setInterval(()=>{
      if(tab==="outbound") loadOutbound(selectedDate);
      else loadInbound();
    },120000);
    return()=>clearInterval(id);
  },[tab,selectedDate]);

  // ─────────────────────────────────────────────────────────────
  return (
    <div style={{minHeight:"100vh",background:"#f0f4fb"}}>

      {/* TOPBAR */}
      <div style={{background:"linear-gradient(90deg,#0a2a6e,#1e3a8a,#1d4ed8)",color:"#fff",
        padding:"12px 18px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",
        position:"sticky",top:0,zIndex:40}}>
        <button onClick={onBack} style={{border:"1px solid rgba(255,255,255,.2)",background:"transparent",color:"#fff",borderRadius:8,padding:"4px 10px",cursor:"pointer",fontSize:12}}>← Back</button>
        <span style={{fontWeight:800,fontSize:15}}>📊 Manager Dashboard</span>

        {/* Outbound / Inbound */}
        <div style={{display:"flex",gap:4,background:"rgba(255,255,255,.12)",borderRadius:9,padding:3,marginLeft:8}}>
          {["outbound","inbound"].map(t=>(
            <button key={t} onClick={()=>{setTab(t);setInnerTab("overview");}}
              style={{border:"none",borderRadius:7,padding:"5px 12px",fontWeight:700,fontSize:12,cursor:"pointer",background:tab===t?"#fff":"transparent",color:tab===t?"#0a2a6e":"rgba(255,255,255,.7)"}}>
              {t==="outbound"?"📤 Outbound":"📥 Inbound"}
            </button>
          ))}
        </div>

        {/* Inner tabs */}
        {tab==="outbound" && (
          <div style={{display:"flex",gap:3,background:"rgba(255,255,255,.08)",borderRadius:8,padding:2}}>
            {[["overview","📊 Overview"],["groups","👥 Groups"],["slots","📅 Slots (3 วัน)"]].map(([t,l])=>(
              <button key={t} onClick={()=>setInnerTab(t)}
                style={{border:"none",borderRadius:6,padding:"3px 10px",fontWeight:700,fontSize:11,cursor:"pointer",background:innerTab===t?"rgba(255,255,255,.25)":"transparent",color:"rgba(255,255,255,.8)"}}>
                {l}
              </button>
            ))}
          </div>
        )}

        {tab==="outbound" && (
          <input type="date" value={selectedDate} onChange={e=>setSelectedDate(e.target.value)}
            style={{padding:"4px 8px",borderRadius:7,border:"none",fontSize:12,background:"rgba(255,255,255,.15)",color:"#fff"}}/>
        )}

        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8}}>
          <button onClick={()=>tab==="outbound"?loadOutbound(selectedDate):loadInbound()}
            style={{background:"rgba(255,255,255,.1)",border:"1px solid rgba(255,255,255,.2)",color:"rgba(255,255,255,.7)",borderRadius:6,padding:"3px 8px",cursor:"pointer",fontSize:10}}>
            ↺ {lastRefresh.toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit"})}
          </button>
          <span style={{width:8,height:8,borderRadius:"50%",background:"#4ADE80",display:"inline-block",boxShadow:"0 0 0 3px rgba(34,197,94,.25)"}}/>
          <span style={{fontSize:11,fontWeight:700,color:"#86EFAC"}}>LIVE</span>
        </div>
      </div>

      <div style={{padding:14,maxWidth:1200,margin:"0 auto"}}>
        {loading ? <div style={{padding:40,textAlign:"center"}}><Spinner/></div> : <>

        {/* ══════════════════════════════════════════════════════
            OUTBOUND
        ══════════════════════════════════════════════════════ */}
        {tab==="outbound" && data && <>

          {/* ── ALERTS (FIX 5) ── */}
          {data.alerts.length>0 && (
            <div style={{marginBottom:14}}>
              {data.alerts.slice(0,5).map((a,i)=>(
                <Alert key={i} type={a.level==="danger"?"err":a.level==="info"?"ok":"warn"} msg={a.msg}/>
              ))}
            </div>
          )}

          {/* ══ OVERVIEW TAB ══════════════════════════════════ */}
          {innerTab==="overview" && <>

            {/* KPI CARDS */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:10,marginBottom:14}}>
              <KpiCard label="Booked วันนี้"   value={data.kpi.bookedToday}  color="#1d4ed8"/>
              <KpiCard label="On Yard"          value={data.kpi.onYard}       color="#F5A800"/>
              <KpiCard label="At Dock"          value={data.kpi.atDock}       color="#7c3aed"/>
              <KpiCard label="Completed"        value={data.kpi.completed}    color="#16a34a"/>
              <KpiCard label="On-time Rate"
                value={data.kpi.onTimeRate!=null?`${data.kpi.onTimeRate}%`:"—"}
                color={data.kpi.onTimeRate>=90?"#16a34a":data.kpi.onTimeRate>=70?"#F5A800":"#dc2626"}
                sub={`${data.kpi.onTimeCount}✓ ${data.kpi.lateCount}✗`}/>
              <KpiCard label="SLA Breach"
                value={data.kpi.slaBreached}
                color={data.kpi.slaBreached>0?"#dc2626":"#16a34a"}
                sub={`>${data.kpi.slaMin} นาที`}/>
              <KpiCard label="OBD Open (รวม)"
                value={data.kpi.obdOpen}
                color={data.kpi.obdOpen>0?"#F5A800":"#16a34a"}/>
            </div>

            {/* FIX 8: Group Pipeline Visual */}
            <Section title="🔄 Group Pipeline">
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
                {[
                  {label:"รอ Booking",  val:data.groupSummary.bookingPending, bg:"#fef3c7",c:"#92400e"},
                  {label:"Booked",      val:data.groupSummary.booked,         bg:"#dbeafe",c:"#1d4ed8"},
                  {label:"On Yard",     val:data.groupSummary.onYard,         bg:"#ffedd5",c:"#c2410c"},
                  {label:"At Dock",     val:data.groupSummary.atDock,         bg:"#ede9fe",c:"#6d28d9"},
                ].map(s=>(
                  <div key={s.label} style={{background:s.bg,borderRadius:12,padding:"14px 12px",textAlign:"center",border:`1.5px solid ${s.c}33`}}>
                    <div style={{fontSize:28,fontWeight:900,color:s.c}}>{s.val}</div>
                    <div style={{fontSize:11,color:s.c,fontWeight:700,opacity:.8,marginTop:2}}>{s.label}</div>
                  </div>
                ))}
              </div>
            </Section>

            {/* DOCK GRID (FIX 1: dockCount จาก config) */}
            <Section title={`🏭 Dock Status (${data.dockCount} docks)`}>
              <div style={{display:"grid",gridTemplateColumns:`repeat(${Math.min(data.dockCount,10)},1fr)`,gap:8}}>
                {data.docks.map(dk=><DockMini key={dk.dockNo} dockNo={dk.dockNo} booking={dk.booking}/>)}
              </div>
            </Section>

            {/* TIMELINE */}
            <Section title="📅 Slot Timeline วันนี้">
              {data.timeline.length===0
                ? <div style={{color:"#9ca3af",textAlign:"center",padding:"12px 0"}}>ไม่มีข้อมูล Slot</div>
                : <div style={{display:"flex",gap:4,flexWrap:"wrap",alignItems:"flex-end"}}>
                    {data.timeline.map(tl=>{
                      const pct = tl.total>0?Math.round(tl.booked/tl.total*100):0;
                      return (
                        <div key={tl.hour} style={{flex:"0 0 auto",minWidth:52,textAlign:"center"}}>
                          <div style={{fontSize:10,color:"#6b7280",marginBottom:4}}>{tl.hour}</div>
                          <div style={{background:"#e5e7eb",borderRadius:6,overflow:"hidden",height:44,position:"relative"}}>
                            <div style={{position:"absolute",bottom:0,left:0,right:0,
                              height:`${pct}%`,background:pct>=80?"#dc2626":pct>=50?"#F5A800":"#1d4ed8",
                              borderRadius:"0 0 6px 6px",transition:"height .3s"}}/>
                          </div>
                          <div style={{fontSize:9,color:"#374151",marginTop:3,fontWeight:700}}>{tl.booked}/{tl.total}</div>
                          {tl.checkedIn>0 && <div style={{fontSize:8,color:"#16a34a",fontWeight:700}}>✓{tl.checkedIn}</div>}
                        </div>
                      );
                    })}
                  </div>
              }
            </Section>

            {/* SUBCON BREAKDOWN */}
            <Section title="🏢 SubCon OBD Breakdown">
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead>
                    <tr style={{background:"#f8fafc"}}>
                      {["SubCon","Open","Grouped","Booked","Completed"].map(h=>(
                        <th key={h} style={{padding:"7px 10px",textAlign:h==="SubCon"?"left":"center",fontWeight:700,color:"#374151"}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.subconBreakdown.map(sc=>(
                      <tr key={sc.subcon_code} style={{borderBottom:"1px solid #f3f4f6"}}>
                        <td style={{padding:"7px 10px",fontWeight:700,color:"#0a2a6e"}}>{sc.subcon_code}</td>
                        <td style={{padding:"7px 10px",textAlign:"center",color:sc.open>0?"#F5A800":"#9ca3af",fontWeight:700}}>{sc.open}</td>
                        <td style={{padding:"7px 10px",textAlign:"center",color:"#1d4ed8",fontWeight:700}}>{sc.grouped}</td>
                        <td style={{padding:"7px 10px",textAlign:"center",color:"#7c3aed",fontWeight:700}}>{sc.booked}</td>
                        <td style={{padding:"7px 10px",textAlign:"center",color:"#16a34a",fontWeight:700}}>{sc.completed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>

            {/* QUEUE SUMMARY */}
            <Section title="🔔 Queue Summary">
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
                {[
                  {label:"รอ",val:data.qSummary.waiting,bg:"#dbeafe",c:"#1d4ed8"},
                  {label:"กำลังเรียก",val:data.qSummary.calling,bg:"#fef3c7",c:"#92400e"},
                  {label:"เสร็จ",val:data.qSummary.completed,bg:"#dcfce7",c:"#166534"},
                  {label:"Skip",val:data.qSummary.skipped,bg:"#f3f4f6",c:"#6b7280"},
                ].map(s=>(
                  <div key={s.label} style={{background:s.bg,borderRadius:10,padding:"12px",textAlign:"center"}}>
                    <div style={{fontSize:22,fontWeight:900,color:s.c}}>{s.val}</div>
                    <div style={{fontSize:11,color:s.c,opacity:.8}}>{s.label}</div>
                  </div>
                ))}
              </div>
            </Section>
          </>}

          {/* ══ GROUPS TAB (FIX 4) ════════════════════════════ */}
          {innerTab==="groups" && (
            <div style={{background:"#fff",borderRadius:14,overflow:"hidden",boxShadow:"0 4px 20px rgba(0,0,0,.06)"}}>
              <div style={{padding:"12px 16px",borderBottom:"1px solid #e5e7eb",fontWeight:800,color:"#0a2a6e",fontSize:14}}>
                👥 Active Groups ({data.groupRows.length})
                {data.groupRows.filter(r=>r.isLate).length>0 && (
                  <span style={{marginLeft:8,fontSize:11,background:"#fee2e2",color:"#991b1b",borderRadius:999,padding:"2px 8px",fontWeight:700}}>
                    ⚠️ {data.groupRows.filter(r=>r.isLate).length} เลยเวลา
                  </span>
                )}
              </div>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead>
                    <tr style={{background:"#f8fafc"}}>
                      {["Group No","SubCon","Status","Booking Date","Slot","Dock","Truck","Qty","OBD"].map(h=>(
                        <th key={h} style={{padding:"8px 10px",textAlign:"left",fontWeight:700,color:"#374151",whiteSpace:"nowrap"}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.groupRows.length===0 ? (
                      <tr><td colSpan={9} style={{padding:24,textAlign:"center",color:"#9ca3af"}}>ไม่มี Active Group</td></tr>
                    ) : data.groupRows.map(g=>{
                      const ST_BG = {
                        BOOKING_PENDING:"#fef3c7", BOOKED:"#dbeafe",
                        ON_YARD:"#ffedd5", CALLED_TO_DOCK:"#ffedd5",
                        TRUCK_DOCKED:"#ede9fe", LOADING:"#dbeafe",
                      };
                      return (
                        <tr key={g.group_number}
                          style={{borderBottom:"1px solid #f3f4f6",background:g.isLate?"#fff7ed":"#fff"}}>
                          <td style={{padding:"8px 10px",fontFamily:"monospace",fontWeight:700,fontSize:11,color:"#0a2a6e"}}>
                            {g.isLate && <span style={{color:"#dc2626",marginRight:4}}>⚠️</span>}
                            {g.group_number}
                          </td>
                          <td style={{padding:"8px 10px",fontWeight:700}}>{g.subcon_code}</td>
                          <td style={{padding:"8px 10px"}}>
                            <span style={{background:ST_BG[g.status]||"#f3f4f6",color:"#374151",borderRadius:999,padding:"2px 8px",fontSize:10,fontWeight:800}}>
                              {g.status}
                            </span>
                          </td>
                          <td style={{padding:"8px 10px",color:"#6b7280"}}>{g.booking_date||"—"}</td>
                          <td style={{padding:"8px 10px",fontWeight:700,color:g.isLate?"#dc2626":"#374151"}}>
                            {g.booking_slot?String(g.booking_slot).slice(0,5):"—"}
                          </td>
                          <td style={{padding:"8px 10px"}}>{g.dock_no||"—"}</td>
                          <td style={{padding:"8px 10px",fontFamily:"monospace",fontSize:11}}>{g.truck_plate||"—"}</td>
                          <td style={{padding:"8px 10px",textAlign:"right",fontWeight:700}}>{g.total_qty||0}</td>
                          <td style={{padding:"8px 10px",textAlign:"center",color:"#6b7280"}}>{g.total_obd||0}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ══ SLOTS TAB — 3 วัน (FIX 2) ═══════════════════ */}
          {innerTab==="slots" && (
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              {data.slotDays.map(sd=>(
                <Section key={sd.date} title={`📅 ${sd.dayLabel} (${sd.date})`}
                  actions={
                    <div style={{display:"flex",gap:8,fontSize:12}}>
                      <span style={{color:"#1d4ed8",fontWeight:700}}>{sd.booked} Booked</span>
                      <span style={{color:"#16a34a",fontWeight:700}}>{sd.available} Available</span>
                      <span style={{color:"#6b7280"}}>{sd.totalSlots} total slots</span>
                    </div>
                  }>
                  {sd.totalSlots===0
                    ? <div style={{color:"#9ca3af",textAlign:"center",padding:"12px 0"}}>ไม่มี Slot — Admin ต้องสร้างก่อน</div>
                    : (
                      <div style={{background:"#f8fafc",borderRadius:8,padding:"10px 14px"}}>
                        <div style={{display:"flex",gap:4,alignItems:"center",flexWrap:"wrap"}}>
                          <span style={{fontSize:12,fontWeight:700,color:"#374151",minWidth:80}}>ความจุ:</span>
                          <div style={{flex:1,background:"#e5e7eb",borderRadius:999,height:14,overflow:"hidden",position:"relative",minWidth:100}}>
                            <div style={{
                              position:"absolute",left:0,top:0,bottom:0,
                              width:`${sd.totalSlots>0?Math.round(sd.booked/sd.totalSlots*100):0}%`,
                              background:sd.booked/sd.totalSlots>0.8?"#dc2626":sd.booked/sd.totalSlots>0.5?"#F5A800":"#1d4ed8",
                              borderRadius:999,
                            }}/>
                          </div>
                          <span style={{fontSize:12,fontWeight:700,color:"#374151"}}>
                            {sd.totalSlots>0?Math.round(sd.booked/sd.totalSlots*100):0}%
                          </span>
                        </div>
                      </div>
                    )
                  }
                </Section>
              ))}
            </div>
          )}
        </>}

        {/* ══════════════════════════════════════════════════════
            INBOUND
        ══════════════════════════════════════════════════════ */}
        {tab==="inbound" && inbound && <>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:10,marginBottom:14}}>
            <KpiCard label="Booking วันนี้"    value={inbound.kpi.todayTotal}     color="#0a2a6e"/>
            <KpiCard label="รอ Check-in"       value={inbound.kpi.reserved}       color="#6b7280"/>
            <KpiCard label="On Yard"           value={inbound.kpi.onYard}         color="#F5A800"/>
            <KpiCard label="At Dock / Unload" value={inbound.kpi.atDock}         color="#7c3aed"/>
            <KpiCard label="รอ GR"             value={inbound.kpi.grPending}      color={inbound.kpi.grPending>0?"#dc2626":"#16a34a"}/>
            <KpiCard label="GR เสร็จวันนี้"   value={inbound.kpi.completedToday} color="#16a34a"/>
          </div>

          <Section title={`🏭 Inbound Dock Status (${inbound.docks.length} docks)`}>
            <div style={{display:"grid",gridTemplateColumns:`repeat(${Math.min(inbound.docks.length,10)},1fr)`,gap:8}}>
              {inbound.docks.map(dk=>(
                <DockMini key={dk.dockNo} dockNo={dk.dockNo}
                  booking={dk.booking?{...dk.booking,subcon_code:dk.asn?.supplier_code||dk.booking?.supplier_code}:null}/>
              ))}
            </div>
          </Section>

          <div style={{background:"#fff",borderRadius:14,overflow:"hidden",boxShadow:"0 4px 20px rgba(0,0,0,.06)"}}>
            <div style={{padding:"12px 16px",borderBottom:"1px solid #e5e7eb",fontWeight:800,color:"#0a2a6e",fontSize:14}}>
              📋 Active Inbound ({inbound.activeRows.length})
            </div>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead><tr style={{background:"#f8fafc"}}>
                  {["Booking ID","ASN","Supplier","Dock","เวลา","Plate","Check-in","Status"].map(h=>(
                    <th key={h} style={{padding:"7px 10px",textAlign:"left",fontWeight:700,color:"#374151",whiteSpace:"nowrap"}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {inbound.activeRows.length===0 ? (
                    <tr><td colSpan={8} style={{padding:24,textAlign:"center",color:"#9ca3af"}}>ไม่มี Active Inbound</td></tr>
                  ) : inbound.activeRows.map(b=>(
                    <tr key={b.booking_id} style={{borderBottom:"1px solid #f3f4f6"}}>
                      <td style={{padding:"7px 10px",fontFamily:"monospace",fontSize:10,fontWeight:700,color:"#0a2a6e"}}>{b.booking_id}</td>
                      <td style={{padding:"7px 10px",fontFamily:"monospace",fontSize:10}}>{b.asn_no}</td>
                      <td style={{padding:"7px 10px",fontWeight:700}}>{b.supplier_name}</td>
                      <td style={{padding:"7px 10px",fontWeight:700}}>D{b.dock_no}</td>
                      <td style={{padding:"7px 10px",fontWeight:700}}>{String(b.booking_hour||"").slice(0,5)}</td>
                      <td style={{padding:"7px 10px",fontFamily:"monospace"}}>{b.truck_plate}</td>
                      <td style={{padding:"7px 10px",color:b.check_in_time?"#16a34a":"#9ca3af",fontWeight:700}}>
                        {b.check_in_time?fmtTime(b.check_in_time):"—"}
                      </td>
                      <td style={{padding:"7px 10px"}}><StatusBadge status={b.status}/></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>}
        </>}
      </div>
    </div>
  );
}
