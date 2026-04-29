import React, { useState, useEffect, useCallback } from "react";
import { supabase, today, nowISO, auditLog } from "../lib/supabase";
import { printBookingSlip } from "../lib/pdf";
import { Alert, Spinner, Topbar, Card } from "../components/UI";
import { T } from "../theme";

const DOCKS = [1,2,3,4,5];
const MIN_HOURS_AHEAD = 3; // อ่านจาก config จริงๆ ได้

export default function BookingApp({ user, onBack }) {
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(today());
  const [selected, setSelected] = useState(null);
  const [msg, setMsg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({truckPlate:"",truckType:"",driverName:"",phone:""});
  const [formErr, setFormErr] = useState("");
  const [myBookings, setMyBookings] = useState([]);
  const [showMyBookings, setShowMyBookings] = useState(false);

  const days = Array.from({length:7},(_,i)=>{
    const d = new Date(); d.setDate(d.getDate()+i);
    return d.toISOString().slice(0,10);
  });

  // เช็ค min hours ahead
  function isPastSlot(slotDate, slotHour) {
    if (slotDate !== today()) return false;
    const now = new Date();
    const [h,m] = String(slotHour).split(":").map(Number);
    const slotMs = new Date(now.getFullYear(),now.getMonth(),now.getDate(),h,m||0).getTime();
    return slotMs < now.getTime() + MIN_HOURS_AHEAD * 3600000;
  }

  const loadSlots = useCallback(async (date) => {
    setLoading(true); setSelected(null);
    const { data } = await supabase.from("dock_slots").select("*")
      .eq("slot_date", date).order("slot_hour").order("dock_no");
    setSlots(data||[]);
    setLoading(false);
  },[]);

  const loadMyBookings = useCallback(async () => {
    const { data } = await supabase.from("bookings").select("*")
      .eq("created_by", user.username)
      .in("status",["RESERVED","ON_YARD","CALLED_TO_DOCK","TRUCK_DOCKED","LOADING"])
      .order("booking_date", {ascending:false}).limit(20);
    setMyBookings(data||[]);
  },[user.username]);

  useEffect(()=>{ loadSlots(selectedDate); },[selectedDate,loadSlots]);
  useEffect(()=>{ loadMyBookings(); },[loadMyBookings]);

  useEffect(()=>{
    const ch = supabase.channel("booking_slots")
      .on("postgres_changes",{event:"*",schema:"public",table:"dock_slots"},()=>loadSlots(selectedDate))
      .subscribe((s)=>{ if(s==="CHANNEL_ERROR") console.warn("Realtime error"); });
    return ()=>supabase.removeChannel(ch);
  },[selectedDate,loadSlots]);

  const hours = [...new Set(slots.map(s=>String(s.slot_hour).slice(0,5)))].sort();
  const slotMap = {};
  slots.forEach(s=>{ slotMap[String(s.slot_hour).slice(0,5)+"_"+s.dock_no]=s; });

  const confirmBooking = async () => {
    if (!form.truckPlate.trim()) return setFormErr("กรุณากรอกทะเบียนรถ");
    if (!form.driverName.trim()) return setFormErr("กรุณากรอกชื่อคนขับ");
    if (!form.phone.trim()) return setFormErr("กรุณากรอกเบอร์โทร");
    setSaving(true); setFormErr(""); setMsg(null);
    const bkId = "BK"+Date.now();
    const { error } = await supabase.from("bookings").insert({
      booking_id: bkId, booking_date: selectedDate,
      booking_hour: selected.slot_hour, dock_no: selected.dock_no,
      slot_key: selected.slot_key,
      truck_plate: form.truckPlate.toUpperCase(),
      truck_type: form.truckType, driver_name: form.driverName,
      phone: form.phone, status: "RESERVED",
      created_by: user.username,
    });
    if (error) { setMsg({type:"err",msg:error.message}); setSaving(false); return; }
    await supabase.from("dock_slots")
      .update({status:"BOOKED", booking_id:bkId})
      .eq("slot_key", selected.slot_key);
    await auditLog({module:"BOOKING",action:"CREATE_BOOKING",targetType:"BOOKING",targetId:bkId,actor:user.username,remark:`Dock ${selected.dock_no} ${selectedDate} ${String(selected.slot_hour).slice(0,5)}`});
    setMsg({type:"ok",msg:`✅ จอง Dock ${selected.dock_no} เวลา ${String(selected.slot_hour).slice(0,5)} สำเร็จ! ID: ${bkId}`});
    setTimeout(()=>printBookingSlip({booking_id:bkId,booking_date:selectedDate,booking_hour:selected.slot_hour,dock_no:selected.dock_no,truck_plate:form.truckPlate,truck_type:form.truckType,driver_name:form.driverName,phone:form.phone}),500);
    setSelected(null); setShowForm(false);
    setForm({truckPlate:"",truckType:"",driverName:"",phone:""});
    loadMyBookings();
    setSaving(false);
  };

  const cancelBooking = async (bk) => {
    if (!confirm(`ยืนยันยกเลิก Booking ${bk.booking_id}?`)) return;
    if (!["RESERVED","ON_YARD"].includes(bk.status)) return setMsg({type:"err",msg:"ยกเลิกได้เฉพาะ RESERVED หรือ ON_YARD เท่านั้น"});
    await supabase.from("bookings").update({status:"CANCELLED",updated_at:nowISO()}).eq("booking_id",bk.booking_id);
    if (bk.slot_key) await supabase.from("dock_slots").update({status:"AVAILABLE",booking_id:null}).eq("slot_key",bk.slot_key);
    await auditLog({module:"BOOKING",action:"CANCEL_BOOKING",targetType:"BOOKING",targetId:bk.booking_id,actor:user.username});
    setMsg({type:"ok",msg:`✅ ยกเลิก Booking ${bk.booking_id} แล้ว`});
    loadMyBookings(); loadSlots(selectedDate);
  };

  const STATUS_BG = {RESERVED:T.greenBg,ON_YARD:T.goldPale,CALLED_TO_DOCK:T.amberBg,TRUCK_DOCKED:T.purpleBg,LOADING:T.blueBg};

  return (
    <div style={{minHeight:"100vh",background:T.bg}}>
      <Topbar title="📅 Dock Booking" color="linear-gradient(90deg,#0a2a6e,#1d4ed8)" onBack={onBack}>
        <button onClick={()=>setShowMyBookings(p=>!p)} style={{marginLeft:8,background:"rgba(255,255,255,.15)",border:"none",color:T.white,borderRadius:7,padding:"4px 10px",cursor:"pointer",fontSize:11,fontWeight:700}}>
          📋 My Bookings ({myBookings.length})
        </button>
      </Topbar>

      <div style={{padding:14,maxWidth:960,margin:"0 auto"}}>
        {msg && <Alert type={msg.type} msg={msg.msg}/>}

        {/* MY BOOKINGS */}
        {showMyBookings && (
          <Card>
            <div style={{fontWeight:800,color:T.navy,fontSize:14,marginBottom:10}}>📋 My Active Bookings</div>
            {myBookings.length===0 ? <p style={{color:T.textMuted,fontSize:12,textAlign:"center",padding:12}}>ไม่มี Booking ที่ Active</p>
            : myBookings.map(bk=>(
              <div key={bk.booking_id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 12px",borderRadius:9,background:STATUS_BG[bk.status]||T.bg,marginBottom:6,flexWrap:"wrap",gap:8}}>
                <div>
                  <div style={{fontFamily:"monospace",fontWeight:700,fontSize:12}}>{bk.booking_id}</div>
                  <div style={{fontSize:11,color:T.textMuted}}>Dock {bk.dock_no} • {String(bk.booking_hour||"").slice(0,5)} • {bk.booking_date} • {bk.truck_plate}</div>
                </div>
                <div style={{display:"flex",gap:6}}>
                  <button onClick={()=>printBookingSlip(bk)} style={{background:T.border,color:T.textSecond,border:"none",borderRadius:6,padding:"4px 8px",cursor:"pointer",fontSize:11,fontWeight:700}}>🖨 Print</button>
                  {["RESERVED","ON_YARD"].includes(bk.status) &&
                    <button onClick={()=>cancelBooking(bk)} style={{background:T.redBg,color:T.red,border:"none",borderRadius:6,padding:"4px 8px",cursor:"pointer",fontSize:11,fontWeight:700}}>✕ ยกเลิก</button>}
                </div>
              </div>
            ))}
          </Card>
        )}

        {/* DAY TABS */}
        <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap"}}>
          {days.map(d=>{
            const dt = new Date(d);
            const label = d===today()?"วันนี้":d===days[1]?"พรุ่งนี้":dt.toLocaleDateString("th-TH",{weekday:"short"});
            return (
              <button key={d} onClick={()=>setSelectedDate(d)}
                style={{border:"1.5px solid",borderColor:selectedDate===d?T.navyLight:T.border,borderRadius:10,padding:"7px 12px",fontSize:12,fontWeight:700,cursor:"pointer",background:selectedDate===d?T.navyLight:T.white,color:selectedDate===d?T.white:T.textSecond,textAlign:"center",minWidth:70}}>
                <div style={{fontSize:10,opacity:.8}}>{label}</div>
                <div>{dt.toLocaleDateString("th-TH",{day:"numeric",month:"short"})}</div>
              </button>
            );
          })}
        </div>

        {/* LEGEND */}
        <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap"}}>
          {[[T.greenBg,T.green,"FREE"],[T.redBg,T.red,"FULL"],[T.goldLight,T.goldDark,"SELECTED"],[T.bg,T.textMuted,"ผ่านแล้ว"]].map(([bg,c,l])=>(
            <span key={l} style={{background:bg,color:c,borderRadius:7,padding:"3px 9px",fontSize:11,fontWeight:700}}>{l}</span>
          ))}
        </div>

        {/* SLOT MATRIX */}
        <div style={{background:T.white,borderRadius:14,overflow:"auto",boxShadow:T.shadow,marginBottom:12}}>
          {loading ? <div style={{padding:40,textAlign:"center"}}><Spinner/></div> : (
            <table style={{width:"100%",borderCollapse:"separate",borderSpacing:3,padding:10,minWidth:500}}>
              <thead>
                <tr>
                  <th style={{background:T.navy,color:T.white,padding:"8px 12px",borderRadius:6,fontSize:11,textAlign:"center"}}>เวลา</th>
                  {DOCKS.map(d=><th key={d} style={{background:T.navy,color:T.white,padding:"8px 10px",borderRadius:6,fontSize:11,textAlign:"center"}}>Dock {d}</th>)}
                </tr>
              </thead>
              <tbody>
                {hours.map(h=>(
                  <tr key={h}>
                    <td style={{padding:"6px 10px",textAlign:"center",fontWeight:700,fontSize:12,color:T.textSecond,background:T.bg,borderRadius:6}}>{h}</td>
                    {DOCKS.map(d=>{
                      const s = slotMap[h+"_"+d];
                      if (!s) return <td key={d} style={{padding:3}}><div style={{background:T.bg,borderRadius:7,padding:"7px 4px",textAlign:"center",color:T.textMuted,fontSize:11}}>—</div></td>;
                      const isSel = selected?.slot_key===s.slot_key;
                      const isBooked = s.status!=="AVAILABLE";
                      const isPast = isPastSlot(s.slot_date, s.slot_hour);
                      const bg = isSel?T.goldLight:isBooked?T.redBg:isPast?T.bg:T.greenBg;
                      const color = isSel?T.goldDark:isBooked?T.red:isPast?T.textMuted:T.green;
                      const disabled = isBooked || isPast;
                      return (
                        <td key={d} style={{padding:3}}>
                          <button disabled={disabled} onClick={()=>setSelected(isSel?null:s)}
                            style={{width:"100%",padding:"7px 4px",borderRadius:7,border:"none",background:bg,color,fontWeight:700,fontSize:11,cursor:disabled?"not-allowed":"pointer",transform:isSel?"scale(1.05)":"none",transition:"all .15s"}}>
                            {isBooked?"FULL":isPast?"—":"FREE"}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {selected && !showForm && (
          <div style={{padding:"12px 16px",background:T.greenBg,border:"1.5px solid #6ee7b7",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
            <span style={{fontWeight:700,color:T.green}}>✅ Dock {selected.dock_no} • {String(selected.slot_hour).slice(0,5)} • {selectedDate}</span>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setSelected(null)} style={{background:T.border,color:T.textSecond,border:"none",borderRadius:8,padding:"6px 12px",fontWeight:700,cursor:"pointer",fontSize:12}}>เปลี่ยน</button>
              <button onClick={()=>setShowForm(true)} style={{background:T.green,color:T.white,border:"none",borderRadius:8,padding:"6px 16px",fontWeight:700,cursor:"pointer",fontSize:12}}>กรอกข้อมูลรถ →</button>
            </div>
          </div>
        )}

        {/* BOOKING FORM MODAL */}
        {showForm && selected && (
          <div style={{position:"fixed",inset:0,background:"rgba(10,20,50,.6)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,padding:16}}>
            <div style={{background:T.white,borderRadius:16,padding:24,width:"100%",maxWidth:420,boxShadow:"0 20px 60px rgba(0,0,0,.3)"}}>
              <div style={{fontWeight:800,color:T.navy,fontSize:16,marginBottom:4}}>📋 กรอกข้อมูลรถ</div>
              <div style={{fontSize:12,color:T.textMuted,marginBottom:16}}>Dock {selected.dock_no} • {String(selected.slot_hour).slice(0,5)} • {selectedDate}</div>
              {formErr && <Alert type="err" msg={formErr}/>}
              {[
                {label:"ทะเบียนรถ *",key:"truckPlate",placeholder:"เช่น 80-1234"},
                {label:"ประเภทรถ",key:"truckType",placeholder:"เช่น 6 ล้อ, เทรลเลอร์"},
                {label:"ชื่อคนขับ *",key:"driverName",placeholder:"ชื่อ-นามสกุล"},
                {label:"เบอร์โทร *",key:"phone",placeholder:"08x-xxx-xxxx",type:"tel"},
              ].map(f=>(
                <div key={f.key} style={{marginBottom:12}}>
                  <label style={{display:"block",fontSize:12,fontWeight:700,marginBottom:5,color:T.textSecond}}>{f.label}</label>
                  <input value={form[f.key]} onChange={e=>setForm(p=>({...p,[f.key]:e.target.value}))}
                    placeholder={f.placeholder} type={f.type||"text"}
                    style={{width:"100%",padding:"9px 12px",border:"1.5px solid #e5e7eb",borderRadius:10,fontSize:13,outline:"none",boxSizing:"border-box"}}/>
                </div>
              ))}
              <div style={{display:"flex",gap:8,marginTop:16}}>
                <button onClick={()=>{setShowForm(false);setFormErr("");}} style={{flex:1,padding:"10px",background:T.border,color:T.textSecond,border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:13}}>ยกเลิก</button>
                <button onClick={confirmBooking} disabled={saving}
                  style={{flex:2,padding:"10px",background:T.green,color:T.white,border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:13,opacity:saving?.6:1}}>
                  {saving?"กำลังจอง…":"✓ ยืนยันการจอง"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
