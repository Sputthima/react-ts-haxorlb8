import React from "react";

export function StatusBadge({ status, size = 10 }) {
  const STATUS_TH = {
    AVAILABLE:"ว่าง", BOOKED:"จอง", RESERVED:"จอง", ON_YARD:"On Yard",
    CALLED_TO_DOCK:"เรียกแล้ว", TRUCK_DOCKED:"เข้า Dock", LOADING:"Loading",
    COMPLETED:"เสร็จ", OPEN:"รอ Book", GROUPED:"Grouped", CANCELLED:"ยกเลิก",
    BOOKING_PENDING:"รอ Book", UNLOADING:"ขนลง", RECEIVED:"รับแล้ว",
    WAITING:"รอ", CALLING:"กำลังเรียก", SKIPPED:"ข้าม",
  };
  const colors = {
    AVAILABLE:{bg:"#d1fae5",c:"#065f46"}, BOOKED:{bg:"#fee2e2",c:"#991b1b"},
    RESERVED:{bg:"#d1fae5",c:"#065f46"}, ON_YARD:{bg:"#fef9c3",c:"#854d0e"},
    CALLED_TO_DOCK:{bg:"#ffedd5",c:"#9a3412"}, TRUCK_DOCKED:{bg:"#ede9fe",c:"#5b21b6"},
    LOADING:{bg:"#dbeafe",c:"#1e40af"}, COMPLETED:{bg:"#dcfce7",c:"#166534"},
    OPEN:{bg:"#dcfce7",c:"#166534"}, GROUPED:{bg:"#dbeafe",c:"#1d4ed8"},
    CANCELLED:{bg:"#fee2e2",c:"#991b1b"}, BOOKING_PENDING:{bg:"#fef9c3",c:"#92400e"},
    UNLOADING:{bg:"#dbeafe",c:"#1e40af"}, RECEIVED:{bg:"#dcfce7",c:"#166534"},
    WAITING:{bg:"#f3f4f6",c:"#374151"}, CALLING:{bg:"#fef3c7",c:"#92400e"},
    SKIPPED:{bg:"#f3f4f6",c:"#6b7280"},
  };
  const col = colors[status] || { bg:"#f3f4f6", c:"#374151" };
  return (
    <span style={{display:"inline-block",padding:`2px ${size<11?7:9}px`,borderRadius:999,fontSize:size,fontWeight:800,background:col.bg,color:col.c}}>
      {STATUS_TH[status] || status}
    </span>
  );
}

export function Spinner() {
  return <div style={{width:20,height:20,border:"3px solid #e5e7eb",borderTopColor:"#0f4bd7",borderRadius:"50%",animation:"spin .6s linear infinite",margin:"0 auto"}}/>;
}

export function Alert({ type, msg }) {
  const s = {
    err:  {bg:"#fee2e2",c:"#991b1b"},
    ok:   {bg:"#d1fae5",c:"#065f46"},
    warn: {bg:"#fef3c7",c:"#92400e"},
  }[type] || {bg:"#dbeafe",c:"#1d4ed8"};
  return <div style={{padding:"10px 14px",borderRadius:10,fontSize:13,marginBottom:12,background:s.bg,color:s.c,fontWeight:600}}>{msg}</div>;
}

export function Topbar({ title, color="#0a2a6e", onBack, children }) {
  return (
    <div style={{background:color,color:"#fff",padding:"12px 18px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",position:"sticky",top:0,zIndex:40}}>
      {onBack && <button onClick={onBack} style={{border:"1px solid rgba(255,255,255,.2)",background:"transparent",color:"#fff",borderRadius:8,padding:"4px 10px",cursor:"pointer",fontSize:12}}>← Back</button>}
      <span style={{fontWeight:800,fontSize:15}}>{title}</span>
      {children}
      <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:6}}>
        <span style={{width:8,height:8,borderRadius:"50%",background:"#22c55e",display:"inline-block",boxShadow:"0 0 0 3px rgba(34,197,94,.25)"}}/>
        <span style={{fontSize:11,fontWeight:700,color:"#86efac"}}>LIVE</span>
      </div>
    </div>
  );
}

export function Modal({ title, onClose, children, maxWidth=420 }) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(10,20,50,.6)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,padding:16}}>
      <div style={{background:"#fff",borderRadius:16,padding:24,width:"100%",maxWidth,boxShadow:"0 20px 60px rgba(0,0,0,.3)",maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div style={{fontWeight:800,color:"#0a2a6e",fontSize:16}}>{title}</div>
          {onClose && <button onClick={onClose} style={{border:"none",background:"none",cursor:"pointer",fontSize:18,color:"#9ca3af"}}>✕</button>}
        </div>
        {children}
      </div>
    </div>
  );
}

export function Card({ children, style={} }) {
  return <div style={{background:"#fff",borderRadius:14,padding:16,boxShadow:"0 4px 20px rgba(0,0,0,.07)",marginBottom:14,...style}}>{children}</div>;
}

export function LiveBadge() {
  return (
    <div style={{display:"flex",alignItems:"center",gap:6}}>
      <span style={{width:8,height:8,borderRadius:"50%",background:"#22c55e",display:"inline-block",boxShadow:"0 0 0 3px rgba(34,197,94,.25)"}}/>
      <span style={{fontSize:11,fontWeight:700,color:"#86efac"}}>LIVE</span>
    </div>
  );
}
