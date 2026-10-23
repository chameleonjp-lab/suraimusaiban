import type { ChartModel } from './chart-model';
const NS='http://www.w3.org/2000/svg';
export function renderChart(model:ChartModel,kind:'radar'|'bar'|'line'='radar'):SVGElement {
 const svg=document.createElementNS(NS,'svg');svg.setAttribute('viewBox',kind==='radar'?'0 0 900 760':'0 0 900 420');svg.setAttribute('role','img');svg.setAttribute('aria-label',`${model.series.map(s=>s.name).join('・')}。尺度${model.min}〜${model.max}。数値と項目名は続く表に記載。`);svg.style.width='100%';svg.style.height='auto';svg.style.display='block';
 const add=(tag:string,attrs:Record<string,string>,parent:SVGElement=svg)=>{const node=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))node.setAttribute(k,v);parent.append(node);return node;};
 const colors=['#655387','#3c7983'];
 const text=(x:number,y:number,value:string,attrs:Record<string,string>={})=>{const t=add('text',{x:String(x),y:String(y),'font-size':'19',fill:'#272b42',...attrs});t.textContent=value;return t;};
 if(kind==='radar'){
  const cx=450,cy=370,r=230,n=model.labels.length;const xy=(i:number,value:number,radius=r)=>{const angle=-Math.PI/2+i*2*Math.PI/n;return[cx+Math.cos(angle)*radius*value/100,cy+Math.sin(angle)*radius*value/100];};
  for(const value of [25,50,75,100]){add('polygon',{points:model.labels.map((_,i)=>xy(i,value).join(',')).join(' '),fill:'none',stroke:'#c4bdcc','stroke-width':'1'});text(cx+8,cy-value*r/100,String(value),{'font-size':'17'});}
  model.labels.forEach((label,i)=>{const[x,y]=xy(i,100);add('line',{x1:String(cx),y1:String(cy),x2:String(x),y2:String(y),stroke:'#d6cfdb'});const[lx,ly]=xy(i,100,292);const t=text(lx,ly,`${i+1}. ${label.slice(0,9)}`,{'text-anchor':'middle'});if(label.length>9){const span=document.createElementNS(NS,'tspan');span.setAttribute('x',String(lx));span.setAttribute('dy','24');span.textContent=label.slice(9);t.append(span);}});
  model.series.forEach((series,index)=>add('polygon',{points:series.values.map((v,i)=>xy(i,v).join(',')).join(' '),fill:index===0?'#9187b722':'none',stroke:colors[index%2],'stroke-width':'4','stroke-dasharray':index===1||series.name.includes('破線')?'10 7':''}));
  model.series.forEach((s,i)=>{add('line',{x1:String(240+i*260),y1:'720',x2:String(280+i*260),y2:'720',stroke:colors[i%2],'stroke-width':'4','stroke-dasharray':s.name.includes('破線')?'10 7':''});text(290+i*260,727,s.name);});
 }else{
  const left=55,top=25,width=815,height=325;const py=(v:number)=>top+(model.max-v)/(model.max-model.min)*height;
  for(const value of [model.min,0,model.max]){add('line',{x1:String(left),x2:String(left+width),y1:String(py(value)),y2:String(py(value)),stroke:'#c4bdcc'});text(3,py(value)+6,String(value));}
  const step=width/model.labels.length;
  model.series.forEach((series,s)=>{if(kind==='line'){add('polyline',{points:series.values.map((v,i)=>`${left+(i+.5)*step},${py(v)}`).join(' '),fill:'none',stroke:colors[s%2],'stroke-width':'3'});}else{series.values.forEach((v,i)=>add('rect',{x:String(left+i*step+step*.1+s*step*.35),y:String(Math.min(py(v),py(0))),width:String(step*.32),height:String(Math.max(1,Math.abs(py(v)-py(0)))),fill:colors[s%2]}));}});
  model.labels.forEach((label,i)=>text(left+(i+.5)*step,382,label.slice(0,3),{'font-size':'16','text-anchor':'middle'}));
 }
 return svg;
}
