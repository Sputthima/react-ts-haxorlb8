import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase, today, nowISO, auditLog } from "../lib/supabase";
import { printInboundSlip } from "../lib/pdf";
import { Alert, Spinner, StatusBadge } from "../components/UI";

const DOCKS = [1,2,3,4,5];

export default function SupplierApp({ user, onBack }) {
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
  const [bulkRows, setBulkRows] = useState([]);
  const [bulkLoading, setBulkLoading] = useState(false);
  const fileRef = useRef();

  const days = Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()+i);return d.toISOString().slice(0,10);});

  const loadSlots = useCallback(async(date)=>{
    setSlotLoading(true); setSelected(null);
    const {data}=await supabase.from("dock_slots").select("*").eq("slot_date",date).order("slot_hour").order("dock_no");
    setSlots(data||[]); setSlotLoading(false);
  },[]);

  const loadMyAsns = useCallback(async()=>{
    const {data}=await supabase.from("asn_header").select("*")
      .eq("supplier_code",user.subcon_code||"")
      .order("created_at",{ascending:false}).limit(50);
    setMyAsns(data||[]);
  },[user.subcon_code]);

  useEffect(()=>{ loadSlots(slotDate); },[slotDate,loadSlots]);
  useEffect(()=>{ if(tab==="myasn") loadMyAsns(); },[tab,loadMyAsns]);

  const hours=[...new Set(slots.map(s=>String(s.slot_hour).slice(0,5)))].sort();
  const slotMap={};
  slots.forEach(s=>{slotMap[String(s.slot_hour).slice(0,5)+"_"+s.dock_no]=s;});

  // Invoice helpers
  const addInvoice=()=>setInvoices(p=>[...p.map(i=>({...i,open:false})),{invoiceNo:"",invoiceDate:today(),poNo:"",open:true,items:[{itemCode:"",itemName:"",unit:"",qtyShipped:""}]}]);
  const removeInvoice=(i)=>{if(invoices.length>1)setInvoices(p=>p.filter((_,idx)=>idx!==i));};
  const toggleInv=(i)=>setInvoices(p=>p.map((inv,idx)=>({...inv,open:idx===i?!inv.open:inv.open})));
  const updateInv=(i,f,v)=>setInvoices(p=>p.map((inv,idx)=>idx===i?{...inv,[f]:v}:inv));
  const addItem=(i)=>setInvoices(p=>p.map((inv,idx)=>idx===i?{...inv,items:[...inv.items,{itemCode:"",itemName:"",unit:"",qtyShipped:""}]}:inv));
  const removeItem=(ii,ki)=>setInvoices(p=>p.map((inv,idx)=>idx===ii?{...inv,items:inv.items.filter((_,k)=>k!==ki)}:inv));
  const updateItem=(ii,ki,f,v)=>setInvoices(p=>p.map((inv,idx)=>idx===ii?{...inv,items:inv.items.map((it,k)=>k===ki?{...it,[f]:v}:it)}:inv));

  const submitASN = async()=>{
    if(!selected) return setMsg({type:"err",msg:"กรุณาเลือก Slot ก่อน"});
    if(!truck.truckPlate||!truck.driverName||!truck.driverPhone) return setMsg({type:"err",msg:"กรุณากรอกข้อมูลรถให้ครบ"});
    const badInv=invoices.find(inv=>!inv.invoiceNo||!inv.invoiceDate);
    if(badInv) return setMsg({type:"err",msg:"กรุณากรอก Invoice No และ Date ให้ครบ"});
    const badItem=invoices.find(inv=>inv.items.find(it=>!it.itemCode||!it.qtyShipped));
    if(badItem) return setMsg({type:"err",msg:"กรุณากรอก Item Code และ Qty ให้ครบ"});
    setSaving(true); setMsg(null);
    const sc=user.subcon_code||"SUP";
    const asnNo="ASN-"+sc+"-"+Date.now().toString().slice(-8);
    const bkId="IN"+String(selected.dock_no).padStart(2,"0")+sc+Date.now().toString().slice(-8);
    const totalQty=invoices.reduce((s,inv)=>s+inv.items.reduce((ss,it)=>ss+Number(it.qtyShipped||0),0),0);
    const totalLines=invoices.reduce((s,inv)=>s+inv.items.length,0);
    const {error:aErr}=await supabase.from("asn_header").insert({
      asn_no:asnNo,supplier_code:user.subcon_code||"",supplier_name:user.full_name||"",
      ship_date:truck.shipDate,truck_type:truck.truckType,truck_plate:truck.truckPlate.toUpperCase(),
      driver_name:truck.driverName,driver_phone:truck.driverPhone,
      invoice_count:invoices.length,total_lines:totalLines,total_qty:totalQty,
      booking_id:bkId,status:"BOOKED",created_by:user.username,remarks:truck.remarks||"",
    });
    if(aErr){setMsg({type:"err",msg:aErr.message});setSaving(false);return;}
    for(let i=0;i<invoices.length;i++){
      const inv=invoices[i];
      const invQty=inv.items.reduce((s,it)=>s+Number(it.qtyShipped||0),0);
      await supabase.from("asn_invoice").insert({asn_no:asnNo,invoice_seq:i+1,invoice_no:inv.invoiceNo,invoice_date:inv.invoiceDate,po_no:inv.poNo||"",invoice_qty:invQty,invoice_lines:inv.items.length});
      for(let k=0;k<inv.items.length;k++){
        const it=inv.items[k];
        await supabase.from("asn_detail").insert({asn_no:asnNo,invoice_no:inv.invoiceNo,line_no:k+1,item_code:it.itemCode,item_name:it.itemName||"",unit:it.unit||"",qty_shipped:Number(it.qtyShipped||0),qty_received:0});
      }
    }
    await supabase.from("inbound_bookings").insert({booking_id:bkId,asn_no:asnNo,supplier_code:user.subcon_code||"",booking_date:slotDate,booking_hour:selected.slot_hour,dock_no:selected.dock_no,slot_key:selected.slot_key,truck_type:truck.truckType,truck_plate:truck.truckPlate.toUpperCase(),driver_name:truck.driverName,driver_phone:truck.driverPhone,status:"RESERVED",created_by:user.username});
    await supabase.from("dock_slots").update({status:"BOOKED",booking_id:bkId}).eq("slot_key",selected.slot_key);
    await auditLog({module:"INBOUND",action:"CREATE_ASN",targetType:"ASN",targetId:asnNo,subconCode:user.subcon_code||"",bookingId:bkId,actor:user.username});
    setMsg({type:"ok",msg:`✅ ASN ${asnNo} Booking ${bkId} สำเร็จ!`});
    setSelected(null); setShowForm(false);
    setTruck({shipDate:today(),truckType:"",truckPlate:"",driverName:"",driverPhone:"",remarks:""});
    setInvoices([{invoiceNo:"",invoiceDate:today(),poNo:"",open:true,items:[{itemCode:"",itemName:"",unit:"",qtyShipped:""}]}]);
    loadSlots(slotDate); loadMyAsns(); setSaving(false);
  };

  const cancelASN = async(asn)=>{
    if(!confirm(`ยืนยันยกเลิก ASN ${asn.asn_no}?`)) return;
    if(["RECEIVED","CANCELLED"].includes(asn.status)) return setMsg({type:"err",msg:"ไม่สามารถยกเลิกได้"});
    await supabase.from("asn_header").update({status:"CANCELLED",updated_at:nowISO()}).eq("asn_no",asn.asn_no);
    if(asn.booking_id){
      await supabase.from("inbound_bookings").update({status:"CANCELLED",updated_at:nowISO()}).eq("booking_id",asn.booking_id);
      const {data:bk}=await supabase.from("inbound_bookings").select("slot_key").eq("booking_id",asn.booking_id).single();
      if(bk?.slot_key) await supabase.from("dock_slots").update({status:"AVAILABLE",booking_id:null}).eq("slot_key",bk.slot_key);
    }
    await auditLog({module:"INBOUND",action:"CANCEL_ASN",targetType:"ASN",targetId:asn.asn_no,actor:user.username});
    setMsg({type:"ok",msg:`✅ ยกเลิก ASN ${asn.asn_no} แล้ว`});
    loadMyAsns();
  };

  // CSV Bulk import
  const handleCSV = async(e)=>{
    const file=e.target.files[0]; if(!file) return;
    setBulkLoading(true); setMsg(null);
    const text=await file.text();
    const lines=text.split("\n").filter(l=>l.trim());
    const headers=lines[0].split(",").map(h=>h.trim().replace(/"/g,""));
    const rows=lines.slice(1).map(l=>{
      const vals=l.split(",").map(v=>v.trim().replace(/"/g,""));
      return Object.fromEntries(headers.map((h,i)=>[h,vals[i]||""]));
    });
    setBulkRows(rows);
    setBulkLoading(false);
    setTab("bulk");
  };

  const submitBulk = async()=>{
    if(!bulkRows.length) return;
    setSaving(true); setMsg(null);
    let created=0,failed=[];
    for(const row of bulkRows){
      try{
        const sc=user.subcon_code||"SUP";
        const asnNo="ASN-"+sc+"-"+Date.now().toString().slice(-8);
        const slotKey=`${row.bookingDate}_${row.bookingHour}_D${String(row.dockNo||"1").padStart(2,"0")}`;
        const {data:slot}=await supabase.from("dock_slots").select("*").eq("slot_key",slotKey).single();
        if(!slot||slot.status!=="AVAILABLE") throw new Error(`Slot ${slotKey} ไม่ว่าง`);
        const bkId="IN"+String(row.dockNo||1).padStart(2,"0")+sc+Date.now().toString().slice(-8);
        await supabase.from("asn_header").insert({asn_no:asnNo,supplier_code:user.subcon_code||"",supplier_name:user.full_name||"",ship_date:row.shipDate,truck_type:row.truckType||"",truck_plate:(row.truckPlate||"").toUpperCase(),driver_name:row.driverName||"",driver_phone:row.driverPhone||"",invoice_count:1,total_lines:1,total_qty:Number(row.qty||0),booking_id:bkId,status:"BOOKED",created_by:user.username});
        await supabase.from("asn_invoice").insert({asn_no:asnNo,invoice_seq:1,invoice_no:row.invoiceNo||asnNo,invoice_date:row.invoiceDate||today(),po_no:row.poNo||"",invoice_qty:Number(row.qty||0),invoice_lines:1});
        if(row.itemCode) await supabase.from("asn_detail").insert({asn_no:asnNo,invoice_no:row.invoiceNo||asnNo,line_no:1,item_code:row.itemCode,item_name:row.itemName||"",unit:row.unit||"",qty_shipped:Number(row.qty||0),qty_received:0});
        await supabase.from("inbound_bookings").insert({booking_id:bkId,asn_no:asnNo,supplier_code:user.subcon_code||"",booking_date:row.bookingDate,booking_hour:row.bookingHour,dock_no:Number(row.dockNo||1),slot_key:slotKey,truck_plate:(row.truckPlate||"").toUpperCase(),driver_name:row.driverName||"",driver_phone:row.driverPhone||"",status:"RESERVED",created_by:user.username});
        await supabase.from("dock_slots").update({status:"BOOKED",booking_id:bkId}).eq("slot_key",slotKey);
        created++;
      }catch(err){ failed.push({row,error:err.message}); }
    }
    setMsg({type:failed.length===0?"ok":"warn",msg:`สร้างสำเร็จ ${created} รายการ${failed.length>0?` | ล้มเหลว ${failed.length} รายการ`:""}`});
    setBulkRows([]); setTab("myasn"); loadMyAsns(); setSaving(false);
  };

  return (
    <div style={{minHeight:"100vh",background:"#f0f4fb"}}>
      <div style={{background:"linear-gradient(90deg,#065f46,#059669)",color:"#fff",padding:"12px 18px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",position:"sticky",top:0,zIndex:40}}>
        <button onClick={onBack} style={{border:"1px solid rgba(255,255,255,.2)",background:"transparent",color:"#fff",borderRadius:8,padding:"4px 10px",cursor:"pointer",fontSize:12}}>← Back</button>
        <span style={{fontWeight:800,fontSize:15}}>📦 Supplier Portal</span>
        <div style={{display:"flex",gap:4,background:"rgba(255,255,255,.15)",borderRadius:8,padding:3,marginLeft:8}}>
          {[["create","➕ สร้าง ASN"],["myasn","📋 My ASN"],["bulk","📤 Bulk Import"]].map(([t,l])=>(
            <button key={t} onClick={()=>setTab(t)} style={{border:"none",borderRadius:6,padding:"4px 10px",fontWeight:700,fontSize:11,cursor:"pointer",background:tab===t?"#fff":"transparent",color:tab===t?"#065f46":"rgba(255,255,255,.8)"}}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div style={{padding:14,maxWidth:960,margin:"0 auto"}}>
        {msg && <Alert type={msg.type} msg={msg.msg}/>}

        {/* CREATE */}
        {tab==="create" && <>
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
                    <th style={{background:"#065f46",color:"#fff",padding:"7px 10px",borderRadius:5,fontSize:11}}>เวลา</th>
                    {DOCKS.map(d=><th key={d} style={{background:"#065f46",color:"#fff",padding:"7px 8px",borderRadius:5,fontSize:11}}>D{d}</th>)}
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
                            style={{width:"100%",padding:"6px 4px",borderRadius:6,border:"none",background:isSel?"#fde68a":isBooked?"#fee2e2":"#d1fae5",color:isSel?"#92400e":isBooked?"#991b1b":"#065f46",fontWeight:700,fontSize:10,cursor:isBooked?"not-allowed":"pointer"}}>
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

          {showForm && (
            <div style={{background:"#fff",borderRadius:14,padding:16,marginBottom:12,boxShadow:"0 4px 20px rgba(0,0,0,.07)"}}>
              <div style={{fontWeight:800,color:"#0a2a6e",fontSize:14,marginBottom:12}}>🚛 ข้อมูลรถ</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
                {[{l:"Ship Date *",k:"shipDate",t:"date"},{l:"ประเภทรถ",k:"truckType",p:"6 ล้อ"},{l:"ทะเบียนรถ *",k:"truckPlate",p:"80-1234"},{l:"ชื่อคนขับ *",k:"driverName"},{l:"เบอร์โทร *",k:"driverPhone",t:"tel"},{l:"Remarks",k:"remarks"}].map(f=>(
                  <div key={f.k}>
                    <label style={{display:"block",fontSize:11,fontWeight:700,marginBottom:4,color:"#374151"}}>{f.l}</label>
                    <input value={truck[f.k]} onChange={e=>setTruck(p=>({...p,[f.k]:e.target.value}))} type={f.t||"text"} placeholder={f.p}
                      style={{width:"100%",padding:"8px 10px",border:"1.5px solid #e5e7eb",borderRadius:9,fontSize:12,outline:"none",boxSizing:"border-box"}}/>
                  </div>
                ))}
              </div>
              <div style={{fontWeight:800,color:"#0a2a6e",fontSize:14,marginBottom:10,display:"flex",justifyContent:"space-between"}}>
                <span>📄 Invoices ({invoices.length})</span>
                <button onClick={addInvoice} style={{background:"#e5e7eb",color:"#374151",border:"none",borderRadius:7,padding:"4px 10px",fontWeight:700,cursor:"pointer",fontSize:11}}>+ Invoice</button>
              </div>
              {invoices.map((inv,ii)=>(
                <div key={ii} style={{border:"1.5px solid #e5e7eb",borderRadius:10,marginBottom:8,overflow:"hidden"}}>
                  <div onClick={()=>toggleInv(ii)} style={{background:"#f8fafc",padding:"8px 12px",display:"flex",alignItems:"center",gap:8,cursor:"pointer"}}>
                    <span style={{background:"#065f46",color:"#fff",borderRadius:"50%",width:20,height:20,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800}}>{ii+1}</span>
                    <span style={{fontWeight:700,fontSize:13,flex:1}}>{inv.invoiceNo||`Invoice ${ii+1}`}</span>
                    <span style={{fontSize:11,color:"#6b7280"}}>{inv.items.length} รายการ</span>
                    {invoices.length>1 && <button onClick={e=>{e.stopPropagation();removeInvoice(ii);}} style={{background:"#fee2e2",color:"#991b1b",border:"none",borderRadius:5,padding:"2px 7px",cursor:"pointer",fontSize:11}}>✕</button>}
                    <span style={{color:"#9ca3af"}}>{inv.open?"▲":"▼"}</span>
                  </div>
                  {inv.open && <div style={{padding:12}}>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>
                      {[{l:"Invoice No *",k:"invoiceNo"},{l:"Invoice Date *",k:"invoiceDate",t:"date"},{l:"PO No",k:"poNo"}].map(f=>(
                        <div key={f.k}>
                          <label style={{display:"block",fontSize:11,fontWeight:700,marginBottom:3}}>{f.l}</label>
                          <input value={inv[f.k]} onChange={e=>updateInv(ii,f.k,e.target.value)} type={f.t||"text"}
                            style={{width:"100%",padding:"7px 9px",border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:12,outline:"none",boxSizing:"border-box"}}/>
                        </div>
                      ))}
                    </div>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                      <thead><tr style={{background:"#f8fafc"}}>
                        <th style={{padding:"5px 6px",textAlign:"left"}}>#</th>
                        <th style={{padding:"5px 6px",textAlign:"left"}}>Item Code *</th>
                        <th style={{padding:"5px 6px",textAlign:"left"}}>Item Name</th>
                        <th style={{padding:"5px 6px",textAlign:"left"}}>Unit</th>
                        <th style={{padding:"5px 6px",textAlign:"left"}}>Qty *</th>
                        <th></th>
                      </tr></thead>
                      <tbody>{inv.items.map((it,ki)=>(
                        <tr key={ki}>
                          <td style={{padding:"3px 6px",color:"#9ca3af"}}>{ki+1}</td>
                          {["itemCode","itemName","unit"].map(f=>(
                            <td key={f} style={{padding:"3px 3px"}}><input value={it[f]} onChange={e=>updateItem(ii,ki,f,e.target.value)}
                              style={{width:"100%",padding:"4px 7px",border:"1px solid #e5e7eb",borderRadius:6,fontSize:11,outline:"none"}}/></td>
                          ))}
                          <td style={{padding:"3px 3px",width:70}}><input value={it.qtyShipped} onChange={e=>updateItem(ii,ki,"qtyShipped",e.target.value)} type="number"
                            style={{width:"100%",padding:"4px 7px",border:"1px solid #e5e7eb",borderRadius:6,fontSize:11,outline:"none"}}/></td>
                          <td style={{padding:"3px 3px"}}><button onClick={()=>removeItem(ii,ki)} style={{border:"none",background:"none",cursor:"pointer",color:"#9ca3af",fontSize:16}}>✕</button></td>
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

        {/* MY ASN */}
        {tab==="myasn" && (
          <div style={{background:"#fff",borderRadius:14,overflow:"hidden",boxShadow:"0 4px 20px rgba(0,0,0,.07)"}}>
            <div style={{padding:"12px 16px",borderBottom:"1px solid #e5e7eb",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontWeight:800,color:"#0a2a6e",fontSize:14}}>My ASN ({myAsns.length})</div>
              <button onClick={loadMyAsns} style={{background:"#e5e7eb",color:"#374151",border:"none",borderRadius:7,padding:"4px 10px",cursor:"pointer",fontSize:11,fontWeight:700}}>↻</button>
            </div>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead><tr style={{background:"#f8fafc"}}>
                  {["ASN No","Booking ID","Ship Date","Plate","Inv","Qty","Status",""].map(h=>(
                    <th key={h} style={{padding:"8px 10px",textAlign:"left",fontWeight:700,color:"#374151",whiteSpace:"nowrap"}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {myAsns.length===0 ? <tr><td colSpan={8} style={{padding:24,textAlign:"center",color:"#9ca3af"}}>ยังไม่มี ASN</td></tr>
                  : myAsns.map(a=>(
                    <tr key={a.asn_no} style={{borderBottom:"1px solid #f3f4f6"}}>
                      <td style={{padding:"7px 10px",fontFamily:"monospace",fontSize:10,fontWeight:700}}>{a.asn_no}</td>
                      <td style={{padding:"7px 10px",fontFamily:"monospace",fontSize:10}}>{a.booking_id||"—"}</td>
                      <td style={{padding:"7px 10px",color:"#6b7280"}}>{a.ship_date}</td>
                      <td style={{padding:"7px 10px",fontFamily:"monospace",fontWeight:700}}>{a.truck_plate}</td>
                      <td style={{padding:"7px 10px",textAlign:"center"}}>{a.invoice_count}</td>
                      <td style={{padding:"7px 10px",textAlign:"center",fontWeight:700}}>{a.total_qty}</td>
                      <td style={{padding:"7px 10px"}}><StatusBadge status={a.status} size={10}/></td>
                      <td style={{padding:"7px 6px"}}>
                        <div style={{display:"flex",gap:4"}}>
                          {!["RECEIVED","CANCELLED"].includes(a.status) &&
                            <button onClick={()=>cancelASN(a)} style={{background:"#fee2e2",color:"#991b1b",border:"none",borderRadius:6,padding:"3px 7px",cursor:"pointer",fontSize:10,fontWeight:700}}>ยกเลิก</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* BULK IMPORT */}
        {tab==="bulk" && (
          <div style={{background:"#fff",borderRadius:14,padding:20,boxShadow:"0 4px 20px rgba(0,0,0,.07)"}}>
            <div style={{fontWeight:800,color:"#0a2a6e",fontSize:14,marginBottom:8}}>📤 Bulk Import ASN (CSV)</div>
            <div style={{fontSize:12,color:"#6b7280",marginBottom:12}}>
              CSV ต้องมี columns: <code>bookingDate, bookingHour, dockNo, shipDate, truckType, truckPlate, driverName, driverPhone, invoiceNo, invoiceDate, poNo, itemCode, itemName, unit, qty</code>
            </div>
            <input ref={fileRef} type="file" accept=".csv" onChange={handleCSV} style={{marginBottom:12}}/>
            {bulkLoading && <Spinner/>}
            {bulkRows.length>0 && (
              <>
                <div style={{fontSize:12,color:"#374151",marginBottom:8,fontWeight:700}}>Preview: {bulkRows.length} rows</div>
                <div style={{overflowX:"auto",maxHeight:300,overflow:"auto",border:"1px solid #e5e7eb",borderRadius:8,marginBottom:12}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                    <thead><tr style={{background:"#f8fafc",position:"sticky",top:0}}>
                      {Object.keys(bulkRows[0]).map(h=>(
                        <th key={h} style={{padding:"5px 8px",textAlign:"left",fontWeight:700,color:"#374151",whiteSpace:"nowrap"}}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>{bulkRows.map((r,i)=>(
                      <tr key={i} style={{borderBottom:"1px solid #f3f4f6"}}>
                        {Object.values(r).map((v,j)=>(
                          <td key={j} style={{padding:"4px 8px",fontFamily:"monospace",fontSize:10}}>{v}</td>
                        ))}
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                <button onClick={submitBulk} disabled={saving}
                  style={{background:"#059669",color:"#fff",border:"none",borderRadius:10,padding:"10px 24px",fontWeight:700,cursor:"pointer",fontSize:13,opacity:saving?.6:1}}>
                  {saving?`กำลัง import…`:`✓ Import ${bulkRows.length} rows`}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
