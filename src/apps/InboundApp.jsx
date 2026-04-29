import React, { useState, useEffect, useCallback } from "react";
import { supabase, today, nowISO, auditLog } from "../lib/supabase";
import { printInboundSlip } from "../lib/pdf";
import { Alert, Spinner, StatusBadge } from "../components/UI";
import { T } from "../theme";

const ACTIONS = {
  RESERVED:      {label:"✓ Check-in เข้า Yard",      next:"ON_YARD",       color:T.green},
  ON_YARD:       {label:"📢 Call to Dock",             next:"CALLED_TO_DOCK",color:T.gold},
  CALLED_TO_DOCK:{label:"🚛 Confirm Docked",           next:"TRUCK_DOCKED",  color:T.purple},
  TRUCK_DOCKED:  {label:"⬇ Start Unloading",           next:"UNLOADING",     color:T.blue},
  UNLOADING:     {label:"✓ ปิด Booking (GR ใน WMS)",  next:"COMPLETED",     color:T.green},
};

const STATUS_STYLE = {
  RESERVED:      {bg:T.greenBg,bl:T.greenBg},
  ON_YARD:       {bg:T.goldPale,bl:T.goldLight},
  CALLED_TO_DOCK:{bg:T.amberBg,bl:T.amberBg},
  TRUCK_DOCKED:  {bg:T.purpleBg,bl:T.purpleBg},
  UNLOADING:     {bg:T.blueBg,bl:T.blueBg},
  COMPLETED:     {bg:T.greenBg,bl:"#86EFAC"},
};

