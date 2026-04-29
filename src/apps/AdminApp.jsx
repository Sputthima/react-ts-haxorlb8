import React, { useState, useEffect, useCallback } from "react";
import { supabase, today, auditLog } from "../lib/supabase";
import { Alert, Spinner, StatusBadge } from "../components/UI";
import { T } from "../theme";

const ROLES = ["cs","gate","warehouse","queue","manager","admin","supplier"];
const ROLE_COLOR = {
  cs:T.navyLight, gate:T.amber, warehouse:T.purple,
  queue:T.goldDark, manager:T.blue, admin:T.red, supplier:T.green,
};

export default function AdminApp({ user, onBack }) {
  const [tab, setTab] = useState("users");
  const [users, setUsers] = useState([]);
  const [config, setConfig] = useState([]);
  const [subcons, setSubcons] = useState([]);
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Add User modal
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({username:"",fullName:"",role:"cs",subconCode:"",password:""});

  // Add SubCon modal
  const [showAddSubcon, setShowAddSubcon] = useState(false);
  const [newSc, setNewSc] = useState({subcon_code:"",subcon_name:"",email:"",phone:""});

  // Slot generation state
  const [slotPreview, setSlotPreview] = useState(null);
  const [dockCount, setDockCount] = useState(5);
  const [startHour, setStartHour] = useState(6);
  const [endHour, setEndHour] = useState(18);
  const [genDays, setGenDays] = useState(7);

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
  },[]);

  useEffect(()=>{ loadAll(); },[loadAll]);

  // ── USERS ─────────────────────────────────────────────────
  const toggleUser = async (id, active) => {
    await supabase.from("users").update({active:!active}).eq("id",id);
    await auditLog({module:"ADMIN",action:active?"DEACTIVATE_USER":"ACTIVATE_USER",targetType:"USER",targetId:String(id),actor:user.username});
    loadAll();
  };

  const createUser = async () => {
    if (!newUser.username||!newUser.fullName||!newUser.password)
      return setMsg({type:"err",msg:"กรุณากรอกให้ครบ"});
    setSaving(true);
    const { error } = await supabase.from("users").insert({
      username: newUser.username.trim(),
      password_hash: newUser.password,
      full_name: newUser.fullName,
      role: newUser.role,
      subcon_code: newUser.subconCode||null,
      active: true,
    });
    if (error) setMsg({type:"err",msg:error.message});
    else {
      setMsg({type:"ok",msg:`✅ สร้าง user ${newUser.username} สำเร็จ`});
      setShowAddUser(false);
      setNewUser({username:"",fullName:"",role:"cs",subconCode:"",password:""});
      await auditLog({module:"ADMIN",action:"CREATE_USER",targetType:"USER",targetId:newUser.username,actor:user.username});
      loadAll();
    }
    setSaving(false);
  };

  const resetPassword = async (u, newPw) => {
    if (!newPw) return;
    await supabase.from("users").update({password_hash:newPw}).eq("id",u.id);
    setMsg({type:"ok",msg:`✅ Reset password ของ ${u.username} แล้ว`});
    await auditLog({module:"ADMIN",action:"RESET_PASSWORD",targetType:"USER",targetId:u.username,actor:user.username});
  };

  // ── CONFIG ─────────────────────────────────────────────────
  const updateConfig = async (key, value) => {
    await supabase.from("config").update({value}).eq("key",key);
    setMsg({type:"ok",msg:`✅ อัปเดต ${key} แล้ว`});
    setTimeout(()=>setMsg(null),2000);
  };

  // ── SUBCON ─────────────────────────────────────────────────
  const createSubcon = async () => {
    if (!newSc.subcon_code||!newSc.subcon_name) return setMsg({type:"err",msg:"กรุณากรอก Code และ Name"});
    setSaving(true);
    const { error } = await supabase.from("subcon_master").insert({
      subcon_code:newSc.subcon_code.toUpperCase().trim(),
      subcon_name:newSc.subcon_name.trim(),
      email:newSc.email||"", phone:newSc.phone||"",
      active:true,
    });
    if (error) setMsg({type:"err",msg:error.message});
    else {
      setMsg({type:"ok",msg:`✅ สร้าง SubCon ${newSc.subcon_code} สำเร็จ`});
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

  // ── SLOTS ──────────────────────────────────────────────────
  const previewSlots = () => {
    const days = Array.from({length:genDays},(_,i)=>{
      const d=new Date(); d.setDate(d.getDate()+i);
      return d.toISOString().slice(0,10);
    });
    const hours = Array.from({length:endHour-startHour+1},(_,i)=>i+startHour);
    const total = days.length * hours.length * dockCount;
    setSlotPreview({days, hours, total});
  };

  const generateSlots = async () => {
    if (!slotPreview) return previewSlots();
    setSaving(true); setMsg(null);
    let created=0, skipped=0;
    for (const date of slotPreview.days) {
      for (const h of slotPreview.hours) {
        for (let dk=1; dk<=dockCount; dk++) {
          const hStr = String(h).padStart(2,"0")+":00";
          const key = `${date}_${hStr}_D${String(dk).padStart(2,"0")}`;
          const { error } = await supabase.from("dock_slots").insert({
            slot_key:key, slot_date:date,
            slot_hour:hStr+":00", dock_no:dk, status:"AVAILABLE",
          });
          if (error) skipped++; else created++;
        }
      }
    }
    setMsg({type:"ok",msg:`✅ สร้าง Slot ${created} รายการ | ข้าม ${skipped} (มีอยู่แล้ว)`});
    setSlotPreview(null); setSaving(false);
    await auditLog({module:"ADMIN",action:"GENERATE_SLOTS",targetType:"SLOT",targetId:"BATCH",actor:user.username,remark:`${created} slots`});
  };

  const clearOldSlots = async () => {
    if (!confirm("ลบ Slot ที่ผ่านมาแล้วทั้งหมด (AVAILABLE เท่านั้น)?")) return;
    setSaving(true);
    const { error } = await supabase.from("dock_slots")
      .delete().lt("slot_date", today()).eq("status","AVAILABLE");
    if (error) setMsg({type:"err",msg:error.message});
    else setMsg({type:"ok",msg:"✅ ลบ Slot เก่า (AVAILABLE) เรียบร้อย"});
    setSaving(false);
  };

  return (
    <div style={{minHeight:"100vh",background:T.bg}}>
      {/* TOPBAR */}
      <div style={{background:"linear-gradient(90deg,#7f1d1d,#b91c1c,#dc2626)",color:T.white,padding:"12px 18px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",position:"sticky",top:0,zIndex:40}}>
        <button onClick={onBack} style={{border:"1px solid rgba(255,255,255,.2)",background:"transparent",color:T.white,borderRadius:8,padding:"4px 10px",cursor:"pointer",fontSize:12}}>← Back</button>
        <span style={{fontWeight:800,fontSize:15}}>⚙️ Admin Panel</span>
        <div style={{display:"flex",gap:4,background:"rgba(255,255,255,.15)",borderRadius:8,padding:3,marginLeft:8,flexWrap:"wrap"}}>
          {[["users","👥 Users"],["subcon","🏢 SubCon"],["config","⚙️ Config"],["slots","📅 Slots"]].map(([t,l])=>(
            <button key={t} onClick={()=>setTab(t)}
              style={{border:"none",borderRadius:6,padding:"4px 10px",fontWeight:700,fontSize:11,cursor:"pointer",background:tab===t?T.white:"transparent",color:tab===t?T.red:"rgba(255,255,255,.8)"}}>
              {l}
            </button>
          ))}
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:8}}>
          {tab==="users" && <button onClick={()=>setShowAddUser(true)} style={{background:"#4ADE80",color:T.white,border:"none",borderRadius:8,padding:"5px 12px",fontWeight:700,cursor:"pointer",fontSize:12}}>+ User</button>}
          {tab==="subcon" && <button onClick={()=>setShowAddSubcon(true)} style={{background:"#4ADE80",color:T.white,border:"none",borderRadius:8,padding:"5px 12px",fontWeight:700,cursor:"pointer",fontSize:12}}>+ SubCon</button>}
        </div>
      </div>

      <div style={{padding:14,maxWidth:1000,margin:"0 auto"}}>
        {msg && <Alert type={msg.type} msg={msg.msg}/>}
        {loading ? <div style={{padding:40,textAlign:"center"}}><Spinner/></div> : <>

        {/* ── USERS TAB ── */}
        {tab==="users" && (
          <div style={{background:T.white,borderRadius:14,overflow:"hidden",boxShadow:T.shadow}}>
            <div style={{padding:"12px 16px",borderBottom:"1px solid #e5e7eb",fontWeight:800,color:T.navy,fontSize:14}}>
              Users ({users.length})
            </div>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead><tr style={{background:T.bg}}>
                  {["Username","Full Name","Role","SubCon","Active","Actions"].map(h=>(
                    <th key={h} style={{padding:"8px 12px",textAlign:"left",fontWeight:700,color:T.textSecond,whiteSpace:"nowrap"}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {users.map(u=>(
                    <tr key={u.id} style={{borderBottom:"1px solid #f3f4f6",opacity:u.active?1:.5}}>
                      <td style={{padding:"8px 12px",fontFamily:"monospace",fontWeight:700,fontSize:11}}>{u.username}</td>
                      <td style={{padding:"8px 12px"}}>{u.full_name}</td>
                      <td style={{padding:"8px 12px"}}>
                        <span style={{background:(ROLE_COLOR[u.role]||T.textMuted)+"22",color:ROLE_COLOR[u.role]||T.textMuted,borderRadius:999,padding:"2px 8px",fontSize:10,fontWeight:800}}>
                          {u.role}
                        </span>
                      </td>
                      <td style={{padding:"8px 12px",color:T.textMuted,fontSize:11}}>{u.subcon_code||"—"}</td>
                      <td style={{padding:"8px 12px"}}>
                        <span style={{color:u.active?T.green:T.red,fontWeight:700,fontSize:13}}>
                          {u.active?"✅":"❌"}
                        </span>
                      </td>
                      <td style={{padding:"8px 12px"}}>
                        <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                          <button onClick={()=>toggleUser(u.id,u.active)}
                            style={{background:u.active?T.redBg:T.greenBg,color:u.active?T.red:T.green,border:"none",borderRadius:6,padding:"3px 8px",cursor:"pointer",fontSize:11,fontWeight:700}}>
                            {u.active?"ปิด":"เปิด"}
                          </button>
                          <button onClick={()=>{const pw=prompt(`Reset password ของ ${u.username}:`);if(pw)resetPassword(u,pw);}}
                            style={{background:T.goldPale,color:T.goldDark,border:"none",borderRadius:6,padding:"3px 8px",cursor:"pointer",fontSize:11,fontWeight:700}}>
                            🔑 Reset PW
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

        {/* ── SUBCON TAB ── */}
        {tab==="subcon" && (
          <div style={{background:T.white,borderRadius:14,overflow:"hidden",boxShadow:T.shadow}}>
            <div style={{padding:"12px 16px",borderBottom:"1px solid #e5e7eb",fontWeight:800,color:T.navy,fontSize:14}}>
              SubCon Master ({subcons.length})
            </div>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead><tr style={{background:T.bg}}>
                  {["Code","Name","Email","Phone","Active",""].map(h=>(
                    <th key={h} style={{padding:"8px 12px",textAlign:"left",fontWeight:700,color:T.textSecond}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {subcons.map(sc=>(
                    <tr key={sc.id||sc.subcon_code} style={{borderBottom:"1px solid #f3f4f6",opacity:sc.active?1:.5}}>
                      <td style={{padding:"8px 12px",fontFamily:"monospace",fontWeight:800,color:T.navy}}>{sc.subcon_code}</td>
                      <td style={{padding:"8px 12px",fontWeight:600}}>{sc.subcon_name}</td>
                      <td style={{padding:"8px 12px",color:T.textMuted,fontSize:11}}>{sc.email||"—"}</td>
                      <td style={{padding:"8px 12px",color:T.textMuted,fontSize:11}}>{sc.phone||"—"}</td>
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

        {/* ── CONFIG TAB ── */}
        {tab==="config" && (
          <div style={{background:T.white,borderRadius:14,overflow:"hidden",boxShadow:T.shadow}}>
            <div style={{padding:"12px 16px",borderBottom:"1px solid #e5e7eb",fontWeight:800,color:T.navy,fontSize:14}}>Config Settings</div>
            <div style={{padding:12,fontSize:11,color:T.textMuted,borderBottom:"1px solid #f3f4f6"}}>
              แก้ค่าแล้ว click ออกนอก field — ระบบบันทึกอัตโนมัติ
            </div>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead><tr style={{background:T.bg}}>
                {["Key","Value","Description"].map(h=>(
                  <th key={h} style={{padding:"8px 12px",textAlign:"left",fontWeight:700,color:T.textSecond}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {config.map(c=>(
                  <tr key={c.key} style={{borderBottom:"1px solid #f3f4f6"}}>
                    <td style={{padding:"8px 12px",fontFamily:"monospace",fontWeight:700,fontSize:11,color:T.navy,whiteSpace:"nowrap"}}>{c.key}</td>
                    <td style={{padding:"6px 8px"}}>
                      <input defaultValue={c.value}
                        onBlur={e=>{ if(e.target.value!==String(c.value)) updateConfig(c.key,e.target.value); }}
                        style={{width:"100%",padding:"5px 8px",border:"1px solid #e5e7eb",borderRadius:7,fontSize:12,outline:"none",fontFamily:"monospace",boxSizing:"border-box"}}/>
                    </td>
                    <td style={{padding:"8px 12px",color:T.textMuted,fontSize:11}}>{c.description||"—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── SLOTS TAB ── */}
        {tab==="slots" && (
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            {/* GENERATE */}
            <div style={{background:T.white,borderRadius:14,padding:20,boxShadow:T.shadow}}>
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
                      style={{width:"100%",padding:"8px 10px",border:"1.5px solid #e5e7eb",borderRadius:9,fontSize:13,outline:"none",boxSizing:"border-box"}}/>
                  </div>
                ))}
              </div>
              {slotPreview && (
                <div style={{padding:12,background:T.blueBg,borderRadius:9,border:"1px solid #bfdbfe",marginBottom:12,fontSize:12}}>
                  <div style={{fontWeight:700,color:T.blue,marginBottom:4}}>Preview:</div>
                  <div>วันที่: {slotPreview.days[0]} ถึง {slotPreview.days[slotPreview.days.length-1]} ({slotPreview.days.length} วัน)</div>
                  <div>ชั่วโมง: {startHour}:00 - {endHour}:00 ({slotPreview.hours.length} slot/dock)</div>
                  <div>Dock: {dockCount} dock</div>
                  <div style={{fontWeight:700,marginTop:4,color:T.blue}}>รวม: {slotPreview.total} slots</div>
                </div>
              )}
              <div style={{display:"flex",gap:8}}>
                <button onClick={previewSlots}
                  style={{flex:1,padding:"10px",background:T.border,color:T.textSecond,border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:13}}>
                  Preview
                </button>
                <button onClick={generateSlots} disabled={saving}
                  style={{flex:2,padding:"10px",background:T.gold,color:T.white,border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:13,opacity:saving?.6:1}}>
                  {saving?"กำลังสร้าง…":"🗓 Generate Slots"}
                </button>
              </div>
            </div>

            {/* CLEAR OLD */}
            <div style={{background:T.white,borderRadius:14,padding:20,boxShadow:T.shadow}}>
              <div style={{fontWeight:800,color:T.red,fontSize:14,marginBottom:8}}>🗑 ลบ Slot เก่า</div>
              <div style={{fontSize:12,color:T.textMuted,marginBottom:12}}>ลบ Slot ที่ผ่านมาแล้ว (AVAILABLE เท่านั้น — BOOKED จะไม่ถูกลบ)</div>
              <button onClick={clearOldSlots} disabled={saving}
                style={{padding:"9px 20px",background:T.redBg,color:T.red,border:"none",borderRadius:9,fontWeight:700,cursor:"pointer",fontSize:12,opacity:saving?.6:1}}>
                🗑 ลบ Slot ที่ผ่านมา
              </button>
            </div>
          </div>
        )}
        </>}
      </div>

      {/* ── ADD USER MODAL ── */}
      {showAddUser && (
        <div style={{position:"fixed",inset:0,background:"rgba(10,20,50,.6)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,padding:16}}>
          <div style={{background:T.white,borderRadius:16,padding:24,width:"100%",maxWidth:420,boxShadow:"0 20px 60px rgba(0,0,0,.3)"}}>
            <div style={{fontWeight:800,color:T.navy,fontSize:16,marginBottom:16}}>👥 เพิ่ม User ใหม่</div>
            {[
              {l:"Username *",k:"username"},
              {l:"Full Name *",k:"fullName"},
              {l:"Password *",k:"password",t:"password"},
            ].map(f=>(
              <div key={f.k} style={{marginBottom:10}}>
                <label style={{display:"block",fontSize:12,fontWeight:700,marginBottom:4,color:T.textSecond}}>{f.l}</label>
                <input value={newUser[f.k]} onChange={e=>setNewUser(p=>({...p,[f.k]:e.target.value}))} type={f.t||"text"}
                  style={{width:"100%",padding:"8px 10px",border:"1.5px solid #e5e7eb",borderRadius:9,fontSize:13,outline:"none",boxSizing:"border-box"}}/>
              </div>
            ))}
            <div style={{marginBottom:10}}>
              <label style={{display:"block",fontSize:12,fontWeight:700,marginBottom:4,color:T.textSecond}}>Role *</label>
              <select value={newUser.role} onChange={e=>setNewUser(p=>({...p,role:e.target.value}))}
                style={{width:"100%",padding:"8px 10px",border:"1.5px solid #e5e7eb",borderRadius:9,fontSize:13,outline:"none",boxSizing:"border-box"}}>
                {ROLES.map(r=><option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div style={{marginBottom:16}}>
              <label style={{display:"block",fontSize:12,fontWeight:700,marginBottom:4,color:T.textSecond}}>SubCon (ถ้ามี)</label>
              <select value={newUser.subconCode} onChange={e=>setNewUser(p=>({...p,subconCode:e.target.value}))}
                style={{width:"100%",padding:"8px 10px",border:"1.5px solid #e5e7eb",borderRadius:9,fontSize:13,outline:"none",boxSizing:"border-box"}}>
                <option value="">— ไม่มี —</option>
                {subcons.map(s=><option key={s.subcon_code} value={s.subcon_code}>{s.subcon_code} — {s.subcon_name}</option>)}
              </select>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setShowAddUser(false)} style={{flex:1,padding:"10px",background:T.border,color:T.textSecond,border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:13}}>ยกเลิก</button>
              <button onClick={createUser} disabled={saving} style={{flex:2,padding:"10px",background:T.red,color:T.white,border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:13,opacity:saving?.6:1}}>
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
              {l:"Email",k:"email",t:"email"},
              {l:"Phone",k:"phone",t:"tel"},
            ].map(f=>(
              <div key={f.k} style={{marginBottom:10}}>
                <label style={{display:"block",fontSize:12,fontWeight:700,marginBottom:4,color:T.textSecond}}>{f.l}</label>
                <input value={newSc[f.k]} onChange={e=>setNewSc(p=>({...p,[f.k]:e.target.value}))}
                  type={f.t||"text"} placeholder={f.p}
                  style={{width:"100%",padding:"8px 10px",border:"1.5px solid #e5e7eb",borderRadius:9,fontSize:13,outline:"none",boxSizing:"border-box"}}/>
              </div>
            ))}
            <div style={{display:"flex",gap:8,marginTop:8}}>
              <button onClick={()=>setShowAddSubcon(false)} style={{flex:1,padding:"10px",background:T.border,color:T.textSecond,border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:13}}>ยกเลิก</button>
              <button onClick={createSubcon} disabled={saving} style={{flex:2,padding:"10px",background:T.red,color:T.white,border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:13,opacity:saving?.6:1}}>
                {saving?"กำลังสร้าง…":"✓ สร้าง SubCon"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
