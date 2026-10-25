import React, {useCallback, useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Plus, FolderOpen, Save, Undo2, Redo2, Trash2, Copy, Clipboard, Maximize, ZoomIn, ZoomOut, LayoutGrid, Image, RotateCcw} from 'lucide-react';
import {addChild, colors, descendants, fresh, fromFile, layout, size, uid, type Document, type Node} from './model';
import {DocumentThumbnail} from './thumbnail';
import {deleteDoc, getDoc, listDocs, putDoc} from './storage';
import './style.css';

const GRID = 24;
const fileName = (value:string) => value.replace(/[\\/:*?"<>|]/g,'_').slice(0,90)||'mindmap';
function download(blob:Blob, name:string){
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),2000);
}
type Point={x:number;y:number};
type Drag = {
  type:'node'|'pan'|'box'; startX:number;startY:number;panX:number;panY:number;
  before?:Document; original?:Map<string,Point>; selectedBefore?:string[]; changed?:boolean;
};
const clone = <T,>(value:T):T => structuredClone(value);

function App(){
  const [doc,setDoc]=useState<Document|null>(null);
  const [docs,setDocs]=useState<Document[]>([]);
  const [showHome,setShowHome]=useState(true);

  const [locked,setLocked]=useState(false);
  const [status,setStatus]=useState('준비 중');
  const [dirty,setDirty]=useState(false);
  const [fileDirty,setFileDirty]=useState(true);
  const [selectedIds,setSelectedIds]=useState<string[]>([]);
  const [ribbonTab,setRibbonTab]=useState<"home"|"layout"|"node"|"edge">("home");
  const [selectedEdge,setSelectedEdge]=useState<string|null>(null);
  const [selectedEdges,setSelectedEdges]=useState<string[]>([]);
  useEffect(()=>{if(!selectedEdge)setSelectedEdges([]);},[selectedEdge]);
  const [editingId,setEditingId]=useState<string|null>(null);
  const [editingText,setEditingText]=useState('');
  const [scale,setScale]=useState(1);
  const [pan,setPan]=useState<Point>({x:0,y:0});
  const [box,setBox]=useState<{a:Point;b:Point}|null>(null);
  const [pngBackground,setPngBackground]=useState(false);
  const [pngColor,setPngColor]=useState('#f7f9fc');
  const [exportOpen,setExportOpen]=useState(false);
  const [subtreeMode,setSubtreeMode]=useState(false);
  const [snap,setSnap]=useState(()=>localStorage.getItem('mindmap:snap')!=='off');
  const [,setHistoryVersion]=useState(0);
  const svg=useRef<SVGSVGElement>(null);
  const editInput=useRef<HTMLTextAreaElement>(null);
  const fileInput=useRef<HTMLInputElement>(null);
  const docRef=useRef<Document|null>(null);
  const revision=useRef(0);
  const history=useRef<Document[]>([]);
  const future=useRef<Document[]>([]);
  const clipboard=useRef<Node[]|null>(null);
  const drag=useRef<Drag|null>(null);
  const editCounter=useRef(0);
  const dirtyRef=useRef(false);
  const channel=useRef<BroadcastChannel|null>(null);
  const fileHandle=useRef<FileSystemFileHandle|null>(null);
  const wheelSteps=useRef(0);

  useEffect(()=>{if(showHome)return;setRibbonTab(selectedEdge?'edge':selectedIds.length?'node':'home');},[selectedEdge,selectedIds.join(','),showHome]);
  const selectedNode=doc?.nodes.find(n=>n.id===selectedIds[0])||null;
  const edgeNode=doc?.nodes.find(n=>n.id===selectedEdge&&n.parentId)||null;
  const selectedNodes=doc?.nodes.filter(n=>selectedIds.includes(n.id))||[];
  const isEditing=editingId!==null;

  useEffect(()=>{localStorage.setItem('mindmap:snap',snap?'on':'off');},[snap]);
  useEffect(()=>{docRef.current=doc;},[doc]);
  useEffect(()=>{dirtyRef.current=dirty;},[dirty]);
  useEffect(()=>{if(editingId)editInput.current?.focus();},[editingId]);
  const refresh=useCallback(async()=>setDocs(await listDocs()),[]);
  useEffect(()=>{void refresh();return()=>channel.current?.close();},[refresh]);

  useEffect(()=>{
    if(!doc?.id)return;
    const id=doc.id;
    channel.current?.close();
    const bc=new BroadcastChannel('mindmap:'+id);
    channel.current=bc;
    bc.onmessage=async event=>{
      if(event.data?.type!=='saved'||event.data.revision<=revision.current)return;
      const latest=await getDoc(id);
      if(!latest||docRef.current?.id!==id||latest.revision<=revision.current)return;
      if(dirtyRef.current){setLocked(true);setStatus('다른 탭에서 문서가 바뀌었습니다. 현재 내용을 파일로 저장하거나 최신 문서를 다시 불러오세요.');return;}
      revision.current=latest.revision;
      docRef.current=latest;setDoc(latest);setSelectedIds([]);setSelectedEdge(null);setEditingId(null);
      history.current=[];future.current=[];setHistoryVersion(v=>v+1);
      setFileDirty(true);setStatus('다른 탭에서 저장한 내용을 반영했습니다.');
    };
    return()=>{bc.close();if(channel.current===bc)channel.current=null;};
  },[doc?.id]);

  const reloadLatest=async()=>{
    if(!docRef.current)return;
    const latest=await getDoc(docRef.current.id);
    if(!latest)return;
    revision.current=latest.revision;docRef.current=latest;setDoc(latest);
    setSelectedIds([]);setSelectedEdge(null);setEditingId(null);
    history.current=[];future.current=[];setHistoryVersion(v=>v+1);
    dirtyRef.current=false;setDirty(false);setLocked(false);setFileDirty(true);
    setStatus('다른 탭에서 저장한 최신 상태를 불러왔습니다.');
  };
  const openDoc=(d:Document)=>{
    if(dirtyRef.current&&!window.confirm('아직 브라우저에 저장되지 않은 변경사항이 있습니다. 이동할까요?'))return false;
    revision.current=d.revision;dirtyRef.current=false;setLocked(false);
    history.current=[];future.current=[];setHistoryVersion(v=>v+1);
    docRef.current=d;setDoc(d);setSelectedIds([]);setSelectedEdge(null);setEditingId(null);
    setDirty(false);setFileDirty(true);setShowHome(false);setScale(1);setPan({x:0,y:0});fileHandle.current=null;
    return true;
  };
  const newDoc=()=>{
    const d=fresh();
    if(openDoc(d)){dirtyRef.current=true;editCounter.current++;setDirty(true);}
  };
  const apply=(next:Document,before?:Document)=>{
    if(locked)return;
    const original=before||docRef.current;
    if(!original)return;
    history.current.push(clone(original));if(history.current.length>80)history.current.shift();
    future.current=[];setHistoryVersion(v=>v+1);
    docRef.current=next;setDoc(next);editCounter.current++;dirtyRef.current=true;setDirty(true);setFileDirty(true);
  };
  const change=(fn:(d:Document)=>Document)=>{
    const d=docRef.current;if(d&&!locked)apply(fn(clone(d)));
  };
  const updateNodes=(patch:Partial<Node>)=>{
    if(!selectedIds.length)return;
    const ids=new Set(selectedIds);
    change(d=>({...d,nodes:d.nodes.map(n=>ids.has(n.id)?{...n,...patch}:n)}));
  };
  const updateEdge=(patch:Partial<Node>)=>{
    if(!selectedEdge&&!subtreeMode)return;
    const ids=new Set(subtreeMode?selectedIds.filter(id=>docRef.current?.nodes.some(n=>n.id===id&&n.parentId)):selectedEdges.length?selectedEdges:selectedEdge?[selectedEdge]:[]);
    change(d=>({...d,nodes:d.nodes.map(n=>ids.has(n.id)?{...n,...patch}:n)}));
  };
  useEffect(()=>{
    if(!dirty||!doc||locked)return;
    const id=doc.id;
    const timer=setTimeout(async()=>{
      const current=docRef.current;
      if(!current||current.id!==id)return;
      const currentEdit=editCounter.current, expected=revision.current;
      const next={...clone(current),revision:expected+1,updatedAt:Date.now()};
      try{
        const ok=await putDoc(next,expected);
        if(!ok){setLocked(true);setStatus('다른 탭이 먼저 저장했습니다. 현재 내용을 파일로 저장하고 최신 문서를 다시 불러오세요.');return;}
        revision.current=next.revision;
        if(docRef.current?.id!==id)return;
        docRef.current={...docRef.current,revision:next.revision,updatedAt:next.updatedAt};
        setDoc(old=>old?.id===id?{...old,revision:next.revision,updatedAt:next.updatedAt}:old);
        if(editCounter.current===currentEdit){dirtyRef.current=false;setDirty(false);}
        setStatus('브라우저에 자동 저장됨');
        channel.current?.postMessage({type:'saved',revision:next.revision});
        void refresh();
      }catch(error){setStatus('자동 저장 실패: '+String(error));}
    },350);
    return()=>clearTimeout(timer);
  },[doc,dirty,locked,refresh]);

  const undo=()=>{
    if(locked||!docRef.current||!history.current.length)return;
    future.current.push(clone(docRef.current));
    const next=history.current.pop()!;docRef.current=next;setDoc(next);
    setSelectedIds(ids=>ids.filter(id=>next.nodes.some(n=>n.id===id)));
    setSelectedEdge(id=>id&&next.nodes.some(n=>n.id===id)?id:null);
    setSelectedEdges(ids=>ids.filter(id=>next.nodes.some(n=>n.id===id&&n.parentId)));
    editCounter.current++;dirtyRef.current=true;setDirty(true);setFileDirty(true);setHistoryVersion(v=>v+1);
  };
  const redo=()=>{
    if(locked||!docRef.current||!future.current.length)return;
    history.current.push(clone(docRef.current));
    const next=future.current.pop()!;docRef.current=next;setDoc(next);
    setSelectedIds(ids=>ids.filter(id=>next.nodes.some(n=>n.id===id)));
    setSelectedEdge(id=>id&&next.nodes.some(n=>n.id===id)?id:null);
    setSelectedEdges(ids=>ids.filter(id=>next.nodes.some(n=>n.id===id&&n.parentId)));
    editCounter.current++;dirtyRef.current=true;setDirty(true);setFileDirty(true);setHistoryVersion(v=>v+1);
  };
  const add=(sibling=false)=>{
    if(!docRef.current||locked)return;
    const target=docRef.current.nodes.find(n=>n.id===selectedIds[0])||docRef.current.nodes[0];
    const parentId=sibling&&target.parentId?target.parentId:target.id;
    const result=addChild(docRef.current,parentId);
    apply(result.doc);setSelectedIds([result.id]);setSelectedEdge(null);setSubtreeMode(false);
  };
  const remove=()=>{
    if(!docRef.current||!selectedIds.length||locked)return;
    const root=docRef.current.nodes.find(n=>n.parentId===null);
    const ids=new Set<string>();
    for(const selected of selectedIds){if(selected!==root?.id)for(const id of descendants(docRef.current.nodes,selected))ids.add(id);}
    if(!ids.size)return;
    apply({...docRef.current,nodes:docRef.current.nodes.filter(n=>!ids.has(n.id))});
    setSelectedIds([]);setSelectedEdge(null);
  };
  const copy=()=>{
    if(!docRef.current||!selectedIds.length)return;
    const ids=new Set<string>();
    selectedIds.forEach(id=>descendants(docRef.current!.nodes,id).forEach(child=>ids.add(child)));
    clipboard.current=docRef.current.nodes.filter(n=>ids.has(n.id)).map(n=>({...n}));
  };
  const paste=()=>{
    if(!docRef.current||!clipboard.current||locked)return;
    const d=docRef.current, originals=clipboard.current;
    const parent=d.nodes.find(n=>n.id===selectedIds[0])||d.nodes[0];
    const roots=originals.filter(n=>!originals.some(p=>p.id===n.parentId));
    const map=new Map(originals.map(n=>[n.id,uid()]));
    const nodes=originals.map(n=>({...n,id:map.get(n.id)!,parentId:map.get(n.parentId||'')||(roots.some(r=>r.id===n.id)?parent.id:null),x:n.x+60,y:n.y+60}));
    apply(layout({...d,nodes:[...d.nodes,...nodes]}));setSelectedIds(nodes.filter(n=>roots.some(r=>map.get(r.id)===n.id)).map(n=>n.id));setSelectedEdge(null);
  };

  const beginEdit=(id:string)=>{
    if(locked)return;
    const n=docRef.current?.nodes.find(n=>n.id===id);
    if(!n)return;
    setSelectedIds([id]);setSelectedEdge(null);setEditingText(n.text);setEditingId(id);
  };
  const finishEdit=(commit:boolean)=>{
    if(!editingId)return;
    const id=editingId;
    setEditingId(null);
    if(!commit||locked)return;
    const d=docRef.current;
    const n=d?.nodes.find(n=>n.id===id);
    if(n&&n.text!==editingText)change(prev=>({...prev,nodes:prev.nodes.map(x=>x.id===id?{...x,text:editingText}:x)}));
  };
  const save=async()=>{
    const current=docRef.current;
    if(!current)return;
    const content=JSON.stringify(current,null,2);
    try{
      const w=window as Window&{showSaveFilePicker?:(options:unknown)=>Promise<FileSystemFileHandle>};
      if(w.showSaveFilePicker){
        const handle=fileHandle.current||await w.showSaveFilePicker({suggestedName:fileName(current.title)+'.mindmap',types:[{description:'Mindmap 문서',accept:{'application/json':['.mindmap']}}]});
        const writer=await handle.createWritable();await writer.write(content);await writer.close();fileHandle.current=handle;
      }else download(new Blob([content],{type:'application/json'}),fileName(current.title)+'.mindmap');
      setFileDirty(false);setStatus('마인드맵 파일을 저장했습니다.');
    }catch(error){if((error as Error).name!=='AbortError')setStatus('파일 저장 실패: '+String(error));}
  };
  const importFile=async(file:File)=>{
    if(!/\.mindmap$/i.test(file.name)){window.alert('.mindmap 파일만 지원합니다.');return;}
    try{
      const parsed=fromFile(JSON.parse(await file.text()));
      parsed.id=uid();parsed.revision=0;parsed.title=file.name.replace(/\.mindmap$/i,'');
      if(openDoc(parsed)){
        dirtyRef.current=true;editCounter.current++;setDirty(true);
        setStatus('마인드맵 파일을 새 문서로 가져왔습니다.');
      }
    }catch(error){window.alert('불러오기 실패: '+String(error));}
  };

  // Each connection terminates at a point on the visible boundary, never at the label center.
  const anchor=(node:Node,toward:Node):Point=>{
    const {w,h}=size(node),dx=toward.x-node.x,dy=toward.y-node.y;
    if(doc?.layout==='underline'||node.shape==='underline'){
      return {x:node.x+Math.max(-w/2,Math.min(w/2,dx)),y:node.y+h/2-3};
    }
    if(doc?.layout==='tree'){return {x:node.x+(dx>=0?w/2:-w/2),y:node.y};}
    if(node.shape==='oval'){
      const denom=Math.hypot(dx/(w/2),dy/(h/2))||1;
      return {x:node.x+dx/denom,y:node.y+dy/denom};
    }
    // Rectangle / text-only: intersect the ray with the virtual text/shape box.
    const ratio=Math.max(Math.abs(dx)/(w/2),Math.abs(dy)/(h/2),.00001);
    return {x:node.x+dx/ratio,y:node.y+dy/ratio};
  };
  const edgePath=(a:Node,b:Node)=>{
    const start=anchor(a,b),end=anchor(b,a),mode=b.edge_line||doc?.line||'curve';
    if(mode==='straight')return `M${start.x},${start.y} L${end.x},${end.y}`;
    if(doc?.layout==='underline'||a.shape==='underline'||b.shape==='underline'){
      const midY=(start.y+end.y)/2;
      return `M${start.x},${start.y} C${start.x},${midY} ${end.x},${midY} ${end.x},${end.y}`;
    }
    const midX=(start.x+end.x)/2;
    return `M${start.x},${start.y} C${midX},${start.y} ${midX},${end.y} ${end.x},${end.y}`;
  };
  const buildSvg=()=>{
    const current=docRef.current;
    if(!current?.nodes.length)return '';
    const bounds=current.nodes.map(n=>{const s=size(n);return{x:n.x-s.w/2,y:n.y-s.h/2,x2:n.x+s.w/2,y2:n.y+s.h/2};});
    const minX=Math.min(...bounds.map(b=>b.x))-65,minY=Math.min(...bounds.map(b=>b.y))-65;
    const maxX=Math.max(...bounds.map(b=>b.x2))+65,maxY=Math.max(...bounds.map(b=>b.y2))+65;
    const source=svg.current?.querySelector('#map-content')?.cloneNode(true) as SVGGElement|undefined;
    if(!source)return '';
    source.querySelectorAll('.selection-ring,.node-hit,.edge-hit,.edge-highlight,[data-export-hide]').forEach(n=>n.remove());
    // Text being edited is rendered in a temporary editor; the stored model is the export source.
    const root=document.createElementNS('http://www.w3.org/2000/svg','svg');
    root.setAttribute('xmlns','http://www.w3.org/2000/svg');root.setAttribute('width',String(maxX-minX));root.setAttribute('height',String(maxY-minY));
    root.setAttribute('viewBox',`${minX} ${minY} ${maxX-minX} ${maxY-minY}`);root.appendChild(source);
    return new XMLSerializer().serializeToString(root);
  };
  const exportSvg=()=>{
    if(!docRef.current)return;
    download(new Blob([buildSvg()],{type:'image/svg+xml;charset=utf-8'}),fileName(docRef.current.title)+'.svg');
  };
  const exportPng=()=>{
    if(!docRef.current)return;
    const title=docRef.current.title,xml=buildSvg();
    const img=new window.Image(),url=URL.createObjectURL(new Blob([xml],{type:'image/svg+xml'}));
    img.onload=()=>{
      const c=document.createElement('canvas');c.width=img.naturalWidth*2;c.height=img.naturalHeight*2;
      const ctx=c.getContext('2d');if(!ctx)return;
      ctx.scale(2,2);if(pngBackground){ctx.fillStyle=pngColor;ctx.fillRect(0,0,img.naturalWidth,img.naturalHeight);}ctx.drawImage(img,0,0);
      c.toBlob(blob=>{if(blob)download(blob,fileName(title)+'.png');URL.revokeObjectURL(url);},'image/png');
    };
    img.onerror=()=>{URL.revokeObjectURL(url);window.alert('PNG 내보내기에 실패했습니다. SVG로 내보내기를 이용해 주세요.');};
    img.src=url;
  };
  const screenToWorld=(x:number,y:number):Point=>{
    const rect=svg.current?.getBoundingClientRect();
    if(!rect)return{x:0,y:0};
    return {x:(x-rect.left-rect.width/2-pan.x)/scale,y:(y-rect.top-rect.height/2-pan.y)/scale};
  };
  const onDown=(event:React.PointerEvent<SVGSVGElement>)=>{
    if(event.button!==0&&event.button!==1)return;
    if(isEditing)return;
    const element=event.target as Element;
    const nodeId=element.closest('[data-node-id]')?.getAttribute('data-node-id');
    const edgeId=element.closest('[data-edge-id]')?.getAttribute('data-edge-id');
    if(nodeId){
      if(event.ctrlKey||event.metaKey||event.shiftKey){
        setSelectedIds(ids=>ids.includes(nodeId)?ids.filter(id=>id!==nodeId):[...ids,nodeId]);setSelectedEdge(null);
        return;
      }
      const ids=selectedIds.includes(nodeId)?selectedIds:[nodeId];
      setSelectedIds(ids);setSelectedEdge(null);
      if(locked)return;
      const current=docRef.current;
      if(!current)return;
      const originals=new Map(current.nodes.filter(n=>ids.includes(n.id)).map(n=>[n.id,{x:n.x,y:n.y}]));
      drag.current={type:'node',startX:event.clientX,startY:event.clientY,panX:0,panY:0,before:clone(current),original:originals};
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if(edgeId){
      setSelectedIds([]);setSubtreeMode(false);
      if(event.shiftKey||event.ctrlKey||event.metaKey){
        const next=selectedEdges.includes(edgeId)?selectedEdges.filter(id=>id!==edgeId):[...selectedEdges,edgeId];
        setSelectedEdges(next);setSelectedEdge(next[0]||null);
      }else{setSelectedEdges([edgeId]);setSelectedEdge(edgeId);}
      return;
    }
    if(event.button===0&&event.shiftKey){
      const at=screenToWorld(event.clientX,event.clientY);
      drag.current={type:'box',startX:event.clientX,startY:event.clientY,panX:0,panY:0,selectedBefore:selectedIds};
      setBox({a:at,b:at});setSelectedEdge(null);
    }else{
      drag.current={type:'pan',startX:event.clientX,startY:event.clientY,panX:pan.x,panY:pan.y};
      if(event.button===0){setSelectedIds([]);setSelectedEdge(null);}
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onMove=(event:React.PointerEvent<SVGSVGElement>)=>{
    const currentDrag=drag.current;
    if(!currentDrag)return;
    if(currentDrag.type==='pan'){
      setPan({x:currentDrag.panX+event.clientX-currentDrag.startX,y:currentDrag.panY+event.clientY-currentDrag.startY});return;
    }
    if(currentDrag.type==='box'){
      const a=screenToWorld(currentDrag.startX,currentDrag.startY),b=screenToWorld(event.clientX,event.clientY);
      setBox({a,b});return;
    }
    const dx=(event.clientX-currentDrag.startX)/scale,dy=(event.clientY-currentDrag.startY)/scale;
    if(Math.abs(dx)+Math.abs(dy)<1&&!currentDrag.changed)return;
    const originals=currentDrag.original;
    if(!originals)return;
    const positions=new Map([...originals].map(([id,pos])=>{
      let x=pos.x+dx,y=pos.y+dy;
      if(snap){x=Math.round(x/GRID)*GRID;y=Math.round(y/GRID)*GRID;}
      return [id,{x,y}] as const;
    }));
    if(!currentDrag.changed&&[...positions].every(([id,p])=>p.x===originals.get(id)?.x&&p.y===originals.get(id)?.y))return;
    currentDrag.changed=true;
    const current=docRef.current;
    if(!current)return;
    const next={...current,nodes:current.nodes.map(n=>positions.has(n.id)?{...n,...positions.get(n.id)!}:n)};
    docRef.current=next;setDoc(next);
  };
  const onUp=(event:React.PointerEvent<SVGSVGElement>)=>{
    const currentDrag=drag.current;drag.current=null;
    if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
    if(currentDrag?.type==='node'&&currentDrag.changed&&currentDrag.before){
      history.current.push(currentDrag.before);if(history.current.length>80)history.current.shift();
      future.current=[];setHistoryVersion(v=>v+1);
      editCounter.current++;dirtyRef.current=true;setDirty(true);setFileDirty(true);
    }
    if(currentDrag?.type==='box'){
      const a=screenToWorld(currentDrag.startX,currentDrag.startY),b=screenToWorld(event.clientX,event.clientY);
      const bounds={left:Math.min(a.x,b.x),right:Math.max(a.x,b.x),top:Math.min(a.y,b.y),bottom:Math.max(a.y,b.y)};
      const ids=(docRef.current?.nodes||[]).filter(n=>{
        const s=size(n);
        return n.x-s.w/2<=bounds.right&&n.x+s.w/2>=bounds.left&&n.y-s.h/2<=bounds.bottom&&n.y+s.h/2>=bounds.top;
      }).map(n=>n.id);
      setSelectedIds([...new Set([...(currentDrag.selectedBefore||[]),...ids])]);setBox(null);
    }
  };

  const fit=()=>{
    if(!docRef.current||!svg.current)return;
    const r=svg.current.getBoundingClientRect();
    const xs=docRef.current.nodes.flatMap(n=>[n.x-size(n).w/2,n.x+size(n).w/2]);
    const ys=docRef.current.nodes.flatMap(n=>[n.y-size(n).h/2,n.y+size(n).h/2]);
    const midX=(Math.min(...xs)+Math.max(...xs))/2,midY=(Math.min(...ys)+Math.max(...ys))/2;
    const z=Math.min(1.6,Math.max(.15,Math.min((r.width-110)/(Math.max(...xs)-Math.min(...xs)),(r.height-110)/(Math.max(...ys)-Math.min(...ys)))));
    setScale(z);setPan({x:-midX*z,y:-midY*z});
  };
  useEffect(()=>{
    const listener=(event:KeyboardEvent)=>{
      const el=event.target as HTMLElement;
      if(['INPUT','TEXTAREA','SELECT'].includes(el.tagName)||el.isContentEditable)return;
      if(showHome||!docRef.current)return;
      const mod=event.ctrlKey||event.metaKey;
      if(mod&&event.key.toLowerCase()==='s'){event.preventDefault();void save();}
      else if(mod&&event.key.toLowerCase()==='z'){event.preventDefault();if(event.shiftKey)redo();else undo();}
      else if(mod&&event.key.toLowerCase()==='y'){event.preventDefault();redo();}
      else if(mod&&event.key.toLowerCase()==='c'){event.preventDefault();copy();}
      else if(mod&&event.key.toLowerCase()==='v'){event.preventDefault();paste();}
      else if(mod&&event.key.toLowerCase()==='a'){event.preventDefault();setSelectedIds(docRef.current.nodes.map(n=>n.id));setSelectedEdge(null);}
      else if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();remove();}
      else if(event.key==='F2'){event.preventDefault();if(selectedIds.length===1)beginEdit(selectedIds[0]);}
      else if(event.key==='Tab'){event.preventDefault();if(event.shiftKey){
        if(locked||selectedIds.length!==1)return;
        const current=docRef.current;const node=current.nodes.find(n=>n.id===selectedIds[0]);
        const parent=current.nodes.find(n=>n.id===node?.parentId);
        if(!node||!parent||parent.parentId===null)return;
        change(d=>layout({...d,nodes:d.nodes.map(n=>n.id===node.id?{...n,parentId:parent.parentId}:n)}));
      }else add();}
      else if(event.key==='Enter'){event.preventDefault();add(true);}
      else if(event.key==='Escape'){setSelectedIds([]);setSelectedEdge(null);}
    };
    window.addEventListener('keydown',listener);
    return()=>window.removeEventListener('keydown',listener);
  });
  useEffect(()=>{
    if(showHome||!doc?.id||!svg.current)return;
    const element=svg.current;
    const onWheel=(event:WheelEvent)=>{
      if(event.cancelable)event.preventDefault();
      if(event.ctrlKey||event.metaKey){
        const rect=element.getBoundingClientRect();
        const px=event.clientX-rect.left-rect.width/2,py=event.clientY-rect.top-rect.height/2;
        const normalized=event.deltaMode===1?event.deltaY*16:event.deltaMode===2?event.deltaY*rect.height:event.deltaY;
        wheelSteps.current+=event.deltaMode===1?normalized/48:event.deltaMode===2?normalized/rect.height:normalized/100;
        const steps=Math.trunc(wheelSteps.current);
        if(!steps)return;
        wheelSteps.current-=steps;
        const next=Math.max(.15,Math.min(3,Math.round((scale-steps*.15)*1000)/1000));
        const ratio=next/scale;
        setPan(p=>({x:px-(px-p.x)*ratio,y:py-(py-p.y)*ratio}));setScale(next);
      }else setPan(p=>({x:p.x-event.deltaX,y:p.y-event.deltaY}));
    };
    element.addEventListener('wheel',onWheel,{passive:false});
    return()=>element.removeEventListener('wheel',onWheel);
  },[showHome,doc?.id,scale]);

  return <div className="app">
    {showHome&&<header className="home-header"><button className="brand" onClick={()=>{setShowHome(true);void refresh();}}><img className="logo" src="/favicon.svg" alt=""/><strong>Mindmap</strong></button></header>}
    {showHome?<main className="home">
      <div className="home-intro"><h1>내 마인드맵</h1><p>새 마인드맵을 만들거나 이전 작업을 이어서 편집하세요.</p></div>
      <div className="home-quick-actions">
        <button className="home-action" onClick={newDoc}><span className="home-action-icon"><Plus size={21}/></span><span>새 마인드맵</span><span className="home-action-arrow">→</span></button>
        <button className="home-action" onClick={()=>fileInput.current?.click()}><span className="home-action-icon"><FolderOpen size={21}/></span><span>파일 열기</span><span className="home-action-arrow">→</span></button>
      </div>
      <div className="home-recent-heading"><h2>최근 작업</h2><span>{docs.length}개</span></div>
      <div className="doc-grid">{docs.map(d=><article key={d.id} className="doc-card"><div className="doc-preview"><DocumentThumbnail doc={d}/></div><strong>{d.title}</strong><small>{new Date(d.updatedAt).toLocaleString('ko-KR')} · 주제 {d.nodes.length}개</small><div className="doc-actions"><button className="primary" onClick={()=>openDoc(d)}>열기</button><button title="문서 삭제" aria-label={`${d.title} 삭제`} onClick={async()=>{if(window.confirm('이 마인드맵을 삭제할까요?')){await deleteDoc(d.id);void refresh();}}}><Trash2 size={16}/></button></div></article>)}</div>
      <div className="home-storage-note"><span className="home-note-icon">ⓘ</span><div><strong>작업 내용은 자동으로 저장됩니다.</strong><p>중요한 작업은 <b>.mindmap 파일</b>로 별도 저장하세요. 완성한 마인드맵은 PNG 또는 SVG 이미지로 내보내 다른 문서에도 사용할 수 있습니다.</p></div></div>
      {!docs.length&&<div className="empty">아직 저장된 문서가 없습니다. 새 마인드맵을 만들어 보세요.</div>}
    </main>:doc&&<div className="workspace">
      <div className="editor-ribbon-shell">
        <button className="editor-brand" title="문서 목록" onClick={()=>{finishEdit(true);setShowHome(true);void refresh();}}><img src="/favicon.svg" alt=""/><strong>Mindmap</strong></button>
        <div className="ribbon" role="toolbar" aria-label="편집 도구">
          <div className="ribbon-tabs">
            {([['home','홈'],['layout','배치'],...(selectedIds.length?[['node','주제']]:[]),...(selectedEdge?[['edge','연결선']]:[])] as string[][]).map(([id,label])=><button key={id} className={ribbonTab===id?'active':''} onClick={()=>setRibbonTab(id as typeof ribbonTab)}>{label}</button>)}
            
          </div>
          {ribbonTab==='home'&&exportOpen&&<div className="export-popover"><strong>이미지 내보내기</strong><label><input type="checkbox" checked={pngBackground} onChange={e=>setPngBackground(e.target.checked)}/> 배경색 포함</label>{pngBackground&&<label>배경색 <input aria-label="PNG 배경색" type="color" value={pngColor} onChange={e=>setPngColor(e.target.value)}/></label>}<div><button onClick={()=>{exportPng();setExportOpen(false);}}>PNG 저장</button><button onClick={()=>{exportSvg();setExportOpen(false);}}>SVG 저장</button></div></div>}
        <div className="ribbon-content">
          {ribbonTab==='home'&&<>
            <div className="ribbon-group ribbon-document"><span>문서</span><div><input aria-label="문서 제목" title="문서 제목" value={doc.title} disabled={locked} onChange={e=>change(d=>({...d,title:e.target.value}))}/><button onClick={()=>{finishEdit(true);setShowHome(true);void refresh();}} title="문서 목록"><FolderOpen size={16}/> 목록</button><button onClick={()=>void save()} disabled={!doc} title="Ctrl+S"><Save size={16}/> 파일 저장</button></div><small className="ribbon-save-state">{locked?'저장 충돌':dirty?'자동 저장 중':'자동 저장됨'}{fileDirty?' · 파일 미저장':''}</small></div>
            <div className="ribbon-group"><span>이미지</span><div><button className="export-trigger" onClick={()=>setExportOpen(v=>!v)} aria-expanded={exportOpen}><Image size={15}/> 내보내기 ▾</button></div></div>
            <div className="ribbon-group"><span>편집</span><div><button disabled={locked||!history.current.length} onClick={undo}><Undo2 size={16}/> 실행 취소</button><button disabled={locked||!future.current.length} onClick={redo}><Redo2 size={16}/> 다시 실행</button><button onClick={copy} disabled={!selectedIds.length}><Copy size={16}/> 복사</button><button onClick={paste} disabled={locked}><Clipboard size={16}/> 붙여넣기</button><button disabled={locked||!selectedIds.length} onClick={remove}><Trash2 size={16}/> 삭제</button></div></div>

            {locked&&<div className="ribbon-group"><span>저장 충돌</span><div><button onClick={()=>void reloadLatest()}>최신 내용 불러오기</button></div></div>}
          </>}
          {ribbonTab==='layout'&&<>
            <div className="ribbon-group"><span>레이아웃</span><div><button className={doc.layout==='tree'?'chosen':''} disabled={locked} onClick={()=>change(d=>layout({...d,layout:'tree'}))}>트리</button><button className={doc.layout==='radial'?'chosen':''} disabled={locked} onClick={()=>change(d=>layout({...d,layout:'radial'}))}>방사형</button><button className={doc.layout==='underline'?'chosen':''} disabled={locked} onClick={()=>change(d=>layout({...d,layout:'underline'}))}>밑줄</button><button disabled={locked} onClick={()=>change(d=>layout(d))}><RotateCcw size={16}/> 재배치</button></div></div>
            <div className="ribbon-group"><span>격자</span><label className="ribbon-check"><input type="checkbox" checked={snap} onChange={e=>setSnap(e.target.checked)}/> 격자 스냅</label></div>
            <div className="ribbon-group"><span>연결선 형태</span><div><button className={doc.line==='curve'?'chosen':''} disabled={locked} onClick={()=>change(d=>({...d,line:'curve'}))}>곡선</button><button className={doc.line==='straight'?'chosen':''} disabled={locked} onClick={()=>change(d=>({...d,line:'straight'}))}>직선</button></div></div>
          </>}
          {ribbonTab==='node'&&selectedNode&&<>
            <div className="ribbon-group"><span>주제 추가</span><div><button disabled={locked} onClick={()=>add()}><Plus size={16}/> 하위 주제</button><button disabled={locked} onClick={()=>add(true)}><LayoutGrid size={16}/> 형제 주제</button></div></div>
            <div className="ribbon-group"><span>함께 선택</span><div><button disabled={locked} onClick={()=>{
              if(subtreeMode){setSubtreeMode(false);setSelectedIds([selectedIds[0]]);return;}
              const root=selectedIds[0];if(!root)return;
              setSelectedIds([...descendants(doc.nodes,root)]);setSelectedEdge(null);setSubtreeMode(true);
            }}>{subtreeMode?'하위 주제 선택 해제':'하위 주제와 연결선 모두 선택'}</button></div></div>
            <div className="ribbon-group"><span>선택 {selectedIds.length}개 · 텍스트</span><div><button disabled={locked||selectedIds.length!==1} onClick={()=>beginEdit(selectedNode.id)}>텍스트 편집 (F2)</button></div></div>
            <div className="ribbon-group"><span>도형</span><select aria-label="도형" disabled={locked} value={selectedNodes.every(n=>n.shape===selectedNode.shape)?selectedNode.shape:''} onChange={e=>updateNodes({shape:e.target.value as Node['shape']})}><option value="" disabled>혼합</option><option value="rectangle">둥근 사각형</option><option value="oval">타원</option><option value="none">텍스트만</option></select></div>
            <div className="ribbon-group"><span>채우기 · 빠른 색상</span><div className="ribbon-colors">{colors.map(c=><button key={c} aria-label={'배경 '+c} title={c} disabled={locked} style={{background:c}} onClick={()=>updateNodes({bg_color:c})}/>)}</div><input aria-label="배경색 직접 선택" type="color" disabled={locked} value={selectedNode.bg_color} onChange={e=>updateNodes({bg_color:e.target.value})}/></div>
            {subtreeMode&&<div className="ribbon-group"><span>선택한 연결선 색상</span><div className="ribbon-colors">{colors.map(c=><button key={c} aria-label={'연결선 '+c} title={c} disabled={locked} style={{background:c}} onClick={()=>updateEdge({edge_color:c})}/>)}</div><input aria-label="선택한 연결선 색상 직접 선택" type="color" disabled={locked} value={selectedNode.edge_color} onChange={e=>updateEdge({edge_color:e.target.value})}/></div>}
            <div className="ribbon-group"><span>글꼴 · 글자색 · 크기</span><div><select aria-label="글꼴" disabled={locked} value={selectedNodes.every(n=>n.font_family===selectedNode.font_family)?selectedNode.font_family:''} onChange={e=>updateNodes({font_family:e.target.value})}><option value="" disabled>혼합</option>{['Arial','Malgun Gothic','NanumGothic','Georgia','Consolas'].map(f=><option key={f} value={f}>{f}</option>)}</select><input aria-label="글자색" type="color" disabled={locked} value={selectedNode.text_color} onChange={e=>updateNodes({text_color:e.target.value})}/><input aria-label="글자 크기" className="ribbon-number" type="number" min="8" max="72" disabled={locked} value={selectedNodes.every(n=>n.font_size===selectedNode.font_size)?selectedNode.font_size:''} placeholder="혼합" onChange={e=>updateNodes({font_size:Math.max(8,Math.min(72,Number(e.target.value)||8))})}/></div></div>
          </>}
          {ribbonTab==='edge'&&edgeNode&&<>
            <div className="ribbon-group"><span>선택</span><small>{Math.max(1,selectedEdges.length)}개 연결선 · Shift+클릭으로 추가 선택</small></div>
            <div className="ribbon-group"><span>연결선 형태</span><div><button className={(edgeNode.edge_line||doc.line)==='curve'?'chosen':''} disabled={locked} onClick={()=>updateEdge({edge_line:'curve'})}>곡선</button><button className={(edgeNode.edge_line||doc.line)==='straight'?'chosen':''} disabled={locked} onClick={()=>updateEdge({edge_line:'straight'})}>직선</button></div></div>
            <div className="ribbon-group"><span>빠른 선 색상</span><div className="ribbon-colors">{colors.map(c=><button key={c} aria-label={'선 '+c} title={c} disabled={locked} style={{background:c}} onClick={()=>updateEdge({edge_color:c})}/>)}</div><input aria-label="선 색상 직접 선택" type="color" disabled={locked} value={selectedEdges.length>1&&!selectedEdges.every(id=>doc.nodes.find(n=>n.id===id)?.edge_color===edgeNode.edge_color)?'#000000':edgeNode.edge_color} onChange={e=>updateEdge({edge_color:e.target.value})}/></div>
            <div className="ribbon-group"><span>선 굵기</span><input aria-label="선 굵기" className="ribbon-number" type="number" min="1" max="12" step=".5" disabled={locked} value={selectedEdges.length>1&&!selectedEdges.every(id=>doc.nodes.find(n=>n.id===id)?.edge_thick===edgeNode.edge_thick)?'':edgeNode.edge_thick} placeholder={selectedEdges.length>1?'혼합':undefined} onChange={e=>updateEdge({edge_thick:Math.max(1,Math.min(12,Number(e.target.value)||1))})}/></div>
          </>}

        </div>
        </div>
      </div>
      <div className="canvas">
        <div className="canvas-top"><span className="pill" title={status}>주제 {doc.nodes.length}개</span><span className="pill">{doc.layout==='tree'?'트리':doc.layout==='underline'?'밑줄':'방사형'}</span>{selectedIds.length>1&&<span className="pill">주제 {selectedIds.length}개 선택</span>}{locked&&<span className="pill warning">다른 탭 저장 충돌 · 먼저 파일로 백업하세요</span>}</div>
        <svg ref={svg} className="map" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <defs><pattern id="grid" x={(svg.current?.clientWidth||900)/2+pan.x} y={(svg.current?.clientHeight||600)/2+pan.y} width={GRID*scale} height={GRID*scale} patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r="1" fill="#8ca7c5" opacity=".5"/></pattern></defs>
          <rect width="100%" height="100%" fill="url(#grid)"/>
          <g transform={`translate(${(svg.current?.clientWidth||900)/2+pan.x},${(svg.current?.clientHeight||600)/2+pan.y}) scale(${scale})`}>
            <g id="map-content">
              {doc.nodes.filter(n=>n.parentId).map(n=>{const parent=doc.nodes.find(x=>x.id===n.parentId);if(!parent)return null;const d=edgePath(parent,n),active=selectedEdges.includes(n.id)||selectedEdge===n.id;return <g key={'edge-'+n.id} data-edge-id={n.id} style={{cursor:'pointer'}}><path d={d} stroke={n.edge_color} strokeWidth={n.edge_thick} fill="none" strokeLinecap="round" pointerEvents="none"/>{active&&<path className="edge-highlight" d={d} stroke="#3b9cff" strokeWidth={n.edge_thick+5} strokeOpacity=".35" fill="none" pointerEvents="none"/>}<path className="edge-hit" d={d} stroke="transparent" strokeWidth="18" fill="none" pointerEvents="stroke"/></g>;})}
              {doc.nodes.map(n=>{const dimensions=size(n),active=selectedIds.includes(n.id);return <g key={n.id} data-node-id={n.id} transform={`translate(${n.x},${n.y})`} style={{cursor:locked?'pointer':'grab'}}>
                {active&&<rect className="selection-ring" x={-dimensions.w/2-6} y={-dimensions.h/2-6} width={dimensions.w+12} height={dimensions.h+12} rx="16" fill="none" stroke="#3b9cff" strokeWidth="2" strokeDasharray="5 4"/>}
                {(doc.layout==='underline'||n.shape==='underline')?<line x1={-dimensions.w/2} y1={dimensions.h/2-3} x2={dimensions.w/2} y2={dimensions.h/2-3} stroke={n.edge_color} strokeWidth={n.parentId?3:5} strokeLinecap="round"/>:n.shape==='oval'?<ellipse rx={dimensions.w/2} ry={dimensions.h/2} fill={n.bg_color} stroke="#233248" strokeOpacity={n.parentId?".18":".8"} strokeWidth={n.parentId?1.5:3.5}/>:n.shape==='none'?null:<rect x={-dimensions.w/2} y={-dimensions.h/2} width={dimensions.w} height={dimensions.h} rx="12" fill={n.bg_color} stroke="#233248" strokeOpacity={n.parentId?".18":".8"} strokeWidth={n.parentId?1.5:3.5}/>}
                <rect className="node-hit" x={-dimensions.w/2} y={-dimensions.h/2} width={dimensions.w} height={dimensions.h} fill="transparent"/>
                {n.text.split('\n').map((line,i,lines)=><text key={i} x="0" y={(i-(lines.length-1)/2)*n.font_size*1.35+n.font_size*.35} textAnchor="middle" fill={n.text_color} fontFamily={n.font_family} fontSize={n.font_size} fontWeight={n.parentId?500:700} pointerEvents="none">{line}</text>)}
              </g>;})}
            </g>
            {box&&<rect data-export-hide="true" x={Math.min(box.a.x,box.b.x)} y={Math.min(box.a.y,box.b.y)} width={Math.abs(box.b.x-box.a.x)} height={Math.abs(box.b.y-box.a.y)} fill="#398bce" fillOpacity=".12" stroke="#398bce" strokeWidth={1.5/scale} strokeDasharray={`${6/scale} ${4/scale}`} pointerEvents="none"/>}
            {editingId&&doc.nodes.filter(n=>n.id===editingId).map(n=>{const s=size(n);return <foreignObject key={'edit-'+n.id} x={n.x-s.w/2} y={n.y-s.h/2} width={s.w} height={s.h} style={{overflow:'visible'}}><textarea ref={editInput} className="inline-text-editor" style={{width:s.w,height:Math.max(s.h,70),fontSize:n.font_size,fontFamily:n.font_family,color:n.text_color,background:doc.layout==='underline'||n.shape==='none'||n.shape==='underline'?'#ffffff':n.bg_color}} value={editingText} onChange={event=>setEditingText(event.target.value)} onPointerDown={event=>event.stopPropagation()} onDoubleClick={event=>event.stopPropagation()} onKeyDown={event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();finishEdit(false);}else if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();finishEdit(true);}}} onBlur={()=>finishEdit(true)} /></foreignObject>;})}
          </g>
        </svg>
        <div className="canvas-bottom"><button onClick={()=>setScale(s=>Math.max(.15,Math.round((s-.15)*1000)/1000))} title="축소"><ZoomOut size={18}/></button><span>{Math.round(scale*100)}%</span><button onClick={()=>setScale(s=>Math.min(3,Math.round((s+.15)*1000)/1000))} title="확대"><ZoomIn size={18}/></button><button onClick={fit} title="화면에 맞춤"><Maximize size={18}/></button></div>
        <div className="hint"><div><kbd>F2</kbd><span>주제 텍스트 편집</span></div><div><kbd>Tab</kbd><span>하위 주제 추가</span></div><div><kbd>Shift + Tab</kbd><span>한 단계 상위로 이동</span></div><div><kbd>Enter</kbd><span>형제 주제 추가</span></div><div><kbd>Delete</kbd><span>선택한 주제 삭제</span></div><div><kbd>Shift + 드래그</kbd><span>여러 주제 선택</span></div><div><kbd>빈 공간 드래그</kbd><span>화면 이동</span></div></div>
      </div>
    </div>}
    <input ref={fileInput} type="file" accept=".mindmap" hidden onChange={event=>{const file=event.target.files?.[0];if(file)void importFile(file);event.target.value='';}}/>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
