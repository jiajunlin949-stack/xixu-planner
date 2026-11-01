const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const web=path.resolve('xixu-harmony/web');
const raw=path.resolve('xixu-harmony/entry/src/main/resources/rawfile');
fs.mkdirSync(raw,{recursive:true});
fs.mkdirSync(path.join(raw,'cmaps'),{recursive:true});
const shared=path.resolve('shared');
fs.writeFileSync(path.join(web,'modules','shared-contracts.js'),'  // Generated from shared JSON manifests; do not edit by hand.\n  const XIXU_TOOL_MANIFEST='+JSON.stringify(JSON.parse(fs.readFileSync(path.join(shared,'tool-schemas.json'),'utf8')))+';\n  const XIXU_PROVIDER_CATALOG='+JSON.stringify(JSON.parse(fs.readFileSync(path.join(shared,'provider-catalog.json'),'utf8')))+';\n');

const moduleFiles=JSON.parse(fs.readFileSync(path.join(web,'modules','manifest.json'),'utf8'));
const shell=fs.readFileSync(path.join(web,'modules','shell.js'),'utf8');
const runtime=moduleFiles.map(file=>fs.readFileSync(path.join(web,'modules',file),'utf8')).join('\n');
const motion=fs.readFileSync(path.join(web,'motion.js'),'utf8');
const insertion='  function applyDesign(){';
if(!shell.includes(insertion))throw Error('Application shell insertion point is missing');
const js=shell.replace(insertion,runtime+'\n'+motion+'\n'+insertion).replace(/\r\n?/g,'\n');
new vm.Script(js);
fs.writeFileSync(path.join(raw,'app.js'),js);

const css=['base.css','motion.css','modules/productivity.css','editorial.css','modules/home.css','modules/agent-chat.css','modules/reschedule.css','modules/assistant.css'].map(file=>fs.readFileSync(path.join(web,file),'utf8')).join('\n').replace(/\r\n?/g,'\n');
fs.writeFileSync(path.join(raw,'app.css'),css);
let markup=fs.readFileSync(path.join(web,'base.html'),'utf8');
markup=markup.replace('初版体验','内测版').replace('Xixu · campus planner','汐序 · 校园日程手机原型').replace(/<i data-lucide="waves"[^>]*><\/i>/,'<img src="icon.png" alt="">');
const html='<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="default-src \'self\' resource:; script-src \'self\' resource:; worker-src \'self\' resource: blob:; style-src \'self\' resource: \'unsafe-inline\'; img-src \'self\' resource: data: blob:; connect-src \'self\' resource:"><title>汐序</title><link rel="stylesheet" href="app.css"></head><body><div id="xixu-save-error" role="alert" hidden></div>'+markup+'<script src="lucide.min.js"></script><script src="xlsx.full.min.js"></script><script src="pdf.min.js"></script><script src="fflate.min.js"></script><script src="hyalite.js"></script><script src="app.js"></script></body></html>';
fs.writeFileSync(path.join(raw,'index.html'),html);
fs.copyFileSync(path.join(web,'vendor','lucide.min.js'),path.join(raw,'lucide.min.js'));
fs.copyFileSync(path.join(web,'vendor','xlsx.full.min.js'),path.join(raw,'xlsx.full.min.js'));
fs.copyFileSync(path.join(web,'vendor','pdf.min.js'),path.join(raw,'pdf.min.js'));
fs.copyFileSync(path.join(web,'vendor','fflate.min.js'),path.join(raw,'fflate.min.js'));
fs.copyFileSync(path.join(web,'vendor','FFLATE-LICENSE'),path.join(raw,'FFLATE-LICENSE'));
fs.copyFileSync(path.join(web,'vendor','pdf.worker.min.js'),path.join(raw,'pdf.worker.min.js'));
// ArkWeb's resource:// scheme is not fetchable in every PDF worker. Keep the
// packaged CMaps available without an XHR/fetch dependency on that scheme.
const cmapBundle=Object.fromEntries(['Adobe-GB1-UCS2','UniGB-UCS2-H'].map(name=>[name,fs.readFileSync(path.join(web,'vendor','cmaps',name+'.bcmap')).toString('base64')]));
fs.writeFileSync(path.join(raw,'pdf-cmaps.js'),'globalThis.XixuPdfCMaps=Object.freeze('+JSON.stringify(cmapBundle)+');');
fs.writeFileSync(path.join(raw,'index.html'),html.replace('<script src="pdf.min.js"></script>','<script src="pdf.min.js"></script><script src="pdf-cmaps.js"></script>'));
for(const file of ['Adobe-GB1-UCS2.bcmap','UniGB-UCS2-H.bcmap'])fs.copyFileSync(path.join(web,'vendor','cmaps',file),path.join(raw,'cmaps',file));
fs.copyFileSync(path.join(web,'vendor','hyalite.js'),path.join(raw,'hyalite.js'));
fs.copyFileSync(path.join(web,'vendor','nunito-variable.ttf'),path.join(raw,'nunito-variable.ttf'));
fs.copyFileSync(path.join(web,'vendor','NUNITO-LICENSE'),path.join(raw,'NUNITO-LICENSE'));
fs.copyFileSync('assets/branding/xixu-icon-v1.png',path.join(raw,'icon.png'));
fs.copyFileSync(path.join(web,'vendor','LUCIDE-LICENSE'),path.join(raw,'LUCIDE-LICENSE'));
fs.copyFileSync(path.join(web,'vendor','SHEETJS-LICENSE'),path.join(raw,'SHEETJS-LICENSE'));
fs.copyFileSync(path.join(web,'vendor','PDFJS-LICENSE'),path.join(raw,'PDFJS-LICENSE'));
fs.copyFileSync(path.join(web,'HYALITE-NOTICE'),path.join(raw,'HYALITE-NOTICE'));
console.log('Native resources ready from modular sources.');
