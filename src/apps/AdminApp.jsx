import React, { useState, useEffect, useCallback } from "react";
import { supabase, today, auditLog, triggerAutoSlots } from "../lib/supabase";
import { Alert, Spinner, StatusBadge } from "../components/UI";
import { T, BTN } from "../theme";

const ROLES   = ["cs","subcon","gate","warehouse","queue","manager","admin","supplier"];
const ROLE_COLOR = {
  cs:T.navyLight, gate:T.amber, warehouse:T.purple,
  queue:T.goldDark, manager:T.blue, admin:T.red, supplier:T.green,
};
// ── FIX 3: เพิ่ม QUEUE, OBD, INBOUND ครบ ────────────────────
const ALL_MODULES = ["GATE","WAREHOUSE","DOCK","BOOKING","QUEUE","OBD","INBOUND","ADMIN"];
const MODULE_COLOR = {
  GATE:"#16A34A", WAREHOUSE:"#1D4ED8", DOCK:"#7C3AED",
  BOOKING:"#D97706", QUEUE:"#EA580C", OBD:"#0891B2",
  INBOUND:"#059669", ADMIN:"#DC2626",
};

const inp = { width:"100%", padding:"7px 10px", border:`1.5px solid ${T.borderDark}`, borderRadius:8, fontSize:12, outline:"none", boxSizing:"border-box", color:T.textPrimary, background:T.white };
const sel = { ...inp, cursor:"pointer" };

// ── FIX 1+2: Inline editable cell ────────────────────────────
function EditCell({ value, onSave, placeholder="", type="text", mono=false }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal]         = useState(value || "");

  useEffect(()=>{ setVal(value||""); },[value]);

  if (!editing) return (
    <span
      onClick={()=>setEditing(true)}
      title="คลิกเพื่อแก้ไข"
      style={{ cursor:"pointer", color: val ? T.textPrimary : T.textMuted,
        fontFamily: mono?"monospace":"inherit", fontSize:12,
        borderBottom:`1px dashed ${T.border}`, paddingBottom:1 }}>
      {val || <span style={{color:T.textMuted,fontSize:11}}>—  คลิกแก้</span>}
    </span>
  );

  return (
    <input
      autoFocus
      type={type}
      value={val}
      onChange={e=>setVal(e.target.value)}
      onBlur={()=>{ setEditing(false); if(val!==value) onSave(val); }}
      onKeyDown={e=>{ if(e.key==="Enter"){ setEditing(false); if(val!==value) onSave(val); } if(e.key==="Escape"){ setVal(value||""); setEditing(false); } }}
      style={{ ...inp, padding:"4px 8px", width:160, fontSize:12 }}
    />
  );
}

