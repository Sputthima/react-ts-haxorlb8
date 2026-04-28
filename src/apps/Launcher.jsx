import React from "react";

export const ROLE_APPS = {
  cs:        ["obd","booking"],
  gate:      ["gate"],
  warehouse: ["gate"],
  queue:     ["queue"],
  manager:   ["obd","booking","gate","queue","manager"],
  admin:     ["obd","booking","gate","queue","manager","supplier","inbound","admin"],
  supplier:  ["supplier"],
};

export const APPS = [
  {id:"obd",      icon:"📦", name:"OBD & Group",       role:"CS",        color:"#0f4bd7"},
  {id:"booking",  icon:"📅", name:"Dock Booking",      role:"Subcon/CS", color:"#7c3aed"},
  {id:"gate",     icon:"🏭", name:"Gate & Warehouse",  role:"Gate/WH",   color:"#ea580c"},
  {id:"queue",    icon:"🔔", name:"Queue Operator",    role:"Operator",  color:"#ca8a04"},
  {id:"manager",  icon:"📊", name:"Manager Dashboard", role:"Manager",   color:"#1d4ed8"},
  {id:"supplier", icon:"📦", name:"Supplier Portal",   role:"Supplier",  color:"#065f46"},
  {id:"inbound",  icon:"🏭", name:"Inbound Gate & WH", role:"Gate/WH",   color:"#047857"},
  {id:"admin",    icon:"⚙️", name:"Admin Panel",       role:"Admin",     color:"#dc2626"},
];

export default function Launcher({ user, onSelect, onLogout }) {
  const allowed = ROLE_APPS[user.role] || [];
  const visible = APPS.filter(a => allowed.includes(a.id));
  const now = new Date().toLocaleDateString("th-TH",{weekday:"long",day:"numeric",month:"long",year:"numeric"});

  return (
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#060d2e 0%,#0a2a6e 40%,#1a3a8f 70%,#1d4ed8 100%)"}}>
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
            style={{border:"1px solid rgba(255,255,255,.2)",background:"rgba(255,255,255,.08)",color:"#fff",borderRadius:9,padding:"7px 14px",cursor:"pointer",fontSize:12,fontWeight:700}}
            onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,255,255,.18)";}}
            onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,.08)";}}
          >Logout</button>
        </div>
      </div>

      <div style={{padding:"32px",display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:16,maxWidth:1400,margin:"0 auto"}}>
        {visible.map(app => (
          <button key={app.id} onClick={()=>onSelect(app.id)}
            style={{background:"rgba(255,255,255,.06)",backdropFilter:"blur(20px)",border:"1px solid rgba(255,255,255,.1)",borderRadius:20,padding:"24px 20px",textAlign:"left",cursor:"pointer",color:"#fff",position:"relative",overflow:"hidden",transition:"all .25s",boxShadow:"0 4px 24px rgba(0,0,0,.2)"}}
            onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,255,255,.12)";e.currentTarget.style.transform="translateY(-4px)";}}
            onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,.06)";e.currentTarget.style.transform="none";}}
          >
            <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:`linear-gradient(90deg,${app.color},${app.color}88)`,borderRadius:"20px 20px 0 0"}}/>
            <div style={{width:48,height:48,background:`${app.color}22`,borderRadius:14,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,marginBottom:14,border:`1px solid ${app.color}44`}}>
              {app.icon}
            </div>
            <div style={{fontSize:15,fontWeight:800,marginBottom:4}}>{app.name}</div>
            <div style={{fontSize:10,color:"rgba(255,255,255,.4)",fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:14}}>{app.role}</div>
            <div style={{display:"flex",alignItems:"center",gap:4,fontSize:11,color:app.color,fontWeight:700}}>Open →</div>
          </button>
        ))}
      </div>
    </div>
  );
}
