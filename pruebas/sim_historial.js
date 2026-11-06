// Simulacion del historial de trabajos (Fase 5) con hojas en memoria y datos FICTICIOS. No toca Google.
// Uso: node pruebas/sim_historial.js apps-script
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

const hist=()=>libro._h.HISTORIAL_TRABAJOS;
const filasHist=()=>{ const d=hist()._d; const h=d[0]; return d.slice(1).map(r=>{const o={}; h.forEach((k,i)=>o[k]=r[i]); return o;}); };
console.log('1) Cierre de jornada archiva lo terminado');
let r=R("ejecutarCierreJornada_('2026-11-06', 'U1', 'prueba.admin@ejemplo.com')");
ok('el cierre sigue funcionando y reporta historial', r.ok && r.historial && r.historial.ok, r.historial);
ok('se creo la hoja HISTORIAL_TRABAJOS', !!hist());
let fh=filasHist(); const idsH=fh.map(x=>x.registro_id.slice(-2)).sort();
ok('archiva exactamente 02,04,06,07,10,11,12,14,15', JSON.stringify(idsH)===JSON.stringify(['02','04','06','07','10','11','12','14','15']), idsH);
const porId={}; fh.forEach(x=>porId[x.registro_id.slice(-2)]=x);
ok('estados finales', porId['04'].estado_final==='Completado' && porId['11'].estado_final==='Cancelado' && porId['06'].estado_final==='Cancelado' && porId['02'].estado_final==='Tarea desactivada' && porId['14'].estado_final==='Tarea desactivada' && porId['10'].estado_final==='Completado fuera de la cola', fh.map(x=>[x.registro_id.slice(-2),x.estado_final]));
ok('motivo de cancelacion del ticket', porId['11'].motivo==='x', porId['11'].motivo);
ok('tipos legibles', porId['04'].tipo==='Tarea' && porId['07'].tipo==='Trabajo programado' && porId['12'].tipo==='Ticket');
ok('nombre del trabajo y del tecnico', porId['04'].nombre==='Limpiar lobby' && porId['04'].tecnico_nombre==='Tecnico Prueba');
ok('minutos', Number(porId['04'].minutos_trabajados)===12 && Number(porId['07'].minutos_trabajados)===30);
ok('no se borro ninguna fila de la cola', colaHoja().length===16, colaHoja().length);
const marcadas=['COLA-00002','COLA-00004','COLA-00006','COLA-00007','COLA-00010','COLA-00011','COLA-00012','COLA-00014','COLA-00015'];
ok('renglones archivados quedan marcados con archivado_en', marcadas.every(id=>!!filaHoja(id).archivado_en));
ok('lo pendiente/en proceso no se archiva y pasa al dia siguiente', ['COLA-00001','COLA-00003','COLA-00005','COLA-00008','COLA-00009'].every(id=>!filaHoja(id).archivado_en && String(filaHoja(id).fecha)!=='2026-11-06'));
console.log('2) Sin duplicados');
r=R("ejecutarCierreJornada_('2026-11-06', 'U1', 'prueba.admin@ejemplo.com')");
ok('segundo cierre no archiva de nuevo', r.historial.archivados===0 && filasHist().length===9, [r.historial, filasHist().length]);
r=R("actualizarHistorialTrabajos('ADMIN')");
ok('Actualizar historial no duplica', r.archivados===0 && filasHist().length===9, r);
// si la marca de la cola se perdiera, la siguiente corrida solo vuelve a marcar
const dd=colaHoja(); const col=dd[0].indexOf('archivado_en'); dd.find(x=>x[0]==='COLA-00014')[col]='';  // renglon de ayer (Actualizar historial archiva hasta ayer)
r=R("actualizarHistorialTrabajos('ADMIN')");
ok('sin marca: vuelve a marcar sin duplicar', r.archivados===0 && r.marcados===1 && filasHist().length===9 && !!filaHoja('COLA-00014').archivado_en, r);
let err=''; try{ R("actualizarHistorialTrabajos('TEC')"); }catch(e){ err=e.message; }
ok('tecnico no puede Actualizar historial', /sin permiso/.test(err), err);
console.log('3) Consulta');
let q=R("obtenerHistorialTrabajos('ADMIN', {desde:'2026-11-01', hasta:'2026-11-07'})");
ok('total 9', q.total===9, q.total);
ok('mas reciente primero', q.filas[0].fecha_jornada>=q.filas[q.filas.length-1].fecha_jornada);
q=R("obtenerHistorialTrabajos('ADMIN', {desde:'2026-11-01', hasta:'2026-11-07', estado:'Cancelado'})");
ok('filtro estado Cancelado -> 06, 11', q.total===2, q.filas.map(x=>x.registro_id));
q=R("obtenerHistorialTrabajos('ADMIN', {desde:'2026-11-01', hasta:'2026-11-07', tipo:'Ticket'})");
ok('filtro tipo Ticket -> 3', q.total===3, q.total);
q=R("obtenerHistorialTrabajos('ADMIN', {desde:'2026-11-01', hasta:'2026-11-07', tecnico:'Tecnico Prueba'})");
ok('filtro tecnico -> 4', q.total===4, q.filas.map(x=>x.registro_id));
q=R("obtenerHistorialTrabajos('ADMIN', {desde:'2026-11-01', hasta:'2026-11-07', texto:'desactivada'})");
ok('busqueda por texto -> 2', q.total===2, q.total);
q=R("obtenerHistorialTrabajos('ADMIN', {desde:'2026-11-06', hasta:'2026-11-06'})");
ok('filtro de fecha: solo el 6 -> 8', q.total===8, q.total);
q=R("obtenerHistorialTrabajos('ADMIN', {})");
ok('sin filtros usa los ultimos 7 dias', q.filtros.desde==='2026-10-30' && q.filtros.hasta==='2026-11-06' && q.total===9, q.filtros);
ok('opciones para los filtros', q.opciones.tipos.length===3 && q.opciones.estados.indexOf('Cancelado')!==-1 && q.opciones.tecnicos.indexOf('Tecnico Prueba')!==-1, q.opciones);
err=''; try{ R("obtenerHistorialTrabajos('TEC', {})"); }catch(e){ err=e.message; }
ok('tecnico sin permiso de reportes no consulta', /no tiene acceso/.test(err), err);
console.log('4) Si el archivado falla, el cierre no se cae');
R("var _orig=archivarHistorialHasta_; archivarHistorialHasta_=function(){ throw new Error('falla simulada'); };");
r=R("ejecutarCierreJornada_('2026-11-07', 'U1', 'prueba.admin@ejemplo.com')");
R("archivarHistorialHasta_=_orig;");
ok('cierre ok con historial.ok=false', r.ok===true && r.historial && r.historial.ok===false && /falla simulada/.test(r.historial.error), r.historial);
console.log('\nResultado: '+pasa+' OK, '+falla+' FALLA');
process.exit(falla?1:0);