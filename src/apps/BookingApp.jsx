import React, { useState, useEffect, useCallback } from "react";
import { supabase, today, nowISO, auditLog } from "../lib/supabase";
import { printBookingSlip } from "../lib/pdf";
import { Alert, Spinner, StatusBadge, Modal, SectionHeader } from "../components/UI";
import { T } from "../theme";

const DOCKS = [1,2,3,4,5];

export default function BookingApp({ user, onBack }) {
  const [slots, setSlots]                 = useState([]);
  const [loading, setLoading]             = useState(true);
  const [selectedDate, setSelectedDate]   = useState(today());
  const [selected, setSelected]           = useState(null);
  const [msg, setMsg]                     = useState(null);
  const [saving, setSaving]               = useState(false);
  const [showForm, setShowForm]           = useState(false);
  const [formErr, setFormErr]             = useState("");
  const [myBookings, setMyBookings]       = useState([]);
  const [showMyBookings, setShowMyBookings] = useState(false);
  const [config, setConfig]               = useState({});
  const [minHours, setMinHours]           = useState(3);

  // Group & SubCon state
  const [groups, setGroups]               = useState([]);   // BOOKING_PENDING groups for CS/subcon
  const [subcons, setSubcons]             = useState([]);   // for manager/admin direct booking
  const [form, setForm]                   = useState({
    truckPlate:"", truckType:"", driverName:"", phone:"",
    groupNumber:"",    // selected group (CS role)
    subconCode:"",     // direct subcon (manager/admin)
    remarks:"",
  });

  const isCS      = ["cs"].includes(user.role);
  const isManager = ["manager","admin"].includes(user.role);
  const isGate    = ["gate","warehouse"].includes(user.role);

  const days = Array.from({length:7},(_,i)=>{
    const d = new Date(); d.setDate(d.getDate()+i);
    return d.toISOString().slice(0,10);
  });

  // ── helpers ──────────────────────────────────────────────────────────────
  function isPastSlot(slotDate, slotHour) {
    if (slotDate !== today()) return false;
    const now = new Date();
    const [h,m] = String(slotHour).split(":").map(Number);
    const slotMs = new Date(now.getFullYear(),now.getMonth(),now.getDate(),h,m||0).getTime();
    return slotMs < now.getTime() + minHours * 3600000;
  }

  // ── loaders ───────────────────────────────────────────────────────────────
  const loadConfig = useCallback(async () => {
    const { data } = await supabase.from("config").select("*");
    if (data) {
      const m = Object.fromEntries(data.map(r=>[r.key, r.value]));
      setConfig(m);
      setMinHours(Number(m.MIN_BOOKING_HOURS || 3));
    }
  }, []);

  const loadSlots = useCallback(async (date) => {
    setLoading(true); setSelected(null);
    const { data } = await supabase.from("dock_slots").select("*")
      .eq("slot_date", date).order("slot_hour").order("dock_no");
    setSlots(data||[]);
    setLoading(false);
  }, []);

  const loadGroups = useCallback(async () => {
    // Load BOOKING_PENDING groups — filtered by subcon if CS role
    let q = supabase.from("group_header").select("*")
      .eq("status","BOOKING_PENDING")
      .order("created_at", {ascending:false});
    if (isCS && user.subcon_code) q = q.eq("subcon_code", user.subcon_code);
    const { data } = await q;
    setGroups(data||[]);
  }, [isCS, user.subcon_code]);

  const loadSubcons = useCallback(async () => {
    const { data } = await supabase.from("subcon_master").select("*").eq("active",true).order("subcon_code");
    setSubcons(data||[]);
  }, []);

  const loadMyBookings = useCallback(async () => {
    let q = supabase.from("bookings").select("*")
      .in("status",["RESERVED","ON_YARD","CALLED_TO_DOCK","TRUCK_DOCKED","LOADING"])
      .order("booking_date",{ascending:false}).limit(30);
    if (!isManager) q = q.eq("created_by", user.username);
    const { data } = await q;
    setMyBookings(data||[]);
  }, [isManager, user.username]);

  useEffect(()=>{ loadConfig(); loadGroups(); if(isManager||isGate) loadSubcons(); },[]);
  useEffect(()=>{ loadSlots(selectedDate); },[selectedDate, loadSlots]);
  useEffect(()=>{ loadMyBookings(); },[loadMyBookings]);

  useEffect(()=>{
    const ch = supabase.channel("booking_slots_live")
      .on("postgres_changes",{event:"*",schema:"public",table:"dock_slots"},()=>loadSlots(selectedDate))
      .on("postgres_changes",{event:"*",schema:"public",table:"group_header"},()=>loadGroups())
      .subscribe(s=>{ if(s==="CHANNEL_ERROR") console.warn("booking realtime error"); });
    return ()=>{ try{supabase.removeChannel(ch);}catch(e){} };
  }, [selectedDate, loadSlots, loadGroups]);

  // ── derived slot data ─────────────────────────────────────────────────────
  const hours = [...new Set(slots.map(s=>String(s.slot_hour).slice(0,5)))].sort();
  const slotMap = {};
  slots.forEach(s=>{ slotMap[String(s.slot_hour).slice(0,5)+"_"+s.dock_no]=s; });

  // selected group details
  const selectedGroup = groups.find(g=>g.group_number===form.groupNumber) || null;
  const selectedSubcon = subcons.find(s=>s.subcon_code===form.subconCode) || null;

  // ── confirm booking ────────────────────────────────────────────────────────
  const confirmBooking = async () => {
    setFormErr("");
    if (!form.truckPlate.trim()) return setFormErr("กรุณากรอกทะเบียนรถ");
    if (!form.driverName.trim()) return setFormErr("กรุณากรอกชื่อคนขับ");
    if (!form.phone.trim())      return setFormErr("กรุณากรอกเบอร์โทร");
    // Group validation for CS
    if (isCS && groups.length > 0 && !form.groupNumber)
      return setFormErr("กรุณาเลือก Group Number");
    // SubCon validation for manager/admin direct booking
    if (isManager && !form.subconCode && !form.groupNumber)
      return setFormErr("กรุณาเลือก Group หรือ SubCon");

    setSaving(true); setMsg(null);

    // Resolve subcon info from group or direct selection
    let subconCode = "", subconName = "", groupNumber = "";
    if (form.groupNumber && selectedGroup) {
      subconCode  = selectedGroup.subcon_code;
      subconName  = selectedGroup.subcon_name;
      groupNumber = selectedGroup.group_number;
    } else if (form.subconCode && selectedSubcon) {
      subconCode = selectedSubcon.subcon_code;
      subconName = selectedSubcon.subcon_name;
    } else if (user.subcon_code) {
      subconCode = user.subcon_code;
    }

    const bkId = "BK" + Date.now();
    const payload = {
      booking_id:   bkId,
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

    const { error } = await supabase.from("bookings").insert(payload);
    if (error) { setMsg({type:"err",msg:error.message}); setSaving(false); return; }

    // Update dock slot
    await supabase.from("dock_slots")
      .update({ status:"BOOKED", booking_id:bkId })
      .eq("slot_key", selected.slot_key);

    // Update group_header status → BOOKED
    if (groupNumber) {
      await supabase.from("group_header")
        .update({ status:"BOOKED", booking_id:bkId, updated_at:nowISO() })
        .eq("group_number", groupNumber);
      // Update obd_release inside group → BOOKED
      await supabase.from("obd_release")
        .update({ status:"BOOKED" })
        .eq("group_number", groupNumber);
    }

    await auditLog({
      module:"BOOKING", action:"CREATE_BOOKING",
      targetType:"BOOKING", targetId:bkId,
      subconCode, groupNumber,
      actor:user.username,
      remark:`Dock ${selected.dock_no} • ${selectedDate} • ${String(selected.slot_hour).slice(0,5)}`,
    });

    setMsg({type:"ok", msg:`✅ จอง Dock ${selected.dock_no} เวลา ${String(selected.slot_hour).slice(0,5)} สำเร็จ! (${bkId})`});
    setTimeout(()=>printBookingSlip({...payload, subcon_name:subconName, group_number:groupNumber}), 500);

    // Reset
    setSelected(null); setShowForm(false);
    setForm({truckPlate:"",truckType:"",driverName:"",phone:"",groupNumber:"",subconCode:"",remarks:""});
    loadMyBookings(); loadGroups();
    setSaving(false);
  };

  // ── cancel booking ────────────────────────────────────────────────────────
  const cancelBooking = async (bk) => {
    if (!confirm(`ยืนยันยกเลิก Booking ${bk.booking_id}?`)) return;
    if (!["RESERVED","ON_YARD"].includes(bk.status))
      return setMsg({type:"err",msg:"ยกเลิกได้เฉพาะ RESERVED หรือ ON_YARD เท่านั้น"});

    await supabase.from("bookings").update({status:"CANCELLED",updated_at:nowISO()}).eq("booking_id",bk.booking_id);
    if (bk.slot_key)
      await supabase.from("dock_slots").update({status:"AVAILABLE",booking_id:null}).eq("slot_key",bk.slot_key);

    // Revert group_header back to BOOKING_PENDING
    if (bk.group_number) {
      await supabase.from("group_header")
        .update({status:"BOOKING_PENDING", booking_id:null, updated_at:nowISO()})
        .eq("group_number", bk.group_number);
      await supabase.from("obd_release")
        .update({status:"GROUPED"})
        .eq("group_number", bk.group_number);
    }

    await auditLog({module:"BOOKING",action:"CANCEL_BOOKING",targetType:"BOOKING",targetId:bk.booking_id,actor:user.username});
    setMsg({type:"ok",msg:`✅ ยกเลิก Booking ${bk.booking_id} แล้ว`});
    loadMyBookings(); loadSlots(selectedDate); loadGroups();
  };

  // ── UI helpers ─────────────────────────────────────────────────────────────
  const STATUS_BG = {
    RESERVED:T.greenBg, ON_YARD:T.goldPale,
    CALLED_TO_DOCK:T.amberBg, TRUCK_DOCKED:T.purpleBg, LOADING:T.blueBg,
  };

  const inp = {
    width:"100%", padding:"9px 12px",
    border:`1.5px solid ${T.borderDark}`,
    borderRadius:10, fontSize:13, outline:"none", boxSizing:"border-box",
    color:T.textPrimary, background:T.white,
  };
  const sel = { ...inp, cursor:"pointer" };

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div style={{minHeight:"100vh", background:T.bg}}>

      {/* TOPBAR */}
      <div style={{
        background:T.topbarGrad, color:T.white,
        padding:"13px 18px", display:"flex", alignItems:"center",
        gap:10, flexWrap:"wrap", position:"sticky", top:0, zIndex:40,
        boxShadow:"0 2px 12px rgba(18,40,80,.25)",
        borderBottom:`3px solid ${T.gold}`,
      }}>
        <button onClick={onBack} style={{border:"1px solid rgba(255,255,255,.25)",background:"rgba(255,255,255,.08)",color:T.white,borderRadius:8,padding:"5px 12px",cursor:"pointer",fontSize:12,fontWeight:700}}>← Back</button>
        <div style={{width:28,height:28,borderRadius:6,background:T.gold,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:11,color:T.navy,flexShrink:0}}>YCH</div>
        <span style={{fontWeight:800,fontSize:15}}>📅 Dock Booking</span>

        {/* Pending groups badge */}
        {groups.length > 0 && (
          <div style={{background:`${T.gold}33`,border:`1px solid ${T.gold}66`,borderRadius:999,padding:"3px 10px",fontSize:11,fontWeight:700,color:T.goldLight}}>
            {groups.length} Group รอ Booking
          </div>
        )}

        <div style={{marginLeft:"auto",display:"flex",gap:8}}>
          <button onClick={()=>setShowMyBookings(p=>!p)}
            style={{background:"rgba(255,255,255,.15)",border:"none",color:T.white,borderRadius:7,padding:"5px 12px",cursor:"pointer",fontSize:11,fontWeight:700}}>
            📋 My Bookings {myBookings.length>0?`(${myBookings.length})`:""}
          </button>
        </div>
      </div>

      <div style={{padding:14, maxWidth:980, margin:"0 auto"}}>
        {msg && <Alert type={msg.type} msg={msg.msg}/>}

        {/* ── MY BOOKINGS PANEL ── */}
        {showMyBookings && (
          <div style={{background:T.bgCard,borderRadius:14,padding:16,marginBottom:14,boxShadow:T.shadow,border:`1px solid ${T.border}`}}>
            <SectionHeader title="📋 Active Bookings" count={myBookings.length} onRefresh={loadMyBookings}/>
            {myBookings.length===0
              ? <p style={{color:T.textMuted,fontSize:12,textAlign:"center",padding:12}}>ไม่มี Booking ที่ Active</p>
              : myBookings.map(bk=>(
                <div key={bk.booking_id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"9px 12px",borderRadius:9,background:STATUS_BG[bk.status]||T.bg,marginBottom:6,flexWrap:"wrap",gap:8,border:`1px solid ${T.border}`}}>
                  <div>
                    <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                      <span style={{fontFamily:"monospace",fontWeight:800,fontSize:12,color:T.navy}}>{bk.booking_id}</span>
                      {bk.group_number && <span style={{fontSize:10,background:T.goldPale,color:T.goldDark,borderRadius:999,padding:"1px 7px",fontWeight:700}}>{bk.group_number}</span>}
                      {bk.subcon_code  && <span style={{fontSize:10,background:T.blueBg,color:T.blue,borderRadius:999,padding:"1px 7px",fontWeight:700}}>{bk.subcon_code}</span>}
                    </div>
                    <div style={{fontSize:11,color:T.textMuted,marginTop:2}}>
                      Dock {bk.dock_no} • {String(bk.booking_hour||"").slice(0,5)} • {bk.booking_date} • {bk.truck_plate}
                    </div>
                  </div>
                  <div style={{display:"flex",gap:6,alignItems:"center"}}>
                    <StatusBadge status={bk.status}/>
                    <button onClick={()=>printBookingSlip(bk)} style={{background:T.border,color:T.textSecond,border:"none",borderRadius:6,padding:"4px 8px",cursor:"pointer",fontSize:11,fontWeight:700}}>🖨 Print</button>
                    {["RESERVED","ON_YARD"].includes(bk.status) &&
                      <button onClick={()=>cancelBooking(bk)} style={{background:T.redBg,color:T.red,border:"none",borderRadius:6,padding:"4px 8px",cursor:"pointer",fontSize:11,fontWeight:700}}>✕ ยกเลิก</button>}
                  </div>
                </div>
              ))
            }
          </div>
        )}

        {/* ── PENDING GROUPS BANNER ── */}
        {isCS && groups.length > 0 && (
          <div style={{background:T.goldPale,border:`1.5px solid ${T.goldLight}`,borderRadius:12,padding:"10px 14px",marginBottom:12,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            <span style={{fontSize:13,fontWeight:800,color:T.goldDark}}>⚡ มี {groups.length} Group รอทำ Booking</span>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {groups.map(g=>(
                <span key={g.group_number} style={{background:T.gold,color:T.navy,borderRadius:999,padding:"2px 9px",fontSize:11,fontWeight:800,cursor:"pointer"}}
                  onClick={()=>setForm(p=>({...p,groupNumber:g.group_number}))}>
                  {g.group_number} ({g.total_qty} units)
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── DAY TABS ── */}
        <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap"}}>
          {days.map(d=>{
            const dt = new Date(d);
            const label = d===today()?"วันนี้":d===days[1]?"พรุ่งนี้":dt.toLocaleDateString("th-TH",{weekday:"short"});
            return (
              <button key={d} onClick={()=>setSelectedDate(d)}
                style={{border:"1.5px solid",borderColor:selectedDate===d?T.navy:T.border,borderRadius:10,padding:"7px 12px",fontSize:12,fontWeight:700,cursor:"pointer",background:selectedDate===d?T.navy:T.white,color:selectedDate===d?T.white:T.textSecond,textAlign:"center",minWidth:70}}>
                <div style={{fontSize:10,opacity:.8}}>{label}</div>
                <div>{dt.toLocaleDateString("th-TH",{day:"numeric",month:"short"})}</div>
              </button>
            );
          })}
        </div>

        {/* ── LEGEND ── */}
        <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap"}}>
          {[[T.greenBg,T.green,"FREE"],[T.redBg,T.red,"FULL"],[T.goldPale,T.goldDark,"SELECTED"],[T.bg,T.textMuted,"ผ่านแล้ว"]].map(([bg,c,l])=>(
            <span key={l} style={{background:bg,color:c,border:`1px solid ${c}33`,borderRadius:7,padding:"3px 9px",fontSize:11,fontWeight:700}}>{l}</span>
          ))}
          {minHours>0 && <span style={{fontSize:11,color:T.textMuted,marginLeft:4}}>⏱ ต้องจองล่วงหน้า {minHours} ชม.</span>}
        </div>

        {/* ── SLOT MATRIX ── */}
        <div style={{background:T.white,borderRadius:14,overflow:"auto",boxShadow:T.shadow,marginBottom:12,border:`1px solid ${T.border}`}}>
          {loading
            ? <div style={{padding:40,textAlign:"center"}}><Spinner/></div>
            : hours.length===0
              ? <div style={{padding:32,textAlign:"center",color:T.textMuted,fontSize:13}}>ไม่มี Slot วันนี้ — กรุณาให้ Admin สร้าง Slot ก่อน</div>
              : (
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
                          if (!s) return <td key={d} style={{padding:3}}><div style={{background:T.bg,borderRadius:7,padding:"7px 4px",textAlign:"center",color:T.textMuted,fontSize:10}}>—</div></td>;
                          const isSel    = selected?.slot_key===s.slot_key;
                          const isBooked = s.status!=="AVAILABLE";
                          const isPast   = isPastSlot(s.slot_date, s.slot_hour);
                          const disabled = isBooked || isPast;
                          const bg    = isSel?T.goldPale:isBooked?T.redBg:isPast?T.bg:T.greenBg;
                          const color = isSel?T.goldDark:isBooked?T.red:isPast?T.textMuted:T.green;
                          return (
                            <td key={d} style={{padding:3}}>
                              <button disabled={disabled} onClick={()=>setSelected(isSel?null:s)}
                                style={{width:"100%",padding:"8px 4px",borderRadius:7,border:"none",background:bg,color,fontWeight:700,fontSize:11,cursor:disabled?"not-allowed":"pointer",transform:isSel?"scale(1.06)":"none",transition:"all .12s",boxShadow:isSel?`0 2px 8px rgba(245,168,0,.3)`:"none"}}>
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
          <div style={{padding:"12px 16px",background:T.greenBg,border:`1.5px solid ${T.green}55`,borderRadius:10,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8,marginBottom:10}}>
            <span style={{fontWeight:700,color:T.green}}>
              ✅ Dock {selected.dock_no} • {String(selected.slot_hour).slice(0,5)} • {selectedDate}
            </span>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setSelected(null)} style={{background:T.border,color:T.textSecond,border:"none",borderRadius:8,padding:"6px 12px",fontWeight:700,cursor:"pointer",fontSize:12}}>เปลี่ยน</button>
              <button onClick={()=>setShowForm(true)} style={{background:T.navy,color:T.white,border:`2px solid ${T.gold}`,borderRadius:8,padding:"6px 16px",fontWeight:800,cursor:"pointer",fontSize:12}}>กรอกข้อมูลรถ →</button>
            </div>
          </div>
        )}
      </div>

      {/* ── BOOKING FORM MODAL ── */}
      {showForm && selected && (
        <Modal title="📋 กรอกข้อมูลจอง Dock" onClose={()=>{setShowForm(false);setFormErr("");}} width={480}>
          <div style={{fontSize:12,color:T.textMuted,marginBottom:14,padding:"8px 12px",background:T.bg,borderRadius:8,fontWeight:600}}>
            📍 Dock {selected.dock_no} • {String(selected.slot_hour).slice(0,5)} • {selectedDate}
          </div>

          {formErr && <Alert type="err" msg={formErr}/>}

          {/* ── Group selector (CS / all roles that have groups) ── */}
          {groups.length > 0 && (
            <div style={{marginBottom:14,padding:"10px 12px",background:T.goldPale,borderRadius:10,border:`1.5px solid ${T.goldLight}`}}>
              <label style={{display:"block",fontSize:12,fontWeight:800,marginBottom:6,color:T.goldDark}}>
                📦 Group Number {isCS?"*":""} (BOOKING_PENDING)
              </label>
              <select value={form.groupNumber} onChange={e=>setForm(p=>({...p,groupNumber:e.target.value}))} style={{...inp, borderColor:T.goldLight}}>
                <option value="">— ไม่เลือก Group —</option>
                {groups.map(g=>(
                  <option key={g.group_number} value={g.group_number}>
                    {g.group_number} — {g.subcon_code} — {g.total_qty} units ({g.total_obd} OBD)
                  </option>
                ))}
              </select>
              {form.groupNumber && selectedGroup && (
                <div style={{marginTop:6,fontSize:11,color:T.goldDark,fontWeight:700}}>
                  ✓ SubCon: {selectedGroup.subcon_name} ({selectedGroup.subcon_code})
                </div>
              )}
            </div>
          )}

          {/* ── Direct SubCon (manager/admin if no group selected) ── */}
          {(isManager || isGate) && !form.groupNumber && subcons.length>0 && (
            <div style={{marginBottom:14}}>
              <label style={{display:"block",fontSize:12,fontWeight:700,marginBottom:5,color:T.textSecond}}>SubCon (ถ้าไม่เลือก Group)</label>
              <select value={form.subconCode} onChange={e=>setForm(p=>({...p,subconCode:e.target.value}))} style={sel}>
                <option value="">— เลือก SubCon —</option>
                {subcons.map(s=><option key={s.subcon_code} value={s.subcon_code}>{s.subcon_code} — {s.subcon_name}</option>)}
              </select>
            </div>
          )}

          {/* ── Truck info ── */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
            {[
              {label:"ทะเบียนรถ *", key:"truckPlate",  placeholder:"เช่น 80-1234"},
              {label:"ประเภทรถ",    key:"truckType",   placeholder:"6 ล้อ / เทรลเลอร์"},
            ].map(f=>(
              <div key={f.key}>
                <label style={{display:"block",fontSize:12,fontWeight:700,marginBottom:4,color:T.textSecond}}>{f.label}</label>
                <input value={form[f.key]} onChange={e=>setForm(p=>({...p,[f.key]:e.target.value}))}
                  placeholder={f.placeholder} style={inp}/>
              </div>
            ))}
          </div>

          {[
            {label:"ชื่อคนขับ *", key:"driverName", placeholder:"ชื่อ-นามสกุล"},
            {label:"เบอร์โทร *",  key:"phone",       placeholder:"08x-xxx-xxxx", type:"tel"},
          ].map(f=>(
            <div key={f.key} style={{marginBottom:10}}>
              <label style={{display:"block",fontSize:12,fontWeight:700,marginBottom:4,color:T.textSecond}}>{f.label}</label>
              <input value={form[f.key]} onChange={e=>setForm(p=>({...p,[f.key]:e.target.value}))}
                placeholder={f.placeholder} type={f.type||"text"} style={inp}/>
            </div>
          ))}

          <div style={{marginBottom:14}}>
            <label style={{display:"block",fontSize:12,fontWeight:700,marginBottom:4,color:T.textSecond}}>หมายเหตุ</label>
            <input value={form.remarks} onChange={e=>setForm(p=>({...p,remarks:e.target.value}))}
              placeholder="หมายเหตุเพิ่มเติม (ถ้ามี)" style={inp}/>
          </div>

          {/* Summary */}
          <div style={{background:T.bg,borderRadius:8,padding:"8px 12px",marginBottom:14,fontSize:12,color:T.textSecond}}>
            <div><b>Slot:</b> Dock {selected.dock_no} • {String(selected.slot_hour).slice(0,5)} • {selectedDate}</div>
            {(form.groupNumber||form.subconCode) && (
              <div style={{marginTop:2}}>
                <b>Group:</b> {form.groupNumber||"—"} &nbsp;|&nbsp;
                <b>SubCon:</b> {selectedGroup?.subcon_code || selectedSubcon?.subcon_code || user.subcon_code || "—"}
              </div>
            )}
          </div>

          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>{setShowForm(false);setFormErr("");}}
              style={{flex:1,padding:"10px",background:T.border,color:T.textSecond,border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:13}}>
              ยกเลิก
            </button>
            <button onClick={confirmBooking} disabled={saving}
              style={{flex:2,padding:"10px",background:T.topbarGrad,color:T.white,border:`2px solid ${T.gold}`,borderRadius:10,fontWeight:800,cursor:saving?"not-allowed":"pointer",fontSize:13,opacity:saving?.6:1}}>
              {saving?"กำลังจอง…":"✓ ยืนยันการจอง"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
