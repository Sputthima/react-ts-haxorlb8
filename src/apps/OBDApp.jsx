import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase, today, nowISO, auditLog, sendEmail } from "../lib/supabase";
import { downloadOBDTemplate } from "../lib/templates";
import { usePermissions, applySubconFilter } from "../lib/permissions";
import { Alert, Spinner, StatusBadge } from "../components/UI";
import { T } from "../theme";

// ─────────────────────────────────────────────────────────────
//  OBDApp v3 — ตาม GAS App1
//
//  Fixes vs เดิม:
//  1. OBD No: กรอกเอง (ไม่ gen auto) — ตาม GAS createObd_
//  2. Group No format: {initial}{yyMMdd}{seq2d} เช่น MON26043001
//  3. Cancel Group → revert OBD กลับ OPEN
//  4. Cancel OBD (OPEN เท่านั้น)
//  5. OBD list: filter แสดงเฉพาะ OPEN (pending booking ตัดออก)
//     → tab แยก: OPEN | GROUPED | ทั้งหมด
//  6. Email หลัง create group
//  7. Group detail modal (ดู OBD ใน group)
// ─────────────────────────────────────────────────────────────

// ── Group Number generator (ตาม GAS generateGroupNumber_) ───
// format: {initial}{yyMMdd}{seq2d}
// seq = running sequence ของวันนั้นๆ ต่อ subcon เดิม
async function generateGroupNumber(subconInitial) {
  const now   = new Date();
  const yy    = String(now.getFullYear()).slice(-2);
  const mm    = String(now.getMonth()+1).padStart(2,"0");
  const dd    = String(now.getDate()).padStart(2,"0");
  const yymmdd = yy+mm+dd;
  const prefix = `${subconInitial}${yymmdd}`;

  // หา sequence วันนี้ = count group ที่ขึ้นต้นด้วย prefix นี้
  const { data } = await supabase.from("group_header")
    .select("group_number")
    .like("group_number", `${prefix}%`);
  const seq = String(((data||[]).length)+1).padStart(2,"0");
  return `${prefix}${seq}`;
}

const STATUS_COLOR = {
  OPEN:      {bg:"#d1fae5",c:"#065f46"},
  GROUPED:   {bg:"#dbeafe",c:"#1d4ed8"},
  BOOKED:    {bg:"#ede9fe",c:"#6d28d9"},
  COMPLETED: {bg:"#f3f4f6",c:"#6b7280"},
  CANCELLED: {bg:"#fee2e2",c:"#991b1b"},
};
const GRP_COLOR = {
  BOOKING_PENDING:{bg:"#fef3c7",c:"#92400e"},
  BOOKED:         {bg:"#dbeafe",c:"#1d4ed8"},
  ON_YARD:        {bg:"#fef9c3",c:"#92400e"},
  CALLED_TO_DOCK: {bg:"#ffedd5",c:"#c2410c"},
  TRUCK_DOCKED:   {bg:"#ede9fe",c:"#6d28d9"},
  LOADING:        {bg:"#dbeafe",c:"#0a2a6e"},
  COMPLETED:      {bg:"#f3f4f6",c:"#6b7280"},
  CANCELLED:      {bg:"#fee2e2",c:"#991b1b"},
};

