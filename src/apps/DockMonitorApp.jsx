import React, { useState, useEffect, useCallback } from "react";
import { supabase, today } from "../lib/supabase";
import { T } from "../theme";

// ─────────────────────────────────────────────────────────────
//  DockMonitorApp v3 — ตาม GAS App4 getLiveDashboard_
//
//  Fixes vs เดิม:
//  1. DockCard: แสดงเฉพาะ CALLED_TO_DOCK, TRUCK_DOCKED, LOADING
//     → ON_YARD ยังอยู่ใน Yard ไม่ขึ้น Dock Card
//  2. COMPLETED/CANCELLED → เคลียร์ออกจาก Dock Card ทันที
//  3. subcon_code จาก booking จริง (ไม่ hardcode "MON")
//  4. เพิ่ม section CALLED_TO_DOCK (กำลังเดินเข้า Dock)
//  5. เพิ่ม Upcoming bookings (RESERVED วันนี้ ยังไม่มาถึง)
//  6. KPI ครบ: atDock=LOADING, onYard=ON_YARD, called=CALLED_TO_DOCK
//  7. Auto-refresh ทุก 60 วินาที (ป้องกัน realtime miss)
// ─────────────────────────────────────────────────────────────

// ── Status sets (ตาม GAS) ───────────────────────────────────
// รถที่อยู่ใน Dock แล้ว (ขึ้น Dock Card)
const AT_DOCK_STATUSES  = ["CALLED_TO_DOCK","TRUCK_DOCKED","LOADING"];
// รถที่อยู่ใน Yard (ยังไม่ถึง Dock)
const ON_YARD_STATUSES  = ["ON_YARD"];
// ทุก active status
const ACTIVE_STATUSES   = ["RESERVED","ON_YARD","CALLED_TO_DOCK","TRUCK_DOCKED","LOADING"];

// ── Elapsed time helper ──────────────────────────────────────
function elapsed(isoStr) {
  if (!isoStr) return null;
  const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  return h > 0 ? `${h}h${m}m` : `${m}m`;
}
function elapsedHours(isoStr) {
  if (!isoStr) return 0;
  return (Date.now() - new Date(isoStr).getTime()) / 3600000;
}
function fmtTime(isoStr) {
  if (!isoStr) return "—";
  return new Date(isoStr).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit"});
}

// ── Live Clock ───────────────────────────────────────────────
function Clock() {
  const [t, setT] = useState(new Date());
  useEffect(()=>{ const id=setInterval(()=>setT(new Date()),1000); return()=>clearInterval(id); },[]);
  const time = t.toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});
  const date = t.toLocaleDateString("th-TH",{weekday:"short",day:"numeric",month:"short",year:"numeric"});
  return (
    <div style={{textAlign:"right"}}>
      <div style={{fontSize:28,fontWeight:900,color:T.gold,fontFamily:"monospace",letterSpacing:2}}>{time}</div>
      <div style={{fontSize:11,color:"rgba(255,255,255,.5)",marginTop:2}}>{date}</div>
    </div>
  );
}

