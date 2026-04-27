import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

// ── SUPABASE CLIENT ───────────────────────────────────────────
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// ── CONSTANTS ─────────────────────────────────────────────────
const ROLE_APPS = {
  cs:        ["obd","booking"],
  gate:      ["gate"],
  warehouse: ["gate"],
  queue:     ["queue"],
  manager:   ["obd","booking","gate","queue","manager"],
  admin:     ["obd","booking","gate","queue","manager","supplier","inbound","admin"],
  supplier:  ["supplier"],
};

const APPS = [
  {id:"obd",      icon:"📦", name:"OBD & Group",       role:"CS",        color:"#0f4bd7", roles:["cs","manager","admin"]},
  {id:"booking",  icon:"📅", name:"Dock Booking",      role:"Subcon/CS", color:"#7c3aed", roles:["cs","manager","admin"]},
  {id:"gate",     icon:"🏭", name:"Gate & Warehouse",  role:"Gate/WH",   color:"#ea580c", roles:["gate","warehouse","manager","admin"]},
  {id:"queue",    icon:"🔔", name:"Queue Operator",    role:"Operator",  color:"#ca8a04", roles:["queue","manager","admin"]},
  {id:"manager",  icon:"📊", name:"Manager Dashboard", role:"Manager",   color:"#1d4ed8", roles:["manager","admin"]},
  {id:"supplier", icon:"📦", name:"Supplier Portal",   role:"Supplier",  color:"#065f46", roles:["supplier","admin"]},
  {id:"inbound",  icon:"🏭", name:"Inbound Gate & WH", role:"Gate/WH",   color:"#047857", roles:["gate","warehouse","manager","admin"]},
  {id:"admin",    icon:"⚙️", name:"Admin Panel",       role:"Admin",     color:"#dc2626", roles:["admin"]},
];

const STATUS_TH = {
  AVAILABLE:"ว่าง", BOOKED:"จอง",
  RESERVED:"จอง",ON_YARD:"On Yard",CALLED_TO_DOCK:"เรียกแล้ว",
  TRUCK_DOCKED:"เข้า Dock",LOADING:"Loading",COMPLETED:"เสร็จ",
  OPEN:"รอ Book",GROUPED:"Grouped",CANCELLED:"ยกเลิก",
};

// ── HELPERS ───────────────────────────────────────────────────
function today() {
  return new Date().toISOString().slice(0,10);
}

function StatusBadge({status, size=10}) {
  const colors = {
    AVAILABLE:{bg:"#d1fae5",c:"#065f46"}, BOOKED:{bg:"#fee2e2",c:"#991b1b"},
    RESERVED:{bg:"#d1fae5",c:"#065f46"}, ON_YARD:{bg:"#fef9c3",c:"#854d0e"},
    CALLED_TO_DOCK:{bg:"#ffedd5",c:"#9a3412"}, TRUCK_DOCKED:{bg:"#ede9fe",c:"#5b21b6"},
    LOADING:{bg:"#dbeafe",c:"#1e40af"}, COMPLETED:{bg:"#dcfce7",c:"#166534"},
    OPEN:{bg:"#dcfce7",c:"#166534"}, GROUPED:{bg:"#dbeafe",c:"#1d4ed8"},
    CANCELLED:{bg:"#fee2e2",c:"#991b1b"},
  };
  const col = colors[status]||{bg:"#f3f4f6",c:"#374151"};
  return <span style={{display:"inline-block",padding:`2px ${size<11?7:9}px`,borderRadius:999,fontSize:size,fontWeight:800,background:col.bg,color:col.c}}>{STATUS_TH[status]||status}</span>;
}

function Spinner() {
  return <div style={{width:20,height:20,border:"3px solid #e5e7eb",borderTopColor:"#0f4bd7",borderRadius:"50%",animation:"spin .6s linear infinite",margin:"0 auto"}}/>;
}

function Alert({type,msg}) {
  const s = {err:{bg:"#fee2e2",c:"#991b1b"},ok:{bg:"#d1fae5",c:"#065f46"},warn:{bg:"#fef3c7",c:"#92400e"}}[type]||{bg:"#dbeafe",c:"#1d4ed8"};
  return <div style={{padding:"10px 14px",borderRadius:10,fontSize:13,marginBottom:12,background:s.bg,color:s.c,fontWeight:600}}>{msg}</div>;
}