export default function OBDApp({ user, onBack }) {
  const [tab, setTab]               = useState("obd");
  const [obdFilter, setObdFilter]   = useState("OPEN"); // OPEN | ALL
  const [obdList, setObdList]       = useState([]);
  const [groups, setGroups]         = useState([]);
  const [subcons, setSubcons]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [msg, setMsg]               = useState(null);

  // Create OBD
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm]             = useState({obdNo:"",releaseDate:today(),subConCode:"",qty:"",lineCount:"",remarks:""});
  const [creating, setCreating]     = useState(false);

  // Group
  const [selectedObds, setSelectedObds] = useState([]);
  const [showGroup, setShowGroup]       = useState(false);

  // Group detail modal
  const [groupDetail, setGroupDetail]   = useState(null); // {header, details}

  // Bulk import
  const [bulkRows, setBulkRows]   = useState([]);
  const [showBulk, setShowBulk]   = useState(false);
  const fileRef = useRef();

  const p = usePermissions(user);

  // ── LOAD ─────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    // Subcon เห็นแค่ข้อมูลของตัวเอง
    let obdQ = supabase.from("obd_release").select("*").order("created_at",{ascending:false}).limit(300);
    let grpQ = supabase.from("group_header").select("*").order("created_at",{ascending:false}).limit(200);
    obdQ = applySubconFilter(obdQ, user);
    grpQ = applySubconFilter(grpQ, user);
    const [obdRes, grpRes, scRes] = await Promise.all([
      obdQ,
      grpQ,
      supabase.from("subcon_master").select("*").eq("active",true).order("subcon_code"),
    ]);
    if (obdRes.data) setObdList(obdRes.data);
    if (grpRes.data) setGroups(grpRes.data);
    if (scRes.data)  setSubcons(scRes.data);
    setLoading(false);
  },[]);

  useEffect(()=>{ loadData(); },[loadData]);

  useEffect(()=>{
    const ch = supabase.channel("obd_live")
      .on("postgres_changes",{event:"*",schema:"public",table:"obd_release"},   ()=>loadData())
      .on("postgres_changes",{event:"*",schema:"public",table:"group_header"},  ()=>loadData())
      .subscribe(s=>{ if(s==="CHANNEL_ERROR") console.warn("OBD realtime error"); });
    return ()=>{ try{supabase.removeChannel(ch);}catch(e){} };
  },[loadData]);

  const showMsg = (type, text) => setMsg({type,msg:text});

  // ── CREATE OBD (FIX 1: OBD No กรอกเอง) ──────────────────────
  const createOBD = async () => {
    if (!form.obdNo.trim())   return showMsg("err","กรุณากรอก OBD No");
    if (!form.subConCode)     return showMsg("err","กรุณาเลือก SubCon");
    if (!form.qty||isNaN(+form.qty)) return showMsg("err","กรุณากรอก Qty");

    // check duplicate
    const { data: exist } = await supabase.from("obd_release")
      .select("obd_no").eq("obd_no", form.obdNo.trim()).maybeSingle();
    if (exist) return showMsg("err",`OBD No ${form.obdNo} มีอยู่แล้ว`);

    setCreating(true); setMsg(null);
    const sc = subcons.find(s=>s.subcon_code===form.subConCode);
    const { error } = await supabase.from("obd_release").insert({
      obd_no:        form.obdNo.trim(),
      release_date:  form.releaseDate,
      subcon_code:   form.subConCode,
      subcon_name:   sc?.subcon_name||"",
      qty:           Number(form.qty),
      line_count:    Number(form.lineCount||1),
      status:        "OPEN",
      created_by:    user.username,
      remarks:       form.remarks,
    });
    if (error) showMsg("err",error.message);
    else {
      await auditLog({module:"OBD",action:"CREATE_OBD",targetType:"OBD",targetId:form.obdNo.trim(),subconCode:form.subConCode,actor:user.username});
      showMsg("ok",`✅ สร้าง OBD ${form.obdNo} สำเร็จ`);
      setShowCreate(false);
      setForm({obdNo:"",releaseDate:today(),subConCode:"",qty:"",lineCount:"",remarks:""});
    }
    setCreating(false);
  };

  // ── CANCEL OBD (OPEN เท่านั้น — ตาม GAS) ────────────────────
  const cancelOBD = async (obd) => {
    if (obd.status !== "OPEN") return showMsg("err","ยกเลิกได้เฉพาะ OBD ที่ OPEN เท่านั้น");
    if (!confirm(`ยืนยันยกเลิก OBD ${obd.obd_no}?`)) return;
    await supabase.from("obd_release")
      .update({status:"CANCELLED", updated_at:nowISO()})
      .eq("obd_no", obd.obd_no);
    await auditLog({module:"OBD",action:"CANCEL_OBD",targetType:"OBD",targetId:obd.obd_no,actor:user.username});
    showMsg("ok",`✅ ยกเลิก OBD ${obd.obd_no} แล้ว`);
    loadData();
  };

  // ── CREATE GROUP (FIX 2: Group No format ตาม GAS) ────────────
  const createGroup = async () => {
    if (!selectedObds.length) return showMsg("err","เลือก OBD ก่อน");
    const firstObd = obdList.find(o=>o.obd_no===selectedObds[0]);
    if (!firstObd) return;

    // validate: subcon เดียวกัน + status OPEN ทั้งหมด
    for (const id of selectedObds) {
      const o = obdList.find(x=>x.obd_no===id);
      if (o?.subcon_code !== firstObd.subcon_code)
        return showMsg("err","OBD ต้องเป็น SubCon เดียวกัน");
      if (o?.status !== "OPEN")
        return showMsg("err",`OBD ${id} ไม่ได้อยู่ใน status OPEN`);
    }

    setCreating(true); setMsg(null);

    // FIX 2: หา subcon_initial → gen group number format GAS
    const sc = subcons.find(s=>s.subcon_code===firstObd.subcon_code);
    const initial  = sc?.subcon_initial || sc?.subcon_code || firstObd.subcon_code;
    const grpNo    = await generateGroupNumber(initial);
    const totalQty = selectedObds.reduce((s,id)=>{const o=obdList.find(x=>x.obd_no===id);return s+(o?.qty||0);},0);

    const { error: gErr } = await supabase.from("group_header").insert({
      group_number: grpNo,
      subcon_code:  firstObd.subcon_code,
      subcon_name:  firstObd.subcon_name,
      group_date:   today(),
      total_obd:    selectedObds.length,
      total_qty:    totalQty,
      status:       "BOOKING_PENDING",
      created_by:   user.username,
    });
    if (gErr) { showMsg("err",gErr.message); setCreating(false); return; }

    // insert group_detail
    for (const id of selectedObds) {
      const o = obdList.find(x=>x.obd_no===id);
      if (o) {
        await supabase.from("group_detail").insert({
          group_number:grpNo, obd_no:id,
          qty:o.qty, line_count:o.line_count, status:"GROUPED",
        });
      }
    }

    // update obd → GROUPED
    await supabase.from("obd_release")
      .update({status:"GROUPED", group_number:grpNo, updated_at:nowISO()})
      .in("obd_no", selectedObds);

    await auditLog({module:"OBD",action:"CREATE_GROUP",targetType:"GROUP",targetId:grpNo,subconCode:firstObd.subcon_code,actor:user.username,remark:`${selectedObds.length} OBD`});

    // FIX 6: Email after group created (ตาม GAS queueEmail_ GROUP_CREATED)
    try {
      if (sc?.email) {
        await sendEmail({ to:sc.email, type:"group_created", data:{
          group_number:grpNo, subcon_name:firstObd.subcon_name,
          total_obd:selectedObds.length, total_qty:totalQty,
        }});
      }
    } catch(e) { console.warn("Group email failed:", e.message); }

    showMsg("ok",`✅ สร้าง Group ${grpNo} สำเร็จ (${selectedObds.length} OBD, ${totalQty} units)`);
    setSelectedObds([]); setShowGroup(false); setCreating(false);
    loadData();
  };

  // ── CANCEL GROUP → revert OBD กลับ OPEN (FIX 3) ─────────────
  const cancelGroup = async (grp) => {
    if (!["BOOKING_PENDING"].includes(grp.status))
      return showMsg("err","ยกเลิก Group ได้เฉพาะ BOOKING_PENDING เท่านั้น");
    if (!confirm(`ยืนยันยกเลิก Group ${grp.group_number}?\nOBD ใน Group จะกลับเป็น OPEN ทั้งหมด`)) return;

    // 1. cancel group_header
    await supabase.from("group_header")
      .update({status:"CANCELLED", updated_at:nowISO()})
      .eq("group_number", grp.group_number);

    // 2. revert obd_release → OPEN (ตาม GAS: group cancelled → OBD กลับ OPEN)
    await supabase.from("obd_release")
      .update({status:"OPEN", group_number:null, updated_at:nowISO()})
      .eq("group_number", grp.group_number);

    await auditLog({module:"OBD",action:"CANCEL_GROUP",targetType:"GROUP",targetId:grp.group_number,actor:user.username,remark:"Group cancelled, OBD reverted to OPEN"});
    showMsg("ok",`✅ ยกเลิก Group ${grp.group_number} แล้ว — OBD กลับเป็น OPEN`);
    loadData();
  };

  // ── LOAD GROUP DETAIL ─────────────────────────────────────────
  const openGroupDetail = async (grp) => {
    const { data: details } = await supabase.from("group_detail")
      .select("*").eq("group_number", grp.group_number);
    setGroupDetail({ header:grp, details: details||[] });
  };

  // ── BULK IMPORT CSV ───────────────────────────────────────────
  const handleCSV = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const text = await file.text();
    const lines = text.split("\n").filter(l=>l.trim());
    const headers = lines[0].split(",").map(h=>h.trim().replace(/"/g,""));
    const rows = lines.slice(1).map(l=>{
      const vals = l.split(",").map(v=>v.trim().replace(/"/g,""));
      return Object.fromEntries(headers.map((h,i)=>[h,vals[i]||""]));
    });
    setBulkRows(rows); setShowBulk(true);
    if (fileRef.current) fileRef.current.value = "";
  };

  const submitBulk = async () => {
    setCreating(true); setMsg(null);
    let created=0, failed=[];
    for (const row of bulkRows) {
      try {
        if (!row.obdNo||!row.subConCode||!row.qty) throw new Error("ข้อมูลไม่ครบ");
        const sc = subcons.find(s=>s.subcon_code===row.subConCode);
        if (!sc) throw new Error(`SubCon ${row.subConCode} ไม่พบ`);
        // check duplicate
        const { data: ex } = await supabase.from("obd_release")
          .select("obd_no").eq("obd_no",row.obdNo).maybeSingle();
        if (ex) throw new Error(`OBD ${row.obdNo} มีอยู่แล้ว`);

        const { error } = await supabase.from("obd_release").insert({
          obd_no:row.obdNo, release_date:row.releaseDate||today(),
          subcon_code:sc.subcon_code, subcon_name:sc.subcon_name,
          qty:Number(row.qty), line_count:Number(row.lineCount||1),
          status:"OPEN", created_by:user.username, remarks:row.remarks||"",
        });
        if (error) throw new Error(error.message);
        created++;
      } catch(err) { failed.push({obdNo:row.obdNo,error:err.message}); }
    }
    await auditLog({module:"OBD",action:"BULK_CREATE_OBD",targetType:"OBD",targetId:"BULK",actor:user.username,remark:`สร้าง ${created} รายการ`});
    showMsg(failed.length===0?"ok":"warn",
      `สร้างสำเร็จ ${created} | ล้มเหลว ${failed.length}${failed.length>0?": "+failed.map(f=>f.obdNo).join(", "):""}`);
    setBulkRows([]); setShowBulk(false); setCreating(false);
    loadData();
  };

  // ── DERIVED ──────────────────────────────────────────────────
  // FIX 5: filter OBD list ตาม tab
  const filteredObd = obdFilter==="OPEN"
    ? obdList.filter(o=>o.status==="OPEN")
    : obdList;

  const toggleObd = (id) => setSelectedObds(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);

  const openObds = obdList.filter(o=>o.status==="OPEN");
  const canGroup = selectedObds.length > 0;

  // ── STYLES ───────────────────────────────────────────────────
  const th = {padding:"8px 10px",textAlign:"left",fontWeight:700,color:"#374151",whiteSpace:"nowrap",fontSize:11};
  const td = {padding:"8px 10px",fontSize:12};
  const inp = {width:"100%",padding:"8px 10px",border:"1.5px solid #e5e7eb",borderRadius:9,fontSize:13,outline:"none",boxSizing:"border-box"};

  // ─────────────────────────────────────────────────────────────
  return (
    <div style={{minHeight:"100vh",background:"#f0f4fb"}}>

      {/* TOPBAR */}
      <div style={{background:"linear-gradient(90deg,#0a2a6e,#1d4ed8)",color:"#fff",
        padding:"12px 18px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",
        position:"sticky",top:0,zIndex:40}}>
        <button onClick={onBack} style={{border:"1px solid rgba(255,255,255,.2)",background:"transparent",color:"#fff",borderRadius:8,padding:"4px 10px",cursor:"pointer",fontSize:12}}>← Back</button>
        <span style={{fontWeight:800,fontSize:15}}>📦 OBD & Group</span>

        <div style={{display:"flex",gap:4,background:"rgba(255,255,255,.1)",borderRadius:8,padding:3,marginLeft:8}}>
          {[["obd","📦 OBD"],["group","👥 Group"]].map(([t,l])=>(
            <button key={t} onClick={()=>setTab(t)}
              style={{border:"none",borderRadius:6,padding:"4px 12px",fontWeight:700,fontSize:12,cursor:"pointer",background:tab===t?"#fff":"transparent",color:tab===t?"#0a2a6e":"rgba(255,255,255,.7)"}}>
              {l}
            </button>
          ))}
        </div>

        <div style={{marginLeft:"auto",display:"flex",gap:6,flexWrap:"wrap"}}>
          {tab==="obd" && <>
            {p.canCreateOBD && (
              <button onClick={()=>setShowCreate(true)}
                style={{background:"#4ADE80",color:"#fff",border:"none",borderRadius:8,padding:"5px 12px",fontWeight:700,cursor:"pointer",fontSize:12}}>
                + สร้าง OBD
              </button>
            )}
            <label style={{background:"#1d4ed8",color:"#fff",borderRadius:8,padding:"5px 12px",fontWeight:700,cursor:"pointer",fontSize:12}}>
              📤 Import CSV
              <input ref={fileRef} type="file" accept=".csv" onChange={handleCSV} style={{display:"none"}}/>
            </label>
            <button onClick={downloadOBDTemplate}
              style={{background:"rgba(255,255,255,.15)",color:"#fff",border:"1px solid rgba(255,255,255,.3)",borderRadius:8,padding:"5px 12px",fontWeight:700,cursor:"pointer",fontSize:12}}>
              ⬇ Template
            </button>
            {canGroup && (
              <button onClick={()=>setShowGroup(true)}
                style={{background:"#F5A800",color:"#fff",border:"none",borderRadius:8,padding:"5px 12px",fontWeight:700,cursor:"pointer",fontSize:12}}>
                👥 Group ({selectedObds.length} OBD)
              </button>
            )}
          </>}
        </div>
      </div>

      <div style={{padding:14,maxWidth:1000,margin:"0 auto"}}>
        {msg && <Alert type={msg.type} msg={msg.msg}/>}

        {/* ── SUMMARY CARDS ── */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:14}}>
          {[
            {label:"OBD (OPEN)",  val:obdList.filter(o=>o.status==="OPEN").length,     bg:"#d1fae5",c:"#065f46"},
            {label:"GROUPED",     val:obdList.filter(o=>o.status==="GROUPED").length,   bg:"#dbeafe",c:"#1d4ed8"},
            {label:"Groups (รอ Booking)", val:groups.filter(g=>g.status==="BOOKING_PENDING").length, bg:"#fef3c7",c:"#92400e"},
            {label:"Groups (BOOKED)",     val:groups.filter(g=>g.status==="BOOKED").length,          bg:"#ede9fe",c:"#6d28d9"},
          ].map(s=>(
            <div key={s.label} style={{background:s.bg,borderRadius:12,padding:"10px 12px",textAlign:"center"}}>
              <div style={{fontSize:22,fontWeight:900,color:s.c}}>{s.val}</div>
              <div style={{fontSize:10,color:s.c,opacity:.8,fontWeight:700}}>{s.label}</div>
            </div>
          ))}
        </div>

        {loading ? <div style={{padding:40,textAlign:"center"}}><Spinner/></div> : <>

          {/* ══════════════════════════════════════════════════════
              OBD TAB
          ══════════════════════════════════════════════════════ */}
          {tab==="obd" && (
            <div style={{background:"#fff",borderRadius:14,overflow:"hidden",boxShadow:"0 4px 20px rgba(0,0,0,.07)"}}>
              <div style={{padding:"12px 16px",borderBottom:"1px solid #e5e7eb",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
                <div style={{fontWeight:800,color:"#0a2a6e",fontSize:14}}>
                  OBD Release
                  <span style={{fontSize:11,color:"#6b7280",fontWeight:400,marginLeft:8}}>({filteredObd.length})</span>
                </div>
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  {/* FIX 5: filter toggle */}
                  {[["OPEN","OPEN เท่านั้น"],["ALL","ทั้งหมด"]].map(([v,l])=>(
                    <button key={v} onClick={()=>setObdFilter(v)}
                      style={{border:`1.5px solid ${obdFilter===v?"#0a2a6e":"#e5e7eb"}`,background:obdFilter===v?"#0a2a6e":"#fff",color:obdFilter===v?"#fff":"#374151",borderRadius:7,padding:"3px 10px",fontSize:11,fontWeight:700,cursor:"pointer"}}>
                      {l}
                    </button>
                  ))}
                  {selectedObds.length>0 && (
                    <span style={{fontSize:11,color:"#1d4ed8",fontWeight:700}}>{selectedObds.length} เลือกแล้ว</span>
                  )}
                </div>
              </div>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse"}}>
                  <thead>
                    <tr style={{background:"#f8fafc"}}>
                      <th style={{...th,width:32}}></th>
                      {["OBD No","วันที่","SubCon","Qty","Lines","Status","Group","Actions"].map(h=>(
                        <th key={h} style={th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredObd.length===0 ? (
                      <tr><td colSpan={9} style={{padding:24,textAlign:"center",color:"#9ca3af",fontSize:13}}>
                        {obdFilter==="OPEN"?"ไม่มี OBD ที่ OPEN":"ยังไม่มี OBD"}
                      </td></tr>
                    ) : filteredObd.map(o=>{
                      const sc  = STATUS_COLOR[o.status]||{bg:"#f3f4f6",c:"#6b7280"};
                      const canSel = o.status==="OPEN";
                      const isSel  = selectedObds.includes(o.obd_no);
                      return (
                        <tr key={o.obd_no}
                          onClick={()=>canSel&&toggleObd(o.obd_no)}
                          style={{borderBottom:"1px solid #f3f4f6",background:isSel?"#eff6ff":"#fff",cursor:canSel?"pointer":"default"}}>
                          <td style={{...td,textAlign:"center"}}>
                            {canSel && <input type="checkbox" checked={isSel} onChange={()=>toggleObd(o.obd_no)} onClick={e=>e.stopPropagation()}/>}
                          </td>
                          <td style={{...td,fontFamily:"monospace",fontWeight:700,fontSize:11}}>{o.obd_no}</td>
                          <td style={{...td,color:"#6b7280"}}>{o.release_date}</td>
                          <td style={{...td,fontWeight:700}}>{o.subcon_code}</td>
                          <td style={{...td,textAlign:"right",fontWeight:700}}>{o.qty}</td>
                          <td style={{...td,textAlign:"right",color:"#6b7280"}}>{o.line_count||1}</td>
                          <td style={td}>
                            <span style={{background:sc.bg,color:sc.c,borderRadius:999,padding:"2px 8px",fontSize:10,fontWeight:800}}>{o.status}</span>
                          </td>
                          <td style={{...td,fontFamily:"monospace",fontSize:10,color:"#6b7280"}}>{o.group_number||"—"}</td>
                          <td style={td}>
                            {o.status==="OPEN" && p.canCancelOBD && (
                              <button onClick={e=>{e.stopPropagation();cancelOBD(o);}}
                                style={{background:"#fee2e2",color:"#991b1b",border:"none",borderRadius:6,padding:"3px 8px",cursor:"pointer",fontSize:11,fontWeight:700}}>
                                ✕ ยกเลิก
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {obdFilter==="OPEN" && (
                <div style={{padding:"8px 16px",fontSize:11,color:"#6b7280",borderTop:"1px solid #f3f4f6",background:"#f8fafc"}}>
                  💡 แสดงเฉพาะ OPEN — คลิก "ทั้งหมด" เพื่อดู GROUPED/BOOKED/COMPLETED
                </div>
              )}
            </div>
          )}

          {/* ══════════════════════════════════════════════════════
              GROUP TAB
          ══════════════════════════════════════════════════════ */}
          {tab==="group" && (
            <div style={{background:"#fff",borderRadius:14,overflow:"hidden",boxShadow:"0 4px 20px rgba(0,0,0,.07)"}}>
              <div style={{padding:"12px 16px",borderBottom:"1px solid #e5e7eb",fontWeight:800,color:"#0a2a6e",fontSize:14}}>
                Groups <span style={{fontSize:11,color:"#6b7280",fontWeight:400}}>({groups.length})</span>
              </div>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse"}}>
                  <thead>
                    <tr style={{background:"#f8fafc"}}>
                      {["Group No","SubCon","วันที่","OBD","Qty","Status","Booking","Actions"].map(h=>(
                        <th key={h} style={th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {groups.length===0 ? (
                      <tr><td colSpan={8} style={{padding:24,textAlign:"center",color:"#9ca3af",fontSize:13}}>ยังไม่มี Group</td></tr>
                    ) : groups.map(g=>{
                      const gc = GRP_COLOR[g.status]||{bg:"#f3f4f6",c:"#6b7280"};
                      return (
                        <tr key={g.group_number} style={{borderBottom:"1px solid #f3f4f6"}}>
                          <td style={{...td,fontFamily:"monospace",fontWeight:700,fontSize:11,color:"#0a2a6e",cursor:"pointer",textDecoration:"underline"}}
                            onClick={()=>openGroupDetail(g)}>
                            {g.group_number}
                          </td>
                          <td style={{...td,fontWeight:700}}>{g.subcon_code}</td>
                          <td style={{...td,color:"#6b7280"}}>{g.group_date}</td>
                          <td style={{...td,textAlign:"center"}}>{g.total_obd}</td>
                          <td style={{...td,textAlign:"center",fontWeight:700}}>{g.total_qty}</td>
                          <td style={td}>
                            <span style={{background:gc.bg,color:gc.c,borderRadius:999,padding:"2px 8px",fontSize:10,fontWeight:800}}>{g.status}</span>
                          </td>
                          <td style={{...td,fontFamily:"monospace",fontSize:10,color:"#6b7280"}}>{g.booking_id||"—"}</td>
                          <td style={td}>
                            <div style={{display:"flex",gap:4}}>
                              <button onClick={()=>openGroupDetail(g)}
                                style={{background:"#dbeafe",color:"#1d4ed8",border:"none",borderRadius:6,padding:"3px 8px",cursor:"pointer",fontSize:11,fontWeight:700}}>
                                📋 ดู OBD
                              </button>
                              {/* FIX 3: Cancel group BOOKING_PENDING เท่านั้น */}
                              {g.status==="BOOKING_PENDING" && p.canCancelGroup && (
                                <button onClick={()=>cancelGroup(g)}
                                  style={{background:"#fee2e2",color:"#991b1b",border:"none",borderRadius:6,padding:"3px 8px",cursor:"pointer",fontSize:11,fontWeight:700}}>
                                  ✕ ยกเลิก
                                </button>
                              )}
                            </div>
                          </td>
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

      {/* ── CREATE OBD MODAL (FIX 1: กรอก OBD No เอง) ─────────── */}
      {showCreate && (
        <div style={{position:"fixed",inset:0,background:"rgba(10,20,50,.6)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,padding:16}}>
          <div style={{background:"#fff",borderRadius:16,padding:24,width:"100%",maxWidth:420,boxShadow:"0 20px 60px rgba(0,0,0,.3)"}}>
            <div style={{fontWeight:800,color:"#0a2a6e",fontSize:16,marginBottom:4}}>📦 สร้าง OBD Release</div>
            <div style={{fontSize:11,color:"#6b7280",marginBottom:16}}>กรอก OBD No ตามเอกสาร (ไม่ gen auto)</div>

            {/* OBD No — กรอกเอง */}
            <div style={{marginBottom:12}}>
              <label style={{display:"block",fontSize:12,fontWeight:700,marginBottom:5,color:"#374151"}}>OBD No *</label>
              <input value={form.obdNo} onChange={e=>setForm(p=>({...p,obdNo:e.target.value}))}
                placeholder="เช่น MN26043001" style={inp}/>
            </div>

            <div style={{marginBottom:12}}>
              <label style={{display:"block",fontSize:12,fontWeight:700,marginBottom:5,color:"#374151"}}>SubCon *</label>
              <select value={form.subConCode} onChange={e=>setForm(p=>({...p,subConCode:e.target.value}))} style={inp}>
                <option value="">-- เลือก SubCon --</option>
                {subcons.map(s=><option key={s.subcon_code} value={s.subcon_code}>{s.subcon_code} — {s.subcon_name}</option>)}
              </select>
            </div>

            {[
              {label:"วันที่ *",key:"releaseDate",type:"date"},
              {label:"Qty *",key:"qty",type:"number",placeholder:"จำนวน units"},
              {label:"Lines",key:"lineCount",type:"number",placeholder:"จำนวน line สินค้า"},
            ].map(f=>(
              <div key={f.key} style={{marginBottom:12}}>
                <label style={{display:"block",fontSize:12,fontWeight:700,marginBottom:5,color:"#374151"}}>{f.label}</label>
                <input value={form[f.key]} onChange={e=>setForm(p=>({...p,[f.key]:e.target.value}))}
                  type={f.type} placeholder={f.placeholder} style={inp}/>
              </div>
            ))}

            <div style={{marginBottom:16}}>
              <label style={{display:"block",fontSize:12,fontWeight:700,marginBottom:5,color:"#374151"}}>หมายเหตุ</label>
              <input value={form.remarks} onChange={e=>setForm(p=>({...p,remarks:e.target.value}))}
                placeholder="(ถ้ามี)" style={inp}/>
            </div>

            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setShowCreate(false)} style={{flex:1,padding:"10px",background:"#e5e7eb",color:"#374151",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer"}}>ยกเลิก</button>
              <button onClick={createOBD} disabled={creating} style={{flex:2,padding:"10px",background:"#0a2a6e",color:"#fff",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",opacity:creating?.6:1}}>
                {creating?"กำลังสร้าง…":"✓ สร้าง OBD"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── GROUP CONFIRM MODAL ────────────────────────────────── */}
      {showGroup && (
        <div style={{position:"fixed",inset:0,background:"rgba(10,20,50,.6)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,padding:16}}>
          <div style={{background:"#fff",borderRadius:16,padding:24,width:"100%",maxWidth:420,boxShadow:"0 20px 60px rgba(0,0,0,.3)"}}>
            <div style={{fontWeight:800,color:"#0a2a6e",fontSize:16,marginBottom:4}}>👥 สร้าง Group</div>
            <div style={{fontSize:12,color:"#6b7280",marginBottom:12}}>
              {selectedObds.length} OBD — รวม{" "}
              {selectedObds.reduce((s,id)=>{const o=obdList.find(x=>x.obd_no===id);return s+(o?.qty||0);},0)} units
            </div>
            <div style={{fontSize:11,color:"#9ca3af",marginBottom:8}}>
              Group No จะถูก gen อัตโนมัติ: <b style={{color:"#0a2a6e"}}>{subcons.find(s=>s.subcon_code===obdList.find(o=>o.obd_no===selectedObds[0])?.subcon_code)?.subcon_initial || "MON"}261201</b> (ตัวอย่าง)
            </div>
            <div style={{maxHeight:180,overflowY:"auto",marginBottom:16,background:"#f8fafc",borderRadius:8,padding:10}}>
              {selectedObds.map(id=>{
                const o = obdList.find(x=>x.obd_no===id);
                return (
                  <div key={id} style={{padding:"5px 8px",borderRadius:6,marginBottom:4,fontSize:12,display:"flex",justifyContent:"space-between"}}>
                    <span style={{fontFamily:"monospace",fontWeight:700}}>{id}</span>
                    <span style={{color:"#6b7280"}}>{o?.qty} units</span>
                  </div>
                );
              })}
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setShowGroup(false)} style={{flex:1,padding:"10px",background:"#e5e7eb",color:"#374151",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer"}}>ยกเลิก</button>
              <button onClick={createGroup} disabled={creating} style={{flex:2,padding:"10px",background:"#F5A800",color:"#fff",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",opacity:creating?.6:1}}>
                {creating?"กำลังสร้าง…":"✓ สร้าง Group"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── GROUP DETAIL MODAL (FIX 7) ────────────────────────── */}
      {groupDetail && (
        <div style={{position:"fixed",inset:0,background:"rgba(10,20,50,.6)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,padding:16}}>
          <div style={{background:"#fff",borderRadius:16,padding:24,width:"100%",maxWidth:500,boxShadow:"0 20px 60px rgba(0,0,0,.3)",maxHeight:"80vh",overflowY:"auto"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div>
                <div style={{fontWeight:800,color:"#0a2a6e",fontSize:16}}>{groupDetail.header.group_number}</div>
                <div style={{fontSize:12,color:"#6b7280"}}>{groupDetail.header.subcon_name} • {groupDetail.header.group_date}</div>
              </div>
              <button onClick={()=>setGroupDetail(null)} style={{border:"none",background:"none",cursor:"pointer",fontSize:18,color:"#9ca3af"}}>✕</button>
            </div>
            <div style={{display:"flex",gap:12,marginBottom:12,flexWrap:"wrap"}}>
              {[
                {label:"Status",val:groupDetail.header.status},
                {label:"OBD",val:groupDetail.header.total_obd},
                {label:"Qty",val:groupDetail.header.total_qty},
                {label:"Booking",val:groupDetail.header.booking_id||"—"},
              ].map(s=>(
                <div key={s.label} style={{background:"#f8fafc",borderRadius:8,padding:"6px 12px",textAlign:"center",flex:1,minWidth:80}}>
                  <div style={{fontSize:10,color:"#6b7280"}}>{s.label}</div>
                  <div style={{fontWeight:700,fontSize:12,color:"#0a2a6e"}}>{s.val}</div>
                </div>
              ))}
            </div>
            <div style={{fontWeight:700,fontSize:12,color:"#374151",marginBottom:8}}>OBD ใน Group ({groupDetail.details.length})</div>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead>
                <tr style={{background:"#f8fafc"}}>
                  {["OBD No","Qty","Lines","Status"].map(h=>(
                    <th key={h} style={{...th,fontSize:11}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groupDetail.details.map(d=>(
                  <tr key={d.obd_no} style={{borderBottom:"1px solid #f3f4f6"}}>
                    <td style={{...td,fontFamily:"monospace",fontWeight:700,fontSize:11}}>{d.obd_no}</td>
                    <td style={{...td,textAlign:"right",fontWeight:700}}>{d.qty}</td>
                    <td style={{...td,textAlign:"right",color:"#6b7280"}}>{d.line_count}</td>
                    <td style={td}><span style={{background:"#dbeafe",color:"#1d4ed8",borderRadius:999,padding:"2px 6px",fontSize:10,fontWeight:800}}>{d.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── BULK PREVIEW MODAL ────────────────────────────────── */}
      {showBulk && bulkRows.length>0 && (
        <div style={{position:"fixed",inset:0,background:"rgba(10,20,50,.6)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,padding:16}}>
          <div style={{background:"#fff",borderRadius:16,padding:24,width:"100%",maxWidth:700,maxHeight:"80vh",overflow:"auto",boxShadow:"0 20px 60px rgba(0,0,0,.3)"}}>
            <div style={{fontWeight:800,color:"#0a2a6e",fontSize:16,marginBottom:12}}>📤 Preview: {bulkRows.length} rows</div>
            <div style={{overflowX:"auto",maxHeight:280,border:"1px solid #e5e7eb",borderRadius:8,marginBottom:12}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                <thead><tr style={{background:"#f8fafc",position:"sticky",top:0}}>
                  {Object.keys(bulkRows[0]).map(h=><th key={h} style={{...th,fontSize:10}}>{h}</th>)}
                </tr></thead>
                <tbody>{bulkRows.map((r,i)=>(
                  <tr key={i} style={{borderBottom:"1px solid #f3f4f6"}}>
                    {Object.values(r).map((v,j)=><td key={j} style={{padding:"4px 8px",fontFamily:"monospace",fontSize:10}}>{v}</td>)}
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div style={{fontSize:11,color:"#6b7280",marginBottom:12}}>
              CSV columns ที่รองรับ: <code>obdNo, subConCode, releaseDate, qty, lineCount, remarks</code>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setShowBulk(false)} style={{flex:1,padding:"10px",background:"#e5e7eb",color:"#374151",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer"}}>ยกเลิก</button>
              <button onClick={submitBulk} disabled={creating} style={{flex:2,padding:"10px",background:"#1d4ed8",color:"#fff",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",opacity:creating?.6:1}}>
                {creating?`กำลัง import…`:`✓ Import ${bulkRows.length} OBD`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
