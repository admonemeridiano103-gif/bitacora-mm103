// Simulacion de la cola (Fase 4) con hojas en memoria y datos FICTICIOS. No toca Google.
// Uso: node pruebas/sim_cola.js apps-script
const fs=require('fs'), vm=require('vm'), path=require('path');
const DIR=process.argv[2];
// ---------- hojas en memoria
function crearLibro(def){ const hojas={}; for(const n in def){ hojas[n]=hojaMem(n,def[n]); } return {
  getSheetByName:n=>hojas[n]||null, insertSheet:n=>(hojas[n]=hojaMem(n,[[]])), _h:hojas }; }
function hojaMem(nombre,datos){ const d=datos.map(r=>r.slice()); const sh={
  getName:()=>nombre, getLastRow:()=>d.length, getLastColumn:()=>d.length?d[0].length:0,
  getRange:(r,c,nr,nc)=>{ nr=nr||1; nc=nc||1; return {
    getValues:()=>{ const o=[]; for(let i=0;i<nr;i++){ const fila=[]; for(let j=0;j<nc;j++){ const v=(d[r-1+i]||[])[c-1+j]; fila.push(v===undefined?'':v);} o.push(fila);} return o; },
    setValues:(v)=>{ for(let i=0;i<nr;i++){ d[r-1+i]=d[r-1+i]||[]; for(let j=0;j<nc;j++) d[r-1+i][c-1+j]=v[i][j]; } },
    setValue:(v)=>{ d[r-1]=d[r-1]||[]; d[r-1][c-1]=v; },
    setFontWeight(){return this}, setBackground(){return this}, setFontColor(){return this} }; },
  appendRow:(row)=>{ d.push(row.slice()); }, setFrozenRows(){}, insertColumnAfter(){}, _d:d }; return sh; }

const H={
 CATALOGO_TAREAS_DIARIAS:[['tarea_id','nombre_tarea','tipo','area_o_equipo_asociado','orden_cola','activo','requiere_pasos','bloqueo_estricto','periodicidad_dias','fecha_referencia'],
   ['T1','Revisar bombas','Diaria','',10,true,false,false,1,''],['T2','Tarea desactivada','Diaria','',20,false,false,false,1,''],['T3','Limpiar lobby','Diaria','',30,'TRUE',false,false,1,'']],
 TRABAJOS_EXTRA_PROGRAMADOS:[['id','descripcion','estado','prioridad','usuario_asignado','tipo_trabajo','registro_cola_id','fecha_programada'],
   ['E1','Extra pendiente','Pendiente','','','','',''],['E2','Extra cancelado','Cancelado','','','','',''],['E3','Extra completado','Completado','','','','',''],['E4','Extra en proceso pero completado en modulo','Completado','','','','',''],['E5','Extra cancelado con renglon completado','Cancelado','','','','','']],
 TICKETS_INDICACIONES:[['ticket_id','mensaje','prioridad','estado','dirigido_a','era_abierto','fotos_antes_urls','fecha_hora_atendido'],
   ['K1','Ticket urgente abierto','Alta','Abierto','','','',''],['K2','Ticket atendido desde modulo','Media','Atendido','','','',''],['K3','Ticket cancelado','Media','Cancelado','','','',''],['K4','Ticket completado','Baja','Atendido','','','','']],
 COLA_TRABAJO_DIARIO:[['registro_id','fecha','tarea_id','estado','usuario_asignado_actual','hora_inicio','hora_fin','tiempo_total_minutos','codigo_salto','codigo_salto_confirmado','descripcion_realizada','tipo_origen','origen_id','tiempo_acumulado_segundos','rollover_desde','posicion_manual','orden_manual','motivo_salto','motivo_pausa','pausado_por','pausado_en','motivo_reapertura','fotos_reapertura_urls','reabierto_por','reabierto_en','reabierto_veces'],
   ['COLA-00001','2026-11-06','T1','Pendiente','','','','','',false,'','Catalogo','',0,'','','','','','','','','','','',''],
   ['COLA-00002','2026-11-06','T2','Pendiente','','','','','',false,'','Catalogo','',0,'',777,'','','','','','','','','',''],
   ['COLA-00003','2026-11-06','T2','En proceso','U2','2026-11-06T15:00:00Z','','','',false,'','Catalogo','',0,'','','','','','','','','','','',''],
   ['COLA-00004','2026-11-06','T3','Completada','U2','','','12','',false,'','Catalogo','',0,'','','','','','','','','','','',''],
   ['COLA-00005','2026-11-06','','Pendiente','','','','','',false,'','Extra','E1',0,'','','','','','','','','','','',''],
   ['COLA-00006','2026-11-06','','Pendiente','','','','','',false,'','Extra','E2',0,'',888,'','','','','','','','','',''],
   ['COLA-00007','2026-11-06','','Completada','U2','','','30','',false,'','Extra','E3',0,'','','','','','','','','','','',''],
   ['COLA-00008','2026-11-06','','En proceso','U3','2026-11-06T16:00:00Z','','','',false,'','Extra','E4',0,'','','','','','','','','','','',''],
   ['COLA-00009','2026-11-06','','Pendiente','','','','','',false,'','Ticket','K1',0,'','','','','','','','','','','',''],
   ['COLA-00010','2026-11-06','','Pendiente','','','','','',false,'','Ticket','K2',0,'','','','','','','','','','','',''],
   ['COLA-00011','2026-11-06','','Saltada','','','','','',false,'Ticket cancelado: x','Ticket','K3',0,'','','','','','','','','','','',''],
   ['COLA-00012','2026-11-06','','Completada','U2','','','5','',false,'','Ticket','K4',0,'','','','','','','','','','','',''],
   ['COLA-00013','2026-11-06','','Pendiente','','','','','',false,'','Gas','',0,'','','','','','','','','','','',''],
   ['COLA-00014','2026-11-05','T2','Pendiente','','','','','',false,'','Catalogo','',0,'','','','','','','','','','','',''],
   ['COLA-00015','2026-11-06','','Completada','U2','','','8','',false,'','Extra','E5',0,'','','','','','','','','','','','']],
 LOG_AUDITORIA:[['timestamp','id_usuario','correo_ejecuta','accion','entidad','id_entidad_afectada','valor_anterior','valor_nuevo']],
 USUARIOS:[['id_usuario','correo','nombre_completo','rol','estado']],
 EQUIPO_CATALOGO:[['equipo_id','nombre','hoja_relacionada','frecuencia_revision','activo']],
 EVIDENCIAS_FOTOS:[['evidencia_id','fecha_hora','usuario_id','tipo','entidad_relacionada_id','url_drive']]
};
const libro=crearLibro(H);
const props={COLUMNAS_PAUSA_OK:'true'};
function fmt(d){ const x=new Date(d.getTime()-6*3600e3); return x.toISOString().slice(0,10); }
const ctx={ console, Date, Math, JSON, Object, Array, String, Number, isNaN, parseInt, parseFloat, RegExp, Error,
  SpreadsheetApp:{ getActiveSpreadsheet:()=>libro },
  CacheService:{ getScriptCache:()=>({ get:k=>/^COLA_OK_/.test(k)?'1':null, put(){}, remove(){}, removeAll(){} }) },
  PropertiesService:{ getScriptProperties:()=>({ getProperty:k=>props[k]||null, setProperty:(k,v)=>{props[k]=v} }) },
  LockService:{ getScriptLock:()=>({ waitLock(){}, releaseLock(){}, tryLock(){return true} }) },
  Session:{ getScriptTimeZone:()=>'America/Mexico_City' },
  Utilities:{ formatDate:(d,tz,p)=>{ if(p==='yyyy-MM-dd') return fmt(d); return fmt(d); } },
  MailApp:{ sendEmail(){} }, GmailApp:{ sendEmail(){} }, DriveApp:{} };