export default function InboundApp({ user, onBack }) {
  const [scanId, setScanId] = useState("");
  const [found, setFound] = useState(null);
  const [asn, setAsn] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [details, setDetails] = useState([]);
  const [activeList, setActiveList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);
  const [acting, setActing] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const loadActive = useCallback(async () => {
    const { data } = await supabase.from("inbound_bookings").select("*")
      .in("status",["RESERVED","ON_YARD","CALLED_TO_DOCK","TRUCK_DOCKED","UNLOADING","GR_PENDING"])
      .order("booking_hour");
    setActiveList(data||[]);
  },[]);

  useEffect(()=>{ loadActive(); },[loadActive]);

  useEffect(()=>{
    const ch = supabase.channel("inbound_live")
      .on("postgres_changes",{event:"*",schema:"public",table:"inbound_bookings"},()=>loadActive())
      .subscribe((s)=>{ if(s==="CHANNEL_ERROR") console.warn("Inbound realtime error"); });
    return ()=>supabase.removeChannel(ch);
  },[loadActive]);

  const handleScan = async (e) => {
    e.preventDefault(); setLoading(true); setMsg(null);
    setFound(null); setAsn(null); setInvoices([]); setDetails([]);
    const { data:bk } = await supabase.from("inbound_bookings")
      .select("*").eq("booking_id", scanId.trim()).single();
    if (!bk) { setFound("not_found"); setLoading(false); return; }
    const [asnRes, invRes, dtlRes] = await Promise.all([
      supabase.from("asn_header").select("*").eq("asn_no",bk.asn_no).single(),
      supabase.from("asn_invoice").select("*").eq("asn_no",bk.asn_no).order("invoice_seq"),
      supabase.from("asn_detail").select("*").eq("asn_no",bk.asn_no).order("line_no"),
    ]);
    setFound(bk);
    setAsn(asnRes.data||{});
    setInvoices(invRes.data||[]);
    setDetails(dtlRes.data||[]);
    setLoading(false);
  };

  const doAction = async (bookingId, newStatus) => {
    setActing(true); setMsg(null);
    const update = {status:newStatus, updated_at:nowISO()};
    if (newStatus==="ON_YARD") update.check_in_time = nowISO();
    const { error } = await supabase.from("inbound_bookings")
      .update(update).eq("booking_id", bookingId);
    if (error) { setMsg({type:"err",msg:error.message}); setActing(false); return; }
    if (newStatus==="COMPLETED") {
      await supabase.from("asn_header").update({status:"RECEIVED"}).eq("asn_no",found.asn_no);
      if (found.slot_key) {
        await supabase.from("dock_slots")
          .update({status:"AVAILABLE",booking_id:null}).eq("slot_key",found.slot_key);
      }
    }
    await auditLog({
      module:"INBOUND", action:newStatus,
      targetType:"INBOUND_BOOKING", targetId:bookingId,
      subconCode:found.supplier_code, bookingId,
      actor:user.username, remark:`→ ${newStatus}`,
    });
    setMsg({type:"ok",msg:`✅ อัปเดตสถานะเป็น ${newStatus} สำเร็จ`});
    setFound(p=>({...p,...update}));
    loadActive(); setActing(false);
  };

  return (
    <div style={{minHeight:"100vh",background:T.bg}}>
      {/* TOPBAR */}
      <div style={{background:"linear-gradient(90deg,#047857,#059669)",color:T.white,padding:"12px 18px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",position:"sticky",top:0,zIndex:40}}>
        <button onClick={onBack} style={{border:"1px solid rgba(255,255,255,.2)",background:"transparent",color:T.white,borderRadius:8,padding:"4px 10px",cursor:"pointer",fontSize:12}}>← Back</button>
        <span style={{fontWeight:800,fontSize:15}}>🏭 Inbound Gate & WH</span>
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:6}}>
          <span style={{width:8,height:8,borderRadius:"50%",background:"#4ADE80",display:"inline-block",boxShadow:"0 0 0 3px rgba(34,197,94,.25)"}}/>
          <span style={{fontSize:11,fontWeight:700,color:"#86EFAC"}}>LIVE</span>
        </div>
      </div>

      <div style={{padding:14,maxWidth:900,margin:"0 auto"}}>
        {msg && <Alert type={msg.type} msg={msg.msg}/>}

        {/* SCAN */}
        <div style={{background:T.white,borderRadius:14,padding:16,marginBottom:14,boxShadow:T.shadow}}>
          <div style={{fontWeight:800,color:T.navy,fontSize:14,marginBottom:10}}>🔍 Scan Inbound Booking ID</div>
          <form onSubmit={handleScan} style={{display:"flex",gap:8}}>
            <input value={scanId} onChange={e=>setScanId(e.target.value)}
              placeholder="IN01ABC… หรือ Booking ID" autoCapitalize="characters"
              style={{flex:1,padding:"11px 14px",border:"2.5px solid #059669",borderRadius:10,fontSize:13,fontWeight:700,fontFamily:"monospace",letterSpacing:2,outline:"none"}}/>
            <button type="submit" disabled={loading}
              style={{background:T.green,color:T.white,border:"none",borderRadius:10,padding:"0 16px",fontWeight:700,cursor:"pointer",fontSize:13}}>
              ค้นหา
            </button>
            <button type="button" onClick={()=>{setScanId("");setFound(null);setMsg(null);}}
              style={{background:T.border,color:T.textSecond,border:"none",borderRadius:10,padding:"0 12px",fontWeight:700,cursor:"pointer",fontSize:13}}>✕</button>
          </form>

          {loading && <div style={{padding:16,textAlign:"center"}}><Spinner/></div>}
          {found==="not_found" && (
            <div style={{marginTop:10,padding:"8px 12px",background:T.redBg,borderRadius:8,color:T.red,fontWeight:700,fontSize:13}}>
              ❌ ไม่พบ Booking ID นี้
            </div>
          )}

          {found && found!=="not_found" && (
            <div style={{marginTop:12,padding:14,background:STATUS_STYLE[found.status]?.bg||T.bg,border:`1.5px solid ${STATUS_STYLE[found.status]?.bl||T.border}`,borderRadius:10}}>
              {/* HEADER */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8,marginBottom:12}}>
                <div>
                  <div style={{fontFamily:"monospace",fontSize:15,fontWeight:900,color:T.navy}}>{found.booking_id}</div>
                  <div style={{fontWeight:700,color:T.textSecond,marginTop:2}}>{asn?.supplier_name||found.supplier_code}</div>
                  <div style={{fontSize:11,color:T.textMuted,marginTop:1}}>
                    ASN: {found.asn_no} • Dock {found.dock_no} • {String(found.booking_hour||"").slice(0,5)} • {found.booking_date}
                  </div>
                  <div style={{fontSize:11,color:T.textMuted}}>
                    {found.truck_plate} • {found.driver_name} • {found.driver_phone}
                  </div>
                  {found.check_in_time && (
                    <div style={{fontSize:11,color:T.green,fontWeight:700,marginTop:2}}>
                      ✓ Check-in: {new Date(found.check_in_time).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit"})}
                    </div>
                  )}
                </div>
                <StatusBadge status={found.status} size={11}/>
              </div>

              {/* INVOICE SUMMARY */}
              {invoices.length>0 && (
                <div style={{marginBottom:10,padding:10,background:"rgba(255,255,255,.7)",borderRadius:8}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                    <span style={{fontSize:12,fontWeight:700,color:T.textSecond}}>
                      {invoices.length} Invoice • รวม {asn?.total_qty||0} หน่วย
                    </span>
                    <button onClick={()=>setShowDetails(p=>!p)}
                      style={{background:"none",border:"none",cursor:"pointer",fontSize:11,color:T.navyLight,fontWeight:700}}>
                      {showDetails?"▲ ซ่อน":"▼ ดูรายการ"}
                    </button>
                  </div>
                  {invoices.map(inv=>(
                    <div key={inv.id||inv.invoice_no} style={{padding:"5px 8px",background:"rgba(255,255,255,.8)",borderRadius:6,marginBottom:4,fontSize:11}}>
                      <span style={{fontWeight:700}}>{inv.invoice_no}</span>
                      {inv.po_no && <span style={{color:T.textMuted,marginLeft:8}}>PO: {inv.po_no}</span>}
                      <span style={{float:"right",fontWeight:700,color:T.green}}>{inv.invoice_qty} หน่วย</span>
                    </div>
                  ))}
                  {/* DETAIL LINES */}
                  {showDetails && details.length>0 && (
                    <div style={{marginTop:8,overflowX:"auto"}}>
                      <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
                        <thead>
                          <tr style={{background:T.bg}}>
                            {["Invoice","Line","Item Code","Item Name","Unit","Qty"].map(h=>(
                              <th key={h} style={{padding:"4px 6px",textAlign:"left",fontWeight:700,color:T.textSecond,whiteSpace:"nowrap"}}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {details.map((d,i)=>(
                            <tr key={i} style={{borderBottom:"1px solid #f3f4f6"}}>
                              <td style={{padding:"3px 6px",fontFamily:"monospace"}}>{d.invoice_no}</td>
                              <td style={{padding:"3px 6px",color:T.textMuted}}>{d.line_no}</td>
                              <td style={{padding:"3px 6px",fontFamily:"monospace",fontWeight:700}}>{d.item_code}</td>
                              <td style={{padding:"3px 6px",color:T.textSecond}}>{d.item_name||"—"}</td>
                              <td style={{padding:"3px 6px",color:T.textMuted}}>{d.unit||"—"}</td>
                              <td style={{padding:"3px 6px",fontWeight:700,textAlign:"right"}}>{d.qty_shipped}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* WMS WARNING */}
              {found.status==="UNLOADING" && (
                <div style={{marginBottom:8,padding:"8px 10px",background:T.goldPale,borderRadius:7,fontSize:11,color:T.goldDark,fontWeight:700}}>
                  ⚠️ กรุณาบันทึก GR ใน WMS ก่อน แล้วค่อยกดปิด Booking
                </div>
              )}

              {/* BUTTONS */}
              <div style={{display:"flex",gap:8,flexDirection:"column"}}>
                <button onClick={()=>printInboundSlip(found, asn, invoices)}
                  style={{padding:"8px",background:T.border,color:T.textSecond,border:"none",borderRadius:8,fontWeight:700,cursor:"pointer",fontSize:12}}>
                  🖨 Print Booking Slip
                </button>
                {ACTIONS[found.status] && (
                  <button onClick={()=>doAction(found.booking_id, ACTIONS[found.status].next)} disabled={acting}
                    style={{padding:"10px",background:ACTIONS[found.status].color,color:T.white,border:"none",borderRadius:9,fontWeight:700,cursor:"pointer",fontSize:13,opacity:acting?.6:1}}>
                    {acting?"กำลังอัปเดต…":ACTIONS[found.status].label}
                  </button>
                )}
                {found.status==="COMPLETED" && (
                  <div style={{padding:"8px 10px",background:T.greenBg,borderRadius:8,fontSize:12,color:T.green,fontWeight:700,textAlign:"center"}}>
                    ✅ Booking เสร็จสมบูรณ์ — GR บันทึกใน WMS แล้ว
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ACTIVE LIST */}
        <div style={{background:T.white,borderRadius:14,padding:16,boxShadow:T.shadow}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div style={{fontWeight:800,color:T.navy,fontSize:14}}>🚛 Inbound Active ({activeList.length})</div>
            <button onClick={loadActive}
              style={{background:T.border,color:T.textSecond,border:"none",borderRadius:7,padding:"4px 10px",cursor:"pointer",fontSize:11,fontWeight:700}}>↻</button>
          </div>
          {activeList.length===0 ? (
            <p style={{textAlign:"center",color:T.textMuted,padding:20,fontSize:12}}>ไม่มี Inbound Active</p>
          ) : (
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {activeList.map(b=>{
                const ss = STATUS_STYLE[b.status]||{bg:T.bg,bl:T.border};
                const act = ACTIONS[b.status];
                return (
                  <div key={b.booking_id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 12px",borderRadius:10,gap:8,flexWrap:"wrap",background:ss.bg,borderLeft:"3px solid",borderLeftColor:ss.bl}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                        <span style={{fontFamily:"monospace",fontWeight:900,fontSize:12}}>{b.truck_plate||"—"}</span>
                        <span style={{fontSize:11,color:T.textMuted}}>D{b.dock_no} • {String(b.booking_hour||"").slice(0,5)}</span>
                        <span style={{fontSize:10,color:T.textMuted}}>{b.supplier_code}</span>
                        {b.check_in_time && (
                          <span style={{fontSize:11,color:T.green,fontWeight:700}}>
                            ✓ {new Date(b.check_in_time).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit"})}
                          </span>
                        )}
                      </div>
                      <div style={{fontSize:10,color:T.textMuted,fontFamily:"monospace",marginTop:1}}>{b.booking_id}</div>
                    </div>
                    <div style={{display:"flex",gap:6,alignItems:"center"}}>
                      <StatusBadge status={b.status}/>
                      {act && (
                        <button onClick={()=>doAction(b.booking_id, act.next)}
                          style={{background:act.color,color:T.white,border:"none",borderRadius:7,padding:"4px 10px",fontWeight:700,cursor:"pointer",fontSize:11}}>
                          {act.label}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
