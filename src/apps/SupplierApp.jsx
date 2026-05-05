import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase, today, nowISO, auditLog, sendEmail } from "../lib/supabase";
import { downloadASNTemplate } from "../lib/templates";
import { usePermissions } from "../lib/permissions";
import { printInboundSlip } from "../lib/pdf";
import { Alert, Spinner, StatusBadge } from "../components/UI";

// ─────────────────────────────────────────────────────────────
//  SupplierApp v3 — ตาม GAS App7 createASN_ ครบ
//
//  ID Format (ตาม GAS):
//    ASN No:        ASN-{initial}-{yymmdd}-{seq3d}
//                   เช่น ASN-MON-260430-001
//    Inbound Booking: IN{dock2d}{initial}{yymmdd}{HHmm}
//                   เช่น IN01MON2604300700
//
//  Bulk: groupBy truckPlate+date+hour+dock = 1 ASN (ตาม GAS)
//  เพิ่ม: lotNo, expiryDate ใน item detail
//  เพิ่ม: ASN detail modal (ดู invoice+item)
//  เพิ่ม: DOCK_COUNT จาก config
//  เพิ่ม: validateBookingDate (min hours ahead)
//  เพิ่ม: Slot double-check ก่อน insert
// ─────────────────────────────────────────────────────────────

// ── ID Generators (ตาม GAS) ─────────────────────────────────
async function generateAsnNo(supplierInitial, bookingDate) {
  // format: ASN-{initial}-{yymmdd}-{seq3d}
  const yymmdd = String(bookingDate).replace(/-/g,"").slice(2); // 260430
  const prefix = `ASN-${supplierInitial}-${yymmdd}`;
  const { data } = await supabase.from("asn_header")
    .select("asn_no").like("asn_no", `${prefix}%`);
  const seq = String(((data||[]).length)+1).padStart(3,"0");
  return `${prefix}-${seq}`;
}

function generateInboundBookingId(supplierInitial, bookingDate, bookingHour, dockNo) {
  // format: IN{dock2d}{initial}{yymmdd}{HHmm}
  const yymmdd = String(bookingDate).replace(/-/g,"").slice(2);
  const hhmm   = String(bookingHour).replace(":","").slice(0,4);
  const dk     = String(dockNo).padStart(2,"0");
  return `IN${dk}${supplierInitial}${yymmdd}${hhmm}`;
}

