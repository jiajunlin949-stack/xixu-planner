  // Immutable originals use bounded chunks. Capacity follows the selected file
  // and available storage; extraction has a separate working-memory budget.
  const ARCHIVE_FILE_LIMIT=Number.MAX_SAFE_INTEGER,ARCHIVE_CHUNK_SIZE=256*1024;
  const ARCHIVE_SHA_CONSTANTS=new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
  const ARCHIVE_CRC_TABLE=Uint32Array.from({length:256},(_,value)=>{for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);return value});
  class ArchiveDigest {
    constructor(){this.state=new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);this.words=new Uint32Array(64);this.tail=new Uint8Array(64);this.used=0;this.size=0;this.crc=0xffffffff;this.finished=false}
    block(bytes,offset=0){
      const words=this.words,view=new DataView(bytes.buffer,bytes.byteOffset+offset,64),rotate=(v,n)=>(v>>>n)|(v<<(32-n));
      for(let i=0;i<16;i++)words[i]=view.getUint32(i*4);
      for(let i=16;i<64;i++){const x=words[i-15],y=words[i-2];words[i]=(words[i-16]+(rotate(x,7)^rotate(x,18)^(x>>>3))+words[i-7]+(rotate(y,17)^rotate(y,19)^(y>>>10)))>>>0}
      let [a,b,c,d,e,f,g,h]=this.state;
      for(let i=0;i<64;i++){const t1=(h+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+ARCHIVE_SHA_CONSTANTS[i]+words[i])>>>0,t2=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))>>>0;h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0}
      [a,b,c,d,e,f,g,h].forEach((value,i)=>{this.state[i]=(this.state[i]+value)>>>0});
    }
    update(bytes){
      if(this.finished||!(bytes instanceof Uint8Array)||!Number.isSafeInteger(this.size+bytes.length))throw Error('原件校验状态无效');
      this.size+=bytes.length;for(const byte of bytes)this.crc=(this.crc>>>8)^ARCHIVE_CRC_TABLE[(this.crc^byte)&255];
      let offset=0;
      if(this.used){const count=Math.min(64-this.used,bytes.length);this.tail.set(bytes.subarray(0,count),this.used);this.used+=count;offset=count;if(this.used===64){this.block(this.tail);this.used=0}}
      while(offset+64<=bytes.length){this.block(bytes,offset);offset+=64}
      if(offset<bytes.length){this.tail.set(bytes.subarray(offset),0);this.used=bytes.length-offset}
    }
    finish(){
      if(this.finished)throw Error('原件校验已结束');this.finished=true;
      const tail=new Uint8Array(this.used<56?64:128);tail.set(this.tail.subarray(0,this.used));tail[this.used]=128;
      const view=new DataView(tail.buffer);view.setUint32(tail.length-8,Math.floor(this.size/0x20000000));view.setUint32(tail.length-4,(this.size*8)>>>0);
      this.block(tail);if(tail.length===128)this.block(tail,64);
      return {hash:[...this.state].map(value=>value.toString(16).padStart(8,'0')).join(''),crc:(this.crc^0xffffffff)>>>0,bytes:this.size};
    }
  }
  function archiveValidSize(size){return Number.isSafeInteger(size)&&size>0}
  async function archiveDigestSource(source,consume=null){
    if(!archiveValidSize(source.size))throw Error('原件大小无效');const digest=new ArchiveDigest();
    for(let offset=0;offset<source.size;offset+=ARCHIVE_CHUNK_SIZE){const length=Math.min(ARCHIVE_CHUNK_SIZE,source.size-offset),bytes=await source.read(offset,length);if(!(bytes instanceof Uint8Array)||bytes.length!==length)throw Error('文件读取不完整');digest.update(bytes);if(consume)await consume(bytes,offset);await archiveYield()}
    return digest.finish();
  }
  async function archiveBlob(key){
    const db=await archiveDb();return new Promise((resolve,reject)=>{const tx=db.transaction('assets','readonly'),request=tx.objectStore('assets').get(key);request.onsuccess=()=>request.result instanceof Blob?resolve(request.result):reject(Error('本机缺少原始文件'));request.onerror=()=>reject(Error('原件读取失败'))});
  }
  async function archiveWalk(key,consume=null){
    if(!archiveHashPattern.test(key))throw Error('原件编号无效');
    return archiveSerial(async()=>{
      let result;
      if(window.XixuArchive){
        try{const size=Number(window.XixuArchive.beginRead(key));result=await archiveDigestSource({size,read:async(offset,length)=>archiveUnbase64(window.XixuArchive.readChunk(length))},consume)}finally{window.XixuArchive.close()}
      }else{
        if(window.XixuStore)throw Error('此安装包尚未接入图文原件存储');const blob=await archiveBlob(key);
        result=await archiveDigestSource({size:blob.size,read:async(offset,length)=>new Uint8Array(await blob.slice(offset,offset+length).arrayBuffer())},consume);
      }
      if(result.hash!==key)throw Error('原件校验不一致，请保留原文件并重新导入');return result;
    });
  }
  async function archiveStoreSource(source,expectedHash=''){
    const original=await archiveDigestSource(source),key=original.hash;
    if(expectedHash&&expectedHash!==key)throw Error('原文件校验不一致，未保存');
    await archiveSerial(async()=>{
      if(window.XixuArchive){
        try{if(window.XixuArchive.beginWrite(key,source.size)){const copied=await archiveDigestSource(source,async bytes=>{if(!window.XixuArchive.writeChunk(archiveBase64(bytes)))throw Error('原件写入不完整')});if(copied.hash!==key)throw Error('读取期间原文件已改变，未发布原件');if(!window.XixuArchive.finishWrite())throw Error('原件未完整保存')}}finally{window.XixuArchive.close()}
        return;
      }
      if(window.XixuStore)throw Error('此安装包尚未接入图文原件存储');
      if(navigator.storage?.estimate){const space=await navigator.storage.estimate();if(space.quota&&space.quota-(space.usage||0)<source.size)throw Error('本机可用存储不足，未裁剪原文件')}
      let blob=source.blob,tempDirectory=null,tempName='';
      try{
        if(!blob&&navigator.storage?.getDirectory){tempDirectory=await navigator.storage.getDirectory();tempName='xixu-archive-'+key+'-'+uid()+'.pending';const handle=await tempDirectory.getFileHandle(tempName,{create:true}),writer=await handle.createWritable();try{const copied=await archiveDigestSource(source,bytes=>writer.write(bytes));if(copied.hash!==key)throw Error('原件在读取期间改变');await writer.close();blob=await handle.getFile()}catch(error){await writer.abort().catch(()=>{});throw error}}
        if(!blob){const parts=[],copied=await archiveDigestSource(source,async bytes=>parts.push(bytes.slice()));if(copied.hash!==key)throw Error('原件在读取期间改变');blob=new Blob(parts)}
        const db=await archiveDb();await new Promise((resolve,reject)=>{const tx=db.transaction('assets','readwrite'),store=tx.objectStore('assets'),existing=store.get(key);existing.onsuccess=()=>{if(existing.result===undefined)store.add(blob,key)};tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(Error('原件未保存，请检查可用空间'))});
      }finally{if(tempDirectory&&tempName)await tempDirectory.removeEntry(tempName).catch(()=>{})}
    });
    const saved=await archiveWalk(key);if(saved.bytes!==source.size)throw Error('原件保存后大小不一致');return original;
  }
  function archiveBytesSource(bytes){return {size:bytes.length,blob:new Blob([bytes]),read:async(offset,length)=>bytes.subarray(offset,offset+length)}}
  async function archiveSelectedSource(file,index,selection){
    const active=()=>{if(selection.active&&!selection.active())throw Error('已取消文档导入')};
    if(!window.XixuFile)return {size:file.size,blob:file,read:async(offset,length)=>{active();return new Uint8Array(await file.slice(offset,offset+length).arrayBuffer())}};
    const open=()=>{const info=JSON.parse(window.XixuFile.begin(index));if(selection.id!==undefined&&selection.id!==info.selectionId)throw Error('文件选择已变化');selection.id=info.selectionId;return info};
    const info=open();if(!archiveValidSize(Number(info.size)))throw Error('文件大小无效');let position=0;
    return {size:Number(info.size),read:async(offset,length)=>{
      active();
      if(typeof window.XixuFile.readRange==='function')return archiveUnbase64(window.XixuFile.readRange(offset,length,info.selectionId,index));
      if(offset!==position){const current=open();if(Number(current.size)!==Number(info.size))throw Error('所选文件已改变');position=0;while(position<offset){const skipped=archiveUnbase64(window.XixuFile.readChunk(Math.min(ARCHIVE_CHUNK_SIZE,offset-position)));if(!skipped.length)throw Error('文件读取不完整');position+=skipped.length}}
      const bytes=archiveUnbase64(window.XixuFile.readChunk(length));position+=bytes.length;return bytes;
    }};
  }
