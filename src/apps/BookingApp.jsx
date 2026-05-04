import React, { useState, useEffect, useCallback } from "react";
import { supabase, today, nowISO, auditLog, sendEmail } from "../lib/supabase";
import { printBookingSlip } from "../lib/pdf";
import { Alert, Spinner, StatusBadge } from "../components/UI";

// ─────────────────────────────────────────────────────────────
//  BookingApp v4 — ตาม GAS App2 createBooking_ ครบทุก feature
//
//  Booking ID format (ตาม GAS generateBookingId_):
//    {subConInitial}{yyMMdd}{HHmm}{dock2d}
//    เช่น MON260430070001  (MON + 260430 + 0700 + 01)
//    ถ้าไม่มี initial → BK + timestamp (fallback)
//
//  GAS validateBookingDate_:
//    - ห้ามจอง past date
//    - ห้ามจองล่วงหน้าเกิน bookingDaysAhead (default 7)
//    - ห้ามจองน้อยกว่า minHours ก่อนเวลา slot
//
//  Features เพิ่ม vs v3:
//    1. Booking ID format ตาม GAS
//    2. DOCK_COUNT จาก config (ไม่ hardcode 5)
//    3. bookingDaysAhead จาก config
//    4. Slot availability badge: จำนวน FREE/FULL ต่อวัน
//    5. Duplicate check ก่อน insert
//    6. Gate lookup: แสดง booking info เมื่อ scan Booking ID
// ─────────────────────────────────────────────────────────────

// ── Booking ID Generator (ตาม GAS generateBookingId_) ────────
function generateBookingId(subConInitial, bookingDate, bookingHour, dockNo) {
  // format: {initial}{yyMMdd}{HHmm}{dock2d}
  // bookingDate = "2026-04-30", bookingHour = "07:00:00" หรือ "07:00"
  if (!subConInitial) return "BK" + Date.now(); // fallback
  const yy = String(bookingDate).slice(2,4);
  const mm = String(bookingDate).slice(5,7);
  const dd = String(bookingDate).slice(8,10);
  const hh = String(bookingHour).slice(0,2);
  const mi = String(bookingHour).slice(3,5);
  const dk = String(dockNo).padStart(2,"0");
  return `${subConInitial}${yy}${mm}${dd}${hh}${mi}${dk}`;
}

