// Simulacion de la comparativa de tiempos (Fase 6) con hojas en memoria y datos FICTICIOS. No toca Google.
// Uso: node pruebas/sim_comparativa.js apps-script
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
 USUARIOS:[['id_usuario','correo','nombre_completo','rol','estado'],['U1','prueba.admin@ejemplo.com','Admin Prueba','Administrador','Activo'],['U2','prueba.tec@ejemplo.com','Tecnico Prueba','Técnico','Activo'],['U3','prueba.tec3@ejemplo.com','Tecnico Tres','Técnico','Activo']],
 EQUIPO_CATALOGO:[['equipo_id','nombre','hoja_relacionada','frecuencia_revision','activo']],
 EVIDENCIAS_FOTOS:[['evidencia_id','fecha_hora','usuario_id','tipo','entidad_relacionada_id','url_drive']]
};
const libro=crearLibro(H);
const props={COLUMNAS_PAUSA_OK:'true'};
function fmt(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
const ctx={ console, Date, Math, JSON, Object, Array, String, Number, isNaN, parseInt, parseFloat, RegExp, Error,
  SpreadsheetApp:{ getActiveSpreadsheet:()=>libro },
  CacheService:{ getScriptCache:()=>({ get:k=>/^COLA_OK_/.test(k)?'1':null, put(){}, remove(){}, removeAll(){} }) },
  PropertiesService:{ getScriptProperties:()=>({ getProperty:k=>props[k]||null, setProperty:(k,v)=>{props[k]=v} }) },
  LockService:{ getScriptLock:()=>({ waitLock(){}, releaseLock(){}, tryLock(){return true} }) },
  Session:{ getScriptTimeZone:()=>'America/Mexico_City' },
  Utilities:{ formatDate:(d,tz,p)=>fmt(d), newBlob:()=>({getAs:()=>({setName(){return this},getBytes:()=>[]})}), base64Encode:()=>'' },
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

// ---- datos de la comparativa (ficticios), reemplazan la cola de ejemplo
const C=libro._h.COLA_TRABAJO_DIARIO._d; const HC=C[0]; C.length=1;
function filaCola(o){ const r=HC.map(k=>o[k]===undefined?'':o[k]); C.push(r); }
let n=0; function comp(fecha,tarea,tec,min,extra){ n++; filaCola(Object.assign({registro_id:'COLA-9'+String(n).padStart(4,'0'),fecha:fecha,tarea_id:tarea,estado:'Completada',usuario_asignado_actual:tec,tiempo_total_minutos:min,tipo_origen:'Catalogo'},extra||{})); return 'COLA-9'+String(n).padStart(4,'0'); }
comp('2026-11-02','T1','U2',10); comp('2026-11-03','T1','U2',12);
comp('2026-11-02','T1','U3',20); comp('2026-11-03','T1','U3',22); comp('2026-11-04','T1','U3',24);
const regU1=comp('2026-11-04','T1','U1',15);
comp('2026-11-02','T3','U2',5); comp('2026-11-03','T3','U2',6); comp('2026-11-04','T3','U2',7);   // un solo tecnico: no se compara
comp('2026-11-02','','U2',30,{tipo_origen:'Extra',origen_id:'E1'}); comp('2026-11-03','','U3',40,{tipo_origen:'Extra',origen_id:'E1'});
comp('2026-11-04','T1','U2',99,{estado:'Pendiente'});         // no completada: fuera
comp('2026-11-04','T1','U3',0);                               // sin minutos: fuera
comp('2026-10-01','T1','U2',50);                              // fuera del periodo del reporte
const regU2a='COLA-90001';
const cfg=libro.insertSheet('CONFIG_SISTEMA'); cfg._d[0]=['clave','valor','descripcion'];
console.log('1) Calculo');
let c=R("calcularComparativaTiempos_({desde:'2026-11-01', hasta:'2026-11-30'})");
ok('umbral por defecto 2', c.umbral===2, c.umbral);
ok('se creo COMPARATIVA_MIN_REGISTROS=2 en CONFIG_SISTEMA', cfg._d.some(r=>r[0]==='COMPARATIVA_MIN_REGISTROS' && Number(r[1])===2), cfg._d);
ok('solo un trabajo comparable (T1)', c.trabajos.length===1 && c.trabajos[0].clave==='T:T1', c.trabajos.map(t=>t.clave));
const t1=c.trabajos[0];
ok('nombre del catalogo', t1.nombre==='Revisar bombas', t1.nombre);
ok('promedio general 17.2 con 6 registros (incluye al de 1 registro)', t1.promedio===17.2 && t1.veces===6, [t1.promedio,t1.veces]);
ok('tecnicos comparables U2 y U3, el mas rapido primero', t1.tecnicos.map(p=>p.tecnico_id).join()==='U2,U3' && t1.otros===1, t1.tecnicos);
const u2=t1.tecnicos[0], u3=t1.tecnicos[1];
ok('U2: 11 min, -6.2 min, -36%', u2.promedio===11 && u2.dif_min===-6.2 && u2.dif_pct===-36, u2);
ok('U3: 22 min, +4.8 min, +28%', u3.promedio===22 && u3.dif_min===4.8 && u3.dif_pct===28, u3);
ok('nombre del tecnico', u2.tecnico==='Tecnico Prueba');
ok('el registro de octubre queda fuera del periodo', !c.porRegistro['COLA-90014']);
ok('registro de U1 (1 vez) marcado como no comparable', c.porRegistro[regU1] && c.porRegistro[regU1].comparable===false && c.porRegistro[regU1].veces_tecnico===1);
ok('registro de U2 comparable con su diferencia', c.porRegistro[regU2a].comparable===true && c.porRegistro[regU2a].dif_min===-7.2, c.porRegistro[regU2a]);
console.log('2) Umbral desde CONFIG_SISTEMA');
cfg._d.find(r=>r[0]==='COMPARATIVA_MIN_REGISTROS')[1]=3;
c=R("calcularComparativaTiempos_({desde:'2026-11-01', hasta:'2026-11-30'})");
ok('con umbral 3, T1 ya no tiene 2 comparables (U2 solo tiene 2)', c.umbral===3 && c.trabajos.length===0, c.trabajos);
cfg._d.find(r=>r[0]==='COMPARATIVA_MIN_REGISTROS')[1]=2;
console.log('3) Agrupacion de trabajos programados por texto');
libro._h.TRABAJOS_EXTRA_PROGRAMADOS._d.push(['E9','  cambiar FOCO pasillo ','Completado','','','','','']);
libro._h.TRABAJOS_EXTRA_PROGRAMADOS._d.push(['E8','Cambiar foco pasillo','Completado','','','','','']);
comp('2026-11-05','','U2',8,{tipo_origen:'Extra',origen_id:'E9'}); comp('2026-11-06','','U2',10,{tipo_origen:'Extra',origen_id:'E8'});
comp('2026-11-05','','U3',14,{tipo_origen:'Extra',origen_id:'E8'}); comp('2026-11-06','','U3',16,{tipo_origen:'Extra',origen_id:'E9'});
c=R("calcularComparativaTiempos_({desde:'2026-11-01', hasta:'2026-11-30'})");
ok('mismo texto con mayusculas/espacios distintos cuenta como el mismo trabajo', c.trabajos.some(t=>t.clave==='E:cambiar foco pasillo' && t.veces===4), c.trabajos.map(t=>[t.clave,t.veces]));
console.log('4) Auditoria');
const LOG=libro._h.LOG_AUDITORIA._d;
LOG.push([new Date('2026-11-03T18:00:00Z'),'U2','prueba.tec@ejemplo.com','COMPLETAR_TAREA_COLA','COLA_TRABAJO_DIARIO',regU2a,'En proceso','Completada']);
LOG.push([new Date('2026-11-04T18:00:00Z'),'U1','prueba.admin@ejemplo.com','COMPLETAR_TAREA_COLA','COLA_TRABAJO_DIARIO',regU1,'En proceso','Completada']);
LOG.push([new Date('2026-11-04T19:00:00Z'),'U1','prueba.admin@ejemplo.com','LOGIN','USUARIOS','U1','','']);
const aud=R("listarAuditoriaReciente('ADMIN', 50)");
const a2=aud.find(f=>f.id_entidad_afectada===regU2a), a1=aud.find(f=>f.id_entidad_afectada===regU1), al=aud.find(f=>f.accion==='LOGIN');
ok('tarea completada trae comparativa con umbral', a2 && a2.comparativa && a2.comparativa.comparable && a2.comparativa.umbral===2, a2 && a2.comparativa);
ok('la de pocos datos trae comparativa no comparable', a1 && a1.comparativa && a1.comparativa.comparable===false);
ok('otras acciones no traen comparativa', al && !al.comparativa);
R("var _o=calcularComparativaTiempos_; calcularComparativaTiempos_=function(){ throw new Error('x'); };");
const aud2=R("listarAuditoriaReciente('ADMIN', 50)"); R("calcularComparativaTiempos_=_o;");
ok('si la comparativa falla, la auditoria se muestra igual', aud2.length===aud.length && !aud2.some(f=>f.comparativa));
console.log('5) Reportes');
const d=R("obtenerDashboard('ADMIN', {desde:'2026-11-01', hasta:'2026-11-30'})");
ok('el dashboard trae la comparativa del periodo sin el detalle por registro', d.comparativa && d.comparativa.trabajos.length>=1 && !d.comparativa.porRegistro && d.comparativa.desde==='2026-11-01', d.comparativa && Object.keys(d.comparativa));
const ex=R("obtenerDatosReporteExcel('ADMIN', {desde:'2026-11-01', hasta:'2026-11-30'})");
ok('el Excel trae la comparativa', ex.comparativa && ex.comparativa.trabajos.length>=1);
console.log('\nResultado: '+pasa+' OK, '+falla+' FALLA');
process.exit(falla?1:0);