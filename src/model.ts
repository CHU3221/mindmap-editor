export type Shape='rectangle'|'oval'|'none'|'underline';
export type Layout='tree'|'radial'|'underline';
export type Line='curve'|'straight';
export interface Node {id:string;parentId:string|null;text:string;x:number;y:number;shape:Shape;bg_color:string;text_color:string;font_family:string;font_size:number;edge_color:string;edge_thick:number;edge_line?:Line;}
export interface Document {schemaVersion:1;id:string;title:string;layout:Layout;line:Line;nodes:Node[];revision:number;updatedAt:number;}
export const colors=['#FF6B6B','#FF8E53','#FFD166','#06D6A0','#2ECC71','#4CC9F0','#0077B6','#7209B7','#F15BB5','#A0522D','#2B2D42','#FFFFFF'];
export const uid=()=>crypto.randomUUID();
export function fresh():Document {const id=uid();return {schemaVersion:1,id,title:'새 마인드맵',layout:'tree',line:'curve',revision:0,updatedAt:Date.now(),nodes:[{id:uid(),parentId:null,text:'중심 주제',x:0,y:0,shape:'rectangle',bg_color:'#FFFFFF',text_color:'#102033',font_family:'Arial',font_size:18,edge_color:'#8D99AE',edge_thick:2.5}]};}
export function size(n:Node){return {w:Math.max(112,Math.min(330, n.text.split('\n').reduce((a,s)=>Math.max(a,s.length),0)*n.font_size*.63+38)),h:Math.max(54,n.text.split('\n').length*n.font_size*1.35+25)};}
export function layout(doc:Document):Document {const nodes=doc.nodes.map(n=>({...n}));const root=nodes.find(n=>n.parentId===null);if(!root)return doc;const children=(id:string)=>nodes.filter(n=>n.parentId===id);if(doc.layout==='tree'||doc.layout==='underline'){const heights=new Map<string,number>();const measure=(n:Node):number=>{const cs=children(n.id);const h=cs.length?cs.reduce((sum,c)=>sum+measure(c),0)+(cs.length-1)*28:0;const v=Math.max(size(n).h,h);heights.set(n.id,v);return v;};measure(root);const place=(n:Node,x:number,y:number)=>{n.x=x;n.y=y;const cs=children(n.id);let cy=y-(heights.get(n.id)||0)/2;for(const c of cs){const h=heights.get(c.id)||60;place(c,x+size(n).w/2+size(c).w/2+125,cy+h/2);cy+=h+28;}};place(root,0,0);}else{const leaves=new Map<string,number>();const count=(n:Node):number=>{const cs=children(n.id);const v=cs.length?cs.reduce((s,c)=>s+count(c),0):1;leaves.set(n.id,v);return v;};count(root);root.x=0;root.y=0;const place=(n:Node,a:number,b:number,depth:number)=>{let cur=a;for(const c of children(n.id)){const sweep=(b-a)*(leaves.get(c.id)||1)/(leaves.get(n.id)||1);const mid=(cur+sweep/2);const radius=depth*245;c.x=Math.cos(mid)*radius;c.y=Math.sin(mid)*radius;place(c,cur,cur+sweep,depth+1);cur+=sweep;}};place(root,-Math.PI,Math.PI,1);}return {...doc,nodes};}
export function addChild(doc:Document,parentId:string):{doc:Document;id:string}{const parent=doc.nodes.find(n=>n.id===parentId)!;const id=uid();const siblings=doc.nodes.filter(n=>n.parentId===parentId);const color=parent.parentId===null?colors[siblings.length%colors.length]:parent.edge_color;const node:Node={...parent,id,parentId,text:'하위 주제',x:parent.x+240,y:parent.y+siblings.length*70,edge_color:color};return {doc:layout({...doc,nodes:[...doc.nodes,node]}),id};}
export function descendants(nodes:Node[],id:string):Set<string>{const ids=new Set([id]);let change=true;while(change){change=false;for(const n of nodes)if(n.parentId&&ids.has(n.parentId)&&!ids.has(n.id)){ids.add(n.id);change=true;}}return ids;}
export function fromFile(value:unknown):Document {
  if(!value||typeof value!=='object')throw Error('올바르지 않은 .mindmap 파일입니다.');
  const v=value as Record<string,unknown>;
  if(v.schemaVersion!==1||!Array.isArray(v.nodes))throw Error('지원하지 않는 마인드맵 형식입니다.');
  if(v.nodes.length===0||v.nodes.length>5000)throw Error('노드 수가 올바르지 않습니다.');
  const nodes:Node[]=v.nodes.map((raw:unknown)=>{
    const n=raw as Node;
    if(!n||typeof n.id!=='string'||typeof n.text!=='string'||!Number.isFinite(n.x)||!Number.isFinite(n.y))throw Error('노드 형식이 잘못되었습니다.');
    return {...n,text:n.text.slice(0,10000)};
  });
  const ids=new Set(nodes.map(n=>n.id));
  if(ids.size!==nodes.length||nodes.filter(n=>n.parentId===null).length!==1||nodes.some(n=>n.parentId!==null&&!ids.has(n.parentId)))throw Error('노드 연결 구조가 잘못되었습니다.');
  for(const n of nodes){
    const seen=new Set<string>();let current:Node|undefined=n;
    while(current){if(seen.has(current.id))throw Error('순환 연결이 발견되었습니다.');seen.add(current.id);current=current.parentId?nodes.find(x=>x.id===current!.parentId):undefined;}
  }
  return {...v,nodes,layout:v.layout==='radial'?'radial':v.layout==='underline'?'underline':'tree',line:v.line==='straight'?'straight':'curve',revision:0,updatedAt:Date.now()} as Document;
}