export default function BookingApp({ user, onBack }) {
  const [slots, setSlots]               = useState([]);
  const [loading, setLoading]           = useState(true);
  const [selectedDate, setSelectedDate] = useState(today());
  const [selected, setSelected]         = useState(null);
  const [msg, setMsg]                   = useState(null);
  const [saving, setSaving]             = useState(false);
  const [showForm, setShowForm]         = useState(false);
  const [formErr, setFormErr]           = useState("");
  const [myBookings, setMyBookings]     = useState([]);
  const [showMyBookings, setShowMyBookings] = useState(false);

  // Config
  const [config, setConfig]             = useState({});
  const [minHours, setMinHours]         = useState(3);
  const [dockCount, setDockCount]       = useState(5);
  const [daysAhead, setDaysAhead]       = useState(7);

  // Group / SubCon
  const [groups, setGroups]             = useState([]);
  const [subcons, setSubcons]           = useState([]);
  const [form, setForm] = useState({
    truckPlate:"", truckType:"", driverName:"", phone:"",
    groupNumber:"", subconCode:"", remarks:"",
  });

  const isCS      = user.role === "cs";
  const isManager = ["manager","admin"].includes(user.role);

  // ── Days — based on daysAhead config ─────────────────────────
  const days = Array.from({length:Math.min(daysAhead,7)},(_,i)=>{
    const d = new Date(); d.setDate(d.getDate()+i);
    const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),dy=String(d.getDate()).padStart(2,"0"); return `${y}-${m}-${dy}`;
  });

  // ── validateBookingDate (ตาม GAS) ────────────────────────────
  function isPastSlot(slotDate, slotHour) {
    // ห้ามจองถ้า slotDate < today
    if (slotDate < today()) return true;
    // ถ้าเป็นวันนี้ ห้ามจองถ้าเวลาผ่านไปแล้ว + minHours
    if (slotDate !== today()) return false;
    const now = new Date();
    const [h,m] = String(slotHour).split(":").map(Number);
    const slotMs = new Date(now.getFullYear(),now.getMonth(),now.getDate(),h,m||0).getTime();
    return slotMs < now.getTime() + minHours * 3600000;
  }

  // ── LOADERS ─────────────────────────────────────────────────
  const loadConfig = useCallback(async () => {
    const { data } = await supabase.from("config").select("*");
    if (data) {
      const m = Object.fromEntries(data.map(r=>[r.key,r.value]));
      setConfig(m);
      setMinHours(Number(m.MIN_BOOKING_HOURS||3));
      setDockCount(parseInt(m.DOCK_COUNT||"5"));
      setDaysAhead(parseInt(m.BOOKING_DAYS_AHEAD||"7"));
    }
  },[]);

  const loadSlots = useCallback(async (date) => {
    setLoading(true); setSelected(null);
    const { data } = await supabase.from("dock_slots").select("*")
      .eq("slot_date", date).order("slot_hour").order("dock_no");
    setSlots(data||[]);
    setLoading(false);
  },[]);

  const loadGroups = useCallback(async () => {
    let q = supabase.from("group_header").select("*")
      .eq("status","BOOKING_PENDING")
      .order("created_at",{ascending:false});
    if (isCS && user.subcon_code) q = q.eq("subcon_code", user.subcon_code);
    const { data } = await q;
    setGroups(data||[]);
  },[isCS, user.subcon_code]);

  const loadSubcons = useCallback(async () => {
    const { data } = await supabase.from("subcon_master")
      .select("subcon_code,subcon_name,subcon_initial,email")
      .eq("active",true).order("subcon_code");
    setSubcons(data||[]);
  },[]);

  const loadMyBookings = useCallback(async () => {
    let q = supabase.from("bookings").select("*")
      .in("status",["RESERVED","ON_YARD","CALLED_TO_DOCK","TRUCK_DOCKED","LOADING"])
      .order("booking_date",{ascending:false}).limit(30);
    if (!isManager) q = q.eq("created_by", user.username);
    const { data } = await q;
    setMyBookings(data||[]);
  },[isManager, user.username]);

  useEffect(()=>{
    loadConfig(); loadGroups();
    if (isManager) loadSubcons();
  },[]);

  useEffect(()=>{ loadSlots(selectedDate); },[selectedDate, loadSlots]);
  useEffect(()=>{ loadMyBookings(); },[loadMyBookings]);

  useEffect(()=>{
    const ch = supabase.channel("booking_slots_live")
      .on("postgres_changes",{event:"*",schema:"public",table:"dock_slots"},   ()=>loadSlots(selectedDate))
      .on("postgres_changes",{event:"*",schema:"public",table:"group_header"}, ()=>loadGroups())
      .subscribe(s=>{ if(s==="CHANNEL_ERROR") console.warn("booking realtime error"); });
    return()=>{ try{supabase.removeChannel(ch);}catch(e){} };
  },[selectedDate, loadSlots, loadGroups]);

  // ── Derived ──────────────────────────────────────────────────
  const DOCKS = Array.from({length:dockCount},(_,i)=>i+1);
  const hours = [...new Set(slots.map(s=>String(s.slot_hour).slice(0,5)))].sort();
  const slotMap = {};
  slots.forEach(s=>{ slotMap[String(s.slot_hour).slice(0,5)+"_"+s.dock_no]=s; });

  // Slot summary per day (สำหรับ day tab badge)
  const freeCount  = slots.filter(s=>s.status==="AVAILABLE"&&!isPastSlot(s.slot_date,s.slot_hour)).length;
  const bookedCount= slots.filter(s=>s.status==="BOOKED").length;

  const selectedGroup  = groups.find(g=>g.group_number===form.groupNumber)  || null;
  const selectedSubcon = subcons.find(s=>s.subcon_code===form.subconCode)   || null;

  // ── CONFIRM BOOKING ─────────────────────────────────────────
  const confirmBooking = async () => {
    setFormErr("");
    if (!form.truckPlate.trim()) return setFormErr("กรุณากรอกทะเบียนรถ");
    if (!form.driverName.trim()) return setFormErr("กรุณากรอกชื่อคนขับ");
    if (!form.phone.trim())      return setFormErr("กรุณากรอกเบอร์โทร");
    if (isCS && groups.length > 0 && !form.groupNumber)
      return setFormErr("กรุณาเลือก Group Number");
    if (isManager && !form.groupNumber && !form.subconCode)
      return setFormErr("กรุณาเลือก Group หรือ SubCon");

    setSaving(true); setMsg(null);

    // Resolve subcon / group
    let subconCode = "", subconName = "", subconInitial = "", groupNumber = "";
    if (form.groupNumber && selectedGroup) {
      subconCode  = selectedGroup.subcon_code;
      subconName  = selectedGroup.subcon_name;
      groupNumber = selectedGroup.group_number;
      const sc = subcons.find(s=>s.subcon_code===subconCode);
      subconInitial = sc?.subcon_initial || subconCode;
    } else if (form.subconCode && selectedSubcon) {
      subconCode    = selectedSubcon.subcon_code;
      subconName    = selectedSubcon.subcon_name;
      subconInitial = selectedSubcon.subcon_initial || selectedSubcon.subcon_code;
    } else if (user.subcon_code) {
      subconCode = user.subcon_code;
      const sc = subcons.find(s=>s.subcon_code===subconCode);
      subconInitial = sc?.subcon_initial || subconCode;
    }

    // FIX 1: Booking ID format ตาม GAS generateBookingId_
    const bkId = generateBookingId(subconInitial, selectedDate, selected.slot_hour, selected.dock_no);

    // FIX 5: Duplicate check
    const { data: existBk } = await supabase.from("bookings")
      .select("booking_id").eq("booking_id", bkId).maybeSingle();
    const finalBkId = existBk ? bkId + String(Date.now()).slice(-3) : bkId;

    // Slot double-check (ตาม GAS: ต้อง re-verify ว่า AVAILABLE)
    const { data: slotCheck } = await supabase.from("dock_slots")
      .select("status").eq("slot_key", selected.slot_key).maybeSingle();
    if (slotCheck?.status !== "AVAILABLE") {
      setMsg({type:"err", msg:"Slot นี้ถูกจองแล้ว กรุณาเลือก Slot ใหม่"});
      setSaving(false);
      setSelected(null); setShowForm(false);
      loadSlots(selectedDate);
      return;
    }

    const payload = {
      booking_id:   finalBkId,
      booking_date: selectedDate,
      booking_hour: selected.slot_hour,
      dock_no:      selected.dock_no,
      slot_key:     selected.slot_key,
      truck_plate:  form.truckPlate.toUpperCase(),
      truck_type:   form.truckType,
      driver_name:  form.driverName,
      phone:        form.phone,
      status:       "RESERVED",
      created_by:   user.username,
      subcon_code:  subconCode,
      subcon_name:  subconName,
      group_number: groupNumber,
    };

    // 1. Insert booking
    const { error } = await supabase.from("bookings").insert(payload);
    if (error) { setMsg({type:"err",msg:error.message}); setSaving(false); return; }

    // 2. Update slot → BOOKED
    await supabase.from("dock_slots")
      .update({ status:"BOOKED", booking_id:finalBkId })
      .eq("slot_key", selected.slot_key);

    // 3. Update group_header → BOOKED (ตาม GAS)
    if (groupNumber) {
      await supabase.from("group_header")
        .update({
          status:"BOOKED", booking_id:finalBkId,
          booking_date:selectedDate,
          booking_slot:selected.slot_hour,
          dock_no:selected.dock_no,
          truck_type:form.truckType,
          truck_plate:form.truckPlate.toUpperCase(),
          driver_name:form.driverName,
          phone:form.phone,
          updated_at:nowISO(),
        })
        .eq("group_number", groupNumber);
      // Update obd_release → BOOKED (ตาม GAS)
      await supabase.from("obd_release")
        .update({ status:"BOOKED", booking_id:finalBkId })
        .eq("group_number", groupNumber);
    }

    // 4. Audit log
    await auditLog({
      module:"BOOKING", action:"CREATE_BOOKING",
      targetType:"BOOKING", targetId:finalBkId,
      subconCode, groupNumber,
      actor:user.username,
      remark:`Dock ${selected.dock_no} • ${selectedDate} • ${String(selected.slot_hour).slice(0,5)}`,
    });

    // 5. Print slip
    const slipData = { ...payload, booking_id:finalBkId, subcon_name:subconName, group_number:groupNumber };
    setTimeout(()=>printBookingSlip(slipData), 400);

    // 6. Email (ตาม GAS queueEmail_ BOOKING_CONFIRMED)
    try {
      let emailTo = user?.email || "";
      if (subconCode) {
        const sc = subcons.find(s=>s.subcon_code===subconCode);
        if (sc?.email) emailTo = sc.email;
      }
      if (emailTo) await sendEmail({ to:emailTo, type:"booking", data:slipData });
    } catch(e) { console.warn("Email failed:", e.message); }

    setMsg({type:"ok", msg:`✅ จอง Dock ${selected.dock_no} เวลา ${String(selected.slot_hour).slice(0,5)} สำเร็จ! (${finalBkId})`});

    // Reset
    setSelected(null); setShowForm(false);
    setForm({truckPlate:"",truckType:"",driverName:"",phone:"",groupNumber:"",subconCode:"",remarks:""});
    loadMyBookings(); loadGroups(); loadSlots(selectedDate);
    setSaving(false);
  };

  // ── CANCEL BOOKING (ตาม GAS cancelBooking_) ─────────────────
  const cancelBooking = async (bk) => {
    if (!confirm(`ยืนยันยกเลิก Booking ${bk.booking_id}?`)) return;
    if (!["RESERVED","ON_YARD"].includes(bk.status))
      return setMsg({type:"err",msg:"ยกเลิกได้เฉพาะ RESERVED หรือ ON_YARD เท่านั้น"});

    await supabase.from("bookings")
      .update({status:"CANCELLED",updated_at:nowISO()}).eq("booking_id",bk.booking_id);

    if (bk.slot_key) {
      await supabase.from("dock_slots")
        .update({status:"AVAILABLE",booking_id:null}).eq("slot_key",bk.slot_key);
    }

    if (bk.group_number) {
      await supabase.from("group_header")
        .update({status:"BOOKING_PENDING",booking_id:null,updated_at:nowISO()})
        .eq("group_number",bk.group_number);
      await supabase.from("obd_release")
        .update({status:"GROUPED"}).eq("group_number",bk.group_number);
    }

    await auditLog({module:"BOOKING",action:"CANCEL_BOOKING",
      targetType:"BOOKING",targetId:bk.booking_id,actor:user.username});

    try {
      if (user?.email) await sendEmail({to:user.email,type:"booking_cancelled",data:bk});
    } catch(e){}

    setMsg({type:"ok",msg:`✅ ยกเลิก Booking ${bk.booking_id} แล้ว`});
    loadMyBookings(); loadSlots(selectedDate); loadGroups();
  };

  // ── RENDER ───────────────────────────────────────────────────
  const STATUS_BG = {
    RESERVED:"#d1fae5",ON_YARD:"#fef9c3",
    CALLED_TO_DOCK:"#ffedd5",TRUCK_DOCKED:"#ede9fe",LOADING:"#dbeafe",
  };
  const inp = {
    width:"100%",padding:"9px 12px",border:"1.5px solid #e5e7eb",
    borderRadius:10,fontSize:13,outline:"none",boxSizing:"border-box",
  };

  return (
    <div style={{minHeight:"100vh",background:"#f0f4fb"}}>

      {/* TOPBAR */}
      <div style={{background:"linear-gradient(90deg,#0a2a6e,#1d4ed8)",color:"#fff",
        padding:"12px 18px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",
        position:"sticky",top:0,zIndex:40,borderBottom:"3px solid #F5A800"}}>
        <button onClick={onBack} style={{border:"1px solid rgba(255,255,255,.2)",background:"transparent",color:"#fff",borderRadius:8,padding:"4px 10px",cursor:"pointer",fontSize:12}}>← Back</button>
        <div style={{width:26,height:26,borderRadius:5,background:"#F5A800",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:10,color:"#1B3A6B"}}>YCH</div>
        <span style={{fontWeight:800,fontSize:15}}>📅 Dock Booking</span>
        {groups.length>0 && (
          <div style={{background:"rgba(245,168,0,.2)",border:"1px solid rgba(245,168,0,.4)",borderRadius:999,padding:"3px 10px",fontSize:11,fontWeight:700,color:"#fcd34d"}}>
            {groups.length} Group รอ Booking
          </div>
        )}
        <div style={{marginLeft:"auto"}}>
          <button onClick={()=>setShowMyBookings(p=>!p)}
            style={{background:"rgba(255,255,255,.15)",border:"none",color:"#fff",borderRadius:7,padding:"5px 12px",cursor:"pointer",fontSize:11,fontWeight:700}}>
            📋 My Bookings {myBookings.length>0?`(${myBookings.length})`:""}
          </button>
        </div>
      </div>

      <div style={{padding:14,maxWidth:980,margin:"0 auto"}}>
        {msg && <Alert type={msg.type} msg={msg.msg}/>}

        {/* ── MY BOOKINGS ── */}
        {showMyBookings && (
          <div style={{background:"#fff",borderRadius:14,padding:16,marginBottom:14,boxShadow:"0 4px 20px rgba(0,0,0,.07)"}}>
            <div style={{fontWeight:800,color:"#0a2a6e",fontSize:14,marginBottom:10}}>📋 Active Bookings ({myBookings.length})</div>
            {myBookings.length===0
              ? <p style={{color:"#9ca3af",fontSize:12,textAlign:"center",padding:12}}>ไม่มี Booking ที่ Active</p>
              : myBookings.map(bk=>(
                <div key={bk.booking_id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"9px 12px",borderRadius:9,background:STATUS_BG[bk.status]||"#f8fafc",marginBottom:6,flexWrap:"wrap",gap:8}}>
                  <div>
                    <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                      <span style={{fontFamily:"monospace",fontWeight:800,fontSize:12,color:"#0a2a6e"}}>{bk.booking_id}</span>
                      {bk.group_number && <span style={{fontSize:10,background:"#fef3c7",color:"#92400e",borderRadius:999,padding:"1px 7px",fontWeight:700}}>{bk.group_number}</span>}
                      {bk.subcon_code  && <span style={{fontSize:10,background:"#dbeafe",color:"#1d4ed8",borderRadius:999,padding:"1px 7px",fontWeight:700}}>{bk.subcon_code}</span>}
                    </div>
                    <div style={{fontSize:11,color:"#6b7280",marginTop:2}}>
                      Dock {bk.dock_no} • {String(bk.booking_hour||"").slice(0,5)} • {bk.booking_date} • {bk.truck_plate}
                    </div>
                  </div>
                  <div style={{display:"flex",gap:6,alignItems:"center"}}>
                    <StatusBadge status={bk.status}/>
                    <button onClick={()=>printBookingSlip(bk)}
                      style={{background:"#e5e7eb",color:"#374151",border:"none",borderRadius:6,padding:"4px 8px",cursor:"pointer",fontSize:11,fontWeight:700}}>
                      🖨 Print
                    </button>
                    {["RESERVED","ON_YARD"].includes(bk.status) &&
                      <button onClick={()=>cancelBooking(bk)}
                        style={{background:"#fee2e2",color:"#991b1b",border:"none",borderRadius:6,padding:"4px 8px",cursor:"pointer",fontSize:11,fontWeight:700}}>
                        ✕ ยกเลิก
                      </button>}
                  </div>
                </div>
              ))
            }
          </div>
        )}

        {/* ── PENDING GROUP BANNER ── */}
        {isCS && groups.length>0 && (
          <div style={{background:"#fef3c7",border:"1.5px solid #fcd34d",borderRadius:12,padding:"10px 14px",marginBottom:12,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            <span style={{fontSize:13,fontWeight:800,color:"#92400e"}}>⚡ มี {groups.length} Group รอทำ Booking</span>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {groups.map(g=>(
                <span key={g.group_number}
                  style={{background:"#F5A800",color:"#1B3A6B",borderRadius:999,padding:"2px 9px",fontSize:11,fontWeight:800,cursor:"pointer"}}
                  onClick={()=>setForm(p=>({...p,groupNumber:g.group_number}))}>
                  {g.group_number} ({g.total_qty} units)
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── DAY TABS (FIX 4: badge free/booked) ── */}
        <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap"}}>
          {days.map((d,idx)=>{
            const dt = new Date(d);
            const label = d===today()?"วันนี้":d===days[1]?"พรุ่งนี้":dt.toLocaleDateString("th-TH",{weekday:"short"});
            const isSelected = selectedDate===d;
            return (
              <button key={d} onClick={()=>setSelectedDate(d)}
                style={{border:"1.5px solid",borderColor:isSelected?"#0f4bd7":"#e5e7eb",borderRadius:10,padding:"7px 12px",fontSize:12,fontWeight:700,cursor:"pointer",background:isSelected?"#0f4bd7":"#fff",color:isSelected?"#fff":"#374151",textAlign:"center",minWidth:70,position:"relative"}}>
                <div style={{fontSize:10,opacity:.8}}>{label}</div>
                <div>{dt.toLocaleDateString("th-TH",{day:"numeric",month:"short"})}</div>
                {/* Badge: แสดงเฉพาะวันที่เลือก */}
                {isSelected && slots.length>0 && (
                  <div style={{fontSize:9,marginTop:2,color:isSelected?"rgba(255,255,255,.7)":"#9ca3af"}}>
                    {freeCount} FREE
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* ── LEGEND ── */}
        <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap",alignItems:"center"}}>
          {[["#d1fae5","#065f46","FREE"],["#fee2e2","#991b1b","FULL"],["#fde68a","#92400e","SELECTED"],["#f3f4f6","#9ca3af","ผ่านแล้ว"]].map(([bg,c,l])=>(
            <span key={l} style={{background:bg,color:c,borderRadius:7,padding:"3px 9px",fontSize:11,fontWeight:700}}>{l}</span>
          ))}
          {minHours>0 && <span style={{fontSize:11,color:"#9ca3af"}}>⏱ ต้องจองล่วงหน้า {minHours} ชม.</span>}
          {slots.length>0 && (
            <span style={{fontSize:11,color:"#374151",marginLeft:"auto",fontWeight:700}}>
              {freeCount} FREE / {bookedCount} BOOKED
            </span>
          )}
        </div>

        {/* ── SLOT MATRIX (FIX 2: DOCK_COUNT จาก config) ── */}
        <div style={{background:"#fff",borderRadius:14,overflow:"auto",boxShadow:"0 4px 20px rgba(0,0,0,.07)",marginBottom:12}}>
          {loading
            ? <div style={{padding:40,textAlign:"center"}}><Spinner/></div>
            : hours.length===0
              ? <div style={{padding:32,textAlign:"center",color:"#9ca3af",fontSize:13}}>ไม่มี Slot — ให้ Admin สร้าง Slot ก่อน</div>
              : (
                <table style={{width:"100%",borderCollapse:"separate",borderSpacing:3,padding:10,minWidth:Math.max(400,dockCount*90)}}>
                  <thead>
                    <tr>
                      <th style={{background:"#0a2a6e",color:"#fff",padding:"8px 12px",borderRadius:6,fontSize:11,textAlign:"center"}}>เวลา</th>
                      {DOCKS.map(d=><th key={d} style={{background:"#0a2a6e",color:"#fff",padding:"8px 10px",borderRadius:6,fontSize:11,textAlign:"center"}}>Dock {d}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {hours.map(h=>(
                      <tr key={h}>
                        <td style={{padding:"6px 10px",textAlign:"center",fontWeight:700,fontSize:12,color:"#374151",background:"#f8fafc",borderRadius:6}}>{h}</td>
                        {DOCKS.map(d=>{
                          const s = slotMap[h+"_"+d];
                          if (!s) return <td key={d} style={{padding:3}}><div style={{background:"#f8fafc",borderRadius:7,padding:"7px 4px",textAlign:"center",color:"#9ca3af",fontSize:10}}>—</div></td>;
                          const isSel    = selected?.slot_key===s.slot_key;
                          const isBooked = s.status!=="AVAILABLE";
                          const isPast   = isPastSlot(s.slot_date, s.slot_hour);
                          const disabled = isBooked || isPast;
                          const bg    = isSel?"#fde68a":isBooked?"#fee2e2":isPast?"#f3f4f6":"#d1fae5";
                          const color = isSel?"#92400e":isBooked?"#991b1b":isPast?"#9ca3af":"#065f46";
                          return (
                            <td key={d} style={{padding:3}}>
                              <button disabled={disabled} onClick={()=>setSelected(isSel?null:s)}
                                style={{width:"100%",padding:"8px 4px",borderRadius:7,border:"none",background:bg,color,fontWeight:700,fontSize:11,cursor:disabled?"not-allowed":"pointer",transform:isSel?"scale(1.05)":"none",transition:"all .12s"}}>
                                {isBooked?"FULL":isPast?"—":"FREE"}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
          }
        </div>

        {/* Selected slot bar */}
        {selected && !showForm && (
          <div style={{padding:"12px 16px",background:"#ecfdf5",border:"1.5px solid #6ee7b7",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
            <span style={{fontWeight:700,color:"#065f46"}}>✅ Dock {selected.dock_no} • {String(selected.slot_hour).slice(0,5)} • {selectedDate}</span>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setSelected(null)} style={{background:"#e5e7eb",color:"#374151",border:"none",borderRadius:8,padding:"6px 12px",fontWeight:700,cursor:"pointer",fontSize:12}}>เปลี่ยน</button>
              <button onClick={()=>setShowForm(true)} style={{background:"#0a2a6e",color:"#fff",border:"2px solid #F5A800",borderRadius:8,padding:"6px 16px",fontWeight:800,cursor:"pointer",fontSize:12}}>กรอกข้อมูลรถ →</button>
            </div>
          </div>
        )}
      </div>

      {/* ── BOOKING FORM MODAL ── */}
      {showForm && selected && (
        <div style={{position:"fixed",inset:0,background:"rgba(10,20,50,.6)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,padding:16}}>
          <div style={{background:"#fff",borderRadius:16,padding:24,width:"100%",maxWidth:460,boxShadow:"0 20px 60px rgba(0,0,0,.3)",maxHeight:"90vh",overflowY:"auto"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
              <div style={{fontWeight:800,color:"#0a2a6e",fontSize:16}}>📋 กรอกข้อมูลจอง Dock</div>
              <button onClick={()=>{setShowForm(false);setFormErr("");}} style={{border:"none",background:"none",cursor:"pointer",fontSize:18,color:"#9ca3af"}}>✕</button>
            </div>

            {/* Preview Booking ID */}
            <div style={{fontSize:11,color:"#6b7280",marginBottom:12,padding:"8px 12px",background:"#f8fafc",borderRadius:8}}>
              <div>📍 Dock {selected.dock_no} • {String(selected.slot_hour).slice(0,5)} • {selectedDate}</div>
              {(selectedGroup||selectedSubcon||user.subcon_code) && (
                <div style={{marginTop:4,fontSize:10,color:"#9ca3af"}}>
                  Booking ID preview:{" "}
                  <span style={{fontFamily:"monospace",fontWeight:700,color:"#0a2a6e"}}>
                    {generateBookingId(
                      selectedGroup
                        ? (subcons.find(s=>s.subcon_code===selectedGroup.subcon_code)?.subcon_initial||selectedGroup.subcon_code)
                        : (selectedSubcon?.subcon_initial||selectedSubcon?.subcon_code||user.subcon_code||""),
                      selectedDate, selected.slot_hour, selected.dock_no
                    )}
                  </span>
                </div>
              )}
            </div>

            {formErr && <Alert type="err" msg={formErr}/>}

            {/* Group selector */}
            {groups.length>0 && (
              <div style={{marginBottom:14,padding:"10px 12px",background:"#fef3c7",borderRadius:10,border:"1.5px solid #fcd34d"}}>
                <label style={{display:"block",fontSize:12,fontWeight:800,marginBottom:6,color:"#92400e"}}>📦 Group Number {isCS?"*":""} (BOOKING_PENDING)</label>
                <select value={form.groupNumber} onChange={e=>setForm(p=>({...p,groupNumber:e.target.value}))}
                  style={{...inp,borderColor:"#fcd34d"}}>
                  <option value="">— ไม่เลือก Group —</option>
                  {groups.map(g=>(
                    <option key={g.group_number} value={g.group_number}>
                      {g.group_number} — {g.subcon_code} — {g.total_qty} units ({g.total_obd} OBD)
                    </option>
                  ))}
                </select>
                {form.groupNumber && selectedGroup && (
                  <div style={{marginTop:6,fontSize:11,color:"#92400e",fontWeight:700}}>
                    ✓ SubCon: {selectedGroup.subcon_name} ({selectedGroup.subcon_code})
                  </div>
                )}
              </div>
            )}

            {/* Direct SubCon */}
            {isManager && !form.groupNumber && subcons.length>0 && (
              <div style={{marginBottom:14}}>
                <label style={{display:"block",fontSize:12,fontWeight:700,marginBottom:5,color:"#374151"}}>SubCon (ถ้าไม่เลือก Group)</label>
                <select value={form.subconCode} onChange={e=>setForm(p=>({...p,subconCode:e.target.value}))} style={inp}>
                  <option value="">— เลือก SubCon —</option>
                  {subcons.map(s=><option key={s.subcon_code} value={s.subcon_code}>{s.subcon_code} — {s.subcon_name}</option>)}
                </select>
              </div>
            )}

            {/* Truck info */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
              {[{label:"ทะเบียนรถ *",key:"truckPlate",placeholder:"80-1234"},{label:"ประเภทรถ",key:"truckType",placeholder:"6 ล้อ / เทรลเลอร์"}].map(f=>(
                <div key={f.key}>
                  <label style={{display:"block",fontSize:12,fontWeight:700,marginBottom:4,color:"#374151"}}>{f.label}</label>
                  <input value={form[f.key]} onChange={e=>setForm(p=>({...p,[f.key]:e.target.value}))} placeholder={f.placeholder} style={inp}/>
                </div>
              ))}
            </div>
            {[{label:"ชื่อคนขับ *",key:"driverName",placeholder:"ชื่อ-นามสกุล"},{label:"เบอร์โทร *",key:"phone",placeholder:"08x-xxx-xxxx",type:"tel"}].map(f=>(
              <div key={f.key} style={{marginBottom:10}}>
                <label style={{display:"block",fontSize:12,fontWeight:700,marginBottom:4,color:"#374151"}}>{f.label}</label>
                <input value={form[f.key]} onChange={e=>setForm(p=>({...p,[f.key]:e.target.value}))}
                  placeholder={f.placeholder} type={f.type||"text"} style={inp}/>
              </div>
            ))}

            {/* Summary */}
            <div style={{background:"#f8fafc",borderRadius:8,padding:"8px 12px",marginBottom:14,fontSize:12,color:"#374151"}}>
              <div><b>Slot:</b> Dock {selected.dock_no} • {String(selected.slot_hour).slice(0,5)} • {selectedDate}</div>
              <div style={{marginTop:2}}>
                <b>Group:</b> {form.groupNumber||"—"} &nbsp;|&nbsp;
                <b>SubCon:</b> {selectedGroup?.subcon_code || selectedSubcon?.subcon_code || user.subcon_code || "—"}
              </div>
            </div>

            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>{setShowForm(false);setFormErr("");}}
                style={{flex:1,padding:"10px",background:"#e5e7eb",color:"#374151",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:13}}>
                ยกเลิก
              </button>
              <button onClick={confirmBooking} disabled={saving}
                style={{flex:2,padding:"10px",background:"linear-gradient(90deg,#0a2a6e,#1d4ed8)",color:"#fff",border:"2px solid #F5A800",borderRadius:10,fontWeight:800,cursor:saving?"not-allowed":"pointer",fontSize:13,opacity:saving?.6:1}}>
                {saving?"กำลังจอง…":"✓ ยืนยันการจอง"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
