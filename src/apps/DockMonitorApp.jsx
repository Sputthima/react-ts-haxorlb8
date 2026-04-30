import React, { useState, useEffect, useCallback } from "react";
import { supabase, today } from "../lib/supabase";
import { T } from "../theme";

// ─────────────────────────────────────────────────────────────
//  DockMonitorApp v4
//
//  SLA Logic:
//  - ON YARD time  = now - check_in_time   (ใช้แบ่ง 3 ช่วง)
//  - Load time     = now - loading_start   (ถ้าเริ่ม load แล้ว)
//  - Pre-dock alert= booking_hour ≤ now+SLA_PRE_DOCK_MINS แต่ยังไม่ DOCKED
//  - Load SLA      = loading_start → completed ≤ SLA_LOAD_LIMIT_MINS
//
//  booking_hour = เวลาที่ต้องการ START LOAD (ไม่ใช่เวลา check-in)
//  → รถควร docked ก่อน booking_hour อย่างน้อย SLA_PRE_DOCK_MINS นาที
// ─────────────────────────────────────────────────────────────

const AT_DOCK_STATUSES = ["CALLED_TO_DOCK","TRUCK_DOCKED","LOADING"];
const ACTIVE_STATUSES  = ["RESERVED","ON_YARD","CALLED_TO_DOCK","TRUCK_DOCKED","LOADING"];

// ── Time helpers ─────────────────────────────────────────────
function elapsedMs(isoStr) {
  if (!isoStr) return 0;
  return Date.now() - new Date(isoStr).getTime();
}
function elapsedMins(isoStr) { return Math.floor(elapsedMs(isoStr)/60000); }
function elapsedHrs(isoStr)  { return elapsedMs(isoStr)/3600000; }
function fmt(isoStr) {
  if (!isoStr) return "—";
  const m = elapsedMins(isoStr);
  const h = Math.floor(m/60), rm = m%60;
  return h>0 ? `${h}h${rm}m` : `${m}m`;
}
function fmtTime(isoStr) {
  if (!isoStr) return "—";
  return new Date(isoStr).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit"});
}
// นาทีจากตอนนี้ถึง slot time วันนี้
function minsToSlot(slotHour) {
  if (!slotHour) return null;
  const now = new Date();
  const [h,m] = String(slotHour).split(":").map(Number);
  const slot = new Date(now.getFullYear(),now.getMonth(),now.getDate(),h,m||0);
  return Math.floor((slot-now)/60000); // ลบ = เลยไปแล้ว
}

// ── Live Clock ───────────────────────────────────────────────
function Clock() {
  const [t, setT] = useState(new Date());
  useEffect(()=>{ const id=setInterval(()=>setT(new Date()),1000); return()=>clearInterval(id); },[]);
  return (
    <div style={{textAlign:"right"}}>
      <div style={{fontSize:28,fontWeight:900,color:T.gold,fontFamily:"monospace",letterSpacing:2}}>
        {t.toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false})}
      </div>
      <div style={{fontSize:11,color:"rgba(255,255,255,.45)",marginTop:1}}>
        {t.toLocaleDateString("th-TH",{weekday:"short",day:"numeric",month:"short",year:"numeric"})}
      </div>
    </div>
  );
}

// ── Section bar ───────────────────────────────────────────────
function SectionBar({ label, count, bg, border, right }) {
  return (
    <div style={{background:bg||"rgba(27,58,107,.5)",padding:"9px 16px",
      display:"flex",alignItems:"center",justifyContent:"space-between",
      borderBottom:`1px solid ${border||"rgba(255,255,255,.08)"}`}}>
      <span style={{fontWeight:800,fontSize:12,letterSpacing:.5}}>{label}</span>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        {right}
        <span style={{background:"rgba(255,255,255,.12)",borderRadius:999,
          padding:"1px 9px",fontSize:11,fontWeight:800,minWidth:24,textAlign:"center"}}>
          {count}
        </span>
      </div>
    </div>
  );
}

// ── Dock Card ─────────────────────────────────────────────────
function DockCard({ dockNo, booking, sla }) {
  const occupied  = !!booking;
  const isLoading = booking?.status==="LOADING";
  const isDocked  = booking?.status==="TRUCK_DOCKED";
  const isCalled  = booking?.status==="CALLED_TO_DOCK";

  const minsLeft  = booking ? minsToSlot(booking.booking_hour) : null;
  // Pre-dock alert: ใกล้/เลยเวลา load start แต่ยังไม่ docked
  const preDockAlert = occupied && !isDocked && !isLoading
    && minsLeft !== null && minsLeft <= (sla.preDockMins||15);

  const borderColor = isLoading||isDocked ? "#22c55e"
    : isCalled ? T.gold
    : preDockAlert ? "#ef4444"
    : "rgba(255,255,255,.1)";

  const bg = isLoading||isDocked
    ? "linear-gradient(160deg,#1a3a1a,#1e5c1e)"
    : isCalled ? "linear-gradient(160deg,#2a1a00,#4a3800)"
    : preDockAlert ? "linear-gradient(160deg,#3a0000,#5a1010)"
    : "linear-gradient(160deg,#0e1a2e,#152240)";

  // Load SLA
  const loadMins    = booking?.loading_start ? elapsedMins(booking.loading_start) : null;
  const loadOverSLA = loadMins !== null && loadMins > (sla.loadLimitMins||90);

  return (
    <div style={{background:bg,border:`2px solid ${borderColor}`,borderRadius:14,
      padding:"14px 12px",minHeight:175,position:"relative",overflow:"hidden",
      flex:"1 1 150px",minWidth:130,maxWidth:210,transition:"border-color .3s",
      boxShadow:preDockAlert?"0 0 0 3px rgba(239,68,68,.2)":
                isLoading||isDocked?"0 0 0 3px rgba(34,197,94,.1)":"none"}}>

      {/* Live dot */}
      {occupied && (
        <div style={{position:"absolute",top:10,right:10,width:9,height:9,borderRadius:"50%",
          background:isLoading||isDocked?"#22c55e":isCalled?T.gold:preDockAlert?"#ef4444":"rgba(255,255,255,.2)",
          boxShadow:`0 0 0 4px ${isLoading||isDocked?"rgba(34,197,94,.2)":isCalled?"rgba(245,168,0,.2)":"rgba(239,68,68,.2)"}`,
          animation:isLoading?"pulse 1.5s infinite":"none"}}/>
      )}

      {/* DOCK NUMBER — ใหญ่ขึ้น */}
      <div style={{fontSize:44,fontWeight:900,color:"#fff",lineHeight:1,letterSpacing:-2}}>
        {dockNo}
      </div>
      <div style={{fontSize:9,color:"rgba(255,255,255,.35)",fontWeight:700,letterSpacing:3,marginBottom:8}}>
        DOCK
      </div>

      {occupied ? (
        <>
          <div style={{fontSize:11,color:"rgba(255,255,255,.5)",marginBottom:2}}>
            {booking.subcon_code||"—"}
          </div>
          {/* Truck Plate — เด่นขึ้น */}
          <div style={{fontSize:18,fontWeight:900,color:"#fff",fontFamily:"monospace",
            letterSpacing:2,lineHeight:1.1}}>
            {booking.truck_plate||"—"}
          </div>
          <div style={{fontSize:10,color:"rgba(255,255,255,.3)",fontFamily:"monospace",marginTop:2}}>
            {booking.booking_id}
          </div>

          {/* Times row */}
          <div style={{display:"flex",gap:10,marginTop:8,flexWrap:"wrap"}}>
            <div>
              <div style={{fontSize:9,color:"rgba(255,255,255,.4)",fontWeight:700}}>LOAD START</div>
              <div style={{fontSize:13,fontWeight:800,color:T.goldLight}}>
                {String(booking.booking_hour||"").slice(0,5)}
              </div>
            </div>
            {booking.check_in_time && (
              <div>
                <div style={{fontSize:9,color:"rgba(255,255,255,.4)",fontWeight:700}}>IN YARD</div>
                <div style={{fontSize:13,fontWeight:800,color:"#86efac"}}>{fmt(booking.check_in_time)}</div>
              </div>
            )}
            {isLoading && booking.loading_start && (
              <div>
                <div style={{fontSize:9,color:"rgba(255,255,255,.4)",fontWeight:700}}>LOADING</div>
                <div style={{fontSize:13,fontWeight:800,
                  color:loadOverSLA?"#ef4444":"#86efac"}}>
                  {fmt(booking.loading_start)}
                  {loadOverSLA && " ⚠"}
                </div>
              </div>
            )}
          </div>

          {/* Pre-dock alert banner */}
          {preDockAlert && (
            <div style={{marginTop:6,padding:"3px 7px",background:"rgba(239,68,68,.25)",
              borderRadius:5,fontSize:9,fontWeight:800,color:"#fca5a5",letterSpacing:.5}}>
              {minsLeft<0 ? `เลยเวลา Load ${-minsLeft}m — ยังไม่ Docked!`
                           : `${minsLeft}m → Load Start — ต้อง Dock ด่วน!`}
            </div>
          )}

          {/* Load SLA over alert */}
          {loadOverSLA && (
            <div style={{marginTop:4,padding:"3px 7px",background:"rgba(239,68,68,.25)",
              borderRadius:5,fontSize:9,fontWeight:800,color:"#fca5a5",letterSpacing:.5}}>
              Loading เกิน {sla.loadLimitMins}m SLA!
            </div>
          )}

          {/* Status badge */}
          <div style={{marginTop:6,display:"inline-block",fontSize:9,fontWeight:800,
            letterSpacing:.5,padding:"2px 7px",borderRadius:999,
            background:isLoading?"rgba(34,197,94,.2)":isCalled?"rgba(245,168,0,.2)":"rgba(255,255,255,.1)",
            color:isLoading?"#86efac":isCalled?T.goldLight:"rgba(255,255,255,.6)"}}>
            {booking.status}
          </div>
        </>
      ) : (
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",
          justifyContent:"center",height:90,gap:6}}>
          <div style={{width:28,height:28,borderRadius:"50%",
            border:"1.5px solid rgba(255,255,255,.08)",
            display:"flex",alignItems:"center",justifyContent:"center"}}>
            <div style={{width:10,height:10,borderRadius:"50%",background:"rgba(255,255,255,.08)"}}/>
          </div>
          <div style={{fontSize:11,color:"rgba(255,255,255,.18)",fontWeight:700,letterSpacing:1}}>
            AVAILABLE
          </div>
        </div>
      )}
    </div>
  );
}

// ── Yard Card — เรียงตาม check_in_time ───────────────────────
function YardCard({ booking, urgency, sla }) {
  const dotColor = urgency==="critical"?"#ef4444":urgency==="warn"?T.gold:"#60a5fa";
  const bg       = urgency==="critical"?"rgba(180,30,30,.25)":urgency==="warn"?"rgba(180,110,0,.2)":"rgba(30,58,100,.25)";
  const border   = urgency==="critical"?"#ef4444":urgency==="warn"?T.gold:"rgba(255,255,255,.15)";

  const minsLeft = minsToSlot(booking.booking_hour);
  const needsDock = minsLeft !== null && minsLeft <= (sla.preDockMins||15);

  return (
    <div style={{background:bg,border:`1.5px solid ${needsDock&&urgency!=="critical"?"#ef4444":border}`,
      borderRadius:12,padding:"11px 13px",minWidth:140,
      boxShadow:needsDock?"0 0 0 2px rgba(239,68,68,.2)":"none"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
        <div style={{fontSize:10,color:"rgba(255,255,255,.5)",fontWeight:700}}>
          {urgency==="critical"?"🔴":urgency==="warn"?"⚠️":"🚛"} {fmt(booking.check_in_time)}
        </div>
        <div style={{width:6,height:6,borderRadius:"50%",background:dotColor}}/>
      </div>

      <div style={{fontSize:10,color:"rgba(255,255,255,.45)",marginBottom:2}}>
        {booking.subcon_code||"—"}
      </div>
      {/* Truck Plate ใหญ่ขึ้น */}
      <div style={{fontSize:17,fontWeight:900,color:"#fff",fontFamily:"monospace",letterSpacing:2}}>
        {booking.truck_plate||"—"}
      </div>

      <div style={{display:"flex",gap:10,marginTop:7}}>
        <div>
          <div style={{fontSize:9,color:"rgba(255,255,255,.35)"}}>เข้ามา</div>
          <div style={{fontSize:12,fontWeight:800,color:T.goldLight}}>{fmtTime(booking.check_in_time)}</div>
        </div>
        <div>
          <div style={{fontSize:9,color:"rgba(255,255,255,.35)"}}>Load Start</div>
          <div style={{fontSize:12,fontWeight:800,
            color:minsLeft!==null&&minsLeft<0?"#ef4444":minsLeft!==null&&minsLeft<=30?T.goldLight:"#fff"}}>
            {String(booking.booking_hour||"").slice(0,5)}
            {minsLeft!==null && (
              <span style={{fontSize:9,marginLeft:4,opacity:.7}}>
                ({minsLeft<0?`เลย ${-minsLeft}m`:minsLeft<=30?`${minsLeft}m`:`${Math.floor(minsLeft/60)}h${minsLeft%60}m`})
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Pre-dock alert */}
      {needsDock && (
        <div style={{marginTop:5,padding:"2px 7px",background:"rgba(239,68,68,.3)",
          borderRadius:4,fontSize:9,fontWeight:800,color:"#fca5a5"}}>
          {minsLeft<0?"ถึงเวลา Load แล้ว — ยังไม่ Docked!":"ต้อง Dock ก่อนเวลา Load!"}
        </div>
      )}

      <div style={{marginTop:5,fontSize:9,fontWeight:700,color:dotColor}}>ON YARD</div>
    </div>
  );
}

// ── Called Card ───────────────────────────────────────────────
function CalledCard({ booking }) {
  return (
    <div style={{background:"rgba(120,80,0,.3)",border:`1.5px solid ${T.gold}`,
      borderRadius:12,padding:"11px 13px",minWidth:140}}>
      <div style={{fontSize:10,color:T.goldLight,marginBottom:3,fontWeight:700}}>
        📢 → D{booking.dock_no}
      </div>
      <div style={{fontSize:10,color:"rgba(255,255,255,.45)",marginBottom:2}}>{booking.subcon_code||"—"}</div>
      <div style={{fontSize:17,fontWeight:900,color:"#fff",fontFamily:"monospace",letterSpacing:2}}>
        {booking.truck_plate||"—"}
      </div>
      <div style={{display:"flex",gap:10,marginTop:7}}>
        <div>
          <div style={{fontSize:9,color:"rgba(255,255,255,.35)"}}>Load Start</div>
          <div style={{fontSize:12,fontWeight:800,color:T.gold}}>{String(booking.booking_hour||"").slice(0,5)}</div>
        </div>
        <div>
          <div style={{fontSize:9,color:"rgba(255,255,255,.35)"}}>Dock</div>
          <div style={{fontSize:13,fontWeight:900,color:T.gold}}>D{booking.dock_no}</div>
        </div>
      </div>
    </div>
  );
}

// ── Upcoming Card ─────────────────────────────────────────────
function UpcomingRow({ booking }) {
  const minsLeft = minsToSlot(booking.booking_hour);
  const isLate   = minsLeft !== null && minsLeft < 0;
  const isSoon   = minsLeft !== null && minsLeft <= 30 && minsLeft >= 0;
  const hasCheckedIn = !!booking.check_in_time;

  return (
    <div style={{display:"flex",alignItems:"center",gap:10,padding:"8px 14px",
      borderBottom:"1px solid rgba(255,255,255,.06)",flexWrap:"wrap",
      background: isLate&&!hasCheckedIn ? "rgba(150,20,20,.2)" : "transparent"}}>

      {/* เวลา Load Start */}
      <div style={{minWidth:42,textAlign:"center"}}>
        <div style={{fontSize:15,fontWeight:900,fontFamily:"monospace",
          color:isLate?"#ef4444":isSoon?T.goldLight:"rgba(255,255,255,.8)"}}>
          {String(booking.booking_hour||"").slice(0,5)}
        </div>
      </div>

      <div style={{fontSize:10,color:"rgba(255,255,255,.35)",minWidth:28}}>
        D{booking.dock_no}
      </div>

      <div style={{fontSize:11,fontWeight:700,color:"rgba(255,255,255,.7)",minWidth:36}}>
        {booking.subcon_code||"—"}
      </div>

      {/* Status pill */}
      {hasCheckedIn ? (
        <span style={{fontSize:10,background:"rgba(34,197,94,.2)",color:"#86efac",
          borderRadius:999,padding:"1px 8px",fontWeight:700}}>
          ✓ In Yard {fmtTime(booking.check_in_time)}
        </span>
      ) : (
        <span style={{fontSize:10,
          background:isLate?"rgba(239,68,68,.25)":"rgba(255,255,255,.08)",
          color:isLate?"#fca5a5":"rgba(255,255,255,.4)",
          borderRadius:999,padding:"1px 8px",fontWeight:700}}>
          {isLate?"ยังไม่มา":"รอ check-in"}
        </span>
      )}

      <div style={{flex:1}}/>

      {/* Time indicator */}
      <div style={{fontSize:11,fontWeight:700,textAlign:"right",
        color:isLate?"#ef4444":isSoon?T.gold:"rgba(255,255,255,.35)"}}>
        {minsLeft===null?"—":isLate?`เลย ${-minsLeft}m`:minsLeft<60?`${minsLeft}m`:`${Math.floor(minsLeft/60)}h${minsLeft%60}m`}
      </div>
    </div>
  );
}

// ── Completed Row ─────────────────────────────────────────────
function CompletedRow({ booking, sla }) {
  const loadMins = booking.loading_start && booking.completed_at
    ? Math.floor((new Date(booking.completed_at)-new Date(booking.loading_start))/60000) : null;
  const overSLA  = loadMins !== null && loadMins > (sla.loadLimitMins||90);

  return (
    <div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 14px",
      borderBottom:"1px solid rgba(255,255,255,.04)",flexWrap:"wrap"}}>
      <span style={{fontSize:10,color:"#4ade80",fontWeight:700}}>✓</span>
      <span style={{fontFamily:"monospace",fontWeight:700,fontSize:12,color:"rgba(255,255,255,.8)",letterSpacing:1}}>
        {booking.truck_plate||"—"}
      </span>
      <span style={{fontSize:10,color:"rgba(255,255,255,.4)"}}>D{booking.dock_no}</span>
      <span style={{fontSize:10,color:"rgba(255,255,255,.4)"}}>{booking.subcon_code}</span>
      <span style={{fontSize:10,color:"rgba(255,255,255,.3)"}}>
        Load {String(booking.booking_hour||"").slice(0,5)}
      </span>
      {loadMins !== null && (
        <span style={{fontSize:10,fontWeight:700,
          color:overSLA?"#ef4444":"rgba(255,255,255,.35)",
          background:overSLA?"rgba(239,68,68,.15)":"transparent",
          borderRadius:4,padding:overSLA?"1px 6px":"0"}}>
          {overSLA?"⚠ ":""}{loadMins}m load
        </span>
      )}
      {booking.completed_at && (
        <span style={{fontSize:10,color:"rgba(255,255,255,.3)",marginLeft:2}}>
          เสร็จ {fmtTime(booking.completed_at)}
        </span>
      )}
    </div>
  );
}

// ── MAIN ─────────────────────────────────────────────────────
export default function DockMonitorApp({ user, onBack }) {
  const [bookings,  setBookings]  = useState([]);
  const [config,    setConfig]    = useState({});
  const [lastRefresh, setLastRefresh] = useState(new Date());

  // SLA config values (อ่านจาก DB, config ผ่าน Admin → Config tab)
  const sla = {
    yardWarnHrs:   parseFloat(config.SLA_YARD_WARN_HRS   || "1"),
    yardCritHrs:   parseFloat(config.SLA_YARD_CRIT_HRS   || "2"),
    loadLimitMins: parseInt(config.SLA_LOAD_LIMIT_MINS   || "90"),
    preDockMins:   parseInt(config.SLA_PRE_DOCK_MINS     || "15"),
  };

  const loadData = useCallback(async () => {
    const [{ data:bk }, { data:cfg }] = await Promise.all([
      supabase.from("bookings").select("*")
        .eq("booking_date", today()).order("booking_hour"),
      supabase.from("config").select("*"),
    ]);
    setBookings(bk||[]);
    if (cfg) setConfig(Object.fromEntries(cfg.map(r=>[r.key,r.value])));
    setLastRefresh(new Date());
  },[]);

  useEffect(()=>{ loadData(); },[loadData]);

  useEffect(()=>{
    const ch = supabase.channel("monitor_live")
      .on("postgres_changes",{event:"*",schema:"public",table:"bookings"},loadData)
      .subscribe(s=>{ if(s==="CHANNEL_ERROR") console.warn("monitor realtime error"); });
    return()=>{ try{supabase.removeChannel(ch);}catch(e){} };
  },[loadData]);

  // Auto-refresh 60s
  useEffect(()=>{
    const id = setInterval(loadData, 60000);
    return()=>clearInterval(id);
  },[loadData]);

  // ── Derived ──────────────────────────────────────────────────
  const numDocks = parseInt(config.DOCK_COUNT||"5");
  const dockNums = Array.from({length:numDocks},(_,i)=>i+1);

  const bookingByDock = {};
  bookings.forEach(b=>{
    if (AT_DOCK_STATUSES.includes(b.status) && b.dock_no)
      bookingByDock[b.dock_no]=b;
  });

  const onYard    = bookings.filter(b=>b.status==="ON_YARD");
  const called    = bookings.filter(b=>b.status==="CALLED_TO_DOCK");
  const atDock    = bookings.filter(b=>["TRUCK_DOCKED","LOADING"].includes(b.status));
  const reserved  = bookings.filter(b=>b.status==="RESERVED");
  const completed = bookings.filter(b=>b.status==="COMPLETED");
  const active    = bookings.filter(b=>ACTIVE_STATUSES.includes(b.status));

  // ON YARD buckets — เรียงตาม check_in_time (เก่าก่อน)
  const sortByCheckIn = (arr) => [...arr].sort((a,b)=>
    new Date(a.check_in_time||0)-new Date(b.check_in_time||0));

  const yardOk   = sortByCheckIn(onYard.filter(b=>elapsedHrs(b.check_in_time)<sla.yardWarnHrs));
  const yardWarn = sortByCheckIn(onYard.filter(b=>elapsedHrs(b.check_in_time)>=sla.yardWarnHrs&&elapsedHrs(b.check_in_time)<sla.yardCritHrs));
  const yardCrit = sortByCheckIn(onYard.filter(b=>elapsedHrs(b.check_in_time)>=sla.yardCritHrs));

  // Upcoming = RESERVED + ON_YARD วันนี้ เรียงตาม booking_hour
  const upcoming = [...reserved, ...onYard].sort((a,b)=>
    String(a.booking_hour).localeCompare(String(b.booking_hour)));

  const kpi = [
    {label:"AT DOCK",  val:atDock.length,   c:"#4ade80"},
    {label:"CALLED",   val:called.length,   c:T.goldLight},
    {label:"ON YARD",  val:onYard.length,   c:"#fb923c"},
    {label:"UPCOMING", val:upcoming.length, c:"#93c5fd"},
    {label:"DONE",     val:completed.length,c:"rgba(255,255,255,.45)"},
    {label:"ACTIVE",   val:active.length,   c:"#f97316"},
  ];

  const sec = (extra={}) => ({
    background:"rgba(255,255,255,.03)",borderRadius:14,
    border:"1px solid rgba(255,255,255,.08)",marginBottom:12,overflow:"hidden",...extra,
  });

  // ─────────────────────────────────────────────────────────────
  return (
    <div style={{minHeight:"100vh",background:"#050e1f",color:"#fff",
      fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>

      {/* HEADER */}
      <div style={{background:"linear-gradient(90deg,#060d20,#0d1f3c)",
        borderBottom:`3px solid ${T.gold}`,padding:"10px 16px",
        display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>

        {onBack && (
          <button onClick={onBack} style={{border:"1px solid rgba(255,255,255,.2)",
            background:"rgba(255,255,255,.07)",color:"#fff",borderRadius:8,
            padding:"5px 12px",cursor:"pointer",fontSize:12,fontWeight:700}}>
            ← Back
          </button>
        )}

        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:36,height:36,background:T.gold,borderRadius:10,display:"flex",
            alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:12,color:T.navy}}>
            YCH
          </div>
          <div>
            <div style={{fontSize:17,fontWeight:900,letterSpacing:-.3}}>Dock Monitor</div>
            <div style={{fontSize:10,color:"rgba(255,255,255,.4)"}}>
              {config.SITE_NAME||"YCH Ladkrabang Plant"}
            </div>
          </div>
        </div>

        {/* KPI strip */}
        <div style={{display:"flex",gap:12,flexWrap:"wrap",marginLeft:8}}>
          {kpi.map(k=>(
            <div key={k.label} style={{textAlign:"center",minWidth:40}}>
              <div style={{fontSize:22,fontWeight:900,color:k.c,fontFamily:"monospace",lineHeight:1}}>
                {k.val}
              </div>
              <div style={{fontSize:8,color:"rgba(255,255,255,.4)",fontWeight:700,
                letterSpacing:.8,marginTop:2}}>
                {k.label}
              </div>
            </div>
          ))}
        </div>

        <div style={{marginLeft:"auto",display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}>
          <Clock/>
          <button onClick={loadData}
            style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.12)",
              color:"rgba(255,255,255,.5)",borderRadius:6,padding:"2px 8px",cursor:"pointer",fontSize:10}}>
            ↺ {lastRefresh.toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}
          </button>
        </div>
      </div>

      <div style={{padding:"12px 14px",maxWidth:1400,margin:"0 auto"}}>

        {/* DOCK STATUS */}
        <div style={sec()}>
          <SectionBar
            label="DOCK STATUS — REAL TIME"
            count={`${atDock.length+called.length}/${numDocks}`}
            right={<span style={{fontSize:10,color:"rgba(255,255,255,.3)"}}>CALLED / DOCKED / LOADING</span>}/>
          <div style={{padding:14,display:"flex",gap:10,flexWrap:"wrap"}}>
            {dockNums.map(n=>(
              <DockCard key={n} dockNo={n} booking={bookingByDock[n]||null} sla={sla}/>
            ))}
          </div>
        </div>

        {/* CALLED TO DOCK */}
        {called.length>0 && (
          <div style={sec({border:"1px solid rgba(245,168,0,.3)",background:"rgba(80,50,0,.25)"})}>
            <SectionBar label="📢 CALLED TO DOCK — กำลังเดินเข้า Dock" count={called.length}
              bg="rgba(100,65,0,.5)" border="rgba(245,168,0,.3)"/>
            <div style={{padding:12,display:"flex",gap:10,flexWrap:"wrap"}}>
              {called.map(b=><CalledCard key={b.booking_id} booking={b}/>)}
            </div>
          </div>
        )}

        {/* ON YARD SECTIONS — 3 ช่วง */}
        {[
          {label:`🚛 ON YARD < ${sla.yardWarnHrs}HR`,  items:yardOk,   urgency:"ok",
           bg:"rgba(27,58,107,.3)",border:"rgba(255,255,255,.08)"},
          {label:`⚠️ ON YARD > ${sla.yardWarnHrs}HR`,  items:yardWarn, urgency:"warn",
           bg:"rgba(100,70,0,.3)",border:"rgba(245,168,0,.3)"},
          {label:`🔴 ON YARD > ${sla.yardCritHrs}HRS`, items:yardCrit, urgency:"critical",
           bg:"rgba(120,20,20,.3)",border:"rgba(239,68,68,.3)"},
        ].map(s=>(
          (s.items.length>0 || s.urgency==="ok") && (
            <div key={s.label} style={sec({background:s.bg,border:`1px solid ${s.border}`})}>
              <SectionBar label={s.label} count={s.items.length}
                bg={s.bg+"88"} border={s.border}/>
              <div style={{padding:12}}>
                {s.items.length===0
                  ? <div style={{textAlign:"center",color:"rgba(255,255,255,.2)",
                      padding:"10px 0",fontSize:13}}>ไม่มีรถในช่วงนี้</div>
                  : <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                      {s.items.map(b=>(
                        <YardCard key={b.booking_id} booking={b} urgency={s.urgency} sla={sla}/>
                      ))}
                    </div>
                }
              </div>
            </div>
          )
        ))}

        {/* UPCOMING TODAY */}
        {upcoming.length>0 && (
          <div style={sec({background:"rgba(15,25,50,.4)",border:"1px solid rgba(255,255,255,.07)"})}>
            <SectionBar
              label="📋 UPCOMING TODAY"
              count={upcoming.length}
              right={
                <span style={{fontSize:9,color:"rgba(255,255,255,.3)"}}>
                  เลยเวลาแล้ว {upcoming.filter(b=>minsToSlot(b.booking_hour)<0&&!b.check_in_time).length} คัน
                </span>
              }
              bg="rgba(15,25,50,.6)" border="rgba(255,255,255,.07)"/>
            <div style={{paddingTop:4}}>
              {upcoming.map(b=><UpcomingRow key={b.booking_id} booking={b}/>)}
            </div>
          </div>
        )}

        {/* COMPLETED TODAY */}
        {completed.length>0 && (
          <div style={sec({background:"rgba(10,30,10,.2)",border:"1px solid rgba(74,222,128,.12)"})}>
            <SectionBar label="✅ COMPLETED TODAY" count={completed.length}
              bg="rgba(10,40,10,.4)" border="rgba(74,222,128,.12)"/>
            <div style={{paddingTop:4}}>
              {[...completed]
                .sort((a,b)=>String(b.completed_at||"").localeCompare(String(a.completed_at||"")))
                .map(b=><CompletedRow key={b.booking_id} booking={b} sla={sla}/>)
              }
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
