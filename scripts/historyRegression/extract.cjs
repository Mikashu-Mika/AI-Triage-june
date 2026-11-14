const fs=require('fs');
const j=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const flat=t=>Array.isArray(t)?t.map(x=>typeof x==='string'?x:x.text).join(''):(t||'');
const BOT='Mikashu Bot';
const msgs=j.messages.filter(m=>m.type==='message');
const byId=new Map(msgs.map(m=>[m.id,m]));
const out=[];
msgs.forEach((m,i)=>{
  if(m.from===BOT) return;
  let q=flat(m.text).replace(/@\w+/g,'').replace(/\s+/g,' ').trim();
  if(!q || q.length<3) return;
  // original bot reply: first bot message replying to it, else next bot message within 30 min before next human msg
  let reply=msgs.find(r=>r.from===BOT&&r.reply_to_message_id===m.id);
  if(!reply){for(let k=i+1;k<msgs.length;k++){const r=msgs[k]; if(r.from!==BOT){ if(k>i+1) break; else continue;} reply=r;break;}}
  const parent=m.reply_to_message_id?byId.get(m.reply_to_message_id):null;
  out.push({id:m.id,date:m.date,from:m.from,q,mentioned:/@\w+bot/i.test(flat(m.text)),isReplyTo:parent?(parent.from===BOT?'bot':'human'):null,
    parentText:parent?flat(parent.text).slice(0,300):null,
    origReply:reply?flat(reply.text):null, origReplyDate:reply?.date, photo:!!m.photo, file:!!m.file});
});
fs.writeFileSync(process.argv[3],JSON.stringify(out,null,1));
const norm=s=>s.toLowerCase().replace(/[\s?!.,ๆ]/g,'').replace(/(ค่ะ|คะ|ครับ|หน่อย|นะ|ให้)/g,'');
const uniq=new Map(); for(const r of out){const k=norm(r.q); if(!uniq.has(k)) uniq.set(k,r);}
console.log('human msgs',out.length,'unique',uniq.size,'mentioned',out.filter(r=>r.mentioned).length,'withReply',out.filter(r=>r.origReply).length,'replyToBot',out.filter(r=>r.isReplyTo==='bot').length,'photo',out.filter(r=>r.photo||r.file).length);
const lens=[...uniq.values()].map(r=>r.q.length).sort((a,b)=>a-b); console.log('len p50',lens[lens.length>>1],'p90',lens[Math.floor(lens.length*.9)],'max',lens.at(-1));
[...uniq.values()].slice(0,400).forEach((r,i)=>console.log(i+1, r.date.slice(5,10), r.from.slice(0,6), r.isReplyTo||'-', r.origReply?'R':'_', '|', r.q.slice(0,110)));
