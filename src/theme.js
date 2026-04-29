import React, { useState, useEffect, useCallback } from "react";
import { supabase, today, nowISO, auditLog } from "../lib/supabase";
import { Alert, Spinner, StatusBadge } from "../components/UI";
import { T } from "../theme";

const ACTIONS = {
  RESERVED:      {label:"✓ Check-in เข้า Yard", next:"ON_YARD",       color:T.green},
  ON_YARD:       {label:"📢 Call to Dock",       next:"CALLED_TO_DOCK",color:T.gold},
  CALLED_TO_DOCK:{label:"🚛 Confirm Docked",     next:"TRUCK_DOCKED",  color:T.purple},
  TRUCK_DOCKED:  {label:"⬆ Start Loading",       next:"LOADING",       color:T.blue},
  LOADING:       {label:"✓ Complete & Release",  next:"COMPLETED",     color:T.green},
};

export default function GateApp({ user, onBack }) {
  const [tab, setTab] = useState("gate");
  const [scanId, setScanId] = useState("");
  const [found, setFound] = useState(null);
  const [group, setGroup] = useState(null);
  const [order, setOrder] = useState(null);
  const [activeList, setActiveList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);
  const [acting, setActing] = useState(false);

  const isGate = ["gate","admin","manager"].includes(user.role);
  const isWH   = ["warehouse","admin","manager"].includes(user.role);

  const loadActive = useCallback(async () => {
    const { data } = await supabase.from("bookings").select("*")
      .in("status",["RESERVED","ON_YARD","CALLED_TO_DOCK","TRUCK_DOCKED","LOADING"])
      .eq("booking_date", today()).order("booking_hour");
    setActiveList(data||[]);
  },[]);

  useEffect(()=>{ loadActive(); },[loadActive]);

  useEffect(()=>{
    const ch = supabase.channel("gate_live")
      .on("postgres_changes",{event:"*",schema:"public",table:"bookings"},()=>loadActive())
      .subscribe((s)=>{ if(s==="CHANNEL_ERROR") console.warn("Gate realtime error"); });
    return ()=>supabase.removeChannel(ch);
  },[loadActive]);

  const handleScan = async (e) => {
    e.preventDefault(); setLoading(true); setMsg(null); setFound(null); setGroup(null); setOrder(null);
    const id = scanId.trim();
    // เช็คว่าเป็น Inbound หรือ Outbound
    if (id.startsWith("IN")) {
      const { data:bk } = await supabase.from("inbound_bookings").select("*").eq("booking_id",id).single();
      if (!bk) { setFound("not_found"); setLoading(false); return; }
      setFound({...bk, _type:"inbound"});
    } else {
      const { data:bk } = await supabase.from("bookings").select("*").eq("booking_id",id).single();
      if (!bk) { setFound("not_found"); setLoading(false); return; }
      // load group
      if (bk.group_number) {
        const { data:g } = await supabase.from("group_header").select("*").eq("group_number",bk.group_number).single();
        setGroup(g||null);
        // load order
        const { data:o } = await supabase.from("group_orders").select("*").eq("order_no","GO-"+bk.group_number).single();
        setOrder(o||null);
      }
      setFound({...bk, _type:"outbound"});
    }
    setLoading(false);
  };

  const doAction = async (bookingId, newStatus, type="outbound") => {
    setActing(true); setMsg(null);
    const update = {status:newStatus, updated_at:nowISO()};
    if (newStatus==="ON_YARD") update.check_in_time = nowISO();
    const table = type==="inbound" ? "inbound_bookings" : "bookings";
    const { error } = await supabase.from(table).update(update).eq("booking_id",bookingId);
    if (error) { setMsg({type:"err",msg:error.message}); setActing(false); return; }

    // Outbound — update group_header ด้วย
    if (type==="outbound" && found?.group_number) {
      const grpUpdate = {status:newStatus, updated_at:nowISO()};
      if (newStatus==="COMPLETED") grpUpdate.dock_no = "";
      await supabase.from("group_header").update(grpUpdate).eq("group_number",found.group_number);
      // Release slot
      if (newStatus==="COMPLETED" && found.slot_key) {
        await supabase.from("dock_slots").update({status:"AVAILABLE",booking_id:null}).eq("slot_key",found.slot_key);
      }
    }
    // Inbound — release slot on complete
    if (type==="inbound" && newStatus==="COMPLETED") {
      await supabase.from("asn_header").update({status:"RECEIVED"}).eq("asn_no",found.asn_no);
      if (found.slot_key) await supabase.from("dock_slots").update({status:"AVAILABLE",booking_id:null}).eq("slot_key",found.slot_key);
    }

    await auditLog({module:"GATE",action:newStatus,targetType:type.toUpperCase()+"_BOOKING",targetId:bookingId,actor:user.username,remark:`→ ${newStatus}`});
    setMsg({type:"ok",msg:`✅ อัปเดตสถานะเป็น ${newStatus} สำเร็จ`});
    setFound(p=>({...p,...update}));
    loadActive(); setActing(false);
  };

  // Warehouse Order functions
  const createOrder = async () => {
    if (!found||found._type!=="outbound") return;
    const orderNo = "GO-"+found.group_number;
    const { error } = await supabase.from("group_orders").insert({
      order_no: orderNo, group_number: found.group_number,
      total_obd: group?.total_obd||0, total_qty: group?.total_qty||0,
      status: "ORDER_CREATED", created_by: user.username,
    });
    if (error) return setMsg({type:"err",msg:error.message});
    const { data:o } = await supabase.from("group_orders").select("*").eq("order_no",orderNo).single();
    setOrder(o||null);
    await auditLog({module:"WAREHOUSE",action:"CREATE_ORDER",targetType:"ORDER",targetId:orderNo,actor:user.username});
    setMsg({type:"ok",msg:`✅ สร้าง Order ${orderNo} สำเร็จ`});
  };

  const updateOrder = async (newStatus) => {
    if (!order) return;
    await supabase.from("group_orders").update({status:newStatus,updated_at:nowISO()}).eq("order_no",order.order_no);
    setOrder(p=>({...p,status:newStatus}));
    await auditLog({module:"WAREHOUSE",action:"UPDATE_ORDER",targetType:"ORDER",targetId:order.order_no,actor:user.username,remark:`→ ${newStatus}`});
    setMsg({type:"ok",msg:`✅ Order status → ${newStatus}`});
  };

  const STATUS_BG = {ON_YARD:T.goldPale,CALLED_TO_DOCK:T.amberBg,TRUCK_DOCKED:T.purpleBg,LOADING:T.blueBg,RESERVED:T.bg};
  const STATUS_BL = {ON_YARD:T.gold,CALLED_TO_DOCK:T.gold,TRUCK_DOCKED:T.purple,LOADING:T.blue,RESERVED:T.border};

  const ORDER_ACTIONS = {
    ORDER_CREATED: {label:"เริ่ม Picking", next:"PICKING", color:T.blue},
    PICKING:       {label:"Ready for Loading", next:"READY_FOR_LOADING", color:T.purple},
    READY_FOR_LOADING: null,
    LOADING: null, COMPLETED: null,
  };

  return (
    <div style={{minHeight:"100vh",background:T.bg}}>
      <div style={{background:T.topbarGrad,color:T.white,padding:"12px 18px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",position:"sticky",top:0,zIndex:40}}>
        <button onClick={onBack} style={{border:"1px solid rgba(255,255,255,.2)",background:"transparent",color:T.white,borderRadius:8,padding:"4px 10px",cursor:"pointer",fontSize:12}}>← Back</button>
        <span style={{fontWeight:800,fontSize:15}}>🏭 Gate & Warehouse</span>
        <div style={{display:"flex",gap:4,background:"rgba(255,255,255,.15)",borderRadius:8,padding:3,marginLeft:8}}>
          {[["gate","🔍 Gate"],["active","📋 Active"]].map(([t,l])=>(
            <button key={t} onClick={()=>setTab(t)} style={{border:"none",borderRadius:6,padding:"4px 10px",fontWeight:700,fontSize:11,cursor:"pointer",background:tab===t?T.white:"transparent",color:tab===t?T.goldDark:"rgba(255,255,255,.8)"}}>
              {l}
            </button>
          ))}
        </div>
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:6}}>
          <span style={{width:8,height:8,borderRadius:"50%",background:"#4ADE80",display:"inline-block",boxShadow:"0 0 0 3px rgba(34,197,94,.25)"}}/>
          <span style={{fontSize:11,fontWeight:700,color:"#86EFAC"}}>LIVE</span>
        </div>
      </div>

      <div style={{padding:14,maxWidth:900,margin:"0 auto"}}>
        {msg && <Alert type={msg.type} msg={msg.msg}/>}

        {tab==="gate" && <>
          {/* SCAN */}
          <div style={{background:T.white,borderRadius:14,padding:16,marginBottom:14,boxShadow:T.shadow}}>
            <div style={{fontWeight:800,color:T.navy,marginBottom:12,fontSize:14}}>🔍 Scan Booking ID</div>
            <form onSubmit={handleScan} style={{display:"flex",gap:8}}>
              <input value={scanId} onChange={e=>setScanId(e.target.value)} placeholder="BOOKING ID" autoCapitalize="characters"
                style={{flex:1,padding:"12px 14px",border:"2.5px solid #d97706",borderRadius:10,fontSize:14,fontWeight:700,fontFamily:"monospace",letterSpacing:2,outline:"none"}}/>
              <button type="submit" disabled={loading} style={{background:T.gold,color:T.white,border:"none",borderRadius:10,padding:"0 18px",fontWeight:700,cursor:"pointer",fontSize:13}}>ค้นหา</button>
              <button type="button" onClick={()=>{setScanId("");setFound(null);setGroup(null);setOrder(null);setMsg(null);}} style={{background:T.border,color:T.textSecond,border:"none",borderRadius:10,padding:"0 12px",fontWeight:700,cursor:"pointer",fontSize:13}}>✕</button>
            </form>

            {loading && <div style={{padding:16,textAlign:"center"}}><Spinner/></div>}
            {found==="not_found" && <div style={{marginTop:10,padding:"8px 12px",background:T.redBg,borderRadius:8,color:T.red,fontWeight:700,fontSize:13}}>❌ ไม่พบ Booking ID นี้</div>}

            {found && found!=="not_found" && (
              <div style={{marginTop:12,padding:14,background:T.goldPale,border:"1.5px solid #fcd34d",borderRadius:10}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8,marginBottom:12}}>
                  <div>
                    <div style={{fontFamily:"monospace",fontSize:15,fontWeight:900,color:T.navy}}>{found.booking_id}</div>
                    <div style={{fontSize:12,color:T.textSecond,marginTop:2}}>
                      {found._type==="inbound" ? `ASN: ${found.asn_no}` : `Group: ${found.group_number}`}
                      {" • "} Dock {found.dock_no} • {String(found.booking_hour||"").slice(0,5)} • {found.booking_date||found.booking_date}
                    </div>
                    <div style={{fontSize:11,color:T.textMuted,marginTop:1}}>{found.truck_plate} • {found.driver_name} • {found.phone||found.driver_phone}</div>
                    {found.check_in_time && <div style={{fontSize:11,color:T.green,fontWeight:700,marginTop:1}}>Check-in: {new Date(found.check_in_time).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit"})}</div>}
                    <div style={{marginTop:4}}>
                      <span style={{fontSize:10,background:found._type==="inbound"?T.greenBg:T.blueBg,color:found._type==="inbound"?T.green:T.blue,borderRadius:999,padding:"1px 7px",fontWeight:700}}>
                        {found._type==="inbound"?"📥 INBOUND":"📤 OUTBOUND"}
                      </span>
                    </div>
                  </div>
                  <StatusBadge status={found.status} size={11}/>
                </div>

                {/* GATE ACTIONS */}
                {isGate && ACTIONS[found.status] && (
                  <button onClick={()=>doAction(found.booking_id,ACTIONS[found.status].next,found._type)} disabled={acting}
                    style={{width:"100%",padding:"10px",background:ACTIONS[found.status].color,color:T.white,border:"none",borderRadius:9,fontWeight:700,cursor:"pointer",fontSize:13,opacity:acting?.6:1,marginBottom:8}}>
                    {ACTIONS[found.status].label}
                  </button>
                )}

                {/* WAREHOUSE ORDER — Outbound only */}
                {isWH && found._type==="outbound" && ["TRUCK_DOCKED","LOADING"].includes(found.status) && (
                  <div style={{marginTop:8,padding:12,background:T.blueBg,borderRadius:9,border:"1px solid #bfdbfe"}}>
                    <div style={{fontWeight:700,color:T.blue,fontSize:13,marginBottom:8}}>📋 Warehouse Order</div>
                    {!order ? (
                      <button onClick={createOrder} style={{background:T.blue,color:T.white,border:"none",borderRadius:8,padding:"7px 14px",fontWeight:700,cursor:"pointer",fontSize:12}}>+ สร้าง Order</button>
                    ) : (
                      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                        <span style={{fontFamily:"monospace",fontSize:12,fontWeight:700}}>{order.order_no}</span>
                        <StatusBadge status={order.status} size={10}/>
                        {ORDER_ACTIONS[order.status] && (
                          <button onClick={()=>updateOrder(ORDER_ACTIONS[order.status].next)}
                            style={{background:ORDER_ACTIONS[order.status].color,color:T.white,border:"none",borderRadius:7,padding:"4px 10px",fontWeight:700,cursor:"pointer",fontSize:11}}>
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
        </>}

        {tab==="active" && (
          <div style={{background:T.white,borderRadius:14,padding:16,boxShadow:T.shadow}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div style={{fontWeight:800,color:T.navy,fontSize:14}}>🚛 Active วันนี้ ({activeList.length})</div>
              <button onClick={loadActive} style={{background:T.border,color:T.textSecond,border:"none",borderRadius:7,padding:"4px 10px",cursor:"pointer",fontSize:11,fontWeight:700}}>↻</button>
            </div>
            {activeList.length===0 ? (
              <p style={{textAlign:"center",color:T.textMuted,padding:20,fontSize:12}}>ไม่มี Active Booking วันนี้</p>
            ) : (
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {activeList.map(b=>{
                  const act = ACTIONS[b.status];
                  return (
                    <div key={b.booking_id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderRadius:10,gap:10,flexWrap:"wrap",background:STATUS_BG[b.status]||T.bg,borderLeft:"3px solid",borderLeftColor:STATUS_BL[b.status]||T.border}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                          <span style={{fontFamily:"monospace",fontWeight:700,fontSize:12,color:T.navy}}>{b.truck_plate||"—"}</span>
                          <span style={{fontSize:11,color:T.textMuted}}>D{b.dock_no} • {String(b.booking_hour||"").slice(0,5)}</span>
                          {b.check_in_time&&<span style={{fontSize:11,color:T.green,fontWeight:700}}>✓ {new Date(b.check_in_time).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit"})}</span>}
                        </div>
                        <div style={{fontSize:10,color:T.textMuted,marginTop:2,fontFamily:"monospace"}}>{b.booking_id}</div>
                      </div>
                      <div style={{display:"flex",gap:6,alignItems:"center"}}>
                        <StatusBadge status={b.status}/>
                        {isGate && act && (
                          <button onClick={()=>doAction(b.booking_id,act.next,"outbound")}
                            style={{background:act.color,color:T.white,border:"none",borderRadius:7,padding:"4px 10px",fontWeight:700,cursor:"pointer",fontSize:11}}>
                            {act.label}
                          </button>
                        )}
                        <button onClick={()=>{setScanId(b.booking_id);setTab("gate");setTimeout(()=>document.querySelector("form")?.dispatchEvent(new Event("submit",{cancelable:true,bubbles:true})),100);}}
                          style={{background:T.border,color:T.textSecond,border:"none",borderRadius:7,padding:"4px 10px",fontWeight:700,cursor:"pointer",fontSize:11}}>
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
      </div>
    </div>
  );
}