// ── PDF BOOKING SLIP ─────────────────────────────────────────
function printBookingSlip(booking, groupInfo={}) {
  const w = window.open("","_blank","width=700,height=900");
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>
    body{font-family:Arial,sans-serif;padding:32px;max-width:600px;margin:0 auto}
    .header{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #059669;padding-bottom:12px;margin-bottom:16px}
    .title{font-size:20px;font-weight:900;color:#065f46}
    .sub{font-size:11px;color:#6b7280}
    p{margin:6px 0;font-size:13px}
    .lbl{font-weight:700;display:inline-block;width:130px;color:#374151}
    hr{margin:12px 0;border:none;border-top:1px solid #e5e7eb}
    .bk-id{font-family:monospace;font-size:18px;font-weight:900;letter-spacing:2px;color:#065f46}
    .barcode{text-align:center;margin:20px 0;padding:16px;border:1px solid #e5e7eb;border-radius:8px}
    table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}
    th{background:#065f46;color:#fff;padding:6px 10px;text-align:left}
    td{padding:6px 10px;border-bottom:1px solid #e5e7eb}
    .footer{font-size:10px;color:#9ca3af;text-align:center;margin-top:16px}
    @media print{button{display:none}}
  </style></head><body>
  <div class="header">
    <div>
      <div class="title">🏭 Dock Booking Slip</div>
      <div class="sub">Dock Management System — YCH Ladkrabang</div>
    </div>
    <button onclick="window.print()" style="background:#059669;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;font-weight:700">🖨 Print</button>
  </div>
  <p><span class="lbl">Booking ID:</span><span class="bk-id">${booking.booking_id||""}</span></p>
  <p><span class="lbl">Group No:</span>${booking.group_number||groupInfo.group_number||"—"}</p>
  <hr>
  <p><span class="lbl">Dock:</span>Dock ${booking.dock_no||""}</p>
  <p><span class="lbl">Date:</span>${booking.booking_date||""}</p>
  <p><span class="lbl">Time:</span>${String(booking.booking_hour||"").slice(0,5)}</p>
  <hr>
  <p><span class="lbl">Truck Plate:</span>${booking.truck_plate||""}</p>
  <p><span class="lbl">Truck Type:</span>${booking.truck_type||"—"}</p>
  <p><span class="lbl">Driver:</span>${booking.driver_name||""}</p>
  <p><span class="lbl">Phone:</span>${booking.phone||""}</p>
  <div class="barcode">
    <div style="font-family:monospace;font-size:24px;font-weight:900;letter-spacing:4px">${booking.booking_id||""}</div>
    <div style="font-size:11px;color:#6b7280;margin-top:4px">กรุณาแสดง Booking ID นี้ที่ Gate</div>
  </div>
  <div class="footer">พิมพ์เมื่อ ${new Date().toLocaleString("th-TH")} • Dock Management System</div>
  </body></html>`;
  w.document.write(html);
  w.document.close();
}

// ── PDF INBOUND SLIP ──────────────────────────────────────────
function printInboundSlip(booking, asn={}, invoices=[]) {
  const w = window.open("","_blank","width=700,height=900");
  const totalQty = invoices.reduce((s,inv)=>s+(inv.invoice_qty||0),0);
  const invRows = invoices.map((inv,i)=>`<tr>
    <td>${i+1}</td><td>${inv.invoice_no}</td><td>${inv.po_no||"—"}</td>
    <td>${inv.invoice_date||""}</td><td style="text-align:right">${inv.invoice_qty||0}</td>
  </tr>`).join("");
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>
    body{font-family:Arial,sans-serif;padding:32px;max-width:600px;margin:0 auto}
    .header{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #059669;padding-bottom:12px;margin-bottom:16px}
    .title{font-size:20px;font-weight:900;color:#065f46}
    p{margin:6px 0;font-size:13px}.lbl{font-weight:700;display:inline-block;width:130px}
    hr{margin:12px 0;border:none;border-top:1px solid #e5e7eb}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th{background:#065f46;color:#fff;padding:6px 10px;text-align:left}
    td{padding:6px 10px;border-bottom:1px solid #e5e7eb}
    .bk-id{font-family:monospace;font-size:16px;font-weight:900;letter-spacing:2px;color:#065f46}
    @media print{button{display:none}}
  </style></head><body>
  <div class="header">
    <div><div class="title">🏭 Inbound Booking Slip</div><div style="font-size:11px;color:#6b7280">Dock Management System</div></div>
    <button onclick="window.print()" style="background:#059669;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;font-weight:700">🖨 Print</button>
  </div>
  <p><span class="lbl">Booking ID:</span><span class="bk-id">${booking.booking_id||""}</span></p>
  <p><span class="lbl">ASN No:</span>${booking.asn_no||""}</p>
  <p><span class="lbl">Supplier:</span>${asn.supplier_name||booking.supplier_code||""}</p>
  <hr>
  <p><span class="lbl">Dock:</span>Dock ${booking.dock_no||""}</p>
  <p><span class="lbl">Date:</span>${booking.booking_date||""}</p>
  <p><span class="lbl">Time:</span>${String(booking.booking_hour||"").slice(0,5)}</p>
  <hr>
  <p><span class="lbl">Truck:</span>${booking.truck_plate||""} (${booking.truck_type||""})</p>
  <p><span class="lbl">Driver:</span>${booking.driver_name||""} ${booking.driver_phone||""}</p>
  <hr>
  <b style="font-size:13px">Invoices (${invoices.length} invoices | Total: ${totalQty} units)</b>
  <table><thead><tr><th>#</th><th>Invoice No</th><th>PO No</th><th>Date</th><th>Qty</th></tr></thead>
  <tbody>${invRows}</tbody></table>
  <div style="margin-top:20px;text-align:center;padding:12px;border:1px solid #e5e7eb;border-radius:8px">
    <div style="font-family:monospace;font-size:20px;font-weight:900;letter-spacing:3px;color:#065f46">${booking.booking_id||""}</div>
    <div style="font-size:11px;color:#6b7280;margin-top:4px">กรุณาแสดง Barcode นี้ที่ประตูทางเข้า (Inbound)</div>
  </div>
  </body></html>`;
  w.document.write(html);
  w.document.close();
}

// ── LOGIN ─────────────────────────────────────────────────────
function Login({onLogin}) {
  const [username,setUsername] = useState("");
  const [password,setPassword] = useState("");
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState("");

  const handleLogin = async(e) => {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      const {data,error:err} = await supabase
        .from("users")
        .select("*")
        .eq("username", username.trim())
        .eq("active", true)
        .single();
      if (err||!data) throw new Error("ไม่พบ username นี้");
      // TODO: bcrypt verify — ตอนนี้ข้ามไปก่อน (placeholder hash)
      onLogin(data);
    } catch(e) {
      setError(e.message||"Login failed");
    } finally { setLoading(false); }
  };

  return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"linear-gradient(135deg,#0a2a6e,#1e3a8a,#1d4ed8)"}}>
      <div style={{background:"#fff",borderRadius:20,padding:"32px 28px",width:"100%",maxWidth:400,boxShadow:"0 20px 60px rgba(0,0,0,.3)"}}>
        <div style={{fontSize:28,textAlign:"center",marginBottom:8}}>🏭</div>
        <h2 style={{fontSize:22,fontWeight:900,color:"#0a2a6e",textAlign:"center",marginBottom:4}}>DMS</h2>
        <p style={{fontSize:12,color:"#6b7280",textAlign:"center",marginBottom:24}}>Dock Management System</p>
        {error && <Alert type="err" msg={error}/>}
        <form onSubmit={handleLogin}>
          <div style={{marginBottom:12}}>
            <label style={{display:"block",fontSize:12,fontWeight:700,marginBottom:5,color:"#374151"}}>Username</label>
            <input value={username} onChange={e=>setUsername(e.target.value)} required autoComplete="username"
              style={{width:"100%",padding:"10px 12px",border:"1.5px solid #e5e7eb",borderRadius:10,fontSize:13,outline:"none",boxSizing:"border-box"}}/>
          </div>
          <div style={{marginBottom:16}}>
            <label style={{display:"block",fontSize:12,fontWeight:700,marginBottom:5,color:"#374151"}}>Password</label>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)} required autoComplete="current-password"
              style={{width:"100%",padding:"10px 12px",border:"1.5px solid #e5e7eb",borderRadius:10,fontSize:13,outline:"none",boxSizing:"border-box"}}/>
          </div>
          <button type="submit" disabled={loading}
            style={{width:"100%",padding:"10px",background:"#0f4bd7",color:"#fff",border:"none",borderRadius:10,fontWeight:700,fontSize:14,cursor:"pointer",opacity:loading?.6:1}}>
            {loading ? "กำลังเข้าสู่ระบบ…" : "Sign In"}
          </button>
        </form>
        <p style={{fontSize:10,color:"#9ca3af",textAlign:"center",marginTop:16}}>Powered by Supabase + React</p>
      </div>
    </div>
  );
}

// ── LAUNCHER ─────────────────────────────────────────────────
function Launcher({user, onSelect, onLogout}) {
  const allowed = ROLE_APPS[user.role]||[];
  const visible = APPS.filter(a=>allowed.includes(a.id));
  const now = new Date().toLocaleDateString("th-TH",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
  return (
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#060d2e 0%,#0a2a6e 40%,#1a3a8f 70%,#1d4ed8 100%)"}}>
      {/* TOPBAR */}
      <div style={{padding:"20px 32px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10,borderBottom:"1px solid rgba(255,255,255,.08)"}}>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <div style={{width:44,height:44,background:"linear-gradient(135deg,#f59e0b,#ef4444)",borderRadius:12,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,boxShadow:"0 4px 15px rgba(245,158,11,.4)"}}>🏭</div>
          <div>
            <div style={{fontSize:18,fontWeight:900,color:"#fff",letterSpacing:-.5}}>Dock Management System</div>
            <div style={{fontSize:11,color:"rgba(255,255,255,.4)",marginTop:1}}>YCH Ladkrabang Plant • {now}</div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:13,color:"#fff",fontWeight:700}}>{user.full_name}</div>
            <div style={{display:"inline-block",fontSize:10,background:"rgba(255,255,255,.15)",borderRadius:999,padding:"2px 8px",color:"rgba(255,255,255,.7)",marginTop:2}}>{user.role}</div>
          </div>
          <button onClick={onLogout}
            style={{border:"1px solid rgba(255,255,255,.2)",background:"rgba(255,255,255,.08)",color:"#fff",borderRadius:9,padding:"7px 14px",cursor:"pointer",fontSize:12,fontWeight:700,transition:"all .15s"}}
            onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,255,255,.18)";}}
            onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,.08)";}}
          >Logout</button>
        </div>
      </div>

      {/* APP GRID */}
      <div style={{padding:"32px",display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:16,maxWidth:1400,margin:"0 auto"}}>
        {visible.map(app=>(
          <button key={app.id} onClick={()=>onSelect(app.id)}
            style={{background:"rgba(255,255,255,.06)",backdropFilter:"blur(20px)",border:"1px solid rgba(255,255,255,.1)",borderRadius:20,padding:"24px 20px",textAlign:"left",cursor:"pointer",color:"#fff",position:"relative",overflow:"hidden",transition:"all .25s",boxShadow:"0 4px 24px rgba(0,0,0,.2)"}}
            onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,255,255,.12)";e.currentTarget.style.transform="translateY(-4px)";e.currentTarget.style.boxShadow="0 12px 32px rgba(0,0,0,.3)";e.currentTarget.style.borderColor="rgba(255,255,255,.2)";}}
            onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,.06)";e.currentTarget.style.transform="none";e.currentTarget.style.boxShadow="0 4px 24px rgba(0,0,0,.2)";e.currentTarget.style.borderColor="rgba(255,255,255,.1)";}}
          >
            {/* TOP COLOR BAR */}
            <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:`linear-gradient(90deg,${app.color},${app.color}88)`,borderRadius:"20px 20px 0 0"}}/>
            {/* ICON */}
            <div style={{width:48,height:48,background:`${app.color}22`,borderRadius:14,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,marginBottom:14,border:`1px solid ${app.color}44`}}>
              {app.icon}
            </div>
            <div style={{fontSize:15,fontWeight:800,marginBottom:4,letterSpacing:-.3}}>{app.name}</div>
            <div style={{fontSize:10,color:"rgba(255,255,255,.4)",fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:14}}>{app.role}</div>
            {/* ARROW */}
            <div style={{display:"flex",alignItems:"center",gap:4,fontSize:11,color:app.color,fontWeight:700}}>
              Open <span style={{fontSize:14}}>→</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── BOOKING APP ───────────────────────────────────────────────
function BookingApp({user, onBack}) {
  const [slots,setSlots] = useState([]);
  const [loading,setLoading] = useState(true);
  const [selectedDate,setSelectedDate] = useState(today());
  const [selected,setSelected] = useState(null);
  const [msg,setMsg] = useState(null);
  const [booking,setBooking] = useState(false);
  const [showForm,setShowForm] = useState(false);
  const [form,setForm] = useState({truckPlate:"",truckType:"",driverName:"",phone:""});
  const [formErr,setFormErr] = useState("");

  const DOCKS = [1,2,3,4,5];
  const days = Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()+i);return d.toISOString().slice(0,10);});

  const loadSlots = useCallback(async(date) => {
    setLoading(true); setSelected(null);
    const {data,error} = await supabase
      .from("dock_slots")
      .select("*")
      .eq("slot_date", date)
      .order("slot_hour").order("dock_no");
    if (!error) setSlots(data||[]);
    setLoading(false);
  },[]);

  useEffect(()=>{ loadSlots(selectedDate); },[selectedDate,loadSlots]);

  // Realtime
  useEffect(()=>{
    const ch = supabase.channel("dock_slots_changes")
      .on("postgres_changes",{event:"*",schema:"public",table:"dock_slots"},()=>loadSlots(selectedDate))
      .subscribe((s)=>{ if(s==="CHANNEL_ERROR"||s==="TIMED_OUT") console.warn("Realtime error:",s); });
    return ()=>supabase.removeChannel(ch);
  },[selectedDate,loadSlots]);

  const hours = [...new Set(slots.map(s=>String(s.slot_hour).slice(0,5)))].sort();
  const slotMap = {};
  slots.forEach(s=>{ slotMap[String(s.slot_hour).slice(0,5)+"_"+s.dock_no]=s; });

  const confirmBooking = async() => {
    if (!selected) return;
    // validate form
    if (!form.truckPlate.trim()) return setFormErr("กรุณากรอกทะเบียนรถ");
    if (!form.driverName.trim()) return setFormErr("กรุณากรอกชื่อคนขับ");
    if (!form.phone.trim()) return setFormErr("กรุณากรอกเบอร์โทร");
    setFormErr(""); setBooking(true); setMsg(null);
    // สร้าง booking_id
    const bkId = "BK"+Date.now();
    // insert booking
    const {error:bkErr} = await supabase.from("bookings").insert({
      booking_id: bkId,
      booking_date: selectedDate,
      booking_hour: selected.slot_hour,
      dock_no: selected.dock_no,
      slot_key: selected.slot_key,
      truck_plate: form.truckPlate.toUpperCase(),
      truck_type: form.truckType,
      driver_name: form.driverName,
      phone: form.phone,
      status: "RESERVED",
      created_by: user.username,
    });
    if (bkErr) { setMsg({type:"err",msg:"สร้าง Booking ไม่สำเร็จ: "+bkErr.message}); setBooking(false); return; }
    // update slot
    await supabase.from("dock_slots")
      .update({status:"BOOKED", booking_id:bkId})
      .eq("slot_key", selected.slot_key);
    setMsg({type:"ok",msg:"✅ จอง Dock "+selected.dock_no+" เวลา "+String(selected.slot_hour).slice(0,5)+" สำเร็จ! Booking ID: "+bkId});
    // auto print slip
    const bkData = {booking_id:bkId,booking_date:selectedDate,booking_hour:selected.slot_hour,dock_no:selected.dock_no,truck_plate:form.truckPlate,truck_type:form.truckType,driver_name:form.driverName,phone:form.phone};
    setTimeout(()=>printBookingSlip(bkData),500);
    setSelected(null); setShowForm(false);
    setForm({truckPlate:"",truckType:"",driverName:"",phone:""});
    setBooking(false);
  };

  return (
    <div style={{minHeight:"100vh",background:"#f0f4fb"}}>
      <div style={{background:"linear-gradient(90deg,#0a2a6e,#1d4ed8)",color:"#fff",padding:"12px 18px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
        <button onClick={onBack} style={{border:"1px solid rgba(255,255,255,.2)",background:"transparent",color:"#fff",borderRadius:8,padding:"4px 10px",cursor:"pointer",fontSize:12}}>← Back</button>
        <span style={{fontWeight:800,fontSize:15}}>📅 Dock Booking</span>
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:6}}>
          <span style={{width:8,height:8,borderRadius:"50%",background:"#22c55e",display:"inline-block",boxShadow:"0 0 0 3px rgba(34,197,94,.25)"}}/>
          <span style={{fontSize:11,fontWeight:700,color:"#86efac"}}>LIVE</span>
        </div>
      </div>

      <div style={{padding:14,maxWidth:960,margin:"0 auto"}}>
        {msg && <Alert type={msg.type} msg={msg.msg}/>}

        {/* DAY TABS */}
        <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap"}}>
          {days.map(d=>{
            const dt=new Date(d);
            const label=d===today()?"วันนี้":d===days[1]?"พรุ่งนี้":dt.toLocaleDateString("th-TH",{weekday:"short"});
            const dayNum=dt.toLocaleDateString("th-TH",{day:"numeric",month:"short"});
            return (
              <button key={d} onClick={()=>setSelectedDate(d)}
                style={{border:"1.5px solid",borderColor:selectedDate===d?"#0f4bd7":"#e5e7eb",borderRadius:10,padding:"7px 12px",fontSize:12,fontWeight:700,cursor:"pointer",background:selectedDate===d?"#0f4bd7":"#fff",color:selectedDate===d?"#fff":"#374151",transition:"all .15s",textAlign:"center",minWidth:70}}>
                <div style={{fontSize:10,opacity:.8}}>{label}</div>
                <div>{dayNum}</div>
              </button>
            );
          })}
        </div>

        {/* LEGEND */}
        <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
          {[["#d1fae5","#065f46","FREE"],["#fee2e2","#991b1b","BOOKED"],["#fde68a","#92400e","SELECTED"]].map(([bg,c,l])=>(
            <span key={l} style={{background:bg,color:c,borderRadius:7,padding:"3px 9px",fontSize:11,fontWeight:700}}>{l}</span>
          ))}
        </div>

        {/* SLOT MATRIX */}
        <div style={{background:"#fff",borderRadius:14,overflow:"auto",boxShadow:"0 4px 20px rgba(0,0,0,.07)",marginBottom:12}}>
          {loading ? (
            <div style={{padding:40,textAlign:"center"}}><Spinner/><p style={{marginTop:12,fontSize:12,color:"#9ca3af"}}>กำลังโหลด Slot…</p></div>
          ) : (
            <table style={{width:"100%",borderCollapse:"separate",borderSpacing:3,padding:10,minWidth:500}}>
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
                      if (!s) return <td key={d} style={{padding:3}}><div style={{background:"#f8fafc",borderRadius:7,padding:"7px 4px",textAlign:"center",color:"#9ca3af",fontSize:11}}>—</div></td>;
                      const isSel = selected?.slot_key===s.slot_key;
                      const isBooked = s.status!=="AVAILABLE";
                      const bg = isSel?"#fde68a":isBooked?"#fee2e2":"#d1fae5";
                      const color = isSel?"#92400e":isBooked?"#991b1b":"#065f46";
                      return (
                        <td key={d} style={{padding:3}}>
                          <button disabled={isBooked} onClick={()=>setSelected(isSel?null:s)}
                            style={{width:"100%",padding:"7px 4px",borderRadius:7,border:"none",background:bg,color,fontWeight:700,fontSize:11,cursor:isBooked?"not-allowed":"pointer",transform:isSel?"scale(1.05)":"none",boxShadow:isSel?"0 2px 8px rgba(245,158,11,.4)":"none",transition:"all .15s"}}>
                            {isBooked?"FULL":"FREE"}
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
          <div style={{padding:"12px 16px",background:"#ecfdf5",border:"1.5px solid #6ee7b7",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
            <span style={{fontWeight:700,color:"#065f46"}}>✅ เลือก Dock {selected.dock_no} • {String(selected.slot_hour).slice(0,5)} • {selectedDate}</span>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setSelected(null)} style={{background:"#e5e7eb",color:"#374151",border:"none",borderRadius:8,padding:"6px 12px",fontWeight:700,cursor:"pointer",fontSize:12}}>เปลี่ยน</button>
              <button onClick={()=>setShowForm(true)} style={{background:"#059669",color:"#fff",border:"none",borderRadius:8,padding:"6px 16px",fontWeight:700,cursor:"pointer",fontSize:12}}>
                กรอกข้อมูลรถ →
              </button>
            </div>
          </div>
        )}

        {/* BOOKING FORM MODAL */}
        {showForm && selected && (
          <div style={{position:"fixed",inset:0,background:"rgba(10,20,50,.6)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,padding:16}}>
            <div style={{background:"#fff",borderRadius:16,padding:24,width:"100%",maxWidth:420,boxShadow:"0 20px 60px rgba(0,0,0,.3)"}}>
              <div style={{fontWeight:800,color:"#0a2a6e",fontSize:16,marginBottom:4}}>📋 กรอกข้อมูลรถ</div>
              <div style={{fontSize:12,color:"#6b7280",marginBottom:16}}>Dock {selected.dock_no} • {String(selected.slot_hour).slice(0,5)} • {selectedDate}</div>
              {formErr && <Alert type="err" msg={formErr}/>}
              {[
                {label:"ทะเบียนรถ *",key:"truckPlate",placeholder:"เช่น 80-1234"},
                {label:"ประเภทรถ",key:"truckType",placeholder:"เช่น 6 ล้อ, เทรลเลอร์"},
                {label:"ชื่อคนขับ *",key:"driverName",placeholder:"ชื่อ-นามสกุล"},
                {label:"เบอร์โทร *",key:"phone",placeholder:"08x-xxx-xxxx",type:"tel"},
              ].map(f=>(
                <div key={f.key} style={{marginBottom:12}}>
                  <label style={{display:"block",fontSize:12,fontWeight:700,marginBottom:5,color:"#374151"}}>{f.label}</label>
                  <input value={form[f.key]} onChange={e=>setForm(p=>({...p,[f.key]:e.target.value}))}
                    placeholder={f.placeholder} type={f.type||"text"}
                    style={{width:"100%",padding:"9px 12px",border:"1.5px solid #e5e7eb",borderRadius:10,fontSize:13,outline:"none",boxSizing:"border-box"}}/>
                </div>
              ))}
              <div style={{display:"flex",gap:8,marginTop:16}}>
                <button onClick={()=>{setShowForm(false);setFormErr("");}} style={{flex:1,padding:"10px",background:"#e5e7eb",color:"#374151",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:13}}>ยกเลิก</button>
                <button onClick={confirmBooking} disabled={booking}
                  style={{flex:2,padding:"10px",background:"#059669",color:"#fff",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:13,opacity:booking?.6:1}}>
                  {booking?"กำลังจอง…":"✓ ยืนยันการจอง"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── GATE APP ──────────────────────────────────────────────────
function GateApp({user, onBack}) {
  const [scanId,setScanId] = useState("");
  const [found,setFound] = useState(null);
  const [activeList,setActiveList] = useState([]);
  const [loading,setLoading] = useState(false);
  const [msg,setMsg] = useState(null);

  const loadActive = useCallback(async()=>{
    const {data} = await supabase
      .from("bookings")
      .select("*")
      .in("status",["RESERVED","ON_YARD","CALLED_TO_DOCK","TRUCK_DOCKED","LOADING"])
      .eq("booking_date", today())
      .order("booking_hour");
    setActiveList(data||[]);
  },[]);

  useEffect(()=>{ loadActive(); },[loadActive]);

  useEffect(()=>{
    const ch = supabase.channel("bookings_gate")
      .on("postgres_changes",{event:"*",schema:"public",table:"bookings"},()=>loadActive())
      .subscribe((s)=>{ if(s==="CHANNEL_ERROR"||s==="TIMED_OUT") console.warn("Realtime error:",s); });
    return ()=>supabase.removeChannel(ch);
  },[loadActive]);

  const handleScan = async(e)=>{
    e.preventDefault(); setLoading(true); setMsg(null);
    const {data,error} = await supabase
      .from("bookings").select("*").eq("booking_id",scanId.trim()).single();
    if (error||!data) setFound("not_found");
    else setFound(data);
    setLoading(false);
  };

  const doAction = async(bookingId, newStatus)=>{
    setMsg(null);
    const update = {status:newStatus, updated_at:new Date().toISOString()};
    if (newStatus==="ON_YARD") update.check_in_time = new Date().toISOString();
    const {error} = await supabase.from("bookings").update(update).eq("booking_id",bookingId);
    if (error) setMsg({type:"err",msg:error.message});
    else {
      setMsg({type:"ok",msg:"✅ อัปเดตสถานะสำเร็จ"});
      if (found&&found!=="not_found"&&found.booking_id===bookingId)
        setFound(prev=>({...prev,...update}));
      loadActive();
    }
  };

  const ACTIONS = {
    RESERVED:      {label:"✓ Check-in เข้า Yard", next:"ON_YARD",       color:"#059669"},
    ON_YARD:       {label:"📢 Call to Dock",       next:"CALLED_TO_DOCK",color:"#f59e0b"},
    CALLED_TO_DOCK:{label:"🚛 Confirm Docked",     next:"TRUCK_DOCKED",  color:"#7c3aed"},
    TRUCK_DOCKED:  {label:"⬆ Start Loading",       next:"LOADING",       color:"#1d4ed8"},
    LOADING:       {label:"✓ Complete",            next:"COMPLETED",     color:"#16a34a"},
  };

  return (
    <div style={{minHeight:"100vh",background:"#f0f4fb"}}>
      <div style={{background:"linear-gradient(90deg,#92400e,#d97706)",color:"#fff",padding:"12px 18px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
        <button onClick={onBack} style={{border:"1px solid rgba(255,255,255,.2)",background:"transparent",color:"#fff",borderRadius:8,padding:"4px 10px",cursor:"pointer",fontSize:12}}>← Back</button>
        <span style={{fontWeight:800,fontSize:15}}>🏭 Gate & Warehouse</span>
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:6}}>
          <span style={{width:8,height:8,borderRadius:"50%",background:"#22c55e",display:"inline-block",boxShadow:"0 0 0 3px rgba(34,197,94,.25)"}}/>
          <span style={{fontSize:11,fontWeight:700,color:"#86efac"}}>LIVE</span>
        </div>
      </div>

      <div style={{padding:14,maxWidth:900,margin:"0 auto"}}>
        {msg && <Alert type={msg.type} msg={msg.msg}/>}

        {/* SCAN */}
        <div style={{background:"#fff",borderRadius:14,padding:16,marginBottom:14,boxShadow:"0 4px 20px rgba(0,0,0,.07)"}}>
          <div style={{fontWeight:800,color:"#0a2a6e",marginBottom:12,fontSize:14}}>🔍 Scan Booking ID</div>
          <form onSubmit={handleScan} style={{display:"flex",gap:8}}>
            <input value={scanId} onChange={e=>setScanId(e.target.value)} placeholder="BOOKING ID" autoCapitalize="characters"
              style={{flex:1,padding:"12px 14px",border:"2.5px solid #d97706",borderRadius:10,fontSize:14,fontWeight:700,fontFamily:"monospace",letterSpacing:2,outline:"none"}}/>
            <button type="submit" disabled={loading} style={{background:"#d97706",color:"#fff",border:"none",borderRadius:10,padding:"0 18px",fontWeight:700,cursor:"pointer",fontSize:13}}>ค้นหา</button>
            <button type="button" onClick={()=>{setScanId("");setFound(null);setMsg(null);}} style={{background:"#e5e7eb",color:"#374151",border:"none",borderRadius:10,padding:"0 12px",fontWeight:700,cursor:"pointer",fontSize:13}}>✕</button>
          </form>

          {found==="not_found" && <div style={{marginTop:10,padding:"8px 12px",background:"#fee2e2",borderRadius:8,color:"#991b1b",fontWeight:700,fontSize:13}}>❌ ไม่พบ Booking ID นี้</div>}

          {found && found!=="not_found" && (
            <div style={{marginTop:12,padding:14,background:"#fef3c7",border:"1.5px solid #fcd34d",borderRadius:10}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10,flexWrap:"wrap",gap:8}}>
                <div>
                  <div style={{fontFamily:"monospace",fontSize:15,fontWeight:900,color:"#0a2a6e"}}>{found.booking_id}</div>
                  <div style={{fontSize:12,color:"#374151",marginTop:2}}>Dock {found.dock_no} • {String(found.booking_hour).slice(0,5)} • {found.booking_date}</div>
                  <div style={{fontSize:11,color:"#6b7280",marginTop:1}}>{found.truck_plate} • {found.driver_name}</div>
                  {found.check_in_time && <div style={{fontSize:11,color:"#16a34a",fontWeight:700,marginTop:1}}>Check-in: {new Date(found.check_in_time).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit"})}</div>}
                </div>
                <StatusBadge status={found.status} size={11}/>
              </div>
              {ACTIONS[found.status] && (
                <button onClick={()=>doAction(found.booking_id,ACTIONS[found.status].next)}
                  style={{background:ACTIONS[found.status].color,color:"#fff",border:"none",borderRadius:9,padding:"9px 18px",fontWeight:700,cursor:"pointer",fontSize:13,width:"100%"}}>
                  {ACTIONS[found.status].label}
                </button>
              )}
            </div>
          )}
        </div>

        {/* ACTIVE LIST */}
        <div style={{background:"#fff",borderRadius:14,padding:16,boxShadow:"0 4px 20px rgba(0,0,0,.07)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div style={{fontWeight:800,color:"#0a2a6e",fontSize:14}}>🚛 Active วันนี้</div>
            <button onClick={loadActive} style={{background:"#e5e7eb",color:"#374151",border:"none",borderRadius:7,padding:"4px 10px",cursor:"pointer",fontSize:11,fontWeight:700}}>↻ Refresh</button>
          </div>
          {activeList.length===0 ? (
            <p style={{textAlign:"center",color:"#9ca3af",padding:20,fontSize:12}}>ไม่มี Active Booking วันนี้</p>
          ) : (
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {activeList.map(b=>{
                const act = ACTIONS[b.status];
                const bgMap = {ON_YARD:"#fef9c3",CALLED_TO_DOCK:"#ffedd5",TRUCK_DOCKED:"#ede9fe",LOADING:"#dbeafe",RESERVED:"#f8fafc"};
                const blMap = {ON_YARD:"#eab308",CALLED_TO_DOCK:"#f97316",TRUCK_DOCKED:"#7c3aed",LOADING:"#3b82f6",RESERVED:"#e5e7eb"};
                return (
                  <div key={b.booking_id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderRadius:10,gap:10,flexWrap:"wrap",background:bgMap[b.status]||"#f8fafc",borderLeft:"3px solid",borderLeftColor:blMap[b.status]||"#e5e7eb"}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                        <span style={{fontFamily:"monospace",fontWeight:700,fontSize:12,color:"#0a2a6e"}}>{b.truck_plate||"—"}</span>
                        <span style={{fontSize:11,color:"#6b7280"}}>D{b.dock_no} • {String(b.booking_hour).slice(0,5)}</span>
                        {b.check_in_time&&<span style={{fontSize:11,color:"#16a34a",fontWeight:700}}>✓ {new Date(b.check_in_time).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit"})}</span>}
                      </div>
                      <div style={{fontSize:10,color:"#9ca3af",marginTop:2,fontFamily:"monospace"}}>{b.booking_id}</div>
                    </div>
                    <div style={{display:"flex",gap:6,alignItems:"center"}}>
                      <StatusBadge status={b.status}/>
                      {act&&<button onClick={()=>doAction(b.booking_id,act.next)} style={{background:act.color,color:"#fff",border:"none",borderRadius:7,padding:"4px 10px",fontWeight:700,cursor:"pointer",fontSize:11}}>{act.label}</button>}
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

// ── MANAGER DASHBOARD ─────────────────────────────────────────
function ManagerApp({user, onBack}) {
  const [kpi,setKpi] = useState({booked:0,onYard:0,atDock:0,completed:0});
  const [dockStatus,setDockStatus] = useState([]);
  const [loading,setLoading] = useState(true);

  const loadData = useCallback(async()=>{
    const {data:bk} = await supabase.from("bookings").select("*").eq("booking_date",today());
    if (bk) {
      setKpi({
        booked:    bk.length,
        onYard:    bk.filter(b=>b.status==="ON_YARD").length,
        atDock:    bk.filter(b=>["TRUCK_DOCKED","LOADING"].includes(b.status)).length,
        completed: bk.filter(b=>b.status==="COMPLETED").length,
      });
      // dock grid
      const docks = Array.from({length:5},(_,i)=>{
        const active = bk.find(b=>b.dock_no===i+1&&["ON_YARD","CALLED_TO_DOCK","TRUCK_DOCKED","LOADING"].includes(b.status));
        return {dockNo:i+1, booking:active||null};
      });
      setDockStatus(docks);
    }
    setLoading(false);
  },[]);

  useEffect(()=>{ loadData(); },[loadData]);
  useEffect(()=>{
    const ch = supabase.channel("manager_live")
      .on("postgres_changes",{event:"*",schema:"public",table:"bookings"},()=>loadData())
      .subscribe((s)=>{ if(s==="CHANNEL_ERROR"||s==="TIMED_OUT") console.warn("Realtime error:",s); });
    return ()=>supabase.removeChannel(ch);
  },[loadData]);

  const KPI_CARDS = [
    {label:"Booked",    value:kpi.booked,    color:"#0f4bd7", bg:"#dbeafe"},
    {label:"On Yard",   value:kpi.onYard,    color:"#92400e", bg:"#fef9c3"},
    {label:"At Dock",   value:kpi.atDock,    color:"#5b21b6", bg:"#ede9fe"},
    {label:"Completed", value:kpi.completed, color:"#166534", bg:"#dcfce7"},
  ];

  const DOCK_ICO = {EMPTY:"□",ON_YARD:"🅿️",CALLED_TO_DOCK:"📢",TRUCK_DOCKED:"🚛",LOADING:"⬆️"};
  const DOCK_BG  = {EMPTY:"#f8fafc",ON_YARD:"#fef9c3",CALLED_TO_DOCK:"#ffedd5",TRUCK_DOCKED:"#ede9fe",LOADING:"#dbeafe"};

  return (
    <div style={{minHeight:"100vh",background:"#f0f4fb"}}>
      <div style={{background:"linear-gradient(90deg,#0a2a6e,#1e3a8a,#1d4ed8)",color:"#fff",padding:"12px 18px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
        <button onClick={onBack} style={{border:"1px solid rgba(255,255,255,.2)",background:"transparent",color:"#fff",borderRadius:8,padding:"4px 10px",cursor:"pointer",fontSize:12}}>← Back</button>
        <span style={{fontWeight:800,fontSize:15}}>📊 Manager Dashboard</span>
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:6}}>
          <span style={{width:8,height:8,borderRadius:"50%",background:"#22c55e",display:"inline-block",boxShadow:"0 0 0 3px rgba(34,197,94,.25)"}}/>
          <span style={{fontSize:11,fontWeight:700,color:"#86efac"}}>LIVE</span>
        </div>
      </div>

      <div style={{padding:14,maxWidth:1100,margin:"0 auto"}}>
        {loading ? <div style={{padding:40,textAlign:"center"}}><Spinner/></div> : <>
          {/* KPI */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:10,marginBottom:14}}>
            {KPI_CARDS.map(k=>(
              <div key={k.label} style={{background:"#fff",borderRadius:14,padding:"14px 16px",boxShadow:"0 4px 20px rgba(0,0,0,.07)",borderLeft:`4px solid ${k.color}`}}>
                <div style={{fontSize:28,fontWeight:900,color:k.color}}>{k.value}</div>
                <div style={{fontSize:11,color:"#6b7280",fontWeight:600,marginTop:3}}>{k.label}</div>
              </div>
            ))}
          </div>

          {/* DOCK GRID */}
          <div style={{background:"#fff",borderRadius:14,padding:16,boxShadow:"0 4px 20px rgba(0,0,0,.07)"}}>
            <div style={{fontWeight:800,color:"#0a2a6e",fontSize:14,marginBottom:12}}>🏭 Dock Status</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:8}}>
              {dockStatus.map(dk=>{
                const st = dk.booking?.status||"EMPTY";
                return (
                  <div key={dk.dockNo} style={{background:DOCK_BG[st]||"#f8fafc",borderRadius:12,padding:"12px 10px",textAlign:"center",position:"relative",border:"1.5px solid",borderColor:st==="LOADING"?"#93c5fd":st==="TRUCK_DOCKED"?"#c4b5fd":"#e5e7eb"}}>
                    <div style={{fontSize:9,fontWeight:700,color:"#9ca3af",position:"absolute",top:5,left:8}}>D{dk.dockNo}</div>
                    <div style={{fontSize:22}}>{DOCK_ICO[st]||"□"}</div>
                    {dk.booking?.truck_plate && <div style={{fontSize:11,fontWeight:800,fontFamily:"monospace",marginTop:4}}>{dk.booking.truck_plate}</div>}
                    {dk.booking?.booking_hour && <div style={{fontSize:10,color:"#6b7280"}}>{String(dk.booking.booking_hour).slice(0,5)}</div>}
                    <StatusBadge status={st} size={9}/>
                  </div>
                );
              })}
            </div>
          </div>
        </>}
      </div>
    </div>
  );
}

// ── APP1 OBD & GROUP ─────────────────────────────────────────
function OBDApp({user, onBack}) {
  const [tab, setTab] = useState("obd");
  const [obdList, setObdList] = useState([]);
  const [groups, setGroups] = useState([]);
  const [subcons, setSubcons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({releaseDate:today(),subConCode:"",qty:"",lineCount:"",remarks:""});
  const [creating, setCreating] = useState(false);
  const [selectedObds, setSelectedObds] = useState([]);
  const [showGroup, setShowGroup] = useState(false);

  const loadData = useCallback(async() => {
    setLoading(true);
    const [obdRes, grpRes, scRes] = await Promise.all([
      supabase.from("obd_release").select("*").order("created_at",{ascending:false}).limit(100),
      supabase.from("group_header").select("*").order("created_at",{ascending:false}).limit(50),
      supabase.from("subcon_master").select("*").eq("active",true).order("subcon_code"),
    ]);
    if (obdRes.data) setObdList(obdRes.data);
    if (grpRes.data) setGroups(grpRes.data);
    if (scRes.data) setSubcons(scRes.data);
    setLoading(false);
  },[]);

  useEffect(()=>{ loadData(); },[loadData]);

  // Realtime
useEffect(()=>{
    const ch = supabase.channel("obd_live")
      .on("postgres_changes",{event:"*",schema:"public",table:"obd_release"},()=>loadData())
      .on("postgres_changes",{event:"*",schema:"public",table:"group_header"},()=>loadData())
      .subscribe((s)=>{
        if(s==="CHANNEL_ERROR"||s==="TIMED_OUT"){
          console.warn("Realtime obd_live error - falling back to manual refresh");
        }
      });
    return ()=>{ try{ supabase.removeChannel(ch); }catch(e){} };
  },[loadData]);

  const createOBD = async() => {
    if (!form.subConCode) return setMsg({type:"err",msg:"กรุณาเลือก SubCon"});
    if (!form.qty||isNaN(+form.qty)) return setMsg({type:"err",msg:"กรุณากรอก Qty"});
    setCreating(true); setMsg(null);
    const sc = subcons.find(s=>s.subcon_code===form.subConCode);
    const obdNo = "OBD-"+form.subConCode+"-"+Date.now().toString().slice(-6);
    const {error} = await supabase.from("obd_release").insert({
      obd_no: obdNo,
      release_date: form.releaseDate,
      subcon_code: form.subConCode,
      subcon_name: sc?.subcon_name||"",
      qty: Number(form.qty),
      line_count: Number(form.lineCount||1),
      status: "OPEN",
      created_by: user.username,
    });
    if (error) setMsg({type:"err",msg:error.message});
    else { setMsg({type:"ok",msg:"✅ สร้าง OBD "+obdNo+" สำเร็จ"}); setShowCreate(false); setForm({releaseDate:today(),subConCode:"",qty:"",lineCount:"",remarks:""}); }
    setCreating(false);
  };

  const createGroup = async() => {
    if (!selectedObds.length) return setMsg({type:"err",msg:"เลือก OBD ก่อน"});
    const sc = obdList.find(o=>o.obd_no===selectedObds[0]);
    if (!sc) return;
    // เช็คว่าทุก OBD เป็น SubCon เดียวกัน
    const allSame = selectedObds.every(id=>obdList.find(o=>o.obd_no===id)?.subcon_code===sc.subcon_code);
    if (!allSame) return setMsg({type:"err",msg:"OBD ต้องเป็น SubCon เดียวกัน"});
    setCreating(true); setMsg(null);
    const grpNo = "GRP-"+sc.subcon_code+"-"+Date.now().toString().slice(-6);
    const totalQty = selectedObds.reduce((s,id)=>{const o=obdList.find(x=>x.obd_no===id);return s+(o?.qty||0);},0);
    // สร้าง group
    const {error:gErr} = await supabase.from("group_header").insert({
      group_number: grpNo,
      subcon_code: sc.subcon_code,
      subcon_name: sc.subcon_name,
      group_date: today(),
      total_obd: selectedObds.length,
      total_qty: totalQty,
      status: "BOOKING_PENDING",
      created_by: user.username,
    });
    if (gErr) { setMsg({type:"err",msg:gErr.message}); setCreating(false); return; }
    // อัปเดต OBD status
    await supabase.from("obd_release")
      .update({status:"GROUPED", group_number:grpNo})
      .in("obd_no", selectedObds);
    setMsg({type:"ok",msg:"✅ สร้าง Group "+grpNo+" สำเร็จ ("+selectedObds.length+" OBD, "+totalQty+" units)"});
    setSelectedObds([]); setShowGroup(false);
    setCreating(false);
  };

  const STATUS_COLOR = {
    OPEN:{bg:"#d1fae5",c:"#065f46"}, GROUPED:{bg:"#dbeafe",c:"#1d4ed8"},
    BOOKED:{bg:"#ede9fe",c:"#5b21b6"}, COMPLETED:{bg:"#f3f4f6",c:"#6b7280"},
    CANCELLED:{bg:"#fee2e2",c:"#991b1b"},
  };
  const GRP_COLOR = {
    BOOKING_PENDING:{bg:"#fef9c3",c:"#92400e"}, BOOKED:{bg:"#dbeafe",c:"#1d4ed8"},
    ON_YARD:{bg:"#fef9c3",c:"#854d0e"}, CALLED_TO_DOCK:{bg:"#ffedd5",c:"#9a3412"},
    TRUCK_DOCKED:{bg:"#ede9fe",c:"#5b21b6"}, LOADING:{bg:"#dbeafe",c:"#1e40af"},
    COMPLETED:{bg:"#f3f4f6",c:"#6b7280"},
  };

  const openObds = obdList.filter(o=>o.status==="OPEN");
  const toggleObd = (id) => setSelectedObds(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);

  return (
    <div style={{minHeight:"100vh",background:"#f0f4fb"}}>
      {/* TOPBAR */}
      <div style={{background:"linear-gradient(90deg,#0a2a6e,#1d4ed8)",color:"#fff",padding:"12px 18px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
        <button onClick={onBack} style={{border:"1px solid rgba(255,255,255,.2)",background:"transparent",color:"#fff",borderRadius:8,padding:"4px 10px",cursor:"pointer",fontSize:12}}>← Back</button>
        <span style={{fontWeight:800,fontSize:15}}>📦 OBD & Group</span>
        <div style={{display:"flex",gap:4,background:"rgba(255,255,255,.1)",borderRadius:8,padding:3,marginLeft:8}}>
          {["obd","group"].map(t=>(
            <button key={t} onClick={()=>setTab(t)}
              style={{border:"none",borderRadius:6,padding:"4px 12px",fontWeight:700,fontSize:12,cursor:"pointer",background:tab===t?"#fff":"transparent",color:tab===t?"#0a2a6e":"rgba(255,255,255,.7)"}}>
              {t==="obd"?"📦 OBD":"👥 Group"}
            </button>
          ))}
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:6}}>
          {tab==="obd" && <button onClick={()=>setShowCreate(true)} style={{background:"#22c55e",color:"#fff",border:"none",borderRadius:8,padding:"5px 12px",fontWeight:700,cursor:"pointer",fontSize:12}}>+ สร้าง OBD</button>}
          {tab==="obd" && selectedObds.length>0 && <button onClick={()=>setShowGroup(true)} style={{background:"#f59e0b",color:"#fff",border:"none",borderRadius:8,padding:"5px 12px",fontWeight:700,cursor:"pointer",fontSize:12}}>👥 สร้าง Group ({selectedObds.length})</button>}
        </div>
      </div>

      <div style={{padding:14,maxWidth:1000,margin:"0 auto"}}>
        {msg && <Alert type={msg.type} msg={msg.msg}/>}
        {loading ? <div style={{padding:40,textAlign:"center"}}><Spinner/></div> : <>

        {/* OBD TAB */}
        {tab==="obd" && (
          <div style={{background:"#fff",borderRadius:14,overflow:"hidden",boxShadow:"0 4px 20px rgba(0,0,0,.07)"}}>
            <div style={{padding:"12px 16px",borderBottom:"1px solid #e5e7eb",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontWeight:800,color:"#0a2a6e",fontSize:14}}>OBD Release <span style={{fontSize:11,color:"#6b7280",fontWeight:400}}>({obdList.length} รายการ)</span></div>
              {selectedObds.length>0 && <span style={{fontSize:11,color:"#1d4ed8",fontWeight:700}}>{selectedObds.length} เลือกแล้ว</span>}
            </div>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead>
                  <tr style={{background:"#f8fafc"}}>
                    <th style={{padding:"8px 10px",textAlign:"left",fontWeight:700,color:"#374151",width:32}}></th>
                    <th style={{padding:"8px 10px",textAlign:"left",fontWeight:700,color:"#374151"}}>OBD No</th>
                    <th style={{padding:"8px 10px",textAlign:"left",fontWeight:700,color:"#374151"}}>วันที่</th>
                    <th style={{padding:"8px 10px",textAlign:"left",fontWeight:700,color:"#374151"}}>SubCon</th>
                    <th style={{padding:"8px 10px",textAlign:"right",fontWeight:700,color:"#374151"}}>Qty</th>
                    <th style={{padding:"8px 10px",textAlign:"left",fontWeight:700,color:"#374151"}}>Status</th>
                    <th style={{padding:"8px 10px",textAlign:"left",fontWeight:700,color:"#374151"}}>Group</th>
                  </tr>
                </thead>
                <tbody>
                  {obdList.length===0 ? (
                    <tr><td colSpan={7} style={{padding:24,textAlign:"center",color:"#9ca3af"}}>ยังไม่มี OBD — กด "+ สร้าง OBD"</td></tr>
                  ) : obdList.map(o=>{
                    const sc = STATUS_COLOR[o.status]||{bg:"#f3f4f6",c:"#374151"};
                    const canSel = o.status==="OPEN";
                    const isSel = selectedObds.includes(o.obd_no);
                    return (
                      <tr key={o.obd_no} onClick={()=>canSel&&toggleObd(o.obd_no)}
                        style={{borderBottom:"1px solid #f3f4f6",background:isSel?"#eff6ff":"#fff",cursor:canSel?"pointer":"default"}}>
                        <td style={{padding:"8px 10px",textAlign:"center"}}>
                          {canSel && <input type="checkbox" checked={isSel} onChange={()=>toggleObd(o.obd_no)} onClick={e=>e.stopPropagation()}/>}
                        </td>
                        <td style={{padding:"8px 10px",fontFamily:"monospace",fontWeight:700,fontSize:11}}>{o.obd_no}</td>
                        <td style={{padding:"8px 10px",color:"#6b7280"}}>{o.release_date}</td>
                        <td style={{padding:"8px 10px",fontWeight:700}}>{o.subcon_code}</td>
                        <td style={{padding:"8px 10px",textAlign:"right",fontWeight:700}}>{o.qty}</td>
                        <td style={{padding:"8px 10px"}}><span style={{background:sc.bg,color:sc.c,borderRadius:999,padding:"2px 8px",fontSize:10,fontWeight:800}}>{o.status}</span></td>
                        <td style={{padding:"8px 10px",fontFamily:"monospace",fontSize:10,color:"#6b7280"}}>{o.group_number||"—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* GROUP TAB */}
        {tab==="group" && (
          <div style={{background:"#fff",borderRadius:14,overflow:"hidden",boxShadow:"0 4px 20px rgba(0,0,0,.07)"}}>
            <div style={{padding:"12px 16px",borderBottom:"1px solid #e5e7eb"}}>
              <div style={{fontWeight:800,color:"#0a2a6e",fontSize:14}}>Groups <span style={{fontSize:11,color:"#6b7280",fontWeight:400}}>({groups.length} รายการ)</span></div>
            </div>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead>
                  <tr style={{background:"#f8fafc"}}>
                    {["Group No","SubCon","วันที่","OBD","Qty","Status","Booking"].map(h=>(
                      <th key={h} style={{padding:"8px 10px",textAlign:"left",fontWeight:700,color:"#374151",whiteSpace:"nowrap"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groups.length===0 ? (
                    <tr><td colSpan={7} style={{padding:24,textAlign:"center",color:"#9ca3af"}}>ยังไม่มี Group</td></tr>
                  ) : groups.map(g=>{
                    const gc = GRP_COLOR[g.status]||{bg:"#f3f4f6",c:"#374151"};
                    return (
                      <tr key={g.group_number} style={{borderBottom:"1px solid #f3f4f6"}}>
                        <td style={{padding:"8px 10px",fontFamily:"monospace",fontWeight:700,fontSize:11}}>{g.group_number}</td>
                        <td style={{padding:"8px 10px",fontWeight:700}}>{g.subcon_code}</td>
                        <td style={{padding:"8px 10px",color:"#6b7280"}}>{g.group_date}</td>
                        <td style={{padding:"8px 10px",textAlign:"center"}}>{g.total_obd}</td>
                        <td style={{padding:"8px 10px",textAlign:"center",fontWeight:700}}>{g.total_qty}</td>
                        <td style={{padding:"8px 10px"}}><span style={{background:gc.bg,color:gc.c,borderRadius:999,padding:"2px 8px",fontSize:10,fontWeight:800}}>{g.status}</span></td>
                        <td style={{padding:"8px 10px",fontFamily:"monospace",fontSize:10,color:"#6b7280"}}>{g.booking_id||"—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
        </>}
      </div>

      {/* CREATE OBD MODAL */}
      {showCreate && (
        <div style={{position:"fixed",inset:0,background:"rgba(10,20,50,.6)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,padding:16}}>
          <div style={{background:"#fff",borderRadius:16,padding:24,width:"100%",maxWidth:400,boxShadow:"0 20px 60px rgba(0,0,0,.3)"}}>
            <div style={{fontWeight:800,color:"#0a2a6e",fontSize:16,marginBottom:16}}>📦 สร้าง OBD Release</div>
            {[
              {label:"วันที่ Release *",key:"releaseDate",type:"date"},
              {label:"Qty *",key:"qty",type:"number",placeholder:"จำนวน"},
              {label:"Lines",key:"lineCount",type:"number",placeholder:"จำนวน Line สินค้า"},
            ].map(f=>(
              <div key={f.key} style={{marginBottom:12}}>
                <label style={{display:"block",fontSize:12,fontWeight:700,marginBottom:5,color:"#374151"}}>{f.label}</label>
                <input value={form[f.key]} onChange={e=>setForm(p=>({...p,[f.key]:e.target.value}))}
                  type={f.type} placeholder={f.placeholder}
                  style={{width:"100%",padding:"9px 12px",border:"1.5px solid #e5e7eb",borderRadius:10,fontSize:13,outline:"none",boxSizing:"border-box"}}/>
              </div>
            ))}
            <div style={{marginBottom:12}}>
              <label style={{display:"block",fontSize:12,fontWeight:700,marginBottom:5,color:"#374151"}}>SubCon *</label>
              <select value={form.subConCode} onChange={e=>setForm(p=>({...p,subConCode:e.target.value}))}
                style={{width:"100%",padding:"9px 12px",border:"1.5px solid #e5e7eb",borderRadius:10,fontSize:13,outline:"none",boxSizing:"border-box"}}>
                <option value="">-- เลือก SubCon --</option>
                {subcons.map(s=><option key={s.subcon_code} value={s.subcon_code}>{s.subcon_code} — {s.subcon_name}</option>)}
              </select>
            </div>
            <div style={{display:"flex",gap:8,marginTop:16}}>
              <button onClick={()=>setShowCreate(false)} style={{flex:1,padding:"10px",background:"#e5e7eb",color:"#374151",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:13}}>ยกเลิก</button>
              <button onClick={createOBD} disabled={creating} style={{flex:2,padding:"10px",background:"#0f4bd7",color:"#fff",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:13,opacity:creating?.6:1}}>
                {creating?"กำลังสร้าง…":"✓ สร้าง OBD"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CREATE GROUP MODAL */}
      {showGroup && (
        <div style={{position:"fixed",inset:0,background:"rgba(10,20,50,.6)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,padding:16}}>
          <div style={{background:"#fff",borderRadius:16,padding:24,width:"100%",maxWidth:400,boxShadow:"0 20px 60px rgba(0,0,0,.3)"}}>
            <div style={{fontWeight:800,color:"#0a2a6e",fontSize:16,marginBottom:8}}>👥 สร้าง Group</div>
            <div style={{fontSize:12,color:"#6b7280",marginBottom:16}}>รวม {selectedObds.length} OBD — Qty รวม {selectedObds.reduce((s,id)=>{const o=obdList.find(x=>x.obd_no===id);return s+(o?.qty||0);},0)} units</div>
            <div style={{maxHeight:200,overflowY:"auto",marginBottom:16}}>
              {selectedObds.map(id=>{
                const o=obdList.find(x=>x.obd_no===id);
                return <div key={id} style={{padding:"6px 10px",background:"#f0f4fb",borderRadius:8,marginBottom:6,fontSize:12,fontFamily:"monospace",fontWeight:700}}>{id} <span style={{color:"#6b7280",fontWeight:400}}>({o?.qty} units)</span></div>;
              })}
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setShowGroup(false)} style={{flex:1,padding:"10px",background:"#e5e7eb",color:"#374151",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:13}}>ยกเลิก</button>
              <button onClick={createGroup} disabled={creating} style={{flex:2,padding:"10px",background:"#f59e0b",color:"#fff",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:13,opacity:creating?.6:1}}>
                {creating?"กำลังสร้าง…":"✓ สร้าง Group"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ── APP5 QUEUE OPERATOR ───────────────────────────────────────
function QueueApp({user, onBack}) {
  const [queueList, setQueueList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);
  const [calling, setCalling] = useState(null);
  const [voiceRate, setVoiceRate] = useState(0.75);

  const loadQueue = useCallback(async() => {
    const {data} = await supabase
      .from("queue_log")
      .select("*")
      .eq("slot_date", today())
      .order("booking_hour");
    if (data) setQueueList(data);
    setLoading(false);
  },[]);

  useEffect(()=>{ loadQueue(); },[loadQueue]);

  useEffect(()=>{
    const ch = supabase.channel("queue_live")
      .on("postgres_changes",{event:"*",schema:"public",table:"queue_log"},()=>loadQueue())
      .subscribe((s)=>{ if(s==="CHANNEL_ERROR"||s==="TIMED_OUT") console.warn("Realtime error:",s); });
    return ()=>supabase.removeChannel(ch);
  },[loadQueue]);

  const speak = (row, isRecall=false) => {
    if (!window.speechSynthesis) return;
    const plate = row.truck_plate||"";
    const spelled = plate.split("").map(c=>/[0-9A-Za-z]/.test(c)?c+" ":c).join("").replace(/-/g," ขีด ").trim();
    const dock = String(row.dock_no||"").split("").join(" ");
    const txt = isRecall
      ? "เรียกซ้ำ ทะเบียน "+spelled+" กรุณาเข้า ด็อก "+dock+" ด่วน"
      : "เรียนคุณ "+(row.driver_name||"")+" ทะเบียน "+spelled+" กรุณานำรถเข้า ด็อก "+dock+" ได้เลยครับ";
    window.speechSynthesis.cancel();
    let i=0;
    const say = () => {
      if(i>=2) return;
      const u = new SpeechSynthesisUtterance(txt);
      u.lang="th-TH"; u.rate=voiceRate; u.pitch=1.05; u.volume=1;
      u.onend=()=>{i++;if(i<2)setTimeout(say,1400);};
      window.speechSynthesis.speak(u); i++;
    };
    setTimeout(say,300);
  };

  const callQueue = async(q) => {
    setCalling(q.id); setMsg(null);
    await supabase.from("queue_log").update({queue_status:"CALLING",called_at:new Date().toISOString()}).eq("id",q.id);
    speak(q);
    setMsg({type:"ok",msg:"📢 เรียก "+q.truck_plate+" → Dock "+q.dock_no});
    setCalling(null);
  };

  const recallQueue = async(q) => {
    setCalling(q.id);
    await supabase.from("queue_log").update({recall_count:(q.recall_count||0)+1}).eq("id",q.id);
    speak(q, true);
    setCalling(null);
  };

  const completeQueue = async(q) => {
    setCalling(q.id);
    await supabase.from("queue_log").update({queue_status:"COMPLETED",completed_at:new Date().toISOString()}).eq("id",q.id);
    setCalling(null);
  };

  const skipQueue = async(q) => {
    setCalling(q.id);
    await supabase.from("queue_log").update({queue_status:"SKIPPED"}).eq("id",q.id);
    setCalling(null);
  };

  const STATUS_STYLE = {
    WAITING:{bg:"#f8fafc",border:"#e5e7eb"}, CALLING:{bg:"#fef3c7",border:"#fcd34d",anim:true},
    COMPLETED:{bg:"#f0fdf4",border:"#86efac"}, SKIPPED:{bg:"#f9fafb",border:"#e5e7eb"},
  };

  const waiting = queueList.filter(q=>["WAITING","REMINDER_SENT"].includes(q.queue_status));
  const calling_ = queueList.filter(q=>q.queue_status==="CALLING");
  const done = queueList.filter(q=>["COMPLETED","SKIPPED"].includes(q.queue_status));

  return (
    <div style={{minHeight:"100vh",background:"#f0f4fb"}}>
      <div style={{background:"linear-gradient(90deg,#78350f,#b45309,#f59e0b)",color:"#fff",padding:"12px 18px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
        <button onClick={onBack} style={{border:"1px solid rgba(255,255,255,.2)",background:"transparent",color:"#fff",borderRadius:8,padding:"4px 10px",cursor:"pointer",fontSize:12}}>← Back</button>
        <span style={{fontWeight:800,fontSize:15}}>🔔 Queue Operator</span>
        <div style={{display:"flex",alignItems:"center",gap:8,marginLeft:"auto",background:"rgba(255,255,255,.15)",borderRadius:8,padding:"4px 10px"}}>
          <span style={{fontSize:11,fontWeight:700}}>Speed TTS:</span>
          <input type="range" min="0.5" max="1.2" step="0.05" value={voiceRate} onChange={e=>setVoiceRate(+e.target.value)}
            style={{width:80}}/>
          <span style={{fontSize:11,fontWeight:700}}>{voiceRate}</span>
        </div>
      </div>

      <div style={{padding:14,maxWidth:900,margin:"0 auto"}}>
        {msg && <Alert type={msg.type} msg={msg.msg}/>}

        {/* SUMMARY */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:14}}>
          {[
            {label:"รอเรียก",val:waiting.length,bg:"#dbeafe",c:"#1d4ed8"},
            {label:"กำลังเรียก",val:calling_.length,bg:"#fef3c7",c:"#92400e"},
            {label:"เสร็จ",val:done.filter(q=>q.queue_status==="COMPLETED").length,bg:"#dcfce7",c:"#166534"},
            {label:"Skip",val:done.filter(q=>q.queue_status==="SKIPPED").length,bg:"#f3f4f6",c:"#374151"},
          ].map(s=>(
            <div key={s.label} style={{background:s.bg,borderRadius:12,padding:"12px 10px",textAlign:"center"}}>
              <div style={{fontSize:26,fontWeight:900,color:s.c}}>{s.val}</div>
              <div style={{fontSize:11,color:s.c,opacity:.8,fontWeight:700}}>{s.label}</div>
            </div>
          ))}
        </div>

        {loading ? <div style={{padding:40,textAlign:"center"}}><Spinner/></div> : (
          queueList.length===0 ? (
            <div style={{background:"#fff",borderRadius:14,padding:40,textAlign:"center",boxShadow:"0 4px 20px rgba(0,0,0,.07)"}}>
              <div style={{fontSize:32,marginBottom:8}}>🔔</div>
              <div style={{color:"#9ca3af",fontSize:13}}>ไม่มี Queue วันนี้</div>
              <div style={{fontSize:11,color:"#9ca3af",marginTop:4}}>Queue จะปรากฏเมื่อมี Booking ที่ Check-in แล้ว</div>
            </div>
          ) : (
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {queueList.map(q=>{
                const ss = STATUS_STYLE[q.queue_status]||STATUS_STYLE.WAITING;
                const isBusy = calling===q.id;
                return (
                  <div key={q.id} style={{background:ss.bg,border:`1.5px solid ${ss.border}`,borderRadius:12,padding:"12px 14px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",animation:ss.anim?"pulse 2s infinite":"none"}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                        <span style={{fontFamily:"monospace",fontWeight:900,fontSize:14}}>{q.truck_plate||"—"}</span>
                        <span style={{fontWeight:700,color:"#0a2a6e"}}>D{q.dock_no}</span>
                        <span style={{fontSize:12,color:"#6b7280"}}>{String(q.booking_hour||"").slice(0,5)}</span>
                        {q.recall_count>0&&<span style={{fontSize:10,background:"#fee2e2",color:"#991b1b",borderRadius:999,padding:"1px 6px",fontWeight:700}}>เรียกซ้ำ {q.recall_count}×</span>}
                      </div>
                      <div style={{fontSize:11,color:"#6b7280",marginTop:2}}>{q.driver_name} • {q.subcon_name}</div>
                    </div>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                      <StatusBadge status={q.queue_status} size={10}/>
                      {["WAITING","REMINDER_SENT"].includes(q.queue_status) && <>
                        <button onClick={()=>callQueue(q)} disabled={isBusy} style={{background:"#f59e0b",color:"#fff",border:"none",borderRadius:7,padding:"5px 10px",fontWeight:700,cursor:"pointer",fontSize:11}}>📢 เรียก</button>
                        <button onClick={()=>skipQueue(q)} disabled={isBusy} style={{background:"#e5e7eb",color:"#374151",border:"none",borderRadius:7,padding:"5px 10px",fontWeight:700,cursor:"pointer",fontSize:11}}>Skip</button>
                      </>}
                      {q.queue_status==="CALLING" && <>
                        <button onClick={()=>recallQueue(q)} disabled={isBusy} style={{background:"#ea580c",color:"#fff",border:"none",borderRadius:7,padding:"5px 10px",fontWeight:700,cursor:"pointer",fontSize:11}}>🔁 เรียกซ้ำ</button>
                        <button onClick={()=>completeQueue(q)} disabled={isBusy} style={{background:"#16a34a",color:"#fff",border:"none",borderRadius:7,padding:"5px 10px",fontWeight:700,cursor:"pointer",fontSize:11}}>✓ Done</button>
                      </>}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>
    </div>
  );
}


// ── APP7 SUPPLIER PORTAL ─────────────────────────────────────
function SupplierApp({user, onBack}) {
  const [tab, setTab] = useState("create");
  const [slots, setSlots] = useState([]);
  const [slotDate, setSlotDate] = useState(today());
  const [slotLoading, setSlotLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [myAsns, setMyAsns] = useState([]);
  const [msg, setMsg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [truck, setTruck] = useState({shipDate:today(),truckType:"",truckPlate:"",driverName:"",driverPhone:"",remarks:""});
  const [invoices, setInvoices] = useState([{invoiceNo:"",invoiceDate:today(),poNo:"",open:true,items:[{itemCode:"",itemName:"",unit:"",qtyShipped:""}]}]);

  const DOCKS = [1,2,3,4,5];
  const days = Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()+i);return d.toISOString().slice(0,10);});

  const loadSlots = useCallback(async(date)=>{
    setSlotLoading(true); setSelected(null);
    const {data} = await supabase.from("dock_slots").select("*").eq("slot_date",date).order("slot_hour").order("dock_no");
    setSlots(data||[]); setSlotLoading(false);
  },[]);

  useEffect(()=>{ loadSlots(slotDate); },[slotDate,loadSlots]);
  useEffect(()=>{ if(tab==="myasn") loadMyAsns(); },[tab]);

  const loadMyAsns = async()=>{
    const {data} = await supabase.from("asn_header").select("*")
      .eq("supplier_code", user.subcon_code||"")
      .order("created_at",{ascending:false}).limit(50);
    setMyAsns(data||[]);
  };

  const hours = [...new Set(slots.map(s=>String(s.slot_hour).slice(0,5)))].sort();
  const slotMap = {};
  slots.forEach(s=>{ slotMap[String(s.slot_hour).slice(0,5)+"_"+s.dock_no]=s; });

  const addInvoice = ()=>{
    setInvoices(p=>[...p.map(i=>({...i,open:false})),{invoiceNo:"",invoiceDate:today(),poNo:"",open:true,items:[{itemCode:"",itemName:"",unit:"",qtyShipped:""}]}]);
  };
  const removeInvoice = (i)=>{ if(invoices.length>1) setInvoices(p=>p.filter((_,idx)=>idx!==i)); };
  const toggleInv = (i)=>{ setInvoices(p=>p.map((inv,idx)=>({...inv,open:idx===i?!inv.open:inv.open}))); };
  const updateInv = (i,field,val)=>{ setInvoices(p=>p.map((inv,idx)=>idx===i?{...inv,[field]:val}:inv)); };
  const addItem = (i)=>{ setInvoices(p=>p.map((inv,idx)=>idx===i?{...inv,items:[...inv.items,{itemCode:"",itemName:"",unit:"",qtyShipped:""}]}:inv)); };
  const removeItem = (ii,ki)=>{ setInvoices(p=>p.map((inv,idx)=>idx===ii?{...inv,items:inv.items.filter((_,k)=>k!==ki)}:inv)); };
  const updateItem = (ii,ki,field,val)=>{ setInvoices(p=>p.map((inv,idx)=>idx===ii?{...inv,items:inv.items.map((it,k)=>k===ki?{...it,[field]:val}:it)}:inv)); };

  const submitASN = async()=>{
    if(!selected) return setMsg({type:"err",msg:"กรุณาเลือก Slot ก่อน"});
    if(!truck.truckPlate||!truck.driverName||!truck.driverPhone) return setMsg({type:"err",msg:"กรุณากรอกข้อมูลรถให้ครบ"});
    const badInv = invoices.find(inv=>!inv.invoiceNo||!inv.invoiceDate);
    if(badInv) return setMsg({type:"err",msg:"กรุณากรอก Invoice No และ Date ให้ครบ"});
    const badItem = invoices.find(inv=>inv.items.find(it=>!it.itemCode||!it.qtyShipped));
    if(badItem) return setMsg({type:"err",msg:"กรุณากรอก Item Code และ Qty ให้ครบ"});

    setSaving(true); setMsg(null);
    const sc = user.subcon_code||"SUP";
    const asnNo = "ASN-"+sc+"-"+Date.now().toString().slice(-8);
    const bkId  = "IN"+String(selected.dock_no).padStart(2,"0")+sc+Date.now().toString().slice(-8);
    const totalQty = invoices.reduce((s,inv)=>s+inv.items.reduce((ss,it)=>ss+Number(it.qtyShipped||0),0),0);
    const totalLines = invoices.reduce((s,inv)=>s+inv.items.length,0);

    // insert ASN header
    const {error:aErr} = await supabase.from("asn_header").insert({
      asn_no:asnNo, supplier_code:user.subcon_code||"",
      supplier_name:user.full_name||"",
      ship_date:truck.shipDate, truck_type:truck.truckType,
      truck_plate:truck.truckPlate.toUpperCase(),
      driver_name:truck.driverName, driver_phone:truck.driverPhone,
      invoice_count:invoices.length, total_lines:totalLines, total_qty:totalQty,
      booking_id:bkId, status:"BOOKED", created_by:user.username,
      remarks:truck.remarks||"",
    });
    if(aErr){setMsg({type:"err",msg:aErr.message});setSaving(false);return;}

    // insert invoices
    for(let i=0;i<invoices.length;i++){
      const inv=invoices[i];
      const invQty=inv.items.reduce((s,it)=>s+Number(it.qtyShipped||0),0);
      await supabase.from("asn_invoice").insert({
        asn_no:asnNo, invoice_seq:i+1,
        invoice_no:inv.invoiceNo, invoice_date:inv.invoiceDate,
        po_no:inv.poNo||"", invoice_qty:invQty,
        invoice_lines:inv.items.length,
      });
      // insert items
      for(let k=0;k<inv.items.length;k++){
        const it=inv.items[k];
        await supabase.from("asn_detail").insert({
          asn_no:asnNo, invoice_no:inv.invoiceNo, line_no:k+1,
          item_code:it.itemCode, item_name:it.itemName||"",
          unit:it.unit||"", qty_shipped:Number(it.qtyShipped||0), qty_received:0,
        });
      }
    }

    // insert inbound booking + update slot
    await supabase.from("inbound_bookings").insert({
      booking_id:bkId, asn_no:asnNo, supplier_code:user.subcon_code||"",
      booking_date:slotDate, booking_hour:selected.slot_hour,
      dock_no:selected.dock_no, slot_key:selected.slot_key,
      truck_type:truck.truckType, truck_plate:truck.truckPlate.toUpperCase(),
      driver_name:truck.driverName, driver_phone:truck.driverPhone,
      status:"RESERVED", created_by:user.username,
    });
    await supabase.from("dock_slots").update({status:"BOOKED",booking_id:bkId}).eq("slot_key",selected.slot_key);

    setMsg({type:"ok",msg:"✅ ASN "+asnNo+" และ Booking "+bkId+" สำเร็จ!"});
    setSelected(null); setShowForm(false);
    setTruck({shipDate:today(),truckType:"",truckPlate:"",driverName:"",driverPhone:"",remarks:""});
    setInvoices([{invoiceNo:"",invoiceDate:today(),poNo:"",open:true,items:[{itemCode:"",itemName:"",unit:"",qtyShipped:""}]}]);
    setSaving(false);
    loadSlots(slotDate);
  };

  return (
    <div style={{minHeight:"100vh",background:"#f0f4fb"}}>
      <div style={{background:"linear-gradient(90deg,#065f46,#059669)",color:"#fff",padding:"12px 18px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
        <button onClick={onBack} style={{border:"1px solid rgba(255,255,255,.2)",background:"transparent",color:"#fff",borderRadius:8,padding:"4px 10px",cursor:"pointer",fontSize:12}}>← Back</button>
        <span style={{fontWeight:800,fontSize:15}}>📦 Supplier Portal</span>
        <div style={{display:"flex",gap:4,background:"rgba(255,255,255,.15)",borderRadius:8,padding:3,marginLeft:8}}>
          {["create","myasn"].map(t=>(
            <button key={t} onClick={()=>setTab(t)} style={{border:"none",borderRadius:6,padding:"4px 12px",fontWeight:700,fontSize:12,cursor:"pointer",background:tab===t?"#fff":"transparent",color:tab===t?"#065f46":"rgba(255,255,255,.8)"}}>
              {t==="create"?"➕ สร้าง ASN":"📋 My ASN"}
            </button>
          ))}
        </div>
      </div>

      <div style={{padding:14,maxWidth:960,margin:"0 auto"}}>
        {msg && <Alert type={msg.type} msg={msg.msg}/>}

        {tab==="create" && <>
          {/* SLOT */}
          <div style={{background:"#fff",borderRadius:14,padding:14,marginBottom:12,boxShadow:"0 4px 20px rgba(0,0,0,.07)"}}>
            <div style={{fontWeight:800,color:"#0a2a6e",fontSize:14,marginBottom:10}}>📅 เลือกวัน & Slot</div>
            <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap"}}>
              {days.map(d=>{
                const dt=new Date(d);
                return <button key={d} onClick={()=>setSlotDate(d)} style={{border:"1.5px solid",borderColor:slotDate===d?"#059669":"#e5e7eb",borderRadius:9,padding:"6px 10px",fontSize:11,fontWeight:700,cursor:"pointer",background:slotDate===d?"#059669":"#fff",color:slotDate===d?"#fff":"#374151",textAlign:"center",minWidth:60}}>
                  <div style={{fontSize:10,opacity:.8}}>{d===today()?"วันนี้":d===days[1]?"พรุ่งนี้":dt.toLocaleDateString("th-TH",{weekday:"short"})}</div>
                  <div>{dt.toLocaleDateString("th-TH",{day:"numeric",month:"short"})}</div>
                </button>;
              })}
            </div>
            {slotLoading ? <div style={{padding:20,textAlign:"center"}}><Spinner/></div> : (
              <div style={{overflowX:"auto"}}>
                <table style={{borderCollapse:"separate",borderSpacing:3,minWidth:400}}>
                  <thead><tr>
                    <th style={{background:"#065f46",color:"#fff",padding:"7px 10px",borderRadius:5,fontSize:11,textAlign:"center"}}>เวลา</th>
                    {DOCKS.map(d=><th key={d} style={{background:"#065f46",color:"#fff",padding:"7px 8px",borderRadius:5,fontSize:11,textAlign:"center"}}>Dock {d}</th>)}
                  </tr></thead>
                  <tbody>{hours.map(h=>(
                    <tr key={h}>
                      <td style={{padding:"5px 8px",textAlign:"center",fontWeight:700,fontSize:12,background:"#f8fafc",borderRadius:5}}>{h}</td>
                      {DOCKS.map(d=>{
                        const s=slotMap[h+"_"+d];
                        if(!s) return <td key={d} style={{padding:3}}><div style={{background:"#f8fafc",borderRadius:6,padding:"6px 4px",textAlign:"center",color:"#9ca3af",fontSize:10}}>—</div></td>;
                        const isSel=selected?.slot_key===s.slot_key;
                        const isBooked=s.status!=="AVAILABLE";
                        return <td key={d} style={{padding:3}}>
                          <button disabled={isBooked} onClick={()=>setSelected(isSel?null:s)}
                            style={{width:"100%",padding:"6px 4px",borderRadius:6,border:"none",background:isSel?"#fde68a":isBooked?"#fee2e2":"#d1fae5",color:isSel?"#92400e":isBooked?"#991b1b":"#065f46",fontWeight:700,fontSize:10,cursor:isBooked?"not-allowed":"pointer",transform:isSel?"scale(1.05)":"none"}}>
                            {isBooked?"FULL":"FREE"}
                          </button>
                        </td>;
                      })}
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            {selected && !showForm && (
              <div style={{marginTop:10,padding:"10px 14px",background:"#ecfdf5",border:"1.5px solid #6ee7b7",borderRadius:9,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
                <span style={{fontWeight:700,color:"#065f46"}}>✅ Dock {selected.dock_no} • {String(selected.slot_hour).slice(0,5)} • {slotDate}</span>
                <button onClick={()=>setShowForm(true)} style={{background:"#059669",color:"#fff",border:"none",borderRadius:8,padding:"6px 14px",fontWeight:700,cursor:"pointer",fontSize:12}}>กรอกข้อมูล ASN →</button>
              </div>
            )}
          </div>

          {/* ASN FORM */}
          {showForm && (
            <div style={{background:"#fff",borderRadius:14,padding:16,marginBottom:12,boxShadow:"0 4px 20px rgba(0,0,0,.07)"}}>
              <div style={{fontWeight:800,color:"#0a2a6e",fontSize:14,marginBottom:12}}>🚛 ข้อมูลรถ (ทั้งคัน)</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
                {[{l:"Ship Date *",k:"shipDate",t:"date"},{l:"ประเภทรถ",k:"truckType",p:"6 ล้อ, เทรลเลอร์"},{l:"ทะเบียนรถ *",k:"truckPlate",p:"80-1234"},{l:"ชื่อคนขับ *",k:"driverName"},{l:"เบอร์โทร *",k:"driverPhone",t:"tel"},{l:"Remarks",k:"remarks"}].map(f=>(
                  <div key={f.k}>
                    <label style={{display:"block",fontSize:11,fontWeight:700,marginBottom:4,color:"#374151"}}>{f.l}</label>
                    <input value={truck[f.k]} onChange={e=>setTruck(p=>({...p,[f.k]:e.target.value}))} type={f.t||"text"} placeholder={f.p}
                      style={{width:"100%",padding:"8px 10px",border:"1.5px solid #e5e7eb",borderRadius:9,fontSize:12,outline:"none",boxSizing:"border-box"}}/>
                  </div>
                ))}
              </div>

              <div style={{fontWeight:800,color:"#0a2a6e",fontSize:14,marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span>📄 Invoices ({invoices.length})</span>
                <button onClick={addInvoice} style={{background:"#e5e7eb",color:"#374151",border:"none",borderRadius:7,padding:"4px 10px",fontWeight:700,cursor:"pointer",fontSize:11}}>+ Invoice</button>
              </div>
              {invoices.map((inv,ii)=>(
                <div key={ii} style={{border:"1.5px solid #e5e7eb",borderRadius:10,marginBottom:8,overflow:"hidden"}}>
                  <div onClick={()=>toggleInv(ii)} style={{background:"#f8fafc",padding:"8px 12px",display:"flex",alignItems:"center",gap:8,cursor:"pointer"}}>
                    <span style={{background:"#065f46",color:"#fff",borderRadius:"50%",width:20,height:20,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,flexShrink:0}}>{ii+1}</span>
                    <span style={{fontWeight:700,fontSize:13,flex:1}}>{inv.invoiceNo||"Invoice "+(ii+1)}</span>
                    <span style={{fontSize:11,color:"#6b7280"}}>{inv.items.length} รายการ</span>
                    {invoices.length>1 && <button onClick={e=>{e.stopPropagation();removeInvoice(ii);}} style={{background:"#fee2e2",color:"#991b1b",border:"none",borderRadius:5,padding:"2px 7px",cursor:"pointer",fontSize:11,fontWeight:700}}>✕</button>}
                    <span style={{fontSize:14,color:"#9ca3af"}}>{inv.open?"▲":"▼"}</span>
                  </div>
                  {inv.open && <div style={{padding:12}}>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>
                      {[{l:"Invoice No *",k:"invoiceNo"},{l:"Invoice Date *",k:"invoiceDate",t:"date"},{l:"PO No",k:"poNo"}].map(f=>(
                        <div key={f.k}>
                          <label style={{display:"block",fontSize:11,fontWeight:700,marginBottom:3,color:"#374151"}}>{f.l}</label>
                          <input value={inv[f.k]} onChange={e=>updateInv(ii,f.k,e.target.value)} type={f.t||"text"}
                            style={{width:"100%",padding:"7px 9px",border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:12,outline:"none",boxSizing:"border-box"}}/>
                        </div>
                      ))}
                    </div>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                      <thead><tr style={{background:"#f8fafc"}}>
                        <th style={{padding:"6px 8px",textAlign:"left",fontWeight:700}}>#</th>
                        <th style={{padding:"6px 8px",textAlign:"left",fontWeight:700}}>Item Code *</th>
                        <th style={{padding:"6px 8px",textAlign:"left",fontWeight:700}}>Item Name</th>
                        <th style={{padding:"6px 8px",textAlign:"left",fontWeight:700}}>Unit</th>
                        <th style={{padding:"6px 8px",textAlign:"left",fontWeight:700}}>Qty *</th>
                        <th style={{padding:"6px 8px"}}></th>
                      </tr></thead>
                      <tbody>{inv.items.map((it,ki)=>(
                        <tr key={ki}>
                          <td style={{padding:"4px 8px",color:"#9ca3af"}}>{ki+1}</td>
                          {["itemCode","itemName","unit"].map(f=>(
                            <td key={f} style={{padding:"4px 3px"}}><input value={it[f]} onChange={e=>updateItem(ii,ki,f,e.target.value)}
                              style={{width:"100%",padding:"5px 7px",border:"1px solid #e5e7eb",borderRadius:6,fontSize:11,outline:"none"}}/></td>
                          ))}
                          <td style={{padding:"4px 3px",width:70}}><input value={it.qtyShipped} onChange={e=>updateItem(ii,ki,"qtyShipped",e.target.value)} type="number"
                            style={{width:"100%",padding:"5px 7px",border:"1px solid #e5e7eb",borderRadius:6,fontSize:11,outline:"none"}}/></td>
                          <td style={{padding:"4px 3px"}}><button onClick={()=>removeItem(ii,ki)} style={{border:"none",background:"none",cursor:"pointer",color:"#9ca3af",fontSize:16}}>✕</button></td>
                        </tr>
                      ))}</tbody>
                    </table>
                    <button onClick={()=>addItem(ii)} style={{marginTop:6,background:"#e5e7eb",color:"#374151",border:"none",borderRadius:7,padding:"4px 10px",fontWeight:700,cursor:"pointer",fontSize:11}}>+ สินค้า</button>
                  </div>}
                </div>
              ))}
              <div style={{display:"flex",gap:8,marginTop:12}}>
                <button onClick={()=>{setShowForm(false);setMsg(null);}} style={{flex:1,padding:"10px",background:"#e5e7eb",color:"#374151",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:13}}>ยกเลิก</button>
                <button onClick={submitASN} disabled={saving} style={{flex:2,padding:"10px",background:"#059669",color:"#fff",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:13,opacity:saving?.6:1}}>
                  {saving?"กำลังบันทึก…":"✓ สร้าง ASN & Booking"}
                </button>
              </div>
            </div>
          )}
        </>}

        {tab==="myasn" && (
          <div style={{background:"#fff",borderRadius:14,overflow:"hidden",boxShadow:"0 4px 20px rgba(0,0,0,.07)"}}>
            <div style={{padding:"12px 16px",borderBottom:"1px solid #e5e7eb",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontWeight:800,color:"#0a2a6e",fontSize:14}}>My ASN History</div>
              <button onClick={loadMyAsns} style={{background:"#e5e7eb",color:"#374151",border:"none",borderRadius:7,padding:"4px 10px",cursor:"pointer",fontSize:11,fontWeight:700}}>↻</button>
            </div>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead><tr style={{background:"#f8fafc"}}>
                  {["ASN No","Booking ID","Ship Date","Plate","Invoices","Qty","Status"].map(h=>(
                    <th key={h} style={{padding:"8px 10px",textAlign:"left",fontWeight:700,color:"#374151",whiteSpace:"nowrap"}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {myAsns.length===0 ? <tr><td colSpan={7} style={{padding:24,textAlign:"center",color:"#9ca3af"}}>ยังไม่มี ASN</td></tr>
                  : myAsns.map(a=>(
                    <tr key={a.asn_no} style={{borderBottom:"1px solid #f3f4f6"}}>
                      <td style={{padding:"8px 10px",fontFamily:"monospace",fontSize:10,fontWeight:700}}>{a.asn_no}</td>
                      <td style={{padding:"8px 10px",fontFamily:"monospace",fontSize:10}}>{a.booking_id||"—"}</td>
                      <td style={{padding:"8px 10px",color:"#6b7280"}}>{a.ship_date}</td>
                      <td style={{padding:"8px 10px",fontFamily:"monospace",fontWeight:700}}>{a.truck_plate}</td>
                      <td style={{padding:"8px 10px",textAlign:"center"}}>{a.invoice_count}</td>
                      <td style={{padding:"8px 10px",textAlign:"center",fontWeight:700}}>{a.total_qty}</td>
                      <td style={{padding:"8px 10px"}}><StatusBadge status={a.status} size={10}/></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── APP8 INBOUND GATE ─────────────────────────────────────────
function InboundApp({user, onBack}) {
  const [scanId, setScanId] = useState("");
  const [found, setFound] = useState(null);
  const [asn, setAsn] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [details, setDetails] = useState([]);
  const [activeList, setActiveList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);
  const [acting, setActing] = useState(false);

  const loadActive = useCallback(async()=>{
    const {data} = await supabase.from("inbound_bookings").select("*")
      .in("status",["RESERVED","ON_YARD","CALLED_TO_DOCK","TRUCK_DOCKED","UNLOADING","GR_PENDING"])
      .order("booking_hour");
    setActiveList(data||[]);
  },[]);

  useEffect(()=>{ loadActive(); },[loadActive]);
  useEffect(()=>{
    const ch = supabase.channel("inbound_live")
      .on("postgres_changes",{event:"*",schema:"public",table:"inbound_bookings"},()=>loadActive())
      .subscribe((s)=>{ if(s==="CHANNEL_ERROR"||s==="TIMED_OUT") console.warn("Realtime error:",s); });
    return ()=>supabase.removeChannel(ch);
  },[loadActive]);

  const handleScan = async(e)=>{
    e.preventDefault(); setLoading(true); setMsg(null); setFound(null);
    const {data:bk} = await supabase.from("inbound_bookings").select("*").eq("booking_id",scanId.trim()).single();
    if(!bk){setFound("not_found");setLoading(false);return;}
    const {data:asnData} = await supabase.from("asn_header").select("*").eq("asn_no",bk.asn_no).single();
    const {data:invData} = await supabase.from("asn_invoice").select("*").eq("asn_no",bk.asn_no).order("invoice_seq");
    const {data:dtlData} = await supabase.from("asn_detail").select("*").eq("asn_no",bk.asn_no).order("line_no");
    setFound(bk); setAsn(asnData||{}); setInvoices(invData||[]); setDetails(dtlData||[]);
    setLoading(false);
  };

  const doAction = async(bookingId, newStatus)=>{
    setActing(true); setMsg(null);
    const update={status:newStatus,updated_at:new Date().toISOString()};
    if(newStatus==="ON_YARD") update.check_in_time=new Date().toISOString();
    const {error} = await supabase.from("inbound_bookings").update(update).eq("booking_id",bookingId);
    if(newStatus==="COMPLETED"){
      await supabase.from("asn_header").update({status:"RECEIVED"}).eq("asn_no",found.asn_no);
      if(found.slot_key) await supabase.from("dock_slots").update({status:"AVAILABLE",booking_id:null}).eq("slot_key",found.slot_key);
    }
    if(error) setMsg({type:"err",msg:error.message});
    else{
      setMsg({type:"ok",msg:"✅ อัปเดตสถานะเป็น "+newStatus+" สำเร็จ"});
      setFound(p=>({...p,...update}));
      loadActive();
    }
    setActing(false);
  };

  const ACTIONS = {
    RESERVED:{label:"✓ Check-in เข้า Yard",next:"ON_YARD",color:"#059669"},
    ON_YARD:{label:"📢 Call to Dock",next:"CALLED_TO_DOCK",color:"#f59e0b"},
    CALLED_TO_DOCK:{label:"🚛 Confirm Docked",next:"TRUCK_DOCKED",color:"#7c3aed"},
    TRUCK_DOCKED:{label:"⬇ Start Unloading",next:"UNLOADING",color:"#1d4ed8"},
    UNLOADING:{label:"✓ ปิด Booking (GR ใน WMS)",next:"COMPLETED",color:"#16a34a"},
  };

  const STATUS_STYLE = {
    RESERVED:{bg:"#f0fdf4",bl:"#6ee7b7"}, ON_YARD:{bg:"#fef9c3",bl:"#fcd34d"},
    CALLED_TO_DOCK:{bg:"#ffedd5",bl:"#fdba74"}, TRUCK_DOCKED:{bg:"#ede9fe",bl:"#c4b5fd"},
    UNLOADING:{bg:"#dbeafe",bl:"#93c5fd"}, COMPLETED:{bg:"#f0fdf4",bl:"#86efac"},
  };

  return (
    <div style={{minHeight:"100vh",background:"#f0f4fb"}}>
      <div style={{background:"linear-gradient(90deg,#047857,#059669)",color:"#fff",padding:"12px 18px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
        <button onClick={onBack} style={{border:"1px solid rgba(255,255,255,.2)",background:"transparent",color:"#fff",borderRadius:8,padding:"4px 10px",cursor:"pointer",fontSize:12}}>← Back</button>
        <span style={{fontWeight:800,fontSize:15}}>🏭 Inbound Gate & WH</span>
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:6}}>
          <span style={{width:8,height:8,borderRadius:"50%",background:"#22c55e",display:"inline-block",boxShadow:"0 0 0 3px rgba(34,197,94,.25)"}}/>
          <span style={{fontSize:11,fontWeight:700,color:"#86efac"}}>LIVE</span>
        </div>
      </div>

      <div style={{padding:14,maxWidth:900,margin:"0 auto"}}>
        {msg && <Alert type={msg.type} msg={msg.msg}/>}

        {/* SCAN */}
        <div style={{background:"#fff",borderRadius:14,padding:14,marginBottom:12,boxShadow:"0 4px 20px rgba(0,0,0,.07)"}}>
          <div style={{fontWeight:800,color:"#0a2a6e",fontSize:14,marginBottom:10}}>🔍 Scan Inbound Booking ID</div>
          <form onSubmit={handleScan} style={{display:"flex",gap:8}}>
            <input value={scanId} onChange={e=>setScanId(e.target.value)} placeholder="IN01ABC... หรือ Booking ID" autoCapitalize="characters"
              style={{flex:1,padding:"11px 14px",border:"2.5px solid #059669",borderRadius:10,fontSize:13,fontWeight:700,fontFamily:"monospace",letterSpacing:2,outline:"none"}}/>
            <button type="submit" disabled={loading} style={{background:"#059669",color:"#fff",border:"none",borderRadius:10,padding:"0 16px",fontWeight:700,cursor:"pointer",fontSize:13}}>ค้นหา</button>
            <button type="button" onClick={()=>{setScanId("");setFound(null);setMsg(null);}} style={{background:"#e5e7eb",color:"#374151",border:"none",borderRadius:10,padding:"0 12px",fontWeight:700,cursor:"pointer",fontSize:13}}>✕</button>
          </form>

          {found==="not_found" && <div style={{marginTop:10,padding:"8px 12px",background:"#fee2e2",borderRadius:8,color:"#991b1b",fontWeight:700,fontSize:13}}>❌ ไม่พบ Booking ID นี้</div>}

          {found && found!=="not_found" && (
            <div style={{marginTop:12,padding:14,background:STATUS_STYLE[found.status]?.bg||"#f8fafc",border:`1.5px solid ${STATUS_STYLE[found.status]?.bl||"#e5e7eb"}`,borderRadius:10}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8,marginBottom:10}}>
                <div>
                  <div style={{fontFamily:"monospace",fontSize:15,fontWeight:900,color:"#0a2a6e"}}>{found.booking_id}</div>
                  <div style={{fontWeight:700,color:"#374151",marginTop:2}}>{asn?.supplier_name||found.supplier_code}</div>
                  <div style={{fontSize:11,color:"#6b7280",marginTop:1}}>ASN: {found.asn_no} • Dock {found.dock_no} • {String(found.booking_hour||"").slice(0,5)}</div>
                  <div style={{fontSize:11,color:"#6b7280"}}>{found.truck_plate} • {found.driver_name} • {found.driver_phone}</div>
                  {found.check_in_time && <div style={{fontSize:11,color:"#16a34a",fontWeight:700}}>Check-in: {new Date(found.check_in_time).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit"})}</div>}
                </div>
                <StatusBadge status={found.status} size={11}/>
              </div>

              {/* Invoices */}
              {invoices.length>0 && <div style={{marginBottom:10}}>
                <div style={{fontSize:11,fontWeight:700,color:"#374151",marginBottom:6}}>{invoices.length} Invoice • รวม {asn?.total_qty||0} หน่วย</div>
                {invoices.map(inv=>(
                  <div key={inv.id} style={{background:"rgba(255,255,255,.7)",borderRadius:7,padding:"6px 10px",marginBottom:4,fontSize:11}}>
                    <span style={{fontWeight:700}}>{inv.invoice_no}</span>
                    {inv.po_no && <span style={{color:"#6b7280",marginLeft:8}}>PO: {inv.po_no}</span>}
                    <span style={{float:"right",fontWeight:700,color:"#065f46"}}>{inv.invoice_qty} หน่วย</span>
                  </div>
                ))}
              </div>}

              <div style={{display:"flex",gap:8,marginBottom:8}}>
                <button onClick={()=>printInboundSlip(found,asn,invoices)}
                  style={{flex:1,padding:"8px",background:"#e5e7eb",color:"#374151",border:"none",borderRadius:8,fontWeight:700,cursor:"pointer",fontSize:12}}>
                  🖨 Print Slip
                </button>
              </div>
              {ACTIONS[found.status] && (
                <button onClick={()=>doAction(found.booking_id,ACTIONS[found.status].next)} disabled={acting}
                  style={{width:"100%",padding:"10px",background:ACTIONS[found.status].color,color:"#fff",border:"none",borderRadius:9,fontWeight:700,cursor:"pointer",fontSize:13,opacity:acting?.6:1}}>
                  {ACTIONS[found.status].label}
                </button>
              )}
              {found.status==="UNLOADING" && <div style={{marginBottom:8,padding:"8px 10px",background:"#fef3c7",borderRadius:7,fontSize:11,color:"#92400e",fontWeight:700}}>⚠️ GR บันทึกใน WMS แยกต่างหาก — กดปิด Booking หลัง WMS เสร็จแล้ว</div>}
            </div>
          )}
        </div>

        {/* ACTIVE LIST */}
        <div style={{background:"#fff",borderRadius:14,padding:14,boxShadow:"0 4px 20px rgba(0,0,0,.07)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <div style={{fontWeight:800,color:"#0a2a6e",fontSize:14}}>🚛 Inbound Active</div>
            <button onClick={loadActive} style={{background:"#e5e7eb",color:"#374151",border:"none",borderRadius:7,padding:"4px 10px",cursor:"pointer",fontSize:11,fontWeight:700}}>↻</button>
          </div>
          {activeList.length===0 ? <p style={{textAlign:"center",color:"#9ca3af",padding:20,fontSize:12}}>ไม่มี Inbound Active</p>
          : activeList.map(b=>{
            const ss=STATUS_STYLE[b.status]||{bg:"#f8fafc",bl:"#e5e7eb"};
            const act=ACTIONS[b.status];
            return <div key={b.booking_id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 12px",borderRadius:10,gap:8,flexWrap:"wrap",background:ss.bg,borderLeft:"3px solid",borderLeftColor:ss.bl,marginBottom:6}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                  <span style={{fontFamily:"monospace",fontWeight:900,fontSize:12}}>{b.truck_plate||"—"}</span>
                  <span style={{fontSize:11,color:"#6b7280"}}>D{b.dock_no} • {String(b.booking_hour||"").slice(0,5)}</span>
                  {b.check_in_time && <span style={{fontSize:11,color:"#16a34a",fontWeight:700}}>✓ {new Date(b.check_in_time).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit"})}</span>}
                </div>
                <div style={{fontSize:10,color:"#9ca3af",fontFamily:"monospace",marginTop:1}}>{b.booking_id}</div>
              </div>
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                <StatusBadge status={b.status}/>
                {act && <button onClick={()=>doAction(b.booking_id,act.next)} style={{background:act.color,color:"#fff",border:"none",borderRadius:7,padding:"4px 10px",fontWeight:700,cursor:"pointer",fontSize:11}}>{act.label}</button>}
              </div>
            </div>;
          })}
        </div>
      </div>
    </div>
  );
}

// ── PLACEHOLDER APP ───────────────────────────────────────────
function PlaceholderApp({app, onBack}) {
  return (
    <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"#f0f4fb",gap:12}}>
      <div style={{fontSize:48}}>{app?.icon}</div>
      <div style={{fontSize:20,fontWeight:800,color:"#0a2a6e"}}>{app?.name}</div>
      <div style={{fontSize:13,color:"#6b7280",maxWidth:300,textAlign:"center"}}>กำลัง build — จะพร้อมเร็วๆ นี้</div>
      <button onClick={onBack} style={{marginTop:8,background:"#0f4bd7",color:"#fff",border:"none",borderRadius:10,padding:"9px 20px",fontWeight:700,cursor:"pointer",fontSize:13}}>← กลับ</button>
    </div>
  );
}

// ── ADMIN PANEL ──────────────────────────────────────────────
function AdminApp({user, onBack}) {
  const [tab, setTab] = useState("users");
  const [users, setUsers] = useState([]);
  const [config, setConfig] = useState([]);
  const [subcons, setSubcons] = useState([]);
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({username:"",fullName:"",role:"cs",subconCode:"",password:""});
  const [saving, setSaving] = useState(false);

  const loadAll = useCallback(async()=>{
    setLoading(true);
    const [u,c,s] = await Promise.all([
      supabase.from("users").select("*").order("role").order("username"),
      supabase.from("config").select("*").order("key"),
      supabase.from("subcon_master").select("*").order("subcon_code"),
    ]);
    if(u.data) setUsers(u.data);
    if(c.data) setConfig(c.data);
    if(s.data) setSubcons(s.data);
    setLoading(false);
  },[]);

  useEffect(()=>{ loadAll(); },[loadAll]);

  const toggleUser = async(id, active)=>{
    await supabase.from("users").update({active:!active}).eq("id",id);
    loadAll();
  };

  const updateConfig = async(key, value)=>{
    await supabase.from("config").update({value}).eq("key",key);
    setMsg({type:"ok",msg:"✅ อัปเดต "+key+" แล้ว"});
    setTimeout(()=>setMsg(null),2000);
  };

  const createUser = async()=>{
    if(!newUser.username||!newUser.fullName||!newUser.password) return setMsg({type:"err",msg:"กรุณากรอกให้ครบ"});
    setSaving(true);
    const {error} = await supabase.from("users").insert({
      username: newUser.username.trim(),
      password_hash: newUser.password, // TODO: hash จริง
      full_name: newUser.fullName,
      role: newUser.role,
      subcon_code: newUser.subconCode||null,
      active: true,
    });
    if(error) setMsg({type:"err",msg:error.message});
    else { setMsg({type:"ok",msg:"✅ สร้าง user สำเร็จ"}); setShowAddUser(false); setNewUser({username:"",fullName:"",role:"cs",subconCode:"",password:""}); loadAll(); }
    setSaving(false);
  };

  const generateSlots = async()=>{
    setSaving(true); setMsg(null);
    const docks = 5;
    const hours = Array.from({length:13},(_,i)=>i+6); // 06-18
    const days = Array.from({length:7},(_,i)=>{
      const d=new Date(); d.setDate(d.getDate()+i);
      return d.toISOString().slice(0,10);
    });
    let count = 0;
    for(const date of days){
      for(const h of hours){
        for(let dk=1;dk<=docks;dk++){
          const hStr = String(h).padStart(2,"0")+":00";
          const key = date+"_"+hStr+"_D"+String(dk).padStart(2,"0");
          const {error} = await supabase.from("dock_slots").insert({
            slot_key:key, slot_date:date,
            slot_hour:hStr+":00", dock_no:dk, status:"AVAILABLE"
          }).eq("slot_key",key);
          if(!error) count++;
        }
      }
    }
    setMsg({type:"ok",msg:"✅ สร้าง Slot "+count+" รายการ (7 วัน)"});
    setSaving(false);
  };

  const ROLES = ["cs","gate","warehouse","queue","manager","admin","supplier"];
  const ROLE_COLOR = {cs:"#0f4bd7",gate:"#ea580c",warehouse:"#7c3aed",queue:"#ca8a04",manager:"#1d4ed8",admin:"#dc2626",supplier:"#065f46"};

  return (
    <div style={{minHeight:"100vh",background:"#f0f4fb"}}>
      <div style={{background:"linear-gradient(90deg,#7f1d1d,#dc2626)",color:"#fff",padding:"12px 18px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
        <button onClick={onBack} style={{border:"1px solid rgba(255,255,255,.2)",background:"transparent",color:"#fff",borderRadius:8,padding:"4px 10px",cursor:"pointer",fontSize:12}}>← Back</button>
        <span style={{fontWeight:800,fontSize:15}}>⚙️ Admin Panel</span>
        <div style={{display:"flex",gap:4,background:"rgba(255,255,255,.15)",borderRadius:8,padding:3,marginLeft:8}}>
          {["users","config","slots"].map(t=>(
            <button key={t} onClick={()=>setTab(t)} style={{border:"none",borderRadius:6,padding:"4px 12px",fontWeight:700,fontSize:12,cursor:"pointer",background:tab===t?"#fff":"transparent",color:tab===t?"#dc2626":"rgba(255,255,255,.8)"}}>
              {t==="users"?"👥 Users":t==="config"?"⚙️ Config":"📅 Slots"}
            </button>
          ))}
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:8}}>
          {tab==="users" && <button onClick={()=>setShowAddUser(true)} style={{background:"#22c55e",color:"#fff",border:"none",borderRadius:8,padding:"5px 12px",fontWeight:700,cursor:"pointer",fontSize:12}}>+ เพิ่ม User</button>}
          {tab==="slots" && <button onClick={generateSlots} disabled={saving} style={{background:"#f59e0b",color:"#fff",border:"none",borderRadius:8,padding:"5px 12px",fontWeight:700,cursor:"pointer",fontSize:12,opacity:saving?.6:1}}>{saving?"กำลังสร้าง…":"🗓 สร้าง Slot 7 วัน"}</button>}
        </div>
      </div>

      <div style={{padding:14,maxWidth:1000,margin:"0 auto"}}>
        {msg && <Alert type={msg.type} msg={msg.msg}/>}
        {loading ? <div style={{padding:40,textAlign:"center"}}><Spinner/></div> : <>

        {/* USERS TAB */}
        {tab==="users" && (
          <div style={{background:"#fff",borderRadius:14,overflow:"hidden",boxShadow:"0 4px 20px rgba(0,0,0,.07)"}}>
            <div style={{padding:"12px 16px",borderBottom:"1px solid #e5e7eb",fontWeight:800,color:"#0a2a6e",fontSize:14}}>
              Users ({users.length})
            </div>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead><tr style={{background:"#f8fafc"}}>
                {["Username","Full Name","Role","SubCon","Active",""].map(h=>(
                  <th key={h} style={{padding:"8px 12px",textAlign:"left",fontWeight:700,color:"#374151"}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {users.map(u=>(
                  <tr key={u.id} style={{borderBottom:"1px solid #f3f4f6",opacity:u.active?1:.5}}>
                    <td style={{padding:"8px 12px",fontFamily:"monospace",fontWeight:700}}>{u.username}</td>
                    <td style={{padding:"8px 12px"}}>{u.full_name}</td>
                    <td style={{padding:"8px 12px"}}>
                      <span style={{background:ROLE_COLOR[u.role]+"22",color:ROLE_COLOR[u.role],borderRadius:999,padding:"2px 8px",fontSize:10,fontWeight:800}}>{u.role}</span>
                    </td>
                    <td style={{padding:"8px 12px",color:"#6b7280"}}>{u.subcon_code||"—"}</td>
                    <td style={{padding:"8px 12px"}}>
                      <span style={{color:u.active?"#16a34a":"#dc2626",fontWeight:700}}>{u.active?"✅":"❌"}</span>
                    </td>
                    <td style={{padding:"8px 12px"}}>
                      <button onClick={()=>toggleUser(u.id,u.active)} style={{background:u.active?"#fee2e2":"#d1fae5",color:u.active?"#991b1b":"#065f46",border:"none",borderRadius:7,padding:"3px 8px",cursor:"pointer",fontSize:11,fontWeight:700}}>
                        {u.active?"ปิดใช้งาน":"เปิดใช้งาน"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* CONFIG TAB */}
        {tab==="config" && (
          <div style={{background:"#fff",borderRadius:14,overflow:"hidden",boxShadow:"0 4px 20px rgba(0,0,0,.07)"}}>
            <div style={{padding:"12px 16px",borderBottom:"1px solid #e5e7eb",fontWeight:800,color:"#0a2a6e",fontSize:14}}>Config Settings</div>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead><tr style={{background:"#f8fafc"}}>
                {["Key","Value","Description"].map(h=>(
                  <th key={h} style={{padding:"8px 12px",textAlign:"left",fontWeight:700,color:"#374151"}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {config.map(c=>(
                  <tr key={c.key} style={{borderBottom:"1px solid #f3f4f6"}}>
                    <td style={{padding:"8px 12px",fontFamily:"monospace",fontWeight:700,fontSize:11,color:"#0a2a6e"}}>{c.key}</td>
                    <td style={{padding:"8px 6px"}}>
                      <input defaultValue={c.value}
                        onBlur={e=>{ if(e.target.value!==c.value) updateConfig(c.key,e.target.value); }}
                        style={{width:"100%",padding:"5px 8px",border:"1px solid #e5e7eb",borderRadius:7,fontSize:12,outline:"none",fontFamily:"monospace"}}/>
                    </td>
                    <td style={{padding:"8px 12px",color:"#6b7280",fontSize:11}}>{c.description||"—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* SLOTS TAB */}
        {tab==="slots" && (
          <div style={{background:"#fff",borderRadius:14,padding:24,boxShadow:"0 4px 20px rgba(0,0,0,.07)",textAlign:"center"}}>
            <div style={{fontSize:32,marginBottom:12}}>📅</div>
            <div style={{fontWeight:800,color:"#0a2a6e",fontSize:18,marginBottom:8}}>Auto Generate Dock Slots</div>
            <div style={{fontSize:13,color:"#6b7280",marginBottom:24,maxWidth:400,margin:"0 auto 24px"}}>
              สร้าง Slot อัตโนมัติ 7 วัน ข้างหน้า (Dock 1-5 • 06:00-18:00) Slot ที่มีอยู่แล้วจะไม่ถูกเขียนทับ
            </div>
            <button onClick={generateSlots} disabled={saving}
              style={{background:"#f59e0b",color:"#fff",border:"none",borderRadius:12,padding:"12px 32px",fontWeight:800,cursor:"pointer",fontSize:15,opacity:saving?.6:1}}>
              {saving?"กำลังสร้าง Slot…":"🗓 สร้าง Slot 7 วัน"}
            </button>
          </div>
        )}
        </>}
      </div>

      {/* ADD USER MODAL */}
      {showAddUser && (
        <div style={{position:"fixed",inset:0,background:"rgba(10,20,50,.6)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,padding:16}}>
          <div style={{background:"#fff",borderRadius:16,padding:24,width:"100%",maxWidth:400,boxShadow:"0 20px 60px rgba(0,0,0,.3)"}}>
            <div style={{fontWeight:800,color:"#0a2a6e",fontSize:16,marginBottom:16}}>👥 เพิ่ม User ใหม่</div>
            {[{l:"Username *",k:"username"},{l:"Full Name *",k:"fullName"},{l:"Password *",k:"password",t:"password"}].map(f=>(
              <div key={f.k} style={{marginBottom:10}}>
                <label style={{display:"block",fontSize:12,fontWeight:700,marginBottom:4,color:"#374151"}}>{f.l}</label>
                <input value={newUser[f.k]} onChange={e=>setNewUser(p=>({...p,[f.k]:e.target.value}))} type={f.t||"text"}
                  style={{width:"100%",padding:"8px 10px",border:"1.5px solid #e5e7eb",borderRadius:9,fontSize:13,outline:"none",boxSizing:"border-box"}}/>
              </div>
            ))}
            <div style={{marginBottom:10}}>
              <label style={{display:"block",fontSize:12,fontWeight:700,marginBottom:4,color:"#374151"}}>Role *</label>
              <select value={newUser.role} onChange={e=>setNewUser(p=>({...p,role:e.target.value}))}
                style={{width:"100%",padding:"8px 10px",border:"1.5px solid #e5e7eb",borderRadius:9,fontSize:13,outline:"none",boxSizing:"border-box"}}>
                {ROLES.map(r=><option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div style={{marginBottom:16}}>
              <label style={{display:"block",fontSize:12,fontWeight:700,marginBottom:4,color:"#374151"}}>SubCon Code</label>
              <select value={newUser.subconCode} onChange={e=>setNewUser(p=>({...p,subconCode:e.target.value}))}
                style={{width:"100%",padding:"8px 10px",border:"1.5px solid #e5e7eb",borderRadius:9,fontSize:13,outline:"none",boxSizing:"border-box"}}>
                <option value="">— ไม่มี —</option>
                {subcons.map(s=><option key={s.subcon_code} value={s.subcon_code}>{s.subcon_code} — {s.subcon_name}</option>)}
              </select>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setShowAddUser(false)} style={{flex:1,padding:"10px",background:"#e5e7eb",color:"#374151",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:13}}>ยกเลิก</button>
              <button onClick={createUser} disabled={saving} style={{flex:2,padding:"10px",background:"#dc2626",color:"#fff",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:13,opacity:saving?.6:1}}>
                {saving?"กำลังสร้าง…":"✓ สร้าง User"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MAIN APP ─────────────────────────────────────────────────
export default function App() {
  const [user,setUser] = useState(null);
  const [view,setView] = useState("launcher");

  const handleLogout = () => { setUser(null); setView("launcher"); };
  const handleSelect = (appId) => {
    const allowed = ROLE_APPS[user?.role]||[];
    if (allowed.includes(appId)) setView(appId);
  };

  if (!user) return <Login onLogin={u=>{setUser(u);setView("launcher");}}/>;

  const currentApp = APPS.find(a=>a.id===view);

  return (
    <>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        *{box-sizing:border-box}
        body{margin:0;font-family:'Segoe UI',system-ui,sans-serif}
        button:focus{outline:none}
      `}</style>
      {view==="launcher" && <Launcher user={user} onSelect={handleSelect} onLogout={handleLogout}/>}
      {view==="obd"      && <OBDApp user={user} onBack={()=>setView("launcher")}/>}
      {view==="booking"  && <BookingApp user={user} onBack={()=>setView("launcher")}/>}
      {view==="obd"      && <OBDApp user={user} onBack={()=>setView("launcher")}/>}
      {view==="gate"     && <GateApp user={user} onBack={()=>setView("launcher")}/>}
      {view==="queue"    && <QueueApp user={user} onBack={()=>setView("launcher")}/>}
      {view==="supplier" && <SupplierApp user={user} onBack={()=>setView("launcher")}/>}
      {view==="inbound"  && <InboundApp user={user} onBack={()=>setView("launcher")}/>}
      {view==="admin"    && user.role==="admin" && <AdminApp user={user} onBack={()=>setView("launcher")}/>}
      {view==="manager"  && <ManagerApp user={user} onBack={()=>setView("launcher")}/>}
      {!["launcher","obd","booking","gate","queue","manager","supplier","inbound","admin"].includes(view) && currentApp &&
        <PlaceholderApp app={currentApp} onBack={()=>setView("launcher")}/>}
    </>
  );
}