export default function SupplierApp({ user, onBack }) {
  const [tab, setTab]             = useState("create");
  const [slots, setSlots]         = useState([]);
  const [slotDate, setSlotDate]   = useState(today());
  const [slotLoading, setSlotLoading] = useState(false);
  const [selected, setSelected]   = useState(null);
  const [showForm, setShowForm]   = useState(false);
  const [myAsns, setMyAsns]       = useState([]);
  const [msg, setMsg]             = useState(null);
  const [saving, setSaving]       = useState(false);

  // Config
  const [dockCount, setDockCount] = useState(5);
  const [minHours, setMinHours]   = useState(3);
  const [daysAhead, setDaysAhead] = useState(7);
  const [supplierInfo, setSupplierInfo] = useState(null);

  // Form
  const [truck, setTruck] = useState({
    shipDate:today(), truckType:"", truckPlate:"",
    driverName:"", driverPhone:"", remarks:"",
  });
  const [invoices, setInvoices] = useState([{
    invoiceNo:"", invoiceDate:today(), poNo:"", open:true,
    items:[{ itemCode:"", itemName:"", unit:"", qtyShipped:"", lotNo:"", expiryDate:"" }],
  }]);

  // Bulk import
  const [bulkRows, setBulkRows]     = useState([]);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkPreview, setBulkPreview] = useState([]); // grouped ASN preview
  const fileRef = useRef();

  // ASN detail modal
  const [asnDetail, setAsnDetail] = useState(null); // {header, invoices, details}

  const days = Array.from({length:Math.min(daysAhead,7)},(_,i)=>{
    const d=new Date(); d.setDate(d.getDate()+i); const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),dy=String(d.getDate()).padStart(2,"0"); return `${y}-${m}-${dy}`;
  });
  const DOCKS = Array.from({length:dockCount},(_,i)=>i+1);

  // ── LOAD CONFIG ───────────────────────────────────────────
  const loadConfig = useCallback(async () => {
    const [cfgRes, scRes] = await Promise.all([
      supabase.from("config").select("*"),
      supabase.from("subcon_master").select("subcon_code,subcon_name,subcon_initial")
        .eq("subcon_code", user.subcon_code||"").maybeSingle(),
    ]);
    if (cfgRes.data) {
      const m = Object.fromEntries(cfgRes.data.map(r=>[r.key,r.value]));
      setDockCount(parseInt(m.DOCK_COUNT||"5"));
      setMinHours(Number(m.MIN_BOOKING_HOURS||3));
      setDaysAhead(parseInt(m.BOOKING_DAYS_AHEAD||"7"));
    }
    if (scRes.data) setSupplierInfo(scRes.data);
  },[user.subcon_code]);

  const loadSlots = useCallback(async (date) => {
    setSlotLoading(true); setSelected(null);
    const { data } = await supabase.from("dock_slots").select("*")
      .eq("slot_date", date).order("slot_hour").order("dock_no");
    setSlots(data||[]); setSlotLoading(false);
  },[]);

  const loadMyAsns = useCallback(async () => {
    const { data } = await supabase.from("asn_header").select("*")
      .eq("supplier_code", user.subcon_code||"")
      .order("created_at",{ascending:false}).limit(50);
    setMyAsns(data||[]);
  },[user.subcon_code]);

  useEffect(()=>{ loadConfig(); },[loadConfig]);
  useEffect(()=>{ loadSlots(slotDate); },[slotDate,loadSlots]);
  useEffect(()=>{ if(tab==="myasn") loadMyAsns(); },[tab,loadMyAsns]);

  // ── Slot utils ────────────────────────────────────────────
  const hours = [...new Set(slots.map(s=>String(s.slot_hour).slice(0,5)))].sort();
  const slotMap = {};
  slots.forEach(s=>{ slotMap[String(s.slot_hour).slice(0,5)+"_"+s.dock_no]=s; });

  function isPastSlot(slotDate, slotHour) {
    if (slotDate < today()) return true;
    if (slotDate !== today()) return false;
    const now = new Date();
    const [h,m] = String(slotHour).split(":").map(Number);
    const slotMs = new Date(now.getFullYear(),now.getMonth(),now.getDate(),h,m||0).getTime();
    return slotMs < now.getTime() + minHours * 3600000;
  }

  // ── Invoice helpers ───────────────────────────────────────
  const addInvoice = () => setInvoices(p=>[...p.map(i=>({...i,open:false})),{
    invoiceNo:"",invoiceDate:today(),poNo:"",open:true,
    items:[{itemCode:"",itemName:"",unit:"",qtyShipped:"",lotNo:"",expiryDate:""}],
  }]);
  const removeInvoice = (i) => { if(invoices.length>1) setInvoices(p=>p.filter((_,idx)=>idx!==i)); };
  const toggleInv     = (i) => setInvoices(p=>p.map((inv,idx)=>({...inv,open:idx===i?!inv.open:inv.open})));
  const updateInv     = (i,f,v) => setInvoices(p=>p.map((inv,idx)=>idx===i?{...inv,[f]:v}:inv));
  const addItem       = (i) => setInvoices(p=>p.map((inv,idx)=>idx===i?{...inv,items:[...inv.items,{itemCode:"",itemName:"",unit:"",qtyShipped:"",lotNo:"",expiryDate:""}]}:inv));
  const removeItem    = (ii,ki) => setInvoices(p=>p.map((inv,idx)=>idx===ii?{...inv,items:inv.items.filter((_,k)=>k!==ki)}:inv));
  const updateItem    = (ii,ki,f,v) => setInvoices(p=>p.map((inv,idx)=>idx===ii?{...inv,items:inv.items.map((it,k)=>k===ki?{...it,[f]:v}:it)}:inv));

  // ── SUBMIT ASN (FIX: format + slot double-check) ─────────
  const submitASN = async () => {
    if (!selected)                                    return setMsg({type:"err",msg:"กรุณาเลือก Slot ก่อน"});
    if (!truck.truckPlate||!truck.driverName||!truck.driverPhone)
      return setMsg({type:"err",msg:"กรุณากรอกข้อมูลรถให้ครบ"});
    const badInv = invoices.find(inv=>!inv.invoiceNo||!inv.invoiceDate);
    if (badInv)   return setMsg({type:"err",msg:"กรุณากรอก Invoice No และ Date ให้ครบ"});
    const badItem = invoices.find(inv=>inv.items.find(it=>!it.itemCode||!it.qtyShipped));
    if (badItem)  return setMsg({type:"err",msg:"กรุณากรอก Item Code และ Qty ให้ครบ"});

    setSaving(true); setMsg(null);

    const sc      = user.subcon_code||"SUP";
    const initial = supplierInfo?.subcon_initial || sc;

    // FIX: Slot double-check
    const { data: slotCheck } = await supabase.from("dock_slots")
      .select("status").eq("slot_key", selected.slot_key).maybeSingle();
    if (slotCheck?.status !== "AVAILABLE") {
      setMsg({type:"err",msg:"Slot นี้ถูกจองแล้ว กรุณาเลือก Slot ใหม่"});
      setSaving(false); setSelected(null); setShowForm(false);
      loadSlots(slotDate); return;
    }

    // FIX: ID format ตาม GAS
    const asnNo   = await generateAsnNo(initial, slotDate);
    const bkId    = generateInboundBookingId(initial, slotDate, selected.slot_hour, selected.dock_no);
    const totalQty   = invoices.reduce((s,inv)=>s+inv.items.reduce((ss,it)=>ss+Number(it.qtyShipped||0),0),0);
    const totalLines = invoices.reduce((s,inv)=>s+inv.items.length,0);

    // 1. Insert ASN header
    const { error: aErr } = await supabase.from("asn_header").insert({
      asn_no:asnNo, supplier_code:sc, supplier_name:user.full_name||"",
      ship_date:truck.shipDate, truck_type:truck.truckType,
      truck_plate:truck.truckPlate.toUpperCase(),
      driver_name:truck.driverName, driver_phone:truck.driverPhone,
      invoice_count:invoices.length, total_lines:totalLines, total_qty:totalQty,
      booking_id:bkId, status:"BOOKED",
      created_by:user.username, remarks:truck.remarks||"",
    });
    if (aErr) { setMsg({type:"err",msg:aErr.message}); setSaving(false); return; }

    // 2. Insert invoices + details (with lotNo, expiryDate)
    for (let i=0; i<invoices.length; i++) {
      const inv = invoices[i];
      const invQty = inv.items.reduce((s,it)=>s+Number(it.qtyShipped||0),0);
      await supabase.from("asn_invoice").insert({
        asn_no:asnNo, invoice_seq:i+1, invoice_no:inv.invoiceNo,
        invoice_date:inv.invoiceDate, po_no:inv.poNo||"",
        invoice_qty:invQty, invoice_lines:inv.items.length,
      });
      for (let k=0; k<inv.items.length; k++) {
        const it = inv.items[k];
        await supabase.from("asn_detail").insert({
          asn_no:asnNo, invoice_no:inv.invoiceNo, line_no:k+1,
          item_code:it.itemCode, item_name:it.itemName||"",
          unit:it.unit||"", qty_shipped:Number(it.qtyShipped||0), qty_received:0,
          lot_no:it.lotNo||"",       // FIX: เพิ่ม lotNo
          expiry_date:it.expiryDate||"", // FIX: เพิ่ม expiryDate
        });
      }
    }

    // 3. Insert inbound booking
    await supabase.from("inbound_bookings").insert({
      booking_id:bkId, asn_no:asnNo, supplier_code:sc,
      booking_date:slotDate, booking_hour:selected.slot_hour,
      dock_no:selected.dock_no, slot_key:selected.slot_key,
      truck_type:truck.truckType, truck_plate:truck.truckPlate.toUpperCase(),
      driver_name:truck.driverName, driver_phone:truck.driverPhone,
      status:"RESERVED", created_by:user.username,
    });

    // 4. Update slot
    await supabase.from("dock_slots")
      .update({status:"BOOKED", booking_id:bkId})
      .eq("slot_key", selected.slot_key);

    // 5. Audit
    await auditLog({module:"INBOUND",action:"CREATE_ASN",
      targetType:"ASN",targetId:asnNo,subconCode:sc,bookingId:bkId,actor:user.username,
      remark:`${invoices.length} invoices, ${totalQty} units`,
    });

    // 6. Print slip
    setTimeout(()=>{
      const bkData = {
        booking_id:bkId, asn_no:asnNo, booking_date:slotDate,
        booking_hour:selected.slot_hour, dock_no:selected.dock_no,
        truck_plate:truck.truckPlate.toUpperCase(), truck_type:truck.truckType,
        driver_name:truck.driverName, phone:truck.driverPhone,
        supplier_code:sc, supplier_name:user.full_name||"",
      };
      printInboundSlip(bkData, {supplier_name:user.full_name||""}, invoices.map((inv,i)=>({
        invoice_no:inv.invoiceNo, po_no:inv.poNo,
        invoice_date:inv.invoiceDate,
        invoice_qty:inv.items.reduce((s,it)=>s+Number(it.qtyShipped||0),0),
      })));
    },400);

    setMsg({type:"ok",msg:`✅ ASN ${asnNo} | Booking ${bkId} สำเร็จ!`});
    setSelected(null); setShowForm(false);
    setTruck({shipDate:today(),truckType:"",truckPlate:"",driverName:"",driverPhone:"",remarks:""});
    setInvoices([{invoiceNo:"",invoiceDate:today(),poNo:"",open:true,items:[{itemCode:"",itemName:"",unit:"",qtyShipped:"",lotNo:"",expiryDate:""}]}]);
    loadSlots(slotDate); loadMyAsns(); setSaving(false);
  };

  // ── CANCEL ASN ────────────────────────────────────────────
  const cancelASN = async (asn) => {
    if (!confirm(`ยืนยันยกเลิก ASN ${asn.asn_no}?`)) return;
    if (["RECEIVED","CANCELLED"].includes(asn.status))
      return setMsg({type:"err",msg:"ไม่สามารถยกเลิกได้"});
    await supabase.from("asn_header")
      .update({status:"CANCELLED",updated_at:nowISO()}).eq("asn_no",asn.asn_no);
    if (asn.booking_id) {
      await supabase.from("inbound_bookings")
        .update({status:"CANCELLED",updated_at:nowISO()}).eq("booking_id",asn.booking_id);
      const { data: bk } = await supabase.from("inbound_bookings")
        .select("slot_key").eq("booking_id",asn.booking_id).maybeSingle();
      if (bk?.slot_key)
        await supabase.from("dock_slots").update({status:"AVAILABLE",booking_id:null}).eq("slot_key",bk.slot_key);
    }
    await auditLog({module:"INBOUND",action:"CANCEL_ASN",targetType:"ASN",targetId:asn.asn_no,actor:user.username});
    setMsg({type:"ok",msg:`✅ ยกเลิก ASN ${asn.asn_no} แล้ว`});
    loadMyAsns();
  };

  // ── VIEW ASN DETAIL ───────────────────────────────────────
  const viewASN = async (asn) => {
    const [invRes, dtlRes] = await Promise.all([
      supabase.from("asn_invoice").select("*").eq("asn_no",asn.asn_no).order("invoice_seq"),
      supabase.from("asn_detail").select("*").eq("asn_no",asn.asn_no).order("line_no"),
    ]);
    setAsnDetail({ header:asn, invoices:invRes.data||[], details:dtlRes.data||[] });
  };

  // ── BULK CSV (FIX: group by truck ตาม GAS bulkCreateASN_) ─
  const handleCSV = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    setBulkLoading(true); setMsg(null);
    const text = await file.text();
    const lines = text.split("\n").filter(l=>l.trim());
    const headers = lines[0].split(",").map(h=>h.trim().replace(/"/g,""));
    const rows = lines.slice(1).map(l=>{
      const vals = l.split(",").map(v=>v.trim().replace(/"/g,""));
      return Object.fromEntries(headers.map((h,i)=>[h,vals[i]||""]));
    });

    // FIX: Group by truckPlate+bookingDate+bookingHour+dockNo = 1 ASN
    const asnMap = {}, asnOrder = [];
    rows.forEach(r=>{
      const key = `${r.truckPlate}|${r.bookingDate}|${r.bookingHour}|${r.dockNo}`;
      if (!asnMap[key]) { asnMap[key]={meta:r,invMap:{},invOrder:[]}; asnOrder.push(key); }
      const inv = r.invoiceNo;
      if (inv && !asnMap[key].invMap[inv]) {
        asnMap[key].invMap[inv]={invoiceNo:inv,invoiceDate:r.invoiceDate||"",poNo:r.poNo||"",items:[]};
        asnMap[key].invOrder.push(inv);
      }
      if (inv) asnMap[key].invMap[inv].items.push({
        itemCode:r.itemCode||"", itemName:r.itemName||"", unit:r.unit||"",
        qtyShipped:r.qtyShipped||"", lotNo:r.lotNo||"", expiryDate:r.expiryDate||"",
      });
    });

    const grouped = asnOrder.map(k=>({
      key:k, meta:asnMap[k].meta,
      invoices:asnMap[k].invOrder.map(inv=>asnMap[k].invMap[inv]),
    }));
    setBulkRows(rows);
    setBulkPreview(grouped);
    setBulkLoading(false);
    setTab("bulk");
    if (fileRef.current) fileRef.current.value="";
  };

  const submitBulk = async () => {
    if (!bulkPreview.length) return;
    setSaving(true); setMsg(null);
    let created=0, failed=[];
    const sc      = user.subcon_code||"SUP";
    const initial = supplierInfo?.subcon_initial||sc;

    for (const asnGroup of bulkPreview) {
      const { meta, invoices: invList } = asnGroup;
      try {
        const slotKey = `${meta.bookingDate}_${String(meta.bookingHour).padStart(5,"0")}_D${String(meta.dockNo||"1").padStart(2,"0")}`;
        const { data: slot } = await supabase.from("dock_slots")
          .select("status,slot_key").eq("slot_key",slotKey).maybeSingle();
        if (!slot || slot.status!=="AVAILABLE") throw new Error(`Slot ${slotKey} ไม่ว่าง`);

        const asnNo = await generateAsnNo(initial, meta.bookingDate);
        const bkId  = generateInboundBookingId(initial, meta.bookingDate, meta.bookingHour, meta.dockNo);
        const totalQty   = invList.reduce((s,inv)=>s+inv.items.reduce((ss,it)=>ss+Number(it.qtyShipped||0),0),0);
        const totalLines = invList.reduce((s,inv)=>s+inv.items.length,0);

        const { error } = await supabase.from("asn_header").insert({
          asn_no:asnNo, supplier_code:sc, supplier_name:user.full_name||"",
          ship_date:meta.shipDate, truck_type:meta.truckType||"",
          truck_plate:(meta.truckPlate||"").toUpperCase(),
          driver_name:meta.driverName||"", driver_phone:meta.driverPhone||"",
          invoice_count:invList.length, total_lines:totalLines, total_qty:totalQty,
          booking_id:bkId, status:"BOOKED", created_by:user.username,
        });
        if (error) throw new Error(error.message);

        for (let i=0; i<invList.length; i++) {
          const inv = invList[i];
          const invQty = inv.items.reduce((s,it)=>s+Number(it.qtyShipped||0),0);
          await supabase.from("asn_invoice").insert({
            asn_no:asnNo,invoice_seq:i+1,invoice_no:inv.invoiceNo,
            invoice_date:inv.invoiceDate,po_no:inv.poNo||"",
            invoice_qty:invQty,invoice_lines:inv.items.length,
          });
          for (let k=0;k<inv.items.length;k++) {
            const it=inv.items[k];
            await supabase.from("asn_detail").insert({
              asn_no:asnNo,invoice_no:inv.invoiceNo,line_no:k+1,
              item_code:it.itemCode,item_name:it.itemName||"",unit:it.unit||"",
              qty_shipped:Number(it.qtyShipped||0),qty_received:0,
              lot_no:it.lotNo||"",expiry_date:it.expiryDate||"",
            });
          }
        }

        await supabase.from("inbound_bookings").insert({
          booking_id:bkId,asn_no:asnNo,supplier_code:sc,
          booking_date:meta.bookingDate,booking_hour:meta.bookingHour,
          dock_no:Number(meta.dockNo||1),slot_key:slotKey,
          truck_plate:(meta.truckPlate||"").toUpperCase(),
          driver_name:meta.driverName||"",driver_phone:meta.driverPhone||"",
          status:"RESERVED",created_by:user.username,
        });
        await supabase.from("dock_slots").update({status:"BOOKED",booking_id:bkId}).eq("slot_key",slotKey);
        created++;
      } catch(err) { failed.push({plate:meta.truckPlate,error:err.message}); }
    }

    await auditLog({module:"INBOUND",action:"BULK_CREATE_ASN",targetType:"ASN",
      targetId:"BULK",subconCode:sc,actor:user.username,remark:`สร้าง ${created} ASN`});
    setMsg({type:failed.length===0?"ok":"warn",
      msg:`สร้างสำเร็จ ${created} ASN${failed.length>0?` | ล้มเหลว ${failed.length}: `+failed.map(f=>f.plate).join(", "):""}`});
    setBulkRows([]); setBulkPreview([]);
    setTab("myasn"); loadMyAsns(); setSaving(false);
  };

  // ── SHARED STYLES ─────────────────────────────────────────
  const inp = {width:"100%",padding:"8px 10px",border:"1.5px solid #e5e7eb",borderRadius:9,fontSize:12,outline:"none",boxSizing:"border-box"};
  const th  = {padding:"7px 10px",textAlign:"left",fontWeight:700,color:"#374151",fontSize:11,whiteSpace:"nowrap"};

  // ─────────────────────────────────────────────────────────
  return (
    <div style={{minHeight:"100vh",background:"#f0f4fb"}}>

      {/* TOPBAR */}
      <div style={{background:"linear-gradient(90deg,#065f46,#059669)",color:"#fff",
        padding:"12px 18px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",
        position:"sticky",top:0,zIndex:40}}>
        <button onClick={onBack} style={{border:"1px solid rgba(255,255,255,.2)",background:"transparent",color:"#fff",borderRadius:8,padding:"4px 10px",cursor:"pointer",fontSize:12}}>← Back</button>
        <span style={{fontWeight:800,fontSize:15}}>📦 Supplier Portal</span>
        {supplierInfo && (
          <span style={{fontSize:11,background:"rgba(255,255,255,.15)",borderRadius:999,padding:"2px 8px",fontWeight:700}}>
            {supplierInfo.subcon_code} — {supplierInfo.subcon_name}
          </span>
        )}
        <div style={{display:"flex",gap:4,background:"rgba(255,255,255,.15)",borderRadius:8,padding:3,marginLeft:8}}>
          {[["create","➕ สร้าง ASN"],["myasn","📋 My ASN"],["bulk","📤 Bulk Import"]].map(([t,l])=>(
            <button key={t} onClick={()=>setTab(t)}
              style={{border:"none",borderRadius:6,padding:"4px 10px",fontWeight:700,fontSize:11,cursor:"pointer",background:tab===t?"#fff":"transparent",color:tab===t?"#065f46":"rgba(255,255,255,.8)"}}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div style={{padding:14,maxWidth:960,margin:"0 auto"}}>
        {msg && <Alert type={msg.type} msg={msg.msg}/>}

        {/* ══════════════════════════════════════════════════
            CREATE TAB
        ══════════════════════════════════════════════════ */}
        {tab==="create" && <>

          {/* Slot picker */}
          <div style={{background:"#fff",borderRadius:14,padding:14,marginBottom:12,boxShadow:"0 4px 20px rgba(0,0,0,.07)"}}>
            <div style={{fontWeight:800,color:"#0a2a6e",fontSize:14,marginBottom:10}}>📅 เลือกวัน & Slot</div>
            <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap"}}>
              {days.map(d=>{
                const dt=new Date(d);
                return (
                  <button key={d} onClick={()=>setSlotDate(d)}
                    style={{border:"1.5px solid",borderColor:slotDate===d?"#059669":"#e5e7eb",borderRadius:9,padding:"6px 10px",fontSize:11,fontWeight:700,cursor:"pointer",background:slotDate===d?"#059669":"#fff",color:slotDate===d?"#fff":"#374151",textAlign:"center",minWidth:60}}>
                    <div style={{fontSize:10,opacity:.8}}>{d===today()?"วันนี้":d===days[1]?"พรุ่งนี้":dt.toLocaleDateString("th-TH",{weekday:"short"})}</div>
                    <div>{dt.toLocaleDateString("th-TH",{day:"numeric",month:"short"})}</div>
                  </button>
                );
              })}
            </div>
            {minHours>0 && <div style={{fontSize:11,color:"#9ca3af",marginBottom:8}}>⏱ ต้องจองล่วงหน้า {minHours} ชม.</div>}

            {slotLoading ? <div style={{padding:20,textAlign:"center"}}><Spinner/></div> : (
              hours.length===0
                ? <div style={{textAlign:"center",color:"#9ca3af",padding:"20px 0",fontSize:13}}>ไม่มี Slot — ติดต่อ Admin</div>
                : <div style={{overflowX:"auto"}}>
                    <table style={{borderCollapse:"separate",borderSpacing:3,minWidth:Math.max(300,dockCount*70)}}>
                      <thead><tr>
                        <th style={{background:"#065f46",color:"#fff",padding:"7px 10px",borderRadius:5,fontSize:11}}>เวลา</th>
                        {DOCKS.map(d=><th key={d} style={{background:"#065f46",color:"#fff",padding:"7px 8px",borderRadius:5,fontSize:11,textAlign:"center"}}>D{d}</th>)}
                      </tr></thead>
                      <tbody>
                        {hours.map(h=>(
                          <tr key={h}>
                            <td style={{padding:"5px 8px",textAlign:"center",fontWeight:700,fontSize:12,background:"#f8fafc",borderRadius:5}}>{h}</td>
                            {DOCKS.map(d=>{
                              const s = slotMap[h+"_"+d];
                              if (!s) return <td key={d} style={{padding:3}}><div style={{background:"#f8fafc",borderRadius:6,padding:"6px 4px",textAlign:"center",color:"#9ca3af",fontSize:10}}>—</div></td>;
                              const isSel    = selected?.slot_key===s.slot_key;
                              const isBooked = s.status!=="AVAILABLE";
                              const isPast   = isPastSlot(s.slot_date, s.slot_hour);
                              const disabled = isBooked || isPast;
                              const bg    = isSel?"#fde68a":isBooked?"#fee2e2":isPast?"#f3f4f6":"#d1fae5";
                              const color = isSel?"#92400e":isBooked?"#991b1b":isPast?"#9ca3af":"#065f46";
                              return (
                                <td key={d} style={{padding:3}}>
                                  <button disabled={disabled} onClick={()=>setSelected(isSel?null:s)}
                                    style={{width:"100%",padding:"6px 4px",borderRadius:6,border:"none",background:bg,color,fontWeight:700,fontSize:10,cursor:disabled?"not-allowed":"pointer",transform:isSel?"scale(1.05)":"none",transition:"all .12s"}}>
                                    {isBooked?"FULL":isPast?"—":"FREE"}
                                  </button>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
            )}

            {selected && !showForm && (
              <div style={{marginTop:10,padding:"10px 14px",background:"#ecfdf5",border:"1.5px solid #6ee7b7",borderRadius:9,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
                <div>
                  <span style={{fontWeight:700,color:"#065f46"}}>✅ Dock {selected.dock_no} • {String(selected.slot_hour).slice(0,5)} • {slotDate}</span>
                  {supplierInfo && (
                    <div style={{fontSize:10,color:"#065f46",marginTop:2,opacity:.7}}>
                      Booking ID preview:{" "}
                      <span style={{fontFamily:"monospace",fontWeight:700}}>
                        {generateInboundBookingId(supplierInfo.subcon_initial||user.subcon_code,slotDate,selected.slot_hour,selected.dock_no)}
                      </span>
                    </div>
                  )}
                </div>
                <button onClick={()=>setShowForm(true)}
                  style={{background:"#059669",color:"#fff",border:"none",borderRadius:8,padding:"6px 14px",fontWeight:700,cursor:"pointer",fontSize:12}}>
                  กรอกข้อมูล ASN →
                </button>
              </div>
            )}
          </div>

          {/* ASN Form */}
          {showForm && (
            <div style={{background:"#fff",borderRadius:14,padding:16,marginBottom:12,boxShadow:"0 4px 20px rgba(0,0,0,.07)"}}>
              <div style={{fontWeight:800,color:"#0a2a6e",fontSize:14,marginBottom:12}}>🚛 ข้อมูลรถ</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
                {[{l:"Ship Date *",k:"shipDate",t:"date"},{l:"ประเภทรถ",k:"truckType",p:"6 ล้อ"},{l:"ทะเบียนรถ *",k:"truckPlate",p:"80-1234"},{l:"ชื่อคนขับ *",k:"driverName"},{l:"เบอร์โทร *",k:"driverPhone",t:"tel"},{l:"Remarks",k:"remarks"}].map(f=>(
                  <div key={f.k}>
                    <label style={{display:"block",fontSize:11,fontWeight:700,marginBottom:4,color:"#374151"}}>{f.l}</label>
                    <input value={truck[f.k]} onChange={e=>setTruck(p=>({...p,[f.k]:e.target.value}))}
                      type={f.t||"text"} placeholder={f.p} style={inp}/>
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
                    <span style={{background:"#059669",color:"#fff",borderRadius:"50%",width:20,height:20,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800}}>{ii+1}</span>
                    <span style={{fontWeight:700,fontSize:13,flex:1}}>{inv.invoiceNo||`Invoice ${ii+1}`}</span>
                    <span style={{fontSize:11,color:"#6b7280"}}>{inv.items.length} รายการ</span>
                    {invoices.length>1 && <button onClick={e=>{e.stopPropagation();removeInvoice(ii);}} style={{background:"#fee2e2",color:"#991b1b",border:"none",borderRadius:5,padding:"2px 7px",cursor:"pointer",fontSize:11}}>✕</button>}
                    <span style={{color:"#9ca3af"}}>{inv.open?"▲":"▼"}</span>
                  </div>
                  {inv.open && (
                    <div style={{padding:12}}>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>
                        {[{l:"Invoice No *",k:"invoiceNo"},{l:"Invoice Date *",k:"invoiceDate",t:"date"},{l:"PO No",k:"poNo"}].map(f=>(
                          <div key={f.k}>
                            <label style={{display:"block",fontSize:11,fontWeight:700,marginBottom:3}}>{f.l}</label>
                            <input value={inv[f.k]} onChange={e=>updateInv(ii,f.k,e.target.value)} type={f.t||"text"}
                              style={{...inp,padding:"7px 9px"}}/>
                          </div>
                        ))}
                      </div>
                      <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                        <thead><tr style={{background:"#f8fafc"}}>
                          <th style={th}>#</th>
                          <th style={th}>Item Code *</th>
                          <th style={th}>Item Name</th>
                          <th style={th}>Unit</th>
                          <th style={th}>Qty *</th>
                          <th style={th}>Lot No</th>
                          <th style={th}>Expiry</th>
                          <th></th>
                        </tr></thead>
                        <tbody>
                          {inv.items.map((it,ki)=>(
                            <tr key={ki}>
                              <td style={{padding:"3px 6px",color:"#9ca3af"}}>{ki+1}</td>
                              {["itemCode","itemName","unit"].map(f=>(
                                <td key={f} style={{padding:"2px 3px"}}>
                                  <input value={it[f]} onChange={e=>updateItem(ii,ki,f,e.target.value)}
                                    style={{width:"100%",padding:"4px 6px",border:"1px solid #e5e7eb",borderRadius:6,fontSize:11,outline:"none"}}/>
                                </td>
                              ))}
                              <td style={{padding:"2px 3px",width:65}}>
                                <input value={it.qtyShipped} onChange={e=>updateItem(ii,ki,"qtyShipped",e.target.value)} type="number"
                                  style={{width:"100%",padding:"4px 6px",border:"1px solid #e5e7eb",borderRadius:6,fontSize:11,outline:"none"}}/>
                              </td>
                              {/* FIX: lotNo + expiryDate */}
                              <td style={{padding:"2px 3px",width:80}}>
                                <input value={it.lotNo||""} onChange={e=>updateItem(ii,ki,"lotNo",e.target.value)}
                                  style={{width:"100%",padding:"4px 6px",border:"1px solid #e5e7eb",borderRadius:6,fontSize:11,outline:"none"}}/>
                              </td>
                              <td style={{padding:"2px 3px",width:100}}>
                                <input value={it.expiryDate||""} onChange={e=>updateItem(ii,ki,"expiryDate",e.target.value)} type="date"
                                  style={{width:"100%",padding:"4px 6px",border:"1px solid #e5e7eb",borderRadius:6,fontSize:11,outline:"none"}}/>
                              </td>
                              <td style={{padding:"2px 3px"}}>
                                <button onClick={()=>removeItem(ii,ki)} style={{border:"none",background:"none",cursor:"pointer",color:"#9ca3af",fontSize:16}}>✕</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <button onClick={()=>addItem(ii)} style={{marginTop:6,background:"#e5e7eb",color:"#374151",border:"none",borderRadius:7,padding:"4px 10px",fontWeight:700,cursor:"pointer",fontSize:11}}>+ สินค้า</button>
                    </div>
                  )}
                </div>
              ))}

              <div style={{display:"flex",gap:8,marginTop:12}}>
                <button onClick={()=>{setShowForm(false);setMsg(null);}}
                  style={{flex:1,padding:"10px",background:"#e5e7eb",color:"#374151",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:13}}>
                  ยกเลิก
                </button>
                <button onClick={submitASN} disabled={saving}
                  style={{flex:2,padding:"10px",background:"#059669",color:"#fff",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer",fontSize:13,opacity:saving?.6:1}}>
                  {saving?"กำลังบันทึก…":"✓ สร้าง ASN & Booking"}
                </button>
              </div>
            </div>
          )}
        </>}

        {/* ══════════════════════════════════════════════════
            MY ASN TAB
        ══════════════════════════════════════════════════ */}
        {tab==="myasn" && (
          <div style={{background:"#fff",borderRadius:14,overflow:"hidden",boxShadow:"0 4px 20px rgba(0,0,0,.07)"}}>
            <div style={{padding:"12px 16px",borderBottom:"1px solid #e5e7eb",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontWeight:800,color:"#0a2a6e",fontSize:14}}>My ASN ({myAsns.length})</div>
              <button onClick={loadMyAsns} style={{background:"#e5e7eb",color:"#374151",border:"none",borderRadius:7,padding:"4px 10px",cursor:"pointer",fontSize:11,fontWeight:700}}>↻</button>
            </div>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead><tr style={{background:"#f8fafc"}}>
                  {["ASN No","Booking ID","Ship Date","Plate","Inv","Qty","Status","Actions"].map(h=>(
                    <th key={h} style={th}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {myAsns.length===0 ? (
                    <tr><td colSpan={8} style={{padding:24,textAlign:"center",color:"#9ca3af"}}>ยังไม่มี ASN</td></tr>
                  ) : myAsns.map(a=>(
                    <tr key={a.asn_no} style={{borderBottom:"1px solid #f3f4f6"}}>
                      <td style={{padding:"7px 10px",fontFamily:"monospace",fontSize:11,fontWeight:700,color:"#065f46",cursor:"pointer",textDecoration:"underline"}}
                        onClick={()=>viewASN(a)}>
                        {a.asn_no}
                      </td>
                      <td style={{padding:"7px 10px",fontFamily:"monospace",fontSize:10}}>{a.booking_id||"—"}</td>
                      <td style={{padding:"7px 10px",color:"#6b7280"}}>{a.ship_date}</td>
                      <td style={{padding:"7px 10px",fontFamily:"monospace",fontWeight:700}}>{a.truck_plate}</td>
                      <td style={{padding:"7px 10px",textAlign:"center"}}>{a.invoice_count}</td>
                      <td style={{padding:"7px 10px",textAlign:"center",fontWeight:700}}>{a.total_qty}</td>
                      <td style={{padding:"7px 10px"}}><StatusBadge status={a.status}/></td>
                      <td style={{padding:"7px 10px"}}>
                        <div style={{display:"flex",gap:4}}>
                          <button onClick={()=>viewASN(a)}
                            style={{background:"#dbeafe",color:"#1d4ed8",border:"none",borderRadius:6,padding:"3px 7px",cursor:"pointer",fontSize:10,fontWeight:700}}>
                            📋 ดู
                          </button>
                          {!["RECEIVED","CANCELLED"].includes(a.status) && (
                            <button onClick={()=>cancelASN(a)}
                              style={{background:"#fee2e2",color:"#991b1b",border:"none",borderRadius:6,padding:"3px 7px",cursor:"pointer",fontSize:10,fontWeight:700}}>
                              ยกเลิก
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════
            BULK IMPORT TAB
        ══════════════════════════════════════════════════ */}
        {tab==="bulk" && (
          <div style={{background:"#fff",borderRadius:14,padding:20,boxShadow:"0 4px 20px rgba(0,0,0,.07)"}}>
            <div style={{fontWeight:800,color:"#0a2a6e",fontSize:14,marginBottom:8}}>📤 Bulk Import ASN (CSV)</div>
            <div style={{fontSize:11,color:"#6b7280",marginBottom:10,background:"#f8fafc",padding:"8px 12px",borderRadius:8}}>
              <div style={{fontWeight:700,marginBottom:4}}>CSV columns ที่รองรับ:</div>
              <code style={{fontSize:10}}>truckPlate, bookingDate, bookingHour, dockNo, shipDate, truckType, driverName, driverPhone, invoiceNo, invoiceDate, poNo, itemCode, itemName, unit, qtyShipped, lotNo, expiryDate</code>
              <div style={{marginTop:6,fontSize:10,color:"#9ca3af"}}>💡 rows ที่มี truckPlate+date+hour+dock เดียวกัน = 1 ASN | invoiceNo เดียวกัน = 1 Invoice</div>
            </div>
            <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:12}}>
              <label style={{background:"#059669",color:"#fff",borderRadius:8,padding:"7px 14px",fontWeight:700,cursor:"pointer",fontSize:12}}>
                📤 เลือกไฟล์ CSV
                <input ref={fileRef} type="file" accept=".csv" onChange={handleCSV} style={{display:"none"}}/>
              </label>
              <button onClick={downloadASNTemplate}
                style={{background:"#fff",color:"#059669",border:"1.5px solid #059669",borderRadius:8,padding:"7px 14px",fontWeight:700,cursor:"pointer",fontSize:12}}>
                ⬇ Download Template
              </button>
              <span style={{fontSize:11,color:"#9ca3af"}}>ดาวน์โหลด template พร้อมตัวอย่าง</span>
            </div>
            {bulkLoading && <Spinner/>}

            {bulkPreview.length>0 && (
              <>
                <div style={{fontWeight:700,fontSize:12,color:"#374151",marginBottom:8}}>
                  Preview: {bulkPreview.length} ASN ({bulkRows.length} rows)
                </div>
                <div style={{border:"1px solid #e5e7eb",borderRadius:8,overflow:"hidden",marginBottom:12}}>
                  {bulkPreview.map((g,i)=>(
                    <div key={i} style={{padding:"8px 12px",borderBottom:"1px solid #f3f4f6",fontSize:12}}>
                      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                        <span style={{fontFamily:"monospace",fontWeight:700,fontSize:11}}>{g.meta.truckPlate}</span>
                        <span style={{color:"#6b7280"}}>Dock {g.meta.dockNo} • {g.meta.bookingDate} {String(g.meta.bookingHour).slice(0,5)}</span>
                        <span style={{background:"#dbeafe",color:"#1d4ed8",borderRadius:999,padding:"1px 7px",fontSize:10,fontWeight:700}}>{g.invoices.length} invoice</span>
                        <span style={{background:"#d1fae5",color:"#065f46",borderRadius:999,padding:"1px 7px",fontSize:10,fontWeight:700}}>
                          {g.invoices.reduce((s,inv)=>s+inv.items.reduce((ss,it)=>ss+Number(it.qtyShipped||0),0),0)} units
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <button onClick={submitBulk} disabled={saving}
                  style={{background:"#059669",color:"#fff",border:"none",borderRadius:10,padding:"10px 24px",fontWeight:700,cursor:"pointer",fontSize:13,opacity:saving?.6:1}}>
                  {saving?`กำลัง import…`:`✓ Import ${bulkPreview.length} ASN`}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── ASN DETAIL MODAL ──────────────────────────────── */}
      {asnDetail && (
        <div style={{position:"fixed",inset:0,background:"rgba(10,20,50,.6)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,padding:16}}>
          <div style={{background:"#fff",borderRadius:16,padding:24,width:"100%",maxWidth:640,maxHeight:"85vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,.3)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div>
                <div style={{fontWeight:800,color:"#065f46",fontSize:16}}>{asnDetail.header.asn_no}</div>
                <div style={{fontSize:12,color:"#6b7280"}}>{asnDetail.header.booking_id}</div>
              </div>
              <button onClick={()=>setAsnDetail(null)} style={{border:"none",background:"none",cursor:"pointer",fontSize:18,color:"#9ca3af"}}>✕</button>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
              {[
                {label:"Ship Date", val:asnDetail.header.ship_date},
                {label:"Truck",     val:`${asnDetail.header.truck_plate} (${asnDetail.header.truck_type||"—"})`},
                {label:"Driver",    val:asnDetail.header.driver_name},
                {label:"Phone",     val:asnDetail.header.driver_phone},
                {label:"Invoices",  val:asnDetail.header.invoice_count},
                {label:"Total Qty", val:asnDetail.header.total_qty},
              ].map(s=>(
                <div key={s.label} style={{background:"#f8fafc",borderRadius:8,padding:"6px 10px"}}>
                  <div style={{fontSize:10,color:"#9ca3af"}}>{s.label}</div>
                  <div style={{fontWeight:700,fontSize:12,color:"#0a2a6e"}}>{s.val}</div>
                </div>
              ))}
            </div>

            <div style={{fontWeight:700,fontSize:13,color:"#374151",marginBottom:8}}>รายการสินค้า</div>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead><tr style={{background:"#065f46",color:"#fff"}}>
                {["Invoice No","Item Code","Item Name","Unit","Qty","Lot No","Expiry"].map(h=>(
                  <th key={h} style={{padding:"6px 8px",textAlign:"left",fontWeight:700,fontSize:10}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {asnDetail.details.map((d,i)=>{
                  const inv = asnDetail.invoices.find(iv=>iv.invoice_no===d.invoice_no)||{};
                  return (
                    <tr key={i} style={{borderBottom:"1px solid #f3f4f6",background:i%2===0?"#fff":"#f8fafc"}}>
                      <td style={{padding:"5px 8px",fontFamily:"monospace",fontSize:10,color:"#065f46"}}>{d.invoice_no}</td>
                      <td style={{padding:"5px 8px",fontFamily:"monospace",fontWeight:700,fontSize:10}}>{d.item_code}</td>
                      <td style={{padding:"5px 8px"}}>{d.item_name||"—"}</td>
                      <td style={{padding:"5px 8px"}}>{d.unit||"—"}</td>
                      <td style={{padding:"5px 8px",textAlign:"right",fontWeight:700}}>{d.qty_shipped}</td>
                      <td style={{padding:"5px 8px",fontFamily:"monospace"}}>{d.lot_no||"—"}</td>
                      <td style={{padding:"5px 8px",color:"#6b7280"}}>{d.expiry_date||"—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