export default function AdminApp({ user, onBack }) {
  const [tab, setTab]     = useState("users");
  const [msg, setMsg]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);

  const [users,   setUsers]   = useState([]);
  const [config,  setConfig]  = useState([]);
  const [subcons, setSubcons] = useState([]);

  const [showAddUser,   setShowAddUser]   = useState(false);
  const [showAddSubcon, setShowAddSubcon] = useState(false);
  const [newUser, setNewUser] = useState({ username:"", fullName:"", email:"", role:"cs", subconCode:"", password:"" });
  const [newSc,   setNewSc]   = useState({ subcon_code:"", subcon_name:"", email:"", phone:"" });

  const [slotPreview, setSlotPreview] = useState(null);
  const [dockCount,   setDockCount]   = useState(5);
  const [startHour,   setStartHour]   = useState(6);
  const [endHour,     setEndHour]     = useState(18);
  const [genDays,     setGenDays]     = useState(7);

  const [auditRows,   setAuditRows]   = useState([]);
  const [auditLoaded, setAuditLoaded] = useState(false);
  const [auditFilter, setAuditFilter] = useState({ module:"", actor:"", search:"" });

  // ── LOADERS ─────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    const [u, c, s] = await Promise.all([
      supabase.from("users").select("*").order("role").order("username"),
      supabase.from("config").select("*").order("key"),
      supabase.from("subcon_master").select("*").order("subcon_code"),
    ]);
    if (u.data) setUsers(u.data);
    if (c.data) setConfig(c.data);
    if (s.data) setSubcons(s.data);
    setLoading(false);
  }, []);

  const loadAudit = useCallback(async (filter={}) => {
    let q = supabase.from("audit_log").select("*")
      .order("timestamp",{ascending:false}).limit(500);
    if (filter.module) q = q.eq("module", filter.module);
    if (filter.actor)  q = q.ilike("actor", `%${filter.actor}%`);
    const { data } = await q;
    let rows = data || [];
    if (filter.search) {
      const kw = filter.search.toLowerCase();
      rows = rows.filter(r =>
        [r.target_id,r.group_number,r.booking_id,r.remark,r.subcon_code,r.action]
          .some(v=>String(v||"").toLowerCase().includes(kw))
      );
    }
    setAuditRows(rows);
    setAuditLoaded(true);
  }, []);

  useEffect(()=>{ loadAll(); },[loadAll]);
  useEffect(()=>{ if(tab==="audit" && !auditLoaded) loadAudit(auditFilter); },[tab]);

  const showMsg = (type, text) => { setMsg({type,msg:text}); setTimeout(()=>setMsg(null),3000); };

  // ── USERS ─────────────────────────────────────────────────────
  const toggleUser = async (id, active) => {
    await supabase.from("users").update({active:!active}).eq("id",id);
    await auditLog({module:"ADMIN",action:active?"DEACTIVATE_USER":"ACTIVATE_USER",targetType:"USER",targetId:String(id),actor:user.username});
    loadAll();
  };

  // FIX 2: saveUserField — inline edit สำหรับ users (email, full_name)
  const saveUserField = async (id, field, value, username) => {
    await supabase.from("users").update({[field]:value}).eq("id",id);
    showMsg("ok",`✅ อัปเดต ${field} ของ ${username} แล้ว`);
    await auditLog({module:"ADMIN",action:"UPDATE_USER",targetType:"USER",targetId:username,actor:user.username,remark:`${field}=${value}`});
    loadAll();
  };

  const createUser = async () => {
    if (!newUser.username||!newUser.fullName||!newUser.password)
      return setMsg({type:"err",msg:"กรุณากรอกให้ครบ"});
    setSaving(true);
    const { error } = await supabase.from("users").insert({
      username:      newUser.username.trim(),
      password_hash: newUser.password,
      full_name:     newUser.fullName,
      email:         newUser.email || null,
      role:          newUser.role,
      subcon_code:   newUser.subconCode || null,
      active:        true,
    });
    if (error) { setMsg({type:"err",msg:error.message}); }
    else {
      showMsg("ok",`✅ สร้าง user ${newUser.username} สำเร็จ`);
      setShowAddUser(false);
      setNewUser({username:"",fullName:"",email:"",role:"cs",subconCode:"",password:""});
      await auditLog({module:"ADMIN",action:"CREATE_USER",targetType:"USER",targetId:newUser.username,actor:user.username});
      loadAll();
    }
    setSaving(false);
  };

  const resetPassword = async (u, newPw) => {
    if (!newPw) return;
    await supabase.from("users").update({password_hash:newPw}).eq("id",u.id);
    showMsg("ok",`✅ Reset password ของ ${u.username} แล้ว`);
    await auditLog({module:"ADMIN",action:"RESET_PASSWORD",targetType:"USER",targetId:u.username,actor:user.username});
  };

  // ── CONFIG ────────────────────────────────────────────────────
  const updateConfig = async (key, value) => {
    await supabase.from("config").update({value}).eq("key",key);
    showMsg("ok",`✅ อัปเดต ${key} แล้ว`);
  };

  // ── SUBCON ────────────────────────────────────────────────────
  // FIX 1: saveSubconField — inline edit สำหรับ subcon (email, phone, name)
  const saveSubconField = async (id, field, value, code) => {
    await supabase.from("subcon_master").update({[field]:value}).eq("id",id);
    showMsg("ok",`✅ อัปเดต ${field} ของ ${code} แล้ว`);
    loadAll();
  };

  const createSubcon = async () => {
    if (!newSc.subcon_code||!newSc.subcon_name)
      return setMsg({type:"err",msg:"กรุณากรอก Code และ Name"});
    setSaving(true);
    const { error } = await supabase.from("subcon_master").insert({
      subcon_code: newSc.subcon_code.toUpperCase().trim(),
      subcon_name: newSc.subcon_name.trim(),
      email: newSc.email||"", phone: newSc.phone||"", active:true,
    });
    if (error) { setMsg({type:"err",msg:error.message}); }
    else {
      showMsg("ok",`✅ สร้าง SubCon ${newSc.subcon_code} สำเร็จ`);
      setShowAddSubcon(false);
      setNewSc({subcon_code:"",subcon_name:"",email:"",phone:""});
      loadAll();
    }
    setSaving(false);
  };

  const toggleSubcon = async (id, active) => {
    await supabase.from("subcon_master").update({active:!active}).eq("id",id);
    loadAll();
  };

  // ── SLOTS ─────────────────────────────────────────────────────
  const previewSlots = () => {
    const days = Array.from({length:genDays},(_,i)=>{ const d=new Date(); d.setDate(d.getDate()+i); const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),dy=String(d.getDate()).padStart(2,"0"); return `${y}-${m}-${dy}`; });
    const hours = Array.from({length:endHour-startHour+1},(_,i)=>i+startHour);
    setSlotPreview({days,hours,total:days.length*hours.length*dockCount});
  };

  const generateSlots = async () => {
    if (!slotPreview) return previewSlots();
    setSaving(true); setMsg(null);
    let created=0, skipped=0;
    for (const date of slotPreview.days) {
      for (const h of slotPreview.hours) {
        for (let dk=1; dk<=dockCount; dk++) {
          const hStr = String(h).padStart(2,"0")+":00";
          const key  = `${date}_${hStr}_D${String(dk).padStart(2,"0")}`;
          const { error } = await supabase.from("dock_slots").insert({
            slot_key:key, slot_date:date, slot_hour:hStr+":00", dock_no:dk, status:"AVAILABLE",
          });
          if (error) skipped++; else created++;
        }
      }
    }
    showMsg("ok",`✅ สร้าง Slot ${created} รายการ | ข้าม ${skipped} (มีอยู่แล้ว)`);
    setSlotPreview(null); setSaving(false);
    await auditLog({module:"ADMIN",action:"GENERATE_SLOTS",targetType:"SLOT",targetId:"BATCH",actor:user.username,remark:`${created} slots`});
  };

  const runAutoSlotsFunction = async () => {
    setSaving(true); setMsg(null);
    const result = await triggerAutoSlots();
    if (result.success) showMsg("ok",`✅ Edge Function: สร้าง ${result.created} slots | ข้าม ${result.skipped}`);
    else showMsg("err",`❌ ${result.error}`);
    setSaving(false);
    await auditLog({module:"ADMIN",action:"AUTO_SLOT_FUNCTION",targetType:"SLOT",targetId:"EDGE",actor:user.username});
  };

  const clearOldSlots = async () => {
    if (!confirm("ลบ Slot ที่ผ่านมาแล้วทั้งหมด (AVAILABLE เท่านั้น)?")) return;
    setSaving(true);
    const { error } = await supabase.from("dock_slots").delete().lt("slot_date",today()).eq("status","AVAILABLE");
    if (error) showMsg("err",error.message);
    else showMsg("ok","✅ ลบ Slot เก่า (AVAILABLE) เรียบร้อย");
    setSaving(false);
  };

  const card = (extra={}) => ({
    background:T.white, borderRadius:14, boxShadow:T.shadow,
    border:`1px solid ${T.border}`, ...extra,
  });

  // ─────────────────────────────────────────────────────────────
  return (
    <div style={{minHeight:"100vh",background:T.bg}}>

      {/* TOPBAR */}
      <div style={{background:"linear-gradient(90deg,#7f1d1d,#b91c1c,#dc2626)",color:T.white,
        padding:"12px 18px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",
        position:"sticky",top:0,zIndex:40}}>
        <button onClick={onBack} style={{border:"1px solid rgba(255,255,255,.2)",background:"transparent",color:T.white,borderRadius:8,padding:"4px 10px",cursor:"pointer",fontSize:12}}>← Back</button>
        <span style={{fontWeight:800,fontSize:15}}>⚙️ Admin Panel</span>
        <div style={{display:"flex",gap:4,background:"rgba(255,255,255,.15)",borderRadius:8,padding:3,marginLeft:8,flexWrap:"wrap"}}>
          {[["users","👥 Users"],["subcon","🏢 SubCon"],["config","⚙️ Config"],["slots","📅 Slots"],["audit","📜 Audit"]].map(([t,l])=>(
            <button key={t} onClick={()=>setTab(t)} style={{border:"none",borderRadius:6,padding:"4px 10px",fontWeight:700,fontSize:11,cursor:"pointer",background:tab===t?T.white:"transparent",color:tab===t?T.red:"rgba(255,255,255,.8)"}}>
              {l}
            </button>
          ))}
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:8}}>
          {tab==="users"  && <button onClick={()=>setShowAddUser(true)}  style={{background:"#4ADE80",color:"#fff",border:"none",borderRadius:8,padding:"5px 12px",fontWeight:700,cursor:"pointer",fontSize:12}}>+ User</button>}
          {tab==="subcon" && <button onClick={()=>setShowAddSubcon(true)} style={{background:"#4ADE80",color:"#fff",border:"none",borderRadius:8,padding:"5px 12px",fontWeight:700,cursor:"pointer",fontSize:12}}>+ SubCon</button>}
        </div>
      </div>

      <div style={{padding:14,maxWidth:1000,margin:"0 auto"}}>
        {msg && <Alert type={msg.type} msg={msg.msg}/>}

        {loading && tab!=="audit" ? (
          <div style={{padding:40,textAlign:"center"}}><Spinner/></div>
        ) : (
          <>
            {/* ══════════════════════════════════════════════════════
                USERS TAB — FIX 2: เพิ่ม email column + inline edit
            ══════════════════════════════════════════════════════ */}
            {tab==="users" && (
              <div style={card({overflow:"hidden"})}>
                <div style={{padding:"12px 16px",borderBottom:`1px solid ${T.border}`,fontWeight:800,color:T.navy,fontSize:14}}>
                  Users ({users.length})
                  <span style={{fontSize:11,color:T.textMuted,fontWeight:400,marginLeft:8}}>คลิกที่ Email / Full Name เพื่อแก้ไข inline</span>
                </div>
                <div style={{overflowX:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                    <thead>
                      <tr style={{background:T.bg}}>
                        {["Username","Full Name","Email","Role","SubCon","Active","Actions"].map(h=>(
                          <th key={h} style={{padding:"8px 12px",textAlign:"left",fontWeight:700,color:T.textSecond,whiteSpace:"nowrap"}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {users.map(u=>(
                        <tr key={u.id} style={{borderBottom:`1px solid #f3f4f6`,opacity:u.active?1:.5}}>
                          <td style={{padding:"8px 12px",fontFamily:"monospace",fontWeight:700,fontSize:11}}>{u.username}</td>
                          {/* FIX 2: inline edit full_name */}
                          <td style={{padding:"8px 12px"}}>
                            <EditCell value={u.full_name} onSave={v=>saveUserField(u.id,"full_name",v,u.username)}/>
                          </td>
                          {/* FIX 2: inline edit email */}
                          <td style={{padding:"8px 12px"}}>
                            <EditCell value={u.email} type="email" onSave={v=>saveUserField(u.id,"email",v,u.username)} placeholder="กรอก email"/>
                          </td>
                          <td style={{padding:"8px 12px"}}>
                            <span style={{background:(ROLE_COLOR[u.role]||T.textMuted)+"22",color:ROLE_COLOR[u.role]||T.textMuted,borderRadius:999,padding:"2px 8px",fontSize:10,fontWeight:800}}>
                              {u.role}
                            </span>
                          </td>
                          <td style={{padding:"8px 12px",color:T.textMuted,fontSize:11}}>{u.subcon_code||"—"}</td>
                          <td style={{padding:"8px 12px"}}>
                            <span style={{color:u.active?T.green:T.red,fontWeight:700,fontSize:13}}>{u.active?"✅":"❌"}</span>
                          </td>
                          <td style={{padding:"8px 12px"}}>
                            <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                              <button onClick={()=>toggleUser(u.id,u.active)}
                                style={{background:u.active?T.redBg:T.greenBg,color:u.active?T.red:T.green,border:"none",borderRadius:6,padding:"3px 8px",cursor:"pointer",fontSize:11,fontWeight:700}}>
                                {u.active?"ปิด":"เปิด"}
                              </button>
                              <button onClick={()=>{ const pw=prompt(`Reset password ของ ${u.username}:`); if(pw) resetPassword(u,pw); }}
                                style={{background:T.goldPale,color:T.goldDark,border:"none",borderRadius:6,padding:"3px 8px",cursor:"pointer",fontSize:11,fontWeight:700}}>
                                🔑 PW
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ══════════════════════════════════════════════════════
                SUBCON TAB — FIX 1: inline edit email/phone/name
            ══════════════════════════════════════════════════════ */}
            {tab==="subcon" && (
              <div style={card({overflow:"hidden"})}>
                <div style={{padding:"12px 16px",borderBottom:`1px solid ${T.border}`,fontWeight:800,color:T.navy,fontSize:14}}>
                  SubCon Master ({subcons.length})
                  <span style={{fontSize:11,color:T.textMuted,fontWeight:400,marginLeft:8}}>คลิกที่ Email / Phone / Name เพื่อแก้ไข inline</span>
                </div>
                <div style={{overflowX:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                    <thead>
                      <tr style={{background:T.bg}}>
                        {["Code","Name","Email","Phone","Active",""].map(h=>(
                          <th key={h} style={{padding:"8px 12px",textAlign:"left",fontWeight:700,color:T.textSecond}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {subcons.map(sc=>(
                        <tr key={sc.id||sc.subcon_code} style={{borderBottom:`1px solid #f3f4f6`,opacity:sc.active?1:.5}}>
                          <td style={{padding:"8px 12px",fontFamily:"monospace",fontWeight:800,color:T.navy}}>{sc.subcon_code}</td>
                          {/* FIX 1: inline edit name */}
                          <td style={{padding:"8px 12px"}}>
                            <EditCell value={sc.subcon_name} onSave={v=>saveSubconField(sc.id,"subcon_name",v,sc.subcon_code)}/>
                          </td>
                          {/* FIX 1: inline edit email */}
                          <td style={{padding:"8px 12px"}}>
                            <EditCell value={sc.email} type="email" onSave={v=>saveSubconField(sc.id,"email",v,sc.subcon_code)} placeholder="กรอก email"/>
                          </td>
                          {/* FIX 1: inline edit phone */}
                          <td style={{padding:"8px 12px"}}>
                            <EditCell value={sc.phone} type="tel" onSave={v=>saveSubconField(sc.id,"phone",v,sc.subcon_code)} placeholder="08x-xxx"/>
                          </td>
                          <td style={{padding:"8px 12px"}}>
                            <span style={{color:sc.active?T.green:T.red,fontWeight:700}}>{sc.active?"✅":"❌"}</span>
                          </td>
                          <td style={{padding:"8px 12px"}}>
                            <button onClick={()=>toggleSubcon(sc.id,sc.active)}
                              style={{background:sc.active?T.redBg:T.greenBg,color:sc.active?T.red:T.green,border:"none",borderRadius:6,padding:"3px 8px",cursor:"pointer",fontSize:11,fontWeight:700}}>
                              {sc.active?"ปิด":"เปิด"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ══════════════════════════════════════════════════════
                CONFIG TAB
            ══════════════════════════════════════════════════════ */}
            {tab==="config" && (
              <div style={card({overflow:"hidden"})}>
                <div style={{padding:"12px 16px",borderBottom:`1px solid ${T.border}`,fontWeight:800,color:T.navy,fontSize:14}}>Config Settings</div>
                <div style={{padding:"8px 12px",fontSize:11,color:T.textMuted,borderBottom:`1px solid #f3f4f6`}}>
                  แก้ค่าแล้ว click ออกนอก field — ระบบบันทึกอัตโนมัติ
                </div>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead>
                    <tr style={{background:T.bg}}>
                      {["Key","Value","Description"].map(h=>(
                        <th key={h} style={{padding:"8px 12px",textAlign:"left",fontWeight:700,color:T.textSecond}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {config.map(c=>(
                      <tr key={c.key} style={{borderBottom:`1px solid #f3f4f6`}}>
                        <td style={{padding:"8px 12px",fontFamily:"monospace",fontWeight:700,fontSize:11,color:T.navy,whiteSpace:"nowrap"}}>{c.key}</td>
                        <td style={{padding:"6px 8px"}}>
                          <input defaultValue={c.value}
                            onBlur={e=>{ if(e.target.value!==String(c.value)) updateConfig(c.key,e.target.value); }}
                            style={{width:"100%",padding:"5px 8px",border:`1px solid ${T.border}`,borderRadius:7,fontSize:12,outline:"none",fontFamily:"monospace",boxSizing:"border-box"}}/>
                        </td>
                        <td style={{padding:"8px 12px",color:T.textMuted,fontSize:11}}>{c.description||"—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* ══════════════════════════════════════════════════════
                SLOTS TAB
            ══════════════════════════════════════════════════════ */}
            {tab==="slots" && (
              <div style={{display:"flex",flexDirection:"column",gap:14}}>
                <div style={card({padding:20})}>
                  <div style={{fontWeight:800,color:T.navy,fontSize:14,marginBottom:14}}>📅 Generate Dock Slots</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
                    {[
                      {label:"จำนวน Dock",key:"dockCount",val:dockCount,set:setDockCount,min:1,max:20},
                      {label:"เริ่ม (ชม.)",key:"startHour",val:startHour,set:setStartHour,min:0,max:23},
                      {label:"สิ้นสุด (ชม.)",key:"endHour",val:endHour,set:setEndHour,min:1,max:23},
                      {label:"จำนวนวัน",key:"genDays",val:genDays,set:setGenDays,min:1,max:30},
                    ].map(f=>(
                      <div key={f.key}>
                        <label style={{display:"block",fontSize:12,fontWeight:700,marginBottom:5,color:T.textSecond}}>{f.label}</label>
                        <input type="number" value={f.val} min={f.min} max={f.max}
                          onChange={e=>f.set(Number(e.target.value))}
                          style={{width:"100%",padding:"8px 10px",border:`1.5px solid ${T.border}`,borderRadius:9,fontSize:13,outline:"none",boxSizing:"border-box"}}/>
                      </div>
                    ))}
                  </div>
                  {slotPreview && (
                    <div style={{padding:12,background:"#dbeafe",borderRadius:9,border:`1px solid #bfdbfe`,marginBottom:12,fontSize:12}}>
                      <div style={{fontWeight:700,color:"#1d4ed8",marginBottom:4}}>Preview:</div>
                      <div>วันที่: {slotPreview.days[0]} ถึง {slotPreview.days[slotPreview.days.length-1]} ({slotPreview.days.length} วัน)</div>
                      <div>ชั่วโมง: {startHour}:00 - {endHour}:00 ({slotPreview.hours.length} slot/dock)</div>
                      <div>Dock: {dockCount} dock</div>
                      <div style={{fontWeight:700,marginTop:4,color:"#1d4ed8"}}>รวม: {slotPreview.total} slots</div>
                    </div>
                  )}
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={previewSlots} style={{flex:1,padding:"10px",background:T.border,color:T.textSecond,border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:13}}>Preview</button>
                    <button onClick={generateSlots} disabled={saving} style={{flex:2,padding:"10px",background:T.gold,color:T.white,border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:13,opacity:saving?.6:1}}>
                      {saving?"กำลังสร้าง…":"🗓 Generate Slots"}
                    </button>
                  </div>
                </div>
                <div style={card({padding:20})}>
                  <div style={{fontWeight:800,color:T.navy,fontSize:14,marginBottom:6}}>⚡ Auto-Slots Edge Function</div>
                  <div style={{fontSize:12,color:T.textMuted,marginBottom:12}}>
                    รัน Edge Function <code>auto-slots</code> — อ่าน config จาก DB (DOCK_COUNT, SLOT_START_HOUR, SLOT_END_HOUR, SLOT_GEN_DAYS)<br/>
                    <span style={{fontSize:11}}>Cron: ทำงานอัตโนมัติทุกวัน 01:00 น.</span>
                  </div>
                  <button onClick={runAutoSlotsFunction} disabled={saving}
                    style={{padding:"9px 20px",background:"linear-gradient(90deg,#0a2a6e,#1d4ed8)",color:T.white,border:"none",borderRadius:9,fontWeight:700,cursor:"pointer",fontSize:12,opacity:saving?.6:1}}>
                    ⚡ Run Auto-Slots Now
                  </button>
                </div>
                <div style={card({padding:20})}>
                  <div style={{fontWeight:800,color:T.red,fontSize:14,marginBottom:8}}>🗑 ลบ Slot เก่า</div>
                  <div style={{fontSize:12,color:T.textMuted,marginBottom:12}}>ลบ Slot ที่ผ่านมาแล้ว (AVAILABLE เท่านั้น — BOOKED จะไม่ถูกลบ)</div>
                  <button onClick={clearOldSlots} disabled={saving}
                    style={{padding:"9px 20px",background:T.redBg,color:T.red,border:"none",borderRadius:9,fontWeight:700,cursor:"pointer",fontSize:12,opacity:saving?.6:1}}>
                    🗑 ลบ Slot ที่ผ่านมา
                  </button>
                </div>
              </div>
            )}

            {/* ══════════════════════════════════════════════════════
                AUDIT TAB — FIX 3: เพิ่ม QUEUE, OBD, INBOUND
            ══════════════════════════════════════════════════════ */}
            {tab==="audit" && (
              <div style={{display:"flex",flexDirection:"column",gap:14}}>
                <div style={card({padding:16})}>
                  <div style={{fontWeight:800,color:T.navy,fontSize:14,marginBottom:12}}>📜 Audit Log</div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"flex-end"}}>
                    <div style={{flex:"0 0 160px"}}>
                      <label style={{display:"block",fontSize:11,fontWeight:700,marginBottom:4,color:T.textSecond}}>Module</label>
                      <select value={auditFilter.module} onChange={e=>setAuditFilter(p=>({...p,module:e.target.value}))}
                        style={{...sel,fontSize:12,padding:"7px 10px"}}>
                        <option value="">ทั้งหมด</option>
                        {/* FIX 3: ครบทุก module */}
                        {ALL_MODULES.map(m=>(
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{flex:"0 0 160px"}}>
                      <label style={{display:"block",fontSize:11,fontWeight:700,marginBottom:4,color:T.textSecond}}>Actor</label>
                      <input value={auditFilter.actor} onChange={e=>setAuditFilter(p=>({...p,actor:e.target.value}))}
                        placeholder="ชื่อ user..." style={{...inp,fontSize:12,padding:"7px 10px"}}/>
                    </div>
                    <div style={{flex:1,minWidth:180}}>
                      <label style={{display:"block",fontSize:11,fontWeight:700,marginBottom:4,color:T.textSecond}}>Search</label>
                      <input value={auditFilter.search} onChange={e=>setAuditFilter(p=>({...p,search:e.target.value}))}
                        placeholder="Group / Booking / keyword"
                        onKeyDown={e=>{ if(e.key==="Enter") loadAudit(auditFilter); }}
                        style={{...inp,fontSize:12,padding:"7px 10px"}}/>
                    </div>
                    <button onClick={()=>loadAudit(auditFilter)}
                      style={{background:"#0a2a6e",color:"#fff",border:"none",borderRadius:8,padding:"8px 16px",fontSize:12,fontWeight:700,cursor:"pointer",alignSelf:"flex-end"}}>
                      🔍 ค้นหา
                    </button>
                    <button onClick={()=>{ const r={module:"",actor:"",search:""}; setAuditFilter(r); loadAudit(r); }}
                      style={{background:T.border,color:T.textSecond,border:"none",borderRadius:8,padding:"8px 12px",fontSize:12,fontWeight:700,cursor:"pointer",alignSelf:"flex-end"}}>
                      Reset
                    </button>
                  </div>

                  {/* Module count badges */}
                  <div style={{display:"flex",gap:6,marginTop:10,flexWrap:"wrap",alignItems:"center"}}>
                    <span style={{fontSize:11,color:T.textMuted}}>
                      {auditLoaded?`แสดง ${auditRows.length} รายการ (สูงสุด 500)`:"กด ค้นหา เพื่อโหลด"}
                    </span>
                    {ALL_MODULES.map(m=>{
                      const count = auditRows.filter(r=>r.module===m).length;
                      if (!count) return null;
                      return (
                        <span key={m} style={{fontSize:10,fontWeight:800,padding:"2px 8px",borderRadius:999,background:MODULE_COLOR[m]+"18",color:MODULE_COLOR[m],border:`1px solid ${MODULE_COLOR[m]}44`,cursor:"pointer"}}
                          onClick={()=>{ const f={...auditFilter,module:m}; setAuditFilter(f); loadAudit(f); }}>
                          {m}: {count}
                        </span>
                      );
                    })}
                  </div>
                </div>

                <div style={card({overflow:"hidden"})}>
                  <div style={{overflowX:"auto"}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                      <thead>
                        <tr style={{background:T.navy}}>
                          {["เวลา","Module","Action","Target ID","Group","SubCon","Actor","Remark"].map(h=>(
                            <th key={h} style={{padding:"8px 10px",textAlign:"left",color:T.white,fontWeight:700,fontSize:10,whiteSpace:"nowrap"}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {!auditLoaded ? (
                          <tr><td colSpan={8} style={{textAlign:"center",padding:32,color:T.textMuted,fontSize:12}}>กด ค้นหา เพื่อโหลด Audit Log</td></tr>
                        ) : auditRows.length===0 ? (
                          <tr><td colSpan={8} style={{textAlign:"center",padding:32,color:T.textMuted,fontSize:12}}>ไม่มีข้อมูลตามเงื่อนไขที่เลือก</td></tr>
                        ) : auditRows.map((r,i)=>{
                          const mColor = MODULE_COLOR[r.module]||T.textMuted;
                          return (
                            <tr key={r.id||i} style={{background:i%2===0?T.white:"#F8FAFF",borderBottom:`1px solid ${T.border}`}}>
                              <td style={{padding:"7px 10px",color:T.textMuted,whiteSpace:"nowrap",fontFamily:"monospace",fontSize:10}}>
                                {r.timestamp ? new Date(r.timestamp).toLocaleString("th-TH",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"}) : "—"}
                              </td>
                              <td style={{padding:"7px 10px"}}>
                                <span style={{fontSize:9,fontWeight:800,padding:"2px 7px",borderRadius:999,background:mColor+"18",color:mColor,border:`1px solid ${mColor}44`}}>
                                  {r.module}
                                </span>
                              </td>
                              <td style={{padding:"7px 10px",fontWeight:700,color:T.textPrimary,fontSize:10,whiteSpace:"nowrap"}}>{r.action||"—"}</td>
                              <td style={{padding:"7px 10px",fontFamily:"monospace",fontSize:10,color:T.navy}}>{r.target_id||"—"}</td>
                              <td style={{padding:"7px 10px",fontFamily:"monospace",fontSize:10}}>{r.group_number||"—"}</td>
                              <td style={{padding:"7px 10px",fontSize:10}}>{r.subcon_code||"—"}</td>
                              <td style={{padding:"7px 10px",fontWeight:600,color:T.navy,fontSize:10}}>{r.actor||"—"}</td>
                              <td style={{padding:"7px 10px",color:T.textSecond,fontSize:10,maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={r.remark||""}>
                                {r.remark||"—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── ADD USER MODAL ── */}
      {showAddUser && (
        <div style={{position:"fixed",inset:0,background:"rgba(10,20,50,.6)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,padding:16}}>
          <div style={{background:T.white,borderRadius:16,padding:24,width:"100%",maxWidth:420,boxShadow:"0 20px 60px rgba(0,0,0,.3)"}}>
            <div style={{fontWeight:800,color:T.navy,fontSize:16,marginBottom:16}}>👥 เพิ่ม User ใหม่</div>
            {[
              {l:"Username *",   k:"username"},
              {l:"Full Name *",  k:"fullName"},
              {l:"Email",        k:"email",    t:"email"},
              {l:"Password *",   k:"password", t:"password"},
            ].map(f=>(
              <div key={f.k} style={{marginBottom:10}}>
                <label style={{display:"block",fontSize:12,fontWeight:700,marginBottom:4,color:T.textSecond}}>{f.l}</label>
                <input value={newUser[f.k]} onChange={e=>setNewUser(p=>({...p,[f.k]:e.target.value}))} type={f.t||"text"} style={inp}/>
              </div>
            ))}
            <div style={{marginBottom:10}}>
              <label style={{display:"block",fontSize:12,fontWeight:700,marginBottom:4,color:T.textSecond}}>Role *</label>
              <select value={newUser.role} onChange={e=>setNewUser(p=>({...p,role:e.target.value}))} style={sel}>
                {ROLES.map(r=><option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div style={{marginBottom:16}}>
              <label style={{display:"block",fontSize:12,fontWeight:700,marginBottom:4,color:T.textSecond}}>SubCon (ถ้ามี)</label>
              <select value={newUser.subconCode} onChange={e=>setNewUser(p=>({...p,subconCode:e.target.value}))} style={sel}>
                <option value="">— ไม่มี —</option>
                {subcons.map(s=><option key={s.subcon_code} value={s.subcon_code}>{s.subcon_code} — {s.subcon_name}</option>)}
              </select>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setShowAddUser(false)} style={{flex:1,padding:"10px",background:T.border,color:T.textSecond,border:"none",borderRadius:10,fontWeight:700,cursor:"pointer"}}>ยกเลิก</button>
              <button onClick={createUser} disabled={saving} style={{flex:2,padding:"10px",background:T.red,color:T.white,border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",opacity:saving?.6:1}}>
                {saving?"กำลังสร้าง…":"✓ สร้าง User"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ADD SUBCON MODAL ── */}
      {showAddSubcon && (
        <div style={{position:"fixed",inset:0,background:"rgba(10,20,50,.6)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,padding:16}}>
          <div style={{background:T.white,borderRadius:16,padding:24,width:"100%",maxWidth:400,boxShadow:"0 20px 60px rgba(0,0,0,.3)"}}>
            <div style={{fontWeight:800,color:T.navy,fontSize:16,marginBottom:16}}>🏢 เพิ่ม SubCon ใหม่</div>
            {[
              {l:"SubCon Code *",k:"subcon_code",p:"เช่น MON"},
              {l:"SubCon Name *",k:"subcon_name",p:"ชื่อบริษัท"},
              {l:"Email",        k:"email",      t:"email"},
              {l:"Phone",        k:"phone",      t:"tel"},
            ].map(f=>(
              <div key={f.k} style={{marginBottom:10}}>
                <label style={{display:"block",fontSize:12,fontWeight:700,marginBottom:4,color:T.textSecond}}>{f.l}</label>
                <input value={newSc[f.k]} onChange={e=>setNewSc(p=>({...p,[f.k]:e.target.value}))}
                  type={f.t||"text"} placeholder={f.p} style={inp}/>
              </div>
            ))}
            <div style={{display:"flex",gap:8,marginTop:8}}>
              <button onClick={()=>setShowAddSubcon(false)} style={{flex:1,padding:"10px",background:T.border,color:T.textSecond,border:"none",borderRadius:10,fontWeight:700,cursor:"pointer"}}>ยกเลิก</button>
              <button onClick={createSubcon} disabled={saving} style={{flex:2,padding:"10px",background:T.red,color:T.white,border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",opacity:saving?.6:1}}>
                {saving?"กำลังสร้าง…":"✓ สร้าง SubCon"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
