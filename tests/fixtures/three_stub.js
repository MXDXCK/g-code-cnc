const mk=()=>{const t={};const p=new Proxy(t,{get:(o,k)=>k in o?o[k]:(k===Symbol.toPrimitive?()=>0:(k==='then'?undefined:S)),set:(o,k,v)=>{o[k]=v;return true}});return p;};
const S=new Proxy(function(){},{get:(o,k)=>k===Symbol.toPrimitive?()=>0:(k==='then'?undefined:S),apply:()=>S,construct:()=>mk()});
export class WebGLRenderer{constructor(){this.domElement=document.createElement('canvas')}setPixelRatio(){}setSize(w,h){this.domElement.width=w;this.domElement.height=h}render(){}}
export class Group{constructor(){this.children=[];this.position={copy(){},set(){}};this.rotation={}}add(o){this.children.push(o)}traverse(f){f(this);this.children.forEach(c=>c.traverse?c.traverse(f):f(c))}}
export const Scene=S,Color=S,PerspectiveCamera=S,HemisphereLight=S,DirectionalLight=S,Vector3=S,BufferGeometry=S,BufferAttribute=S,Float32BufferAttribute=S,Mesh=S,MeshStandardMaterial=S,DoubleSide=0,BoxGeometry=S,LineSegments=S,EdgesGeometry=S,LineBasicMaterial=S,GridHelper=S,CylinderGeometry=S,ConeGeometry=S,SphereGeometry=S,PlaneGeometry=S,Shape=S,ShapeGeometry=S,Vector2=S;
export const OrbitControls=S;
export class ArrowHelper{constructor(){this.position={copy(){},set(){}};this.rotation={}}traverse(){}}
export class MeshBasicMaterial{constructor(o){Object.assign(this,o||{})}dispose(){}}
