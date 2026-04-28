import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase, today, nowISO, auditLog } from "../lib/supabase";
import { Alert, Spinner, StatusBadge } from "../components/UI";

export default function OBDApp({ user, onBack }) {
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
  const [bulkRows, setBulkRows] = useState([]);
  const [showBulk, setShowBulk] = useState(false);
  const fileRef = useRef();

  const loadData = useCallback(async () => {
    setLoading(true);
    const [obdRes, grpRes, scRes] = await Promise.all([
      supabase.from("obd_release").select("*").order("created_at",{ascending:false}).limit(200),
      supabase.from("group_header").select("*").order("created_at",{ascending:false}).limit(100),
      supabase.from("subcon_master").select("*").eq("active",true).order("subcon_code"),
    ]);
    if (obdRes.data) setObdList(obdRes.data);
    if (grpRes.data) setGroups(grpRes.data);
    if (scRes.data) setSubcons(scRes.data);
    setLoading(false);
  },[]);

  useEffect(()=>{ loadData(); },[loadData]);

  useEffect(()=>{
    const ch = supabase.channel("obd_live")
      .on("postgres_changes",{event:"*",schema:"public",table:"obd_release"},()=>loadData())
      .on("postgres_changes",{event:"*",schema:"public",table:"group_header"},()=>loadData())
      .subscribe((s)=>{ if(s==="CHANNEL_ERROR"||s==="TIMED_OUT") console.warn("OBD Realtime error"); });
    return ()=>{ try{supabase.removeChannel(ch);}catch(e){} };
  },[loadData]);

  const createOBD = async () => {
    if (!form.subConCode) return setMsg({type:"err",msg:"กรุณาเลือก SubCon"});
    if (!form.qty||isNaN(+form.qty)) return setMsg({type:"err",msg:"กรุณากรอก Qty"});
    setCreating(true); setMsg(null);
    const sc = subcons.find(s=>s.subcon_code===form.subConCode);
    const obdNo = "OBD-"+form.subConCode+"-"+Date.now().toString().slice(-6);
    const {error} = await supabase.from("obd_release").insert({
      obd_no:obdNo, release_date:form.releaseDate,
      subcon_code:form.subConCode, subcon_name:sc?.subcon_name||"",
      qty:Number(form.qty), line_count:Number(form.lineCount||1),
      status:"OPEN", created_by:user.username,
    });
    if (error) setMsg({type:"err",msg:error.message});
    else {
      await auditLog({module:"OBD",action:"CREATE_OBD",targetType:"OBD",targetId:obdNo,subconCode:form.subConCode,actor:user.username});
      setMsg({type:"ok",msg:`✅ สร้าง OBD ${obdNo} สำเร็จ`});
      setShowCreate(false); setForm({releaseDate:today(),subConCode:"",qty:"",lineCount:"",remarks:""});
    }
    setCreating(false);
  };

  const createGroup = async () => {
    if (!selectedObds.length) return setMsg({type:"err",msg:"เลือก OBD ก่อน"});
    const firstObd = obdList.find(o=>o.obd_no===selectedObds[0]);
    if (!firstObd) return;
    const allSame = selectedObds.every(id=>obdList.find(o=>o.obd_no===id)?.subcon_code===firstObd.subcon_code);
    if (!allSame) return setMsg({type:"err",msg:"OBD ต้องเป็น SubCon เดียวกัน"});
    setCreating(true); setMsg(null);
    const grpNo = "GRP-"+firstObd.subcon_code+"-"+Date.now().toString().slice(-6);
    const totalQty = selectedObds.reduce((s,id)=>{const o=obdList.find(x=>x.obd_no===id);return s+(o?.qty||0);},0);
    const {error:gErr} = await supabase.from("group_header").insert({
      group_number:grpNo, subcon_code:firstObd.subcon_code, subcon_name:firstObd.subcon_name,
      group_date:today(), total_obd:selectedObds.length, total_qty:totalQty,
      status:"BOOKING_PENDING", created_by:user.username,
    });
    if (gErr) { setMsg({type:"err",msg:gErr.message}); setCreating(false); return; }
    // insert group_detail
    for(const id of selectedObds){
      const o=obdList.find(x=>x.obd_no===id);
      if(o) await supabase.from("group_detail").insert({group_number:grpNo,obd_no:id,qty:o.qty,line_count:o.line_count,status:"GROUPED"});
    }
    await supabase.from("obd_release").update({status:"GROUPED",group_number:grpNo}).in("obd_no",selectedObds);
    await auditLog({module:"OBD",action:"CREATE_GROUP",targetType:"GROUP",targetId:grpNo,actor:user.username,remark:`${selectedObds.length} OBD`});
    setMsg({type:"ok",msg:`✅ สร้าง Group ${grpNo} สำเร็จ (${selectedObds.length} OBD, ${totalQty} units)`});
    setSelectedObds([]); setShowGroup(false); setCreating(false);
  };

  const handleCSV = async(e)=>{
    const file=e.target.files[0]; if(!file) return;
    const text=await file.text();
    const lines=text.split("\n").filter(l=>l.trim());
    const headers=lines[0].split(",").map(h=>h.trim().replace(/"/g,""));
    const rows=lines.slice(1).map(l=>{
      const vals=l.split(",").map(v=>v.trim().replace(/"/g,""));
      return Object.fromEntries(headers.map((h,i)=>[h,vals[i]||""]));
    });
    setBulkRows(rows); setShowBulk(true);
  };

  const submitBulk = async()=>{
    setCreating(true); setMsg(null);
    let created=0,failed=[];
    for(const row of bulkRows){
      try{
        if(!row.obdNo||!row.subConCode||!row.qty) throw new Error("ข้อมูลไม่ครบ");
        const sc=subcons.find(s=>s.subcon_code===row.subConCode);
        if(!sc) throw new Error(`SubCon ${row.subConCode} ไม่พบ`);
        const {error}=await supabase.from("obd_release").insert({
          obd_no:row.obdNo, release_date:row.releaseDate||today(),
          subcon_code:sc.subcon_code, subcon_name:sc.subcon_name,
          qty:Number(row.qty), line_count:Number(row.lineCount||1),
          status:"OPEN", created_by:user.username, remarks:row.remarks||"",
        });
        if(error) throw new Error(error.message);
        created++;
      }catch(err){ failed.push({obdNo:row.obdNo,error:err.message}); }
    }
    await auditLog({module:"OBD",action:"BULK_CREATE_OBD",targetType:"OBD",targetId:"BULK",actor:user.username,remark:`สร้าง ${created} รายการ`});
    setMsg({type:failed.length===0?"ok":"warn",msg:`สร้างสำเร็จ ${created} | ล้มเหลว ${failed.length}${failed.length>0?": "+failed.map(f=>f.obdNo).join(", "):""}`});
    setBulkRows([]); setShowBulk(false); setCreating(false);
  };

  const STATUS_COLOR={OPEN:{bg:"#d1fae5",c:"#065f46"},GROUPED:{bg:"#dbeafe",c:"#1d4ed8"},BOOKED:{bg:"#ede9fe",c:"#5b21b6"},COMPLETED:{bg:"#f3f4f6",c:"#6b7280"},CANCELLED:{bg:"#fee2e2",c:"#991b1b"}};
  const GRP_COLOR={BOOKING_PENDING:{bg:"#fef9c3",c:"#92400e"},BOOKED:{bg:"#dbeafe",c:"#1d4ed8"},ON_YARD:{bg:"#fef9c3",c:"#854d0e"},CALLED_TO_DOCK:{bg:"#ffedd5",c:"#9a3412"},TRUCK_DOCKED:{bg:"#ede9fe",c:"#5b21b6"},LOADING:{bg:"#dbeafe",c:"#1e40af"},COMPLETED:{bg:"#f3f4f6",c:"#6b7280"}};
  const toggleObd=(id)=>setSelectedObds(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);

  return (
    <div style={{minHeight:"100vh",background:"#f0f4fb"}}>
      <div style={{background:"linear-gradient(90deg,#0a2a6e,#1d4ed8)",color:"#fff",padding:"12px 18px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",position:"sticky",top:0,zIndex:40}}>
        <button onClick={onBack} style={{border:"1px solid rgba(255,255,255,.2)",background:"transparent",color:"#fff",borderRadius:8,padding:"4px 10px",cursor:"pointer",fontSize:12}}>← Back</button>
        <span style={{fontWeight:800,fontSize:15}}>📦 OBD & Group</span>
        <div style={{display:"flex",gap:4,background:"rgba(255,255,255,.1)",borderRadius:8,padding:3,marginLeft:8}}>
          {[["obd","📦 OBD"],["group","👥 Group"]].map(([t,l])=>(
            <button key={t} onClick={()=>setTab(t)} style={{border:"none",borderRadius:6,padding:"4px 12px",fontWeight:700,fontSize:12,cursor:"pointer",background:tab===t?"#fff":"transparent",color:tab===t?"#0a2a6e":"rgba(255,255,255,.7)"}}>{l}</button>
          ))}
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:6}}>
          {tab==="obd" && <>
            <button onClick={()=>setShowCreate(true)} style={{background:"#22c55e",color:"#fff",border:"none",borderRadius:8,padding:"5px 12px",fontWeight:700,cursor:"pointer",fontSize:12}}>+ สร้าง OBD</button>
            <label style={{background:"#0891b2",color:"#fff",border:"none",borderRadius:8,padding:"5px 12px",fontWeight:700,cursor:"pointer",fontSize:12}}>
              📤 Import CSV <input ref={fileRef} type="file" accept=".csv" onChange={handleCSV} style={{display:"none"}}/>
            </label>
            {selectedObds.length>0 && <button onClick={()=>setShowGroup(true)} style={{background:"#f59e0b",color:"#fff",border:"none",borderRadius:8,padding:"5px 12px",fontWeight:700,cursor:"pointer",fontSize:12}}>👥 Group ({selectedObds.length})</button>}
          </>}
        </div>
      </div>

      <div style={{padding:14,maxWidth:1000,margin:"0 auto"}}>
        {msg && <Alert type={msg.type} msg={msg.msg}/>}
        {loading ? <div style={{padding:40,textAlign:"center"}}><Spinner/></div> : <>

        {tab==="obd" && (
          <div style={{background:"#fff",borderRadius:14,overflow:"hidden",boxShadow:"0 4px 20px rgba(0,0,0,.07)"}}>
            <div style={{padding:"12px 16px",borderBottom:"1px solid #e5e7eb",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontWeight:800,color:"#0a2a6e",fontSize:14}}>OBD Release <span style={{fontSize:11,color:"#6b7280",fontWeight:400}}>({obdList.length})</span></div>
              {selectedObds.length>0 && <span style={{fontSize:11,color:"#1d4ed8",fontWeight:700}}>{selectedObds.length} เลือกแล้ว</span>}
            </div>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead><tr style={{background:"#f8fafc"}}>
                  <th style={{padding:"8px 10px",width:32}}></th>
                  {["OBD No","วันที่","SubCon","Qty","Status","Group"].map(h=>(
                    <th key={h} style={{padding:"8px 10px",textAlign:"left",fontWeight:700,color:"#374151"}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {obdList.length===0 ? (
                    <tr><td colSpan={7} style={{padding:24,textAlign:"center",color:"#9ca3af"}}>ยังไม่มี OBD</td></tr>
                  ) : obdList.map(o=>{
                    const sc=STATUS_COLOR[o.status]||{bg:"#f3f4f6",c:"#374151"};
                    const canSel=o.status==="OPEN";
                    const isSel=selectedObds.includes(o.obd_no);
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

        {tab==="group" && (
          <div style={{background:"#fff",borderRadius:14,overflow:"hidden",boxShadow:"0 4px 20px rgba(0,0,0,.07)"}}>
            <div style={{padding:"12px 16px",borderBottom:"1px solid #e5e7eb",fontWeight:800,color:"#0a2a6e",fontSize:14}}>
              Groups <span style={{fontSize:11,color:"#6b7280",fontWeight:400}}>({groups.length})</span>
            </div>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead><tr style={{background:"#f8fafc"}}>
                  {["Group No","SubCon","วันที่","OBD","Qty","Status","Booking"].map(h=>(
                    <th key={h} style={{padding:"8px 10px",textAlign:"left",fontWeight:700,color:"#374151",whiteSpace:"nowrap"}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {groups.length===0 ? (
                    <tr><td colSpan={7} style={{padding:24,textAlign:"center",color:"#9ca3af"}}>ยังไม่มี Group</td></tr>
                  ) : groups.map(g=>{
                    const gc=GRP_COLOR[g.status]||{bg:"#f3f4f6",c:"#374151"};
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
            {[{label:"วันที่ *",key:"releaseDate",type:"date"},{label:"Qty *",key:"qty",type:"number",placeholder:"จำนวน"},{label:"Lines",key:"lineCount",type:"number",placeholder:"จำนวน Line"}].map(f=>(
              <div key={f.key} style={{marginBottom:12}}>
                <label style={{display:"block",fontSize:12,fontWeight:700,marginBottom:5,color:"#374151"}}>{f.label}</label>
                <input value={form[f.key]} onChange={e=>setForm(p=>({...p,[f.key]:e.target.value}))} type={f.type} placeholder={f.placeholder}
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

      {/* GROUP MODAL */}
      {showGroup && (
        <div style={{position:"fixed",inset:0,background:"rgba(10,20,50,.6)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,padding:16}}>
          <div style={{background:"#fff",borderRadius:16,padding:24,width:"100%",maxWidth:400,boxShadow:"0 20px 60px rgba(0,0,0,.3)"}}>
            <div style={{fontWeight:800,color:"#0a2a6e",fontSize:16,marginBottom:8}}>👥 สร้าง Group</div>
            <div style={{fontSize:12,color:"#6b7280",marginBottom:16}}>{selectedObds.length} OBD — รวม {selectedObds.reduce((s,id)=>{const o=obdList.find(x=>x.obd_no===id);return s+(o?.qty||0);},0)} units</div>
            <div style={{maxHeight:200,overflowY:"auto",marginBottom:16}}>
              {selectedObds.map(id=>{const o=obdList.find(x=>x.obd_no===id);return(
                <div key={id} style={{padding:"6px 10px",background:"#f0f4fb",borderRadius:8,marginBottom:6,fontSize:12,fontFamily:"monospace",fontWeight:700}}>{id} <span style={{color:"#6b7280",fontWeight:400}}>({o?.qty})</span></div>
              );})}
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

      {/* BULK PREVIEW MODAL */}
      {showBulk && bulkRows.length>0 && (
        <div style={{position:"fixed",inset:0,background:"rgba(10,20,50,.6)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,padding:16}}>
          <div style={{background:"#fff",borderRadius:16,padding:24,width:"100%",maxWidth:700,maxHeight:"80vh",overflow:"auto",boxShadow:"0 20px 60px rgba(0,0,0,.3)"}}>
            <div style={{fontWeight:800,color:"#0a2a6e",fontSize:16,marginBottom:12}}>📤 Preview: {bulkRows.length} rows</div>
            <div style={{overflowX:"auto",maxHeight:300,border:"1px solid #e5e7eb",borderRadius:8,marginBottom:16}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                <thead><tr style={{background:"#f8fafc",position:"sticky",top:0}}>
                  {Object.keys(bulkRows[0]).map(h=><th key={h} style={{padding:"5px 8px",textAlign:"left",fontWeight:700,color:"#374151",whiteSpace:"nowrap"}}>{h}</th>)}
                </tr></thead>
                <tbody>{bulkRows.map((r,i)=>(
                  <tr key={i} style={{borderBottom:"1px solid #f3f4f6"}}>
                    {Object.values(r).map((v,j)=><td key={j} style={{padding:"4px 8px",fontFamily:"monospace",fontSize:10}}>{v}</td>)}
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div style={{fontSize:11,color:"#6b7280",marginBottom:12}}>CSV ต้องมี columns: obdNo, subConCode, releaseDate, qty, lineCount, remarks</div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setShowBulk(false)} style={{flex:1,padding:"10px",background:"#e5e7eb",color:"#374151",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:13}}>ยกเลิก</button>
              <button onClick={submitBulk} disabled={creating} style={{flex:2,padding:"10px",background:"#0891b2",color:"#fff",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:13,opacity:creating?.6:1}}>
                {creating?`กำลัง import…`:`✓ Import ${bulkRows.length} OBD`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
