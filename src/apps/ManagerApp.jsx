import React, { useState, useEffect, useCallback } from "react";
import { supabase, today } from "../lib/supabase";
import { Spinner, StatusBadge, Alert } from "../components/UI";
import { T } from "../theme";

export default function ManagerApp({ user, onBack }) {
  const [tab, setTab] = useState("outbound");
  const [data, setData] = useState(null);
  const [inbound, setInbound] = useState(null);
  const [selectedDate, setSelectedDate] = useState(today());
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);

  const loadOutbound = useCallback(async (date) => {
    setLoading(true);
    const [bkRes, grpRes, obdRes, qRes, slotRes] = await Promise.all([
      supabase.from("bookings").select("*").eq("booking_date", date),
      supabase.from("group_header").select("*"),
      supabase.from("obd_release").select("*"),
      supabase.from("queue_log").select("*").eq("slot_date", date),
      supabase.from("dock_slots").select("*").eq("slot_date", date),
    ]);
    const bk = bkRes.data||[], grp = grpRes.data||[], obd = obdRes.data||[], q = qRes.data||[], slots = slotRes.data||[];
    const isToday = date === today();

    // KPI
    const kpi = {
      bookedToday: bk.length,
      onYard: bk.filter(b=>b.status==="ON_YARD").length,
      atDock: bk.filter(b=>["TRUCK_DOCKED","LOADING"].includes(b.status)).length,
      completed: bk.filter(b=>b.status==="COMPLETED").length,
      obdOpen: obd.filter(o=>o.status==="OPEN").length,
      groupBookingPending: grp.filter(g=>g.status==="BOOKING_PENDING").length,
    };

    // On-time rate
    let onTime=0, late=0;
    bk.forEach(b=>{
      if (!b.check_in_time||!b.booking_hour) return;
      const ci = new Date(b.check_in_time).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"});
      const bh = String(b.booking_hour).slice(0,5);
      if (ci<=bh) onTime++; else late++;
    });
    kpi.onTimeRate = (onTime+late)>0 ? Math.round(onTime/(onTime+late)*100) : null;
    kpi.onTimeCount = onTime; kpi.lateCount = late;

    // SLA breached
    const SLA = 120;
    let slaBreached = 0;
    bk.filter(b=>b.status==="COMPLETED"&&b.check_in_time).forEach(b=>{
      const ci = new Date(b.check_in_time).getTime();
      const upd = new Date(b.updated_at).getTime();
      if (!isNaN(ci)&&!isNaN(upd)&&(upd-ci)>SLA*60000) slaBreached++;
    });
    kpi.slaBreached = slaBreached;

    // SubCon breakdown
    const scMap = {};
    obd.forEach(o=>{
      const sc = o.subcon_code||"—";
      if (!scMap[sc]) scMap[sc]={subcon_code:sc,subcon_name:o.subcon_name||sc,open:0,grouped:0,booked:0,completed:0};
      const st = o.status;
      if (st==="OPEN") scMap[sc].open++;
      else if (st==="GROUPED") scMap[sc].grouped++;
      else if (st==="BOOKED") scMap[sc].booked++;
      else if (st==="COMPLETED") scMap[sc].completed++;
    });
    const subconBreakdown = Object.values(scMap).sort((a,b)=>b.open-a.open);

    // Dock grid
    const dockMap = {};
    bk.forEach(b=>{
      if (["ON_YARD","CALLED_TO_DOCK","TRUCK_DOCKED","LOADING"].includes(b.status))
        dockMap[String(b.dock_no)]=b;
    });
    const docks = Array.from({length:5},(_,i)=>{
      const bki = dockMap[String(i+1)]||null;
      return {dockNo:i+1,booking:bki};
    });

    // Timeline (slots by hour)
    const hourMap = {};
    slots.forEach(s=>{
      const h = String(s.slot_hour).slice(0,5);
      if (!hourMap[h]) hourMap[h]={hour:h,total:0,booked:0,available:0};
      hourMap[h].total++;
      if (s.status==="BOOKED") hourMap[h].booked++; else hourMap[h].available++;
    });
    const timeline = Object.values(hourMap).sort((a,b)=>a.hour<b.hour?-1:1);

    // Queue summary
    const qSummary = {
      total:q.length,
      waiting:q.filter(r=>["WAITING","REMINDER_SENT"].includes(r.queue_status||"")).length,
      calling:q.filter(r=>r.queue_status==="CALLING").length,
      completed:q.filter(r=>r.queue_status==="COMPLETED").length,
      skipped:q.filter(r=>r.queue_status==="SKIPPED").length,
    };

    // Alerts
    const alerts = [];
    if (kpi.obdOpen>0) alerts.push({level:"warn",msg:`OBD รอ Booking ${kpi.obdOpen} รายการ`});
    if (kpi.groupBookingPending>0) alerts.push({level:"warn",msg:`Group รอ Booking ${kpi.groupBookingPending} groups`});
    if (kpi.slaBreached>0) alerts.push({level:"danger",msg:`SLA Breach: ${kpi.slaBreached} groups เกิน 120 นาที`});

    // Active groups
    const activeGroups = grp.filter(g=>["BOOKING_PENDING","BOOKED","ON_YARD","CALLED_TO_DOCK","TRUCK_DOCKED","LOADING"].includes(g.status));

    setData({kpi,subconBreakdown,docks,timeline,qSummary,alerts,activeGroups,isToday});
    setLoading(false);
  },[]);

  const loadInbound = useCallback(async () => {
    setLoading(true);
    const { data:bk } = await supabase.from("inbound_bookings").select("*");
    const { data:asns } = await supabase.from("asn_header").select("*");
    const t = today();
    const asnMap = Object.fromEntries((asns||[]).map(a=>[a.asn_no,a]));
    const todayBk = (bk||[]).filter(b=>String(b.booking_date).slice(0,10)===t);
    const activeStatuses = ["RESERVED","ON_YARD","CALLED_TO_DOCK","TRUCK_DOCKED","UNLOADING","GR_PENDING"];
    const activeBk = (bk||[]).filter(b=>activeStatuses.includes(b.status));
    const kpi = {
      todayTotal:todayBk.length,
      onYard:activeBk.filter(b=>b.status==="ON_YARD").length,
      atDock:activeBk.filter(b=>["TRUCK_DOCKED","UNLOADING"].includes(b.status)).length,
      grPending:activeBk.filter(b=>b.status==="GR_PENDING").length,
      completedToday:(bk||[]).filter(b=>b.status==="COMPLETED"&&String(b.updated_at||"").slice(0,10)===t).length,
      reserved:todayBk.filter(b=>b.status==="RESERVED").length,
    };
    const dockMap={};
    activeBk.forEach(b=>{dockMap[String(b.dock_no)]=b;});
    const docks=Array.from({length:5},(_,i)=>{const b=dockMap[String(i+1)]||null;return{dockNo:i+1,booking:b,asn:b?asnMap[b.asn_no]||{}:{}};});
    const activeRows=activeBk.map(b=>({...b,supplier_name:asnMap[b.asn_no]?.supplier_name||b.supplier_code})).sort((a,b)=>a.booking_hour<b.booking_hour?-1:1);
    setInbound({kpi,docks,activeRows});
    setLoading(false);
  },[]);

  useEffect(()=>{
    if(tab==="outbound") loadOutbound(selectedDate);
    else loadInbound();
  },[tab,selectedDate,loadOutbound,loadInbound]);

  useEffect(()=>{
    const ch=supabase.channel("manager_live")
      .on("postgres_changes",{event:"*",schema:"public",table:"bookings"},()=>tab==="outbound"&&loadOutbound(selectedDate))
      .on("postgres_changes",{event:"*",schema:"public",table:"inbound_bookings"},()=>tab==="inbound"&&loadInbound())
      .subscribe((s)=>{if(s==="CHANNEL_ERROR")console.warn("Manager realtime error");});
    return()=>supabase.removeChannel(ch);
  },[tab,selectedDate,loadOutbound,loadInbound]);

  const DOCK_ICO={EMPTY:"□",ON_YARD:"🅿️",CALLED_TO_DOCK:"📢",TRUCK_DOCKED:"🚛",LOADING:"⬆️",UNLOADING:"⬇️"};
  const DOCK_BG={EMPTY:T.bg,ON_YARD:T.goldPale,CALLED_TO_DOCK:T.amberBg,TRUCK_DOCKED:T.purpleBg,LOADING:T.blueBg,UNLOADING:T.blueBg};

  return (
    <div style={{minHeight:"100vh",background:T.bg}}>
      <div style={{background:"linear-gradient(90deg,#0a2a6e,#1e3a8a,#1d4ed8)",color:T.white,padding:"12px 18px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",position:"sticky",top:0,zIndex:40}}>
        <button onClick={onBack} style={{border:"1px solid rgba(255,255,255,.2)",background:"transparent",color:T.white,borderRadius:8,padding:"4px 10px",cursor:"pointer",fontSize:12}}>← Back</button>
        <span style={{fontWeight:800,fontSize:15}}>📊 Manager Dashboard</span>
        <div style={{display:"flex",gap:4,background:"rgba(255,255,255,.12)",borderRadius:9,padding:3,marginLeft:8}}>
          {["outbound","inbound"].map(t=>(
            <button key={t} onClick={()=>setTab(t)} style={{border:"none",borderRadius:7,padding:"5px 12px",fontWeight:700,fontSize:12,cursor:"pointer",background:tab===t?T.white:"transparent",color:tab===t?T.navy:"rgba(255,255,255,.7)"}}>
              {t==="outbound"?"📤 Outbound":"📥 Inbound"}
            </button>
          ))}
        </div>
        {tab==="outbound" && (
          <input type="date" value={selectedDate} onChange={e=>setSelectedDate(e.target.value)}
            style={{marginLeft:8,padding:"4px 8px",borderRadius:7,border:"none",fontSize:12,background:"rgba(255,255,255,.15)",color:T.white}}/>
        )}
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:6}}>
          <span style={{width:8,height:8,borderRadius:"50%",background:"#4ADE80",display:"inline-block",boxShadow:"0 0 0 3px rgba(34,197,94,.25)"}}/>
          <span style={{fontSize:11,fontWeight:700,color:"#86EFAC"}}>LIVE</span>
        </div>
      </div>

      <div style={{padding:14,maxWidth:1200,margin:"0 auto"}}>
        {loading ? <div style={{padding:40,textAlign:"center"}}><Spinner/></div> : <>

        {/* ── OUTBOUND ── */}
        {tab==="outbound" && data && <>
          {/* ALERTS */}
          {data.alerts.map((a,i)=>(
            <Alert key={i} type={a.level==="danger"?"err":"warn"} msg={a.msg}/>
          ))}

          {/* KPI CARDS */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:10,marginBottom:14}}>
            {[
              {label:"Booked",value:data.kpi.bookedToday,color:T.navyLight},
              {label:"On Yard",value:data.kpi.onYard,color:T.goldDark},
              {label:"At Dock",value:data.kpi.atDock,color:T.purple},
              {label:"Completed",value:data.kpi.completed,color:T.green},
              {label:"On-time",value:data.kpi.onTimeRate!=null?`${data.kpi.onTimeRate}%`:"—",color:T.green},
              {label:"SLA Breach",value:data.kpi.slaBreached,color:data.kpi.slaBreached>0?T.red:T.green},
              {label:"OBD Open",value:data.kpi.obdOpen,color:data.kpi.obdOpen>0?T.gold:T.green},
            ].map(k=>(
              <div key={k.label} style={{background:T.white,borderRadius:14,padding:"14px 16px",boxShadow:T.shadow,borderLeft:`4px solid ${k.color}`}}>
                <div style={{fontSize:24,fontWeight:900,color:k.color}}>{k.value}</div>
                <div style={{fontSize:11,color:T.textMuted,fontWeight:600,marginTop:3}}>{k.label}</div>
              </div>
            ))}
          </div>

          {/* DOCK GRID */}
          <div style={{background:T.white,borderRadius:14,padding:16,boxShadow:T.shadow,marginBottom:14}}>
            <div style={{fontWeight:800,color:T.navy,fontSize:14,marginBottom:12}}>🏭 Dock Status</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8}}>
              {data.docks.map(dk=>{
                const st=dk.booking?.status||"EMPTY";
                return (
                  <div key={dk.dockNo} style={{background:DOCK_BG[st]||T.bg,borderRadius:12,padding:"12px 10px",textAlign:"center",position:"relative",border:"1.5px solid #e5e7eb"}}>
                    <div style={{fontSize:9,fontWeight:700,color:T.textMuted,position:"absolute",top:5,left:8}}>D{dk.dockNo}</div>
                    <div style={{fontSize:24}}>{DOCK_ICO[st]||"□"}</div>
                    {dk.booking?.truck_plate && <div style={{fontSize:11,fontWeight:800,fontFamily:"monospace",marginTop:4}}>{dk.booking.truck_plate}</div>}
                    {dk.booking?.booking_hour && <div style={{fontSize:10,color:T.textMuted}}>{String(dk.booking.booking_hour).slice(0,5)}</div>}
                    <StatusBadge status={st} size={9}/>
                  </div>
                );
              })}
            </div>
          </div>

          {/* TIMELINE */}
          <div style={{background:T.white,borderRadius:14,padding:16,boxShadow:T.shadow,marginBottom:14}}>
            <div style={{fontWeight:800,color:T.navy,fontSize:14,marginBottom:12}}>📅 Slot Timeline</div>
            <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
              {data.timeline.map(tl=>(
                <div key={tl.hour} style={{flex:"0 0 auto",minWidth:60,textAlign:"center"}}>
                  <div style={{fontSize:10,color:T.textMuted,marginBottom:4}}>{tl.hour}</div>
                  <div style={{background:T.border,borderRadius:6,overflow:"hidden",height:40,position:"relative"}}>
                    <div style={{position:"absolute",bottom:0,left:0,right:0,height:`${tl.total>0?Math.round(tl.booked/tl.total*100):0}%`,background:T.navyLight,borderRadius:"0 0 6px 6px"}}/>
                  </div>
                  <div style={{fontSize:10,color:T.textSecond,marginTop:3,fontWeight:700}}>{tl.booked}/{tl.total}</div>
                </div>
              ))}
            </div>
          </div>

          {/* SUBCON BREAKDOWN */}
          <div style={{background:T.white,borderRadius:14,padding:16,boxShadow:T.shadow,marginBottom:14}}>
            <div style={{fontWeight:800,color:T.navy,fontSize:14,marginBottom:12}}>🏢 SubCon Breakdown</div>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead><tr style={{background:T.bg}}>
                  {["SubCon","Open","Grouped","Booked","Completed"].map(h=>(
                    <th key={h} style={{padding:"7px 10px",textAlign:"left",fontWeight:700,color:T.textSecond}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {data.subconBreakdown.map(sc=>(
                    <tr key={sc.subcon_code} style={{borderBottom:"1px solid #f3f4f6"}}>
                      <td style={{padding:"7px 10px",fontWeight:700}}>{sc.subcon_code}</td>
                      <td style={{padding:"7px 10px",color:sc.open>0?T.gold:T.textMuted,fontWeight:700}}>{sc.open}</td>
                      <td style={{padding:"7px 10px",color:T.blue,fontWeight:700}}>{sc.grouped}</td>
                      <td style={{padding:"7px 10px",color:T.purple,fontWeight:700}}>{sc.booked}</td>
                      <td style={{padding:"7px 10px",color:T.green,fontWeight:700}}>{sc.completed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* QUEUE SUMMARY */}
          <div style={{background:T.white,borderRadius:14,padding:16,boxShadow:T.shadow}}>
            <div style={{fontWeight:800,color:T.navy,fontSize:14,marginBottom:10}}>🔔 Queue Summary</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
              {[
                {label:"รอ",val:data.qSummary.waiting,bg:T.blueBg,c:T.blue},
                {label:"กำลังเรียก",val:data.qSummary.calling,bg:T.goldPale,c:T.goldDark},
                {label:"เสร็จ",val:data.qSummary.completed,bg:T.greenBg,c:T.green},
                {label:"Skip",val:data.qSummary.skipped,bg:T.bg,c:T.textSecond},
              ].map(s=>(
                <div key={s.label} style={{background:s.bg,borderRadius:10,padding:"10px",textAlign:"center"}}>
                  <div style={{fontSize:22,fontWeight:900,color:s.c}}>{s.val}</div>
                  <div style={{fontSize:11,color:s.c,opacity:.8}}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </>}

        {/* ── INBOUND ── */}
        {tab==="inbound" && inbound && <>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:10,marginBottom:14}}>
            {[
              {label:"Booking วันนี้",value:inbound.kpi.todayTotal,color:T.navyLight},
              {label:"รอ Check-in",value:inbound.kpi.reserved,color:T.textMuted},
              {label:"On Yard",value:inbound.kpi.onYard,color:T.goldDark},
              {label:"At Dock/ขนลง",value:inbound.kpi.atDock,color:T.purple},
              {label:"รอ GR",value:inbound.kpi.grPending,color:T.gold},
              {label:"GR เสร็จวันนี้",value:inbound.kpi.completedToday,color:T.green},
            ].map(k=>(
              <div key={k.label} style={{background:T.white,borderRadius:14,padding:"14px 16px",boxShadow:T.shadow,borderLeft:`4px solid ${k.color}`}}>
                <div style={{fontSize:24,fontWeight:900,color:k.color}}>{k.value}</div>
                <div style={{fontSize:11,color:T.textMuted,fontWeight:600,marginTop:3}}>{k.label}</div>
              </div>
            ))}
          </div>

          <div style={{background:T.white,borderRadius:14,padding:16,boxShadow:T.shadow,marginBottom:14}}>
            <div style={{fontWeight:800,color:T.navy,fontSize:14,marginBottom:12}}>🏭 Inbound Dock Status</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8}}>
              {inbound.docks.map(dk=>{
                const st=dk.booking?.status||"EMPTY";
                return (
                  <div key={dk.dockNo} style={{background:DOCK_BG[st]||T.bg,borderRadius:12,padding:"12px 10px",textAlign:"center",position:"relative",border:"1.5px solid #e5e7eb"}}>
                    <div style={{fontSize:9,fontWeight:700,color:T.textMuted,position:"absolute",top:5,left:8}}>D{dk.dockNo}</div>
                    <div style={{fontSize:24}}>{DOCK_ICO[st]||"□"}</div>
                    {dk.booking?.truck_plate && <div style={{fontSize:11,fontWeight:800,fontFamily:"monospace",marginTop:4}}>{dk.booking.truck_plate}</div>}
                    {dk.asn?.supplier_code && <div style={{fontSize:10,color:T.textMuted}}>{dk.asn.supplier_code}</div>}
                    <StatusBadge status={st} size={9}/>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{background:T.white,borderRadius:14,overflow:"hidden",boxShadow:T.shadow}}>
            <div style={{padding:"12px 16px",borderBottom:"1px solid #e5e7eb",fontWeight:800,color:T.navy,fontSize:14}}>
              📋 Active Inbound ({inbound.activeRows.length})
            </div>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead><tr style={{background:T.bg}}>
                  {["Booking ID","ASN","Supplier","Dock","เวลา","Plate","Check-in","Status"].map(h=>(
                    <th key={h} style={{padding:"7px 10px",textAlign:"left",fontWeight:700,color:T.textSecond,whiteSpace:"nowrap"}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {inbound.activeRows.length===0 ? (
                    <tr><td colSpan={8} style={{padding:24,textAlign:"center",color:T.textMuted}}>ไม่มี Active Inbound</td></tr>
                  ) : inbound.activeRows.map(b=>(
                    <tr key={b.booking_id} style={{borderBottom:"1px solid #f3f4f6"}}>
                      <td style={{padding:"7px 10px",fontFamily:"monospace",fontSize:10,fontWeight:700}}>{b.booking_id}</td>
                      <td style={{padding:"7px 10px",fontFamily:"monospace",fontSize:10}}>{b.asn_no}</td>
                      <td style={{padding:"7px 10px",fontWeight:700}}>{b.supplier_name||b.supplier_code}</td>
                      <td style={{padding:"7px 10px",fontWeight:700}}>D{b.dock_no}</td>
                      <td style={{padding:"7px 10px",fontWeight:700}}>{String(b.booking_hour||"").slice(0,5)}</td>
                      <td style={{padding:"7px 10px",fontFamily:"monospace"}}>{b.truck_plate}</td>
                      <td style={{padding:"7px 10px",color:b.check_in_time?T.green:T.textMuted,fontWeight:700}}>
                        {b.check_in_time?new Date(b.check_in_time).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit"}):"—"}
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