vm.createContext(ctx);
for(const f of ['Código.js','Utilidades.js','Auth_Usuarios.js','Tareas_Cola.js','Checklist_Equipos.js','Control_Gas.js','Tickets_Comidas.js','Reapertura.js','Reportes.js','Historial.js','Comparativa.js']){
  vm.runInContext(fs.readFileSync(path.join(DIR,f),'utf8'),ctx,{filename:f}); }
vm.runInContext(`
var USUARIOS_PRUEBA={ ADMIN:{id_usuario:'U1',correo:'prueba.admin@ejemplo.com',nombre_completo:'Admin Prueba',p:['CARGAR_MODIFICAR_TAREAS','ENVIAR_TICKET','EJECUTAR_TAREAS_COLA','ATENDER_TICKET']},
  TEC:{id_usuario:'U2',correo:'prueba.tec@ejemplo.com',nombre_completo:'Tecnico Prueba',p:['EJECUTAR_TAREAS_COLA']},
  TEC3:{id_usuario:'U3',correo:'prueba.tec3@ejemplo.com',nombre_completo:'Tecnico Tres',p:['EJECUTAR_TAREAS_COLA']} };
requiereSesion_=function(t){ return USUARIOS_PRUEBA[t]; };
usuarioTienePermiso_=function(u,p){ return u.p.indexOf(p)!==-1; };
requierePermiso_=function(t,p){ var u=USUARIOS_PRUEBA[t]; if(u.p.indexOf(p)===-1) throw new Error('sin permiso '+p); return u; };
fechaHoy_=function(){ return '2026-11-06'; };
guardarFotosAntesTicket_=function(id,f){ return ['https://ejemplo/foto1']; };
registrarEvidenciaFoto_=function(){ return 'EV'; };
invalidarCacheUsuario_=function(){};
obtenerCatalogoEquipos_=function(){ return []; };
`,ctx);
let pasa=0, falla=0;
function ok(nombre,cond,extra){ if(cond){pasa++; console.log('  OK  '+nombre);} else {falla++; console.log('  FALLA '+nombre+(extra?' -> '+JSON.stringify(extra):''));} }
const R=(c)=>vm.runInContext(c,ctx);
const ids=l=>l.map(x=>x.registro_id.replace('COLA-000','').replace('COLA-0000',''));
const colaHoja=()=>libro._h.COLA_TRABAJO_DIARIO._d;
const filaHoja=id=>{ const d=colaHoja(); const h=d[0]; const r=d.find(x=>x[0]===id); const o={}; h.forEach((k,i)=>o[k]=r[i]); return o; };