// ── Dock Card ────────────────────────────────────────────────
// FIX 1+2: แสดงเฉพาะ AT_DOCK_STATUSES — AVAILABLE ถ้าไม่มี
// FIX 7: COMPLETED/CANCELLED → เคลียร์ออก (ไม่แสดง)
function DockCard({ dockNo, booking }) {
  // FIX 1: booking ที่ส่งมาต้องเป็น AT_DOCK เท่านั้น (กรองจากข้างนอกแล้ว)
  const occupied = !!booking;
  const isLoading = booking?.status === "LOADING";
  const isDocked  = booking?.status === "TRUCK_DOCKED";
  const isCalled  = booking?.status === "CALLED_TO_DOCK";

  const bg = occupied
    ? isLoading || isDocked
      ? "linear-gradient(160deg,#1a3a1a,#1e5c1e)"
      : "linear-gradient(160deg,#2a2010,#4a3800)"   // CALLED_TO_DOCK = amber
    : "linear-gradient(160deg,#0e1a2e,#152240)";

  const dotColor = isLoading||isDocked ? "#22c55e" : isCalled ? T.gold : "rgba(255,255,255,.2)";
  const border   = isLoading||isDocked ? "#22c55e" : isCalled ? T.gold : "rgba(255,255,255,.1)";

  return (
    <div style={{
      background:bg, border:`2px solid ${border}`,
      borderRadius:14, padding:"14px 12px",
      minHeight:165, position:"relative", overflow:"hidden",
      flex:"1 1 150px", minWidth:135, maxWidth:210,
      transition:"border-color .3s",
    }}>
      {/* Dock number */}
      <div style={{fontSize:30,fontWeight:900,color:"#fff",lineHeight:1}}>{dockNo}</div>
      <div style={{fontSize:10,color:"rgba(255,255,255,.4)",fontWeight:700,letterSpacing:2,marginBottom:10}}>DOCK</div>

      {occupied ? (
        <>
          {/* Live dot */}
          <div style={{
            position:"absolute",top:10,right:10,
            width:9,height:9,borderRadius:"50%",background:dotColor,
            boxShadow:`0 0 0 4px ${dotColor}44`,
            animation: isLoading ? "pulse 1.5s infinite" : "none",
          }}/>

          {/* FIX 3: subcon จาก booking จริง */}
          <div style={{fontSize:11,color:"rgba(255,255,255,.5)",marginBottom:3}}>
            🏭 {booking.subcon_code||"—"}
          </div>

          {/* Truck plate */}
          <div style={{fontSize:22,fontWeight:900,color:"#fff",fontFamily:"monospace",letterSpacing:2}}>
            {booking.truck_plate||"—"}
          </div>

          {/* Booking ID */}
          <div style={{fontSize:10,color:"rgba(255,255,255,.35)",fontFamily:"monospace",marginTop:2}}>
            {booking.booking_id}
          </div>

          {/* Times */}
          <div style={{display:"flex",gap:14,marginTop:8}}>
            <div>
              <div style={{fontSize:9,color:"rgba(255,255,255,.4)",fontWeight:700}}>PLAN</div>
              <div style={{fontSize:14,fontWeight:800,color:T.goldLight}}>
                {String(booking.booking_hour||"").slice(0,5)}
              </div>
            </div>
            {booking.check_in_time && (
              <div>
                <div style={{fontSize:9,color:"rgba(255,255,255,.4)",fontWeight:700}}>IN YARD</div>
                <div style={{fontSize:14,fontWeight:800,color:"#86efac"}}>
                  {elapsed(booking.check_in_time)}
                </div>
              </div>
            )}
            {booking.docked_at && (
              <div>
                <div style={{fontSize:9,color:"rgba(255,255,255,.4)",fontWeight:700}}>DOCKED</div>
                <div style={{fontSize:14,fontWeight:800,color:"#86efac"}}>
                  {elapsed(booking.docked_at)}
                </div>
              </div>
            )}
          </div>

          {/* Status badge */}
          <div style={{
            marginTop:8,display:"inline-block",
            fontSize:9,fontWeight:800,letterSpacing:1,
            padding:"2px 7px",borderRadius:999,
            background: isLoading?"rgba(34,197,94,.2)":isCalled?"rgba(245,168,0,.2)":"rgba(255,255,255,.1)",
            color: isLoading?"#86efac":isCalled?T.goldLight:"rgba(255,255,255,.6)",
          }}>{booking.status}</div>
        </>
      ) : (
        // FIX 2: AVAILABLE — สะอาด ไม่มีข้อมูลเก่า
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:95,gap:6}}>
          <div style={{fontSize:26,opacity:.15}}>🟢</div>
          <div style={{fontSize:11,color:"rgba(255,255,255,.2)",fontWeight:700}}>AVAILABLE</div>
        </div>
      )}
    </div>
  );
}

