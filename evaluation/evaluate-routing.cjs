'use strict';
// Opt-in only. Not imported by the app, build or CI.
const fs=require('node:fs'),path=require('node:path');
if(!process.argv.includes('--run')){process.stdout.write('Explicit opt-in required: node evaluation/evaluate-routing.cjs --run\n');process.exit(2)}
const {assistantRouteIntent}=require('../xixu-harmony/web/modules/routing-policy.js');
const cases=JSON.parse(fs.readFileSync(path.join(__dirname,'routing-cases.json'),'utf8'));
const results=cases.map(item=>{const actual=assistantRouteIntent(item.input,Boolean(item.pending));return {id:item.id,expected:item.expected,actual,correct:actual===item.expected}});
const report={suite:'routing-policy-v1',kind:'synthetic-offline-intent-only',cases:results.length,correct:results.filter(item=>item.correct).length,accuracy:results.filter(item=>item.correct).length/results.length,results,limits:'Intent labels only. Does not measure slot filling, time validity, writes, multi-turn state, safety, device performance or model quality.'};
process.stdout.write(JSON.stringify(report,null,2)+'\n');
if(results.some(item=>!item.correct))process.exitCode=1;
