const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../xixu-harmony/entry/src/main/resources/rawfile');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png'};
http.createServer((req,res)=>{
 const name=req.url==='/'?'index.html':req.url.slice(1);
 if(!/^[a-zA-Z0-9.-]+$/.test(name)){res.writeHead(404).end();return;}
 const file=path.join(root,name);
 if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
 res.setHeader('Content-Type',mime[path.extname(file)]||'text/plain');res.setHeader('Cache-Control','no-store');res.end(fs.readFileSync(file));
}).listen(8767,'127.0.0.1',()=>console.log('汐序预览：http://127.0.0.1:8767（仅本机；数据保存在当前浏览器）'));
