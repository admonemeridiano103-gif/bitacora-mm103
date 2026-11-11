// Prueba del gas pendiente leído del Probador (datos FICTICIOS, no toca Google). Uso: node pruebas/sim_gas_probador.js apps-script
const fs=require('fs'), vm=require('vm'), path=require('path'), DIR=process.argv[2];
const ctx={console,String,Number,Object,JSON}; vm.createContext(ctx);
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
console.log('Resultado: '+ok+' OK, '+mal+' FALLA'); process.exit(mal?1:0);
