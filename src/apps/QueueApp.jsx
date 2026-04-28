import React, { useState, useEffect, useCallback } from "react";
import { supabase, today, nowISO, auditLog } from "../lib/supabase";
import { sendSMS, buildQueueSMS, buildRecallSMS } from "../lib/sms";
import { printQueueTV } from "../lib/pdf";
import { Alert, Spinner, StatusBadge } from "../components/UI";

export default function QueueApp({ user, onBack }) {
  const [queueList, setQueueList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);
  const [calling, setCalling] = useState(null);
  const [voiceRate, setVoiceRate] = useState(0.75);
  const [voiceRepeat, setVoiceRepeat] = useState(2);
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [config, setConfig] = useState({});

  const loadQueue = useCallback(async () => {
    const { data } = await supabase.from("queue_log").select("*")
      .eq("slot_date", today()).order("booking_hour");
    if (data) setQueueList(data);
    setLoading(false);
  },[]);

  const loadConfig = useCallback(async () => {
    const { data } = await supabase.from("config").select("*");
    if (data) {
      const cfg = Object.fromEntries(data.map(r=>[r.key,r.value]));
      setConfig(cfg);
      if (cfg.QUEUE_VOICE_RATE) setVoiceRate(Number(cfg.QUEUE_VOICE_RATE)||0.75);
      if (cfg.QUEUE_VOICE_REPEAT) setVoiceRepeat(Number(cfg.QUEUE_VOICE_REPEAT)||2);
      if (cfg.SMS_ENABLED) setSmsEnabled(cfg.SMS_ENABLED==="TRUE");
    }
  },[]);

  useEffect(()=>{ loadQueue(); loadConfig(); },[loadQueue,loadConfig]);

  useEffect(()=>{
    const ch = supabase.channel("queue_live")
      .on("postgres_changes",{event:"*",schema:"public",table:"queue_log"},()=>loadQueue())
      .subscribe((s)=>{ if(s==="CHANNEL_ERROR") console.warn("Realtime queue error"); });
    return ()=>supabase.removeChannel(ch);
  },[loadQueue]);

  // TTS
  const speak = (row, isRecall=false, count=0) => {
    if (!window.speechSynthesis) return;
    const plate = (row.truck_plate||"").split("").map(c=>/[0-9A-Za-ก-ฮ]/.test(c)?c+" ":c).join("").replace(/-/g," ขีด ").trim();
    const dock = String(row.dock_no||"").split("").join(" ");
    const txt = isRecall
      ? `เรียกซ้ำครั้งที่ ${count} ทะเบียน ${plate} กรุณาเข้า ด็อก ${dock} ด่วน`
      : `เรียนคุณ ${row.driver_name||""} ทะเบียน ${plate} กรุณานำรถเข้า ด็อก ${dock} ได้เลยครับ`;

    window.speechSynthesis.cancel();
    let i = 0;
    const say = () => {
      if (i >= voiceRepeat) return;
      const u = new SpeechSynthesisUtterance(txt);
      u.lang = "th-TH"; u.rate = voiceRate; u.pitch = 1.05; u.volume = 1;
      u.onend = ()=>{ i++; if(i<voiceRepeat) setTimeout(say,1400); };
      window.speechSynthesis.speak(u); i++;
    };
    setTimeout(say, 300);
  };

  const callQueue = async (q) => {
    setCalling(q.id); setMsg(null);
    const now = nowISO();
    // upsert queue_log
    const existing = queueList.find(x=>x.booking_id===q.booking_id);
    if (existing && existing.id) {
      await supabase.from("queue_log").update({queue_status:"CALLING",called_at:now}).eq("id",existing.id);
    } else {
      await supabase.from("queue_log").insert({
        booking_id:q.booking_id, dock_no:q.dock_no,
        subcon_code:q.subcon_code, subcon_name:q.subcon_name||"",
        truck_plate:q.truck_plate, driver_name:q.driver_name,
        driver_phone:q.driver_phone||q.phone||"",
        booking_hour:q.booking_hour, slot_date:today(),
        queue_status:"CALLING", called_at:now, recall_count:0,
      });
    }
    speak(q);
    // SMS
    if (smsEnabled && (q.driver_phone||q.phone)) {
      const smsText = buildQueueSMS({truckPlate:q.truck_plate,driverName:q.driver_name,dockNo:q.dock_no,groupNumber:q.group_number||"",siteName:config.SITE_NAME||"DMS"});
      sendSMS({phone:q.driver_phone||q.phone||"",message:smsText,bookingId:q.booking_id});
    }
    await auditLog({module:"QUEUE",action:"CALL_QUEUE",targetType:"BOOKING",targetId:q.booking_id,subconCode:q.subcon_code,actor:user.username,remark:`เรียก Dock ${q.dock_no}`});
    setMsg({type:"ok",msg:`📢 เรียก ${q.truck_plate} → Dock ${q.dock_no}`});
    setCalling(null);
  };

  const recallQueue = async (q) => {
    setCalling(q.id);
    const cnt = (q.recall_count||0)+1;
    await supabase.from("queue_log").update({recall_count:cnt,called_at:nowISO()}).eq("id",q.id);
    speak(q, true, cnt);
    if (smsEnabled && (q.driver_phone||q.phone)) {
      const smsText = buildRecallSMS({truckPlate:q.truck_plate,dockNo:q.dock_no,recallCount:cnt,siteName:config.SITE_NAME||"DMS"});
      sendSMS({phone:q.driver_phone||q.phone||"",message:smsText,bookingId:q.booking_id});
    }
    await auditLog({module:"QUEUE",action:"RECALL_QUEUE",targetType:"BOOKING",targetId:q.booking_id,actor:user.username,remark:`Recall #${cnt}`});
    setCalling(null);
  };

  const completeQueue = async (q) => {
    setCalling(q.id);
    await supabase.from("queue_log").update({queue_status:"COMPLETED",completed_at:nowISO()}).eq("id",q.id);
    await auditLog({module:"QUEUE",action:"COMPLETE_QUEUE",targetType:"BOOKING",targetId:q.booking_id,actor:user.username});
    setCalling(null);
  };

  const skipQueue = async (q) => {
    setCalling(q.id);
    await supabase.from("queue_log").update({queue_status:"SKIPPED"}).eq("id",q.id);
    await auditLog({module:"QUEUE",action:"SKIP_QUEUE",targetType:"BOOKING",targetId:q.booking_id,actor:user.username});
    setCalling(null);
  };

  const openTV = () => {
    const calling_ = queueList.filter(q=>q.queue_status==="CALLING");
    const recent = queueList.filter(q=>q.queue_status!=="WAITING").sort((a,b)=>b.called_at>a.called_at?1:-1).slice(0,10);
    printQueueTV(calling_, recent, config);
  };

  const STATUS_STYLE = {
    WAITING:{bg:"#f8fafc",border:"#e5e7eb"},
    CALLING:{bg:"#fef3c7",border:"#fcd34d"},
    COMPLETED:{bg:"#f0fdf4",border:"#86efac"},
    SKIPPED:{bg:"#f9fafb",border:"#e5e7eb"},
  };

  const waiting = queueList.filter(q=>["WAITING","REMINDER_SENT"].includes(q.queue_status));
  const callingNow = queueList.filter(q=>q.queue_status==="CALLING");
  const done = queueList.filter(q=>["COMPLETED","SKIPPED"].includes(q.queue_status));

  return (
    <div style={{minHeight:"100vh",background:"#f0f4fb"}}>
      <div style={{background:"linear-gradient(90deg,#78350f,#b45309,#f59e0b)",color:"#fff",padding:"12px 18px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",position:"sticky",top:0,zIndex:40}}>
        <button onClick={onBack} style={{border:"1px solid rgba(255,255,255,.2)",background:"transparent",color:"#fff",borderRadius:8,padding:"4px 10px",cursor:"pointer",fontSize:12}}>← Back</button>
        <span style={{fontWeight:800,fontSize:15}}>🔔 Queue Operator</span>
        <button onClick={openTV} style={{background:"rgba(255,255,255,.15)",border:"none",color:"#fff",borderRadius:7,padding:"4px 10px",cursor:"pointer",fontSize:11,fontWeight:700}}>📺 TV Display</button>
        <div style={{display:"flex",alignItems:"center",gap:8,marginLeft:"auto",background:"rgba(255,255,255,.15)",borderRadius:8,padding:"4px 10px",flexWrap:"wrap",gap:8}}>
          <span style={{fontSize:11,fontWeight:700}}>TTS Speed:</span>
          <input type="range" min="0.5" max="1.2" step="0.05" value={voiceRate} onChange={e=>setVoiceRate(+e.target.value)} style={{width:70}}/>
          <span style={{fontSize:11,fontWeight:700,minWidth:24}}>{voiceRate}</span>
          <span style={{fontSize:11,fontWeight:700,marginLeft:8}}>Repeat:</span>
          <select value={voiceRepeat} onChange={e=>setVoiceRepeat(+e.target.value)} style={{background:"rgba(255,255,255,.2)",border:"none",color:"#fff",borderRadius:5,padding:"2px 6px",fontSize:11}}>
            {[1,2,3].map(n=><option key={n} value={n}>{n}×</option>)}
          </select>
          <span style={{fontSize:10,marginLeft:8,color:"rgba(255,255,255,.6)"}}>SMS:{smsEnabled?"ON":"OFF"}</span>
        </div>
      </div>

      <div style={{padding:14,maxWidth:900,margin:"0 auto"}}>
        {msg && <Alert type={msg.type} msg={msg.msg}/>}

        {/* SUMMARY */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:14}}>
          {[
            {label:"รอเรียก",val:waiting.length,bg:"#dbeafe",c:"#1d4ed8"},
            {label:"กำลังเรียก",val:callingNow.length,bg:"#fef3c7",c:"#92400e"},
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
                  <div key={q.id} style={{background:ss.bg,border:`1.5px solid ${ss.border}`,borderRadius:12,padding:"12px 14px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                        <span style={{fontFamily:"monospace",fontWeight:900,fontSize:14}}>{q.truck_plate||"—"}</span>
                        <span style={{fontWeight:700,color:"#0a2a6e"}}>D{q.dock_no}</span>
                        <span style={{fontSize:12,color:"#6b7280"}}>{String(q.booking_hour||"").slice(0,5)}</span>
                        {q.recall_count>0 && <span style={{fontSize:10,background:"#fee2e2",color:"#991b1b",borderRadius:999,padding:"1px 6px",fontWeight:700}}>เรียกซ้ำ {q.recall_count}×</span>}
                        {q.sms_status==="SENT" && <span style={{fontSize:10,background:"#d1fae5",color:"#065f46",borderRadius:999,padding:"1px 6px",fontWeight:700}}>📱 SMS</span>}
                      </div>
                      <div style={{fontSize:11,color:"#6b7280",marginTop:2}}>{q.driver_name} • {q.subcon_name}</div>
                    </div>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                      <StatusBadge status={q.queue_status}/>
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