console.log('1) Cola normal (admin)');
let l=R("listarColaDelDia('ADMIN', null)");
ok('solo visibles: 01,03,04,05,08,09,13', JSON.stringify(ids(l).sort())===JSON.stringify(['01','03','04','05','08','09','13']), ids(l));
ok('posiciones 1..7 sin huecos', l.map(x=>x.posicion).join(',')==='1,2,3,4,5,6,7', l.map(x=>x.posicion));
ok('nunca oculta En proceso (03 tarea desactivada, 08 extra completado)', ids(l).includes('03') && ids(l).includes('08'));
console.log('2) Ver terminados y ocultos');
let lo=R("listarColaDelDia('ADMIN', null, true)");
ok('admin ve los 14 de hoy', lo.length===14, lo.length);
const mot={}; lo.forEach(x=>mot[x.registro_id]=x.oculto_motivo);
ok('motivos correctos', mot['COLA-00002']==='Tarea desactivada en el catálogo' && mot['COLA-00006']==='Trabajo programado cancelado' && mot['COLA-00007']==='Trabajo programado completado' && mot['COLA-00010']==='Ticket atendido' && mot['COLA-00011']==='Ticket cancelado' && mot['COLA-00012']==='Ticket completado' && mot['COLA-00015']==='Trabajo programado completado' && !mot['COLA-00013'], mot);
let lt=R("listarColaDelDia('TEC', null, true)");
ok('tecnico sin permiso no ve ocultos aunque lo pida', lt.length===7, lt.length);
console.log('3) Dia pasado: la tarea desactivada no se oculta hacia atras');
let lp=R("listarColaDelDia('ADMIN', '2026-11-05')");
ok('COLA-00014 visible el 5 de nov', ids(lp).includes('14'), ids(lp));
console.log('4) Tomar');
let r=R("tomarTarea('TEC3', 'COLA-00006', '')");
ok('no deja tomar un oculto por id', r.ok===false && /ya no está en la cola/.test(r.mensaje), r);
r=R("tomarTarea('ADMIN', '', '')");
ok('tomar siguiente elige el ticket urgente visible (09)', r.ok && r.registro_id==='COLA-00009', r.registro_id||r);
ok('la respuesta trae la cola sin ocultos', r.cola.every(x=>!x.oculto_motivo) && r.cola.length===7);
console.log('5) Mover a posicion');
const antes2=filaHoja('COLA-00002').posicion_manual, antes6=filaHoja('COLA-00006').posicion_manual;
r=R("moverTareaEnCola('ADMIN', 'COLA-00005', '1')");
ok('05 queda primero en la cola visible', r.cola[0].registro_id==='COLA-00005', ids(r.cola));
ok('no toca posicion_manual de ocultos', filaHoja('COLA-00002').posicion_manual===antes2 && filaHoja('COLA-00006').posicion_manual===antes6);
console.log('6) Reabrir');
R("reabrirTrabajoCompletado('ADMIN', 'COLA-00007', 'faltó pintar', [{base64:'x'}])");
R("reabrirTrabajoCompletado('ADMIN', 'COLA-00012', 'faltó limpiar', [{base64:'x'}])");
R("reabrirTrabajoCompletado('ADMIN', 'COLA-00015', 'faltó revisar', [{base64:'x'}])");
l=R("listarColaDelDia('ADMIN', null)");
const e=id=>l.find(x=>x.registro_id===id);
ok('extra completado reabierto reaparece como Pendiente', e('COLA-00007') && e('COLA-00007').estado==='Pendiente');
ok('ticket completado reabierto reaparece como Pendiente', e('COLA-00012') && e('COLA-00012').estado==='Pendiente');
ok('extra cancelado con renglon completado reaparece como Pendiente', e('COLA-00015') && e('COLA-00015').estado==='Pendiente');
console.log('7) Cierre de jornada');
R("ejecutarCierreJornada_('2026-11-06', 'U1', 'prueba.admin@ejemplo.com')");
ok('ocultos se quedan en su fecha (02, 06, 10)', ['COLA-00002','COLA-00006','COLA-00010'].every(id=>String(filaHoja(id).fecha)==='2026-11-06'), ['COLA-00002','COLA-00006','COLA-00010'].map(id=>filaHoja(id).fecha));
ok('visibles pendientes pasan al siguiente dia habil (01, 05)', ['COLA-00001','COLA-00005'].every(id=>String(filaHoja(id).fecha)!=='2026-11-06'), ['COLA-00001','COLA-00005'].map(id=>filaHoja(id).fecha));
ok('ninguna fila borrada', colaHoja().length===16, colaHoja().length);
console.log('\nResultado: '+pasa+' OK, '+falla+' FALLA');
process.exit(falla?1:0);