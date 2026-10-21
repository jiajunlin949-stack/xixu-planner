const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const preferredIde='C:/Program Files/Huawei/DevEco Studio';
const legacyIde='C:/Program Files/Huawei/DevEco Studio';
const ide=process.env.XIXU_DEVECO_HOME||(fs.existsSync(path.join(preferredIde,'product-info.json'))?preferredIde:legacyIde);
const root=__dirname;
const sdk=require('./build-windows-sdk.cjs').prepareWindowsSdk(ide,root);
for(const name of ['hvigor','hvigor-ohos-plugin']){
 const dest=path.join(root,'node_modules/@ohos',name);
 const source=path.join(ide,'tools/hvigor',name);
 fs.mkdirSync(path.dirname(dest),{recursive:true});
 const generated='module.exports=require('+JSON.stringify(source)+');\n';
 if(fs.existsSync(dest)&&!fs.lstatSync(dest).isSymbolicLink()&&fs.readdirSync(dest).length===1&&fs.readFileSync(path.join(dest,'index.js'),'utf8')===generated){fs.unlinkSync(path.join(dest,'index.js'));fs.rmdirSync(dest);}
 if(fs.existsSync(dest)&&fs.lstatSync(dest).isSymbolicLink()&&path.normalize(fs.realpathSync(dest)).toLowerCase()!==path.normalize(fs.realpathSync(source)).toLowerCase())fs.rmdirSync(dest);
 if(!fs.existsSync(dest))fs.symlinkSync(source,dest,'junction');
}
const args=[path.join(ide,'tools/hvigor/hvigor/bin/hvigor.js'),'--mode','module','-p','product=default','-p','module=entry@default','-p','buildMode=debug','assembleHap','--no-daemon'];
const result=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit',windowsHide:true,env:{...process.env,NODE_PATH:path.join(root,'node_modules'),DEVECO_SDK_HOME:sdk,JAVA_HOME:path.join(ide,'jbr'),NODE_HOME:path.dirname(process.execPath),HVIGOR_USER_HOME:path.join(root,'.build-cache')}});
if(result.error)console.error(result.error.message);
process.exitCode=result.status??1;
