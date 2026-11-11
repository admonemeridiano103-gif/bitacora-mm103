// Prueba del acceso al Probador con usuario/correo de la Bitácora (datos FICTICIOS, no toca Google).
// Uso: node pruebas/sim_probador_login.js ../codigo/probador-ocr
const fs=require('fs'), vm=require('vm'), path=require('path'), DIR=process.argv[2];
const cache={}; let respuesta={ok:true,resultado:{ok:false,mensaje:'Usuario o contraseña incorrectos.'}}; let enviado=null, uuid=0;
const ctx={console,String,Number,Object,JSON,Date,Math,Array,Error,isNaN,
  UrlFetchApp:{fetch:(u,o)=>{enviado=JSON.parse(o.payload);return {getContentText:()=>typeof respuesta==='string'?respuesta:JSON.stringify(respuesta)};}},
  CacheService:{getScriptCache:()=>({put:(k,v)=>{cache[k]=v;},get:k=>cache[k]||null})},
  Utilities:{getUuid:()=>'u'+(++uuid)}};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(DIR,'Código.js'),'utf8'),ctx,{filename:'Código.js'});
vm.runInContext(`leer_=function(n){return [{Email:'Javier@Ejemplo.com',Nombre:'Javier',Activo:'SI'},{Email:'baja@ejemplo.com',Nombre:'Baja',Activo:'NO'}];}; iniciar=function(){return {correo:_emailForzado};}; guardarLecturas=function(){return 'ok';};`,ctx);
let ok=0,mal=0; const t=(n,c)=>{ if(c){ok++;console.log('OK  '+n);}else{mal++;console.log('FALLA '+n);} };
const falla=(f)=>{ try{ f(); return ''; }catch(e){ return String(e.message); } };
const login=(u,p)=>vm.runInContext('loginConUsuario',ctx)(u,p);
t('sin datos no consulta a la Bitácora', /Escribe tu usuario/.test(falla(()=>login('', 'x'))) && enviado===null);
t('contraseña incorrecta: repite el mensaje de la Bitácora', /incorrectos/.test(falla(()=>login('javier','mal'))));
respuesta={ok:true,resultado:{ok:true,token:'t',usuario:{correo:'javier@ejemplo.com'}}};
const r=login('  JAVIER ','bien');
t('usuario válido y registrado: entrega sesión; manda usuario en minúsculas con la contraseña tal cual', r.token && r.nombre==='Javier' && enviado.fn==='login' && enviado.args[0]==='javier' && enviado.args[1]==='bien');
t('también entra con el correo', !!login('Javier@Ejemplo.com','bien').token && enviado.args[0]==='javier@ejemplo.com');
respuesta={ok:true,resultado:{ok:true,token:'t',usuario:{correo:'otro@ejemplo.com'}}};
t('usuario válido pero no registrado en el Probador: no entra', /no estás registrado/.test(falla(()=>login('otro','bien'))));
respuesta={ok:true,resultado:{ok:true,token:'t',usuario:{correo:'baja@ejemplo.com'}}};
t('cuenta desactivada en el Probador: no entra', /desactivada/.test(falla(()=>login('baja','bien'))));
respuesta='<html>error</html>';
t('respuesta inválida de la Bitácora: error claro', /No se pudo validar/.test(falla(()=>login('javier','bien'))));
respuesta={ok:true,resultado:{ok:true,token:'t',usuario:{correo:'javier@ejemplo.com'}}};
const tok=login('javier','bien').token;
const llamar=(s,f,a)=>vm.runInContext('pwaLlamar',ctx)(s,f,a);
t('con sesión válida corre la función a nombre del correo registrado', llamar(tok,'iniciar',[]).correo==='javier@ejemplo.com');
t('sin sesión o inventada: pide entrar de nuevo', /sesión venció/.test(falla(()=>llamar('inventada','iniciar',[]))));
t('una función fuera de la lista no se puede llamar', /no permitida/.test(falla(()=>llamar(tok,'configuracionInicial',[]))));
console.log('Resultado: '+ok+' OK, '+mal+' FALLA'); process.exit(mal?1:0);