// ── Yard Card (ON_YARD) ──────────────────────────────────────
function YardCard({ booking, urgency }) {
  const dotColor = urgency==="critical"?"#ef4444":urgency==="warn"?T.gold:"#60a5fa";
  const bg = urgency==="critical"?"rgba(180,30,30,.25)":urgency==="warn"?"rgba(180,110,0,.2)":"rgba(30,58,100,.25)";
  const border = urgency==="critical"?"#ef4444":urgency==="warn"?T.gold:"rgba(255,255,255,.15)";
  return (
    <div style={{background:bg,border:`1.5px solid ${border}`,borderRadius:12,padding:"12px 14px",minWidth:145,maxWidth:195}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
        <div style={{fontSize:10,color:"rgba(255,255,255,.5)"}}>
          {urgency==="critical"?"🔴":urgency==="warn"?"⚠️":"🚛"} {elapsed(booking.check_in_time)}
        </div>
        <div style={{width:6,height:6,borderRadius:"50%",background:dotColor,boxShadow:`0 0 0 3px ${dotColor}33`}}/>
      </div>
      <div style={{fontSize:11,color:"rgba(255,255,255,.45)",marginBottom:2}}>
        🏭 {booking.subcon_code||"—"}
      </div>
      <div style={{fontSize:19,fontWeight:900,color:"#fff",fontFamily:"monospace",letterSpacing:2}}>
        {booking.truck_plate||"—"}
      </div>
      <div style={{fontSize:10,color:"rgba(255,255,255,.35)",fontFamily:"monospace",marginTop:1}}>
        {booking.booking_id}
      </div>
      <div style={{display:"flex",gap:12,marginTop:8}}>
        <div>
          <div style={{fontSize:9,color:"rgba(255,255,255,.4)"}}>Check In</div>
          <div style={{fontSize:12,fontWeight:800,color:T.goldLight}}>{fmtTime(booking.check_in_time)}</div>
        </div>
        <div>
          <div style={{fontSize:9,color:"rgba(255,255,255,.4)"}}>Plan</div>
          <div style={{fontSize:12,fontWeight:800,color:"#fff"}}>
            {String(booking.booking_hour||"").slice(0,5)}
          </div>
        </div>
      </div>
      <div style={{marginTop:6,fontSize:9,fontWeight:700,color:dotColor}}>ON YARD</div>
    </div>
  );
}

// ── Called Card (CALLED_TO_DOCK) ─────────────────────────────
// FIX 4: section ใหม่ กำลังเดินเข้า Dock
function CalledCard({ booking }) {
  return (
    <div style={{background:"rgba(120,80,0,.3)",border:`1.5px solid ${T.gold}`,borderRadius:12,padding:"12px 14px",minWidth:145,maxWidth:195}}>
      <div style={{fontSize:10,color:T.goldLight,marginBottom:4,fontWeight:700}}>
        📢 กำลังเรียก → D{booking.dock_no}
      </div>
      <div style={{fontSize:11,color:"rgba(255,255,255,.45)",marginBottom:2}}>
        🏭 {booking.subcon_code||"—"}
      </div>
      <div style={{fontSize:19,fontWeight:900,color:"#fff",fontFamily:"monospace",letterSpacing:2}}>
        {booking.truck_plate||"—"}
      </div>
      <div style={{display:"flex",gap:12,marginTop:8}}>
        <div>
          <div style={{fontSize:9,color:"rgba(255,255,255,.4)"}}>Dock</div>
          <div style={{fontSize:14,fontWeight:900,color:T.gold}}>D{booking.dock_no}</div>
        </div>
        <div>
          <div style={{fontSize:9,color:"rgba(255,255,255,.4)"}}>Plan</div>
          <div style={{fontSize:12,fontWeight:800,color:"#fff"}}>{String(booking.booking_hour||"").slice(0,5)}</div>
        </div>
      </div>
      <div style={{marginTop:6,fontSize:9,fontWeight:700,color:T.gold,animation:"pulse 1s infinite"}}>
        CALLED_TO_DOCK
      </div>
    </div>
  );
}

// ── Upcoming Card (RESERVED) ─────────────────────────────────
// FIX 5: upcoming bookings วันนี้ที่ยังไม่ check-in
function UpcomingCard({ booking }) {
  const now = new Date();
  const [h,m] = String(booking.booking_hour||"00:00").split(":").map(Number);
  const slotTime = new Date(now.getFullYear(),now.getMonth(),now.getDate(),h,m);
  const minsLeft = Math.floor((slotTime-now)/60000);
  const isLate   = minsLeft < 0;
  const isSoon   = minsLeft >= 0 && minsLeft <= 30;
  return (
    <div style={{
      background:isLate?"rgba(120,20,20,.2)":isSoon?"rgba(80,50,0,.25)":"rgba(20,40,70,.25)",
      border:`1px solid ${isLate?"#ef4444":isSoon?T.gold:"rgba(255,255,255,.1)"}`,
      borderRadius:10, padding:"10px 12px", minWidth:130, maxWidth:170,
    }}>
      <div style={{fontSize:10,color:isLate?"#ef4444":isSoon?T.gold:"rgba(255,255,255,.4)",fontWeight:700,marginBottom:3}}>
        {isLate?"⚠️ เลยเวลา":isSoon?"⏰ กำลังจะถึง":"📋 จอง"}
        {" "}{isLate?`${-minsLeft}m late`:isSoon?`${minsLeft}m`:""}
      </div>
      <div style={{fontSize:16,fontWeight:900,color:"#fff",fontFamily:"monospace",letterSpacing:1}}>
        {String(booking.booking_hour||"").slice(0,5)}
      </div>
      <div style={{fontSize:10,color:"rgba(255,255,255,.45)",marginTop:2}}>{booking.subcon_code||"—"}</div>
      <div style={{fontSize:11,fontWeight:700,color:"rgba(255,255,255,.7)",marginTop:2,fontFamily:"monospace"}}>
        {booking.truck_plate||"(ยังไม่มาถึง)"}
      </div>
      <div style={{fontSize:9,color:"rgba(255,255,255,.3)",marginTop:2}}>D{booking.dock_no}</div>
    </div>
  );
}

// ── Completed Row ─────────────────────────────────────────────
function CompletedRow({ booking }) {
  return (
    <div style={{display:"flex",gap:10,alignItems:"center",padding:"7px 12px",borderRadius:8,background:"rgba(255,255,255,.03)",flexWrap:"wrap"}}>
      <span style={{fontSize:10,color:"#4ade80",fontWeight:700}}>✓</span>
      <span style={{fontFamily:"monospace",fontWeight:700,fontSize:12,color:"rgba(255,255,255,.7)"}}>{booking.truck_plate||"—"}</span>
      <span style={{fontSize:11,color:"rgba(255,255,255,.4)"}}>D{booking.dock_no}</span>
      <span style={{fontSize:11,color:"rgba(255,255,255,.4)"}}>{booking.subcon_code}</span>
      <span style={{fontSize:11,color:"rgba(255,255,255,.35)"}}>เข้า {String(booking.booking_hour||"").slice(0,5)}</span>
      {booking.completed_at && (
        <span style={{fontSize:10,color:"rgba(255,255,255,.3)"}}>เสร็จ {fmtTime(booking.completed_at)}</span>
      )}
    </div>
  );
}

// ── Section header ───────────────────────────────────────────
function SectionBar({ label, count, bg="rgba(27,58,107,.5)", border="rgba(255,255,255,.08)" }) {
  return (
    <div style={{
      background:bg, padding:"9px 18px",
      display:"flex", alignItems:"center", justifyContent:"space-between",
      borderBottom:`1px solid ${border}`,
    }}>
      <span style={{fontWeight:800,fontSize:13}}>{label}</span>
      <span style={{background:"rgba(255,255,255,.1)",borderRadius:999,padding:"1px 10px",fontSize:12,fontWeight:800}}>{count}</span>
    </div>
  );
}

// ── MAIN ─────────────────────────────────────────────────────
export default function DockMonitorApp({ user, onBack }) {
  const [bookings,  setBookings]  = useState([]);
  const [config,    setConfig]    = useState({});
  const [lastRefresh, setLastRefresh] = useState(new Date());

  const loadData = useCallback(async () => {
    const [{ data:bk }, { data:cfg }] = await Promise.all([
      supabase.from("bookings").select("*")
        .eq("booking_date", today())
        .order("booking_hour"),
      supabase.from("config").select("*"),
    ]);
    setBookings(bk||[]);
    if (cfg) setConfig(Object.fromEntries(cfg.map(r=>[r.key,r.value])));
    setLastRefresh(new Date());
  }, []);

  useEffect(()=>{ loadData(); },[loadData]);

  // Realtime
  useEffect(()=>{
    const ch = supabase.channel("monitor_live")
      .on("postgres_changes",{event:"*",schema:"public",table:"bookings"},loadData)
      .subscribe(s=>{ if(s==="CHANNEL_ERROR") console.warn("monitor realtime error"); });
    return()=>{ try{supabase.removeChannel(ch);}catch(e){} };
  },[loadData]);

  // FIX 7: auto-refresh ทุก 60 วินาที ป้องกัน realtime miss
  useEffect(()=>{
    const id = setInterval(loadData, 60000);
    return()=>clearInterval(id);
  },[loadData]);

  // ── Derived (ตาม GAS getLiveDashboard_) ──────────────────────
  const numDocks = parseInt(config.DOCK_COUNT||"5");
  const dockNums = Array.from({length:numDocks},(_,i)=>i+1);

  // FIX 1+2: Dock Card แสดงเฉพาะ AT_DOCK_STATUSES
  // COMPLETED/CANCELLED ไม่นับ → dock ว่างทันที
  const bookingByDock = {};
  bookings.forEach(b=>{
    if (AT_DOCK_STATUSES.includes(b.status) && b.dock_no) {
      bookingByDock[b.dock_no] = b;
    }
  });

  // Yard sections
  const onYard   = bookings.filter(b=>b.status==="ON_YARD");
  const called   = bookings.filter(b=>b.status==="CALLED_TO_DOCK");
  const atDock   = bookings.filter(b=>["TRUCK_DOCKED","LOADING"].includes(b.status));
  const reserved = bookings.filter(b=>b.status==="RESERVED");
  const completed= bookings.filter(b=>b.status==="COMPLETED");
  const active   = bookings.filter(b=>ACTIVE_STATUSES.includes(b.status));

  // ON_YARD urgency buckets
  const yardOk   = onYard.filter(b=>elapsedHours(b.check_in_time)<1);
  const yardWarn = onYard.filter(b=>elapsedHours(b.check_in_time)>=1&&elapsedHours(b.check_in_time)<2);
  const yardCrit = onYard.filter(b=>elapsedHours(b.check_in_time)>=2);

  // Upcoming = RESERVED วันนี้ เรียงตามเวลา
  const upcoming = [...reserved].sort((a,b)=>String(a.booking_hour).localeCompare(String(b.booking_hour)));

  // KPI colors (ตาม GAS kpi)
  const kpi = [
    {label:"AT DOCK",  val:atDock.length,   c:"#4ade80"},
    {label:"CALLED",   val:called.length,   c:T.gold},
    {label:"ON YARD",  val:onYard.length,   c:"#fb923c"},
    {label:"UPCOMING", val:upcoming.length, c:"#93c5fd"},
    {label:"DONE",     val:completed.length,c:"rgba(255,255,255,.4)"},
    {label:"ACTIVE",   val:active.length,   c:"#f97316"},
  ];

  const section = (extra={}) => ({
    background:"rgba(255,255,255,.04)", borderRadius:14,
    border:"1px solid rgba(255,255,255,.08)", marginBottom:14, overflow:"hidden",
    ...extra,
  });

  // ─────────────────────────────────────────────────────────────
  return (
    <div style={{minHeight:"100vh",background:"#050e1f",color:"#fff",fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>

      {/* ── HEADER ── */}
      <div style={{
        background:"linear-gradient(90deg,#060d20,#0d1f3c)",
        borderBottom:`3px solid ${T.gold}`,
        padding:"12px 24px",
        display:"flex",alignItems:"center",gap:16,flexWrap:"wrap",
      }}>
        {onBack && (
          <button onClick={onBack} style={{border:"1px solid rgba(255,255,255,.2)",background:"rgba(255,255,255,.08)",color:"#fff",borderRadius:8,padding:"5px 12px",cursor:"pointer",fontSize:12,fontWeight:700}}>
            ← Back
          </button>
        )}
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:36,height:36,background:T.gold,borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:12,color:T.navy}}>YCH</div>
          <div>
            <div style={{fontSize:18,fontWeight:900,letterSpacing:-.3}}>Dock Monitor</div>
            <div style={{fontSize:11,color:"rgba(255,255,255,.4)"}}>{config.SITE_NAME||"YCH Ladkrabang Plant"}</div>
          </div>
        </div>

        {/* KPI strip */}
        <div style={{display:"flex",gap:16,flexWrap:"wrap",marginLeft:16}}>
          {kpi.map(k=>(
            <div key={k.label} style={{textAlign:"center",minWidth:44}}>
              <div style={{fontSize:24,fontWeight:900,color:k.c,fontFamily:"monospace"}}>{k.val}</div>
              <div style={{fontSize:9,color:"rgba(255,255,255,.4)",fontWeight:700,letterSpacing:1}}>{k.label}</div>
            </div>
          ))}
        </div>

        <div style={{marginLeft:"auto",display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}>
          <Clock/>
          <button onClick={loadData} style={{background:"rgba(255,255,255,.08)",border:"1px solid rgba(255,255,255,.15)",color:"rgba(255,255,255,.6)",borderRadius:6,padding:"3px 8px",cursor:"pointer",fontSize:10}}>
            ↺ {lastRefresh.toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}
          </button>
        </div>
      </div>

      <div style={{padding:"16px 20px",maxWidth:1400,margin:"0 auto"}}>

        {/* ══════════════════════════════════════════════════════
            DOCK STATUS — FIX 1+2+3
        ══════════════════════════════════════════════════════ */}
        <div style={section()}>
          <div style={{background:"rgba(27,58,107,.5)",padding:"10px 18px",display:"flex",alignItems:"center",gap:8,borderBottom:"1px solid rgba(255,255,255,.08)"}}>
            <span style={{width:8,height:8,borderRadius:"50%",background:"#4ade80",boxShadow:"0 0 0 3px rgba(74,222,128,.25)",display:"inline-block",animation:"pulse 2s infinite"}}/>
            <span style={{fontWeight:800,fontSize:13,letterSpacing:1,textTransform:"uppercase"}}>Dock Status — Real Time</span>
            <span style={{fontSize:11,color:"rgba(255,255,255,.3)",marginLeft:8}}>
              แสดงเฉพาะรถที่ CALLED / DOCKED / LOADING
            </span>
          </div>
          <div style={{padding:16,display:"flex",gap:12,flexWrap:"wrap"}}>
            {dockNums.map(n=>(
              <DockCard key={n} dockNo={n} booking={bookingByDock[n]||null}/>
            ))}
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════
            CALLED TO DOCK — FIX 4 (section ใหม่)
        ══════════════════════════════════════════════════════ */}
        {called.length>0 && (
          <div style={section({border:"1px solid rgba(245,168,0,.3)",background:"rgba(80,50,0,.3)"})}>
            <SectionBar label="📢 CALLED TO DOCK — กำลังเดินเข้า Dock" count={called.length} bg="rgba(100,65,0,.5)" border="rgba(245,168,0,.3)"/>
            <div style={{padding:14,display:"flex",gap:12,flexWrap:"wrap"}}>
              {called.map(b=><CalledCard key={b.booking_id} booking={b}/>)}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════
            ON YARD SECTIONS
        ══════════════════════════════════════════════════════ */}
        {[
          {label:"🚛 ON YARD < 1 HR",  items:yardOk,   urgency:"ok",       bg:"rgba(27,58,107,.3)",  border:"rgba(255,255,255,.08)"},
          {label:"⚠️ ON YARD > 1 HR",  items:yardWarn, urgency:"warn",     bg:"rgba(100,70,0,.3)",   border:"rgba(245,168,0,.3)"},
          {label:"🔴 ON YARD > 2 HRS", items:yardCrit, urgency:"critical", bg:"rgba(120,20,20,.3)",  border:"rgba(239,68,68,.3)"},
        ].map(s=>(
          (s.items.length>0||s.urgency==="ok") && (
            <div key={s.label} style={section({background:s.bg,border:`1px solid ${s.border}`})}>
              <SectionBar label={s.label} count={s.items.length} bg={s.bg+"88"} border={s.border}/>
              <div style={{padding:14}}>
                {s.items.length===0
                  ? <div style={{textAlign:"center",color:"rgba(255,255,255,.25)",padding:"10px 0",fontSize:13}}>ไม่มีรถในช่วงนี้</div>
                  : <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
                      {s.items.map(b=><YardCard key={b.booking_id} booking={b} urgency={s.urgency}/>)}
                    </div>
                }
              </div>
            </div>
          )
        ))}

        {/* ══════════════════════════════════════════════════════
            UPCOMING — FIX 5 (RESERVED วันนี้)
        ══════════════════════════════════════════════════════ */}
        {upcoming.length>0 && (
          <div style={section({background:"rgba(15,25,50,.4)",border:"1px solid rgba(255,255,255,.07)"})}>
            <SectionBar label={`📋 UPCOMING TODAY (${upcoming.length} bookings)`} count={upcoming.filter(b=>{const[h,m]=String(b.booking_hour||"00:00").split(":").map(Number);const s=new Date();s.setHours(h,m,0);return s<new Date();}).length+" เลยเวลา"} bg="rgba(15,25,50,.6)" border="rgba(255,255,255,.07)"/>
            <div style={{padding:14,display:"flex",gap:10,flexWrap:"wrap"}}>
              {upcoming.map(b=><UpcomingCard key={b.booking_id} booking={b}/>)}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════
            COMPLETED TODAY — FIX 2 (เคลียร์ออกจาก Dock แล้ว)
        ══════════════════════════════════════════════════════ */}
        {completed.length>0 && (
          <div style={section({background:"rgba(10,30,10,.2)",border:"1px solid rgba(74,222,128,.15)"})}>
            <SectionBar label={`✅ COMPLETED TODAY`} count={completed.length} bg="rgba(10,40,10,.4)" border="rgba(74,222,128,.15)"/>
            <div style={{padding:"10px 14px",display:"flex",flexDirection:"column",gap:4}}>
              {[...completed].sort((a,b)=>String(b.completed_at||"").localeCompare(String(a.completed_at||""))).map(b=>(
                <CompletedRow key={b.booking_id} booking={b}/>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
