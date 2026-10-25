import type {Document} from './model';
import {size} from './model';

/** Light-weight SVG preview, rendered from stored document coordinates (not a raster screenshot). */
export function DocumentThumbnail({doc}:{doc:Document}){
  // The initial document has only a root node: show the product icon instead.
  if(doc.nodes.length<=1)return <img className="doc-preview-logo" src="/favicon.svg" alt="새 마인드맵"/>;
  const all=doc.nodes.map(node=>{
    const dimensions=size(node);
    return {node,w:dimensions.w,h:dimensions.h};
  });
  const minX=Math.min(...all.map(n=>n.node.x-n.w/2));
  const maxX=Math.max(...all.map(n=>n.node.x+n.w/2));
  const minY=Math.min(...all.map(n=>n.node.y-n.h/2));
  const maxY=Math.max(...all.map(n=>n.node.y+n.h/2));
  const margin=50;
  const viewBox=`${minX-margin} ${minY-margin} ${Math.max(200,maxX-minX+margin*2)} ${Math.max(120,maxY-minY+margin*2)}`;
  const lookup=new Map(doc.nodes.map(n=>[n.id,n]));
  return <svg className="doc-preview-map" viewBox={viewBox} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`${doc.title} 마인드맵 미리보기`}>
    {doc.nodes.slice(0,250).filter(n=>n.parentId).map(n=>{
      const p=lookup.get(n.parentId!);
      if(!p)return null;
      return <path key={`edge-${n.id}`} d={(n.edge_line||doc.line)==='curve'?`M${p.x},${p.y} Q${(p.x+n.x)/2},${(p.y+n.y)/2-10} ${n.x},${n.y}`:`M${p.x},${p.y} L${n.x},${n.y}`} fill="none" stroke={n.edge_color} strokeWidth={Math.max(2,n.edge_thick)} strokeLinecap="round"/>;
    })}
    {all.slice(0,250).map(({node:n,w,h})=><g key={n.id} transform={`translate(${n.x},${n.y})`}>
      {n.shape==='oval'?<ellipse rx={w/2} ry={h/2} fill={n.bg_color} stroke="#94a6ba" strokeWidth="1"/>:
        n.shape==='none'?null:<rect x={-w/2} y={-h/2} width={w} height={h} rx="12" fill={n.bg_color} stroke="#94a6ba" strokeWidth="1"/>}
      {n.text.split('\n').slice(0,3).map((line,i,lines)=><text key={i} textAnchor="middle" y={(i-(lines.length-1)/2)*n.font_size*1.35+n.font_size*.35} fill={n.text_color} fontFamily={n.font_family} fontSize={n.font_size} fontWeight={n.parentId?500:700}>{line.length>35?line.slice(0,35)+'…':line}</text>)}
    </g>)}
  </svg>;
}
