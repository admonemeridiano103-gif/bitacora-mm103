// Prueba del gas pendiente leído del Probador (datos FICTICIOS, no toca Google). Uso: node pruebas/sim_gas_probador.js apps-script
const fs=require('fs'), vm=require('vm'), path=require('path'), DIR=process.argv[2];
function hoja(d){ const maxF=()=>d.length+2; let max=d.length+2; return { _d:d, getLastRow:()=>d.length, getMaxRows:()=>max, insertRowsAfter:(r,n)=>{max+=n;}, getDataRange:()=>({getValues:()=>d.map(r=>r.slice())}),
  getRange:(r,c,nr,nc)=>({ setValues:v=>{ for(let i=0;i<v.length;i++){ d[r-1+i]=d[r-1+i]||[]; for(let j=0;j<v[i].length;j++) d[r-1+i][c-1+j]=v[i][j]; } }, setNumberFormat(){} }) }; }
const shE=hoja([['Servicio','Unidad','Estado','FechaHora','Email','Usuario','Nota','Comentario'],['gas','B|0804','ABIERTO','2026-11-01 08:00:00','x@x','Otro','n','Solo abrir locales 3 y 4']]);
const shB=hoja([['Id','FechaHora','Email','Nombre','Rol','Accion','PeriodoId','MedidorId','Detalle']]);
const quitadas=[];
const ctx={console,String,Number,Object,JSON,Date,SpreadsheetApp:{openById:()=>({getSheetByName:n=>({CierreEstado:shE,Bitacora:shB})[n]||null})},
  Utilities:{formatDate:()=>'2026-11-11 14:00:00',getUuid:()=>'abcdef12-0000'},CacheService:{getScriptCache:()=>({remove:k=>quitadas.push(k),get:()=>null,put(){}})}}; vm.createContext(ctx);
for(const f of ['Control_Gas.js','Enlace_Probador.js']) vm.runInContext(fs.readFileSync(path.join(DIR,f),'utf8'),ctx,{filename:f});
let ok=0,mal=0; const t=(n,c)=>{ if(c){ok++;console.log('OK  '+n);}else{mal++;console.log('FALLA '+n);} };
const T={
 Medidores:[{Servicio:'gas',Torre:'B',Codigo:'0804',Nombre:'',Estado:'activo'},{Servicio:'gas',Torre:'B',Codigo:'0101',Nombre:'',Estado:'activo'},
   {Servicio:'gas',Torre:'C',Codigo:'0301',Nombre:'',Estado:'activo'},{Servicio:'gas',Torre:'C',Codigo:'0302',Nombre:'',Estado:'activo'},
   {Servicio:'gas',Torre:'D',Codigo:'06',Nombre:'Romeo',Estado:'activo'},{Servicio:'gas',Torre:'D',Codigo:'07',Nombre:'Dexfit',Estado:'comparte',UsaMedidorDe:'06'},
   {Servicio:'agua',Torre:'B',Codigo:'0804',Nombre:'',Estado:'activo'}],
 CierreMontos:[{Unidad:'B|0804',Monto:450},{Unidad:'B|0101',Monto:50},{Unidad:'C|0301',Monto:300},{Unidad:'C|0302',Monto:900}],
 CierreEstado:[{Servicio:'gas',Unidad:'B|0804',Estado:'ABIERTO'},{Servicio:'gas',Unidad:'B|0101',Estado:'CERRADO'},{Servicio:'gas',Unidad:'C|0301',Estado:'ABIERTO'},{Servicio:'gas',Unidad:'C|0302',Estado:'CERRADO'},{Servicio:'gas',Unidad:'D|06',Estado:'ABIERTO'}],
 CierreProrrogas:[{Estado:'vigente',Unidad:'C|0301',Hasta:'2026-11-20'}],
 CierreSolicitudes:[{Estado:'activa',Servicio:'gas',Unidad:'D|06',Accion:'cerrar',Fecha:'2026-11-10',CreadaEn:'x'}],
 CierreImportes:[{Umbral:200}]
};
const r=ctx.gasEvaluarProbador_(T,'2026-11-11');
const por={}; r.forEach(x=>por[x.clave]=x.accion);
t('adeudo >= umbral y abierto -> Cerrar', por['B|0804']==='Cerrar');
t('sin adeudo y cerrado -> Abrir', por['B|0101']==='Abrir');
t('adeudo con prórroga y abierto -> sin pendiente', !('C|0301' in por));
t('adeudo alto y ya cerrado -> sin pendiente', !('C|0302' in por));
t('solicitud del propietario de cerrar -> Cerrar; Dexfit comparte medidor y no es unidad aparte', por['D|06']==='Cerrar' && Object.keys(por).length===3 && r.every(x=>x.clave!=='D|07'));
t('agua no entra y la etiqueta lleva código y nombre', r.every(x=>!/agua/.test(x.clave)) && r.filter(x=>x.clave==='D|06')[0].departamento==='06 Romeo');
t('el técnico no recibe montos', r.every(x=>!('monto' in x)));
t('sin prórroga vencida (Hasta < hoy) vuelve a Cerrar', ctx.gasEvaluarProbador_(Object.assign({},T,{CierreProrrogas:[{Estado:'vigente',Unidad:'C|0301',Hasta:'2026-11-01'}]}),'2026-11-11').some(x=>x.clave==='C|0301'&&x.accion==='Cerrar'));
const tec={correo:'Tec@Ejemplo.com',nombre_completo:'Tecnico Prueba',rol:'Técnico'};
ctx.marcarGasProbador_('B|0804','CERRADO',tec,'foto',{unidad:'B 0804'});
t('actualiza la fila existente (estado, quien y cuando) y conserva el comentario', shE._d[1][2]==='CERRADO' && shE._d[1][4]==='tec@ejemplo.com' && shE._d[1][5]==='Tecnico Prueba' && shE._d[1][3]==='2026-11-11 14:00:00' && shE._d[1][7]==='Solo abrir locales 3 y 4' && shE._d.length===2);
ctx.marcarGasProbador_('C|0301','ABIERTO',tec,'',{});
t('agrega fila nueva si la unidad no tenía estado', shE._d.length===3 && shE._d[2][0]==='gas' && shE._d[2][1]==='C|0301' && shE._d[2][2]==='ABIERTO' && shE._d[2][7]==='');
t('deja huella en la Bitacora del Probador a nombre del técnico', shB._d.length===3 && shB._d[1][5]==='cierre_marcar' && shB._d[1][7]==='gas|B|0804' && shB._d[1][2]==='tec@ejemplo.com');
t('limpia la caché del gas pendiente', quitadas.indexOf('PROBADOR_GAS_PEND')>=0);
let malo=false; try{ ctx.marcarGasProbador_('B|0804','HECHO',tec,'',{}); }catch(e){ malo=true; }
t('rechaza un estado que no sea CERRADO/ABIERTO', malo);
console.log('Resultado: '+ok+' OK, '+mal+' FALLA'); process.exit(mal?1:0);
