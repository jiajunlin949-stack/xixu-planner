  // Stored ZIP entries allow random-access verification without inflating the
  // entire backup. ZIP64 carries offsets/sizes beyond the old 2 GiB boundary.
  const BACKUP_ZIP32=0xffffffff;
  function backupPut64(view,offset,value){if(!Number.isSafeInteger(value)||value<0)throw Error('备份偏移超出可精确表示的范围');view.setUint32(offset,value>>>0,true);view.setUint32(offset+4,Math.floor(value/0x100000000),true)}
  function backupGet64(view,offset){const value=view.getUint32(offset,true)+view.getUint32(offset+4,true)*0x100000000;if(!Number.isSafeInteger(value))throw Error('备份偏移无法精确读取');return value}
  class BackupZipWriter {
    constructor(write){this.output=write;this.position=0;this.entries=[]}
    async write(bytes){if(!Number.isSafeInteger(this.position+bytes.length))throw Error('备份过大');await this.output(bytes);this.position+=bytes.length}
    async entry(name,size,crc,produce){
      if(!Number.isSafeInteger(size)||size<0)throw Error('备份条目大小无效');
      const encoded=new TextEncoder().encode(name),large=size>=BACKUP_ZIP32,extra=large?20:0,header=new Uint8Array(30+encoded.length+extra),view=new DataView(header.buffer),offset=this.position;
      view.setUint32(0,0x04034b50,true);view.setUint16(4,large?45:20,true);view.setUint16(6,0x800,true);view.setUint16(12,0x21,true);view.setUint32(14,crc,true);view.setUint32(18,large?BACKUP_ZIP32:size,true);view.setUint32(22,large?BACKUP_ZIP32:size,true);view.setUint16(26,encoded.length,true);view.setUint16(28,extra,true);header.set(encoded,30);
      if(large){const start=30+encoded.length;view.setUint16(start,1,true);view.setUint16(start+2,16,true);backupPut64(view,start+4,size);backupPut64(view,start+12,size)}
      await this.write(header);const start=this.position;await produce(bytes=>this.write(bytes));if(this.position-start!==size)throw Error('备份条目没有完整写入');
      this.entries.push({name:encoded,size,crc,offset,large});
    }
    async close(){
      const directoryOffset=this.position;
      for(const item of this.entries){
        const offset64=item.offset>=BACKUP_ZIP32,extraBytes=(item.large?16:0)+(offset64?8:0),header=new Uint8Array(46+item.name.length+(extraBytes?extraBytes+4:0)),view=new DataView(header.buffer),version=extraBytes?45:20;
        view.setUint32(0,0x02014b50,true);view.setUint16(4,version,true);view.setUint16(6,version,true);view.setUint16(8,0x800,true);view.setUint16(14,0x21,true);view.setUint32(16,item.crc,true);view.setUint32(20,item.large?BACKUP_ZIP32:item.size,true);view.setUint32(24,item.large?BACKUP_ZIP32:item.size,true);view.setUint16(28,item.name.length,true);view.setUint16(30,extraBytes?extraBytes+4:0,true);view.setUint32(42,offset64?BACKUP_ZIP32:item.offset,true);header.set(item.name,46);
        if(extraBytes){let at=46+item.name.length;view.setUint16(at,1,true);view.setUint16(at+2,extraBytes,true);at+=4;if(item.large){backupPut64(view,at,item.size);backupPut64(view,at+8,item.size);at+=16}if(offset64)backupPut64(view,at,item.offset)}
        await this.write(header);
      }
      const directoryBytes=this.position-directoryOffset,zip64=this.entries.length>=65535||directoryOffset>=BACKUP_ZIP32||directoryBytes>=BACKUP_ZIP32||this.entries.some(item=>item.large);
      if(zip64){
        const recordOffset=this.position,record=new Uint8Array(56),view=new DataView(record.buffer);view.setUint32(0,0x06064b50,true);backupPut64(view,4,44);view.setUint16(12,45,true);view.setUint16(14,45,true);backupPut64(view,24,this.entries.length);backupPut64(view,32,this.entries.length);backupPut64(view,40,directoryBytes);backupPut64(view,48,directoryOffset);await this.write(record);
        const locator=new Uint8Array(20),loc=new DataView(locator.buffer);loc.setUint32(0,0x07064b50,true);backupPut64(loc,8,recordOffset);loc.setUint32(16,1,true);await this.write(locator);
      }
      const end=new Uint8Array(22),view=new DataView(end.buffer);view.setUint32(0,0x06054b50,true);view.setUint16(8,Math.min(this.entries.length,65535),true);view.setUint16(10,Math.min(this.entries.length,65535),true);view.setUint32(12,Math.min(directoryBytes,BACKUP_ZIP32),true);view.setUint32(16,Math.min(directoryOffset,BACKUP_ZIP32),true);await this.write(end);return this.position;
    }
  }
  async function backupZipDirectory(reader,size){
    if(!Number.isSafeInteger(size)||size<22)throw Error('备份大小无效');
    const read=async(offset,length)=>{if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||offset<0||length<0||!Number.isSafeInteger(offset+length)||offset+length>size)throw Error('备份读取范围无效');const bytes=await reader(offset,length);if(!(bytes instanceof Uint8Array)||bytes.length!==length)throw Error('备份文件不完整');return bytes};
    const tailSize=Math.min(65557,size),tail=await read(size-tailSize,tailSize),endView=new DataView(tail.buffer,tail.byteOffset,tail.length);let end=-1;
    for(let at=tail.length-22;at>=0;at--)if(endView.getUint32(at,true)===0x06054b50&&at+22+endView.getUint16(at+20,true)===tail.length){end=at;break}
    if(end<0||endView.getUint16(end+4,true)||endView.getUint16(end+6,true)||endView.getUint16(end+8,true)!==endView.getUint16(end+10,true))throw Error('不是受支持的完整备份');
    let count=endView.getUint16(end+10,true),directoryBytes=endView.getUint32(end+12,true),directoryOffset=endView.getUint32(end+16,true),directoryEnd=size-tailSize+end;
    if(directoryEnd>=20){
      const locator=await read(directoryEnd-20,20),loc=new DataView(locator.buffer,locator.byteOffset,20);
      if(loc.getUint32(0,true)===0x07064b50){
        const offset=backupGet64(loc,8),record=await read(offset,56),view=new DataView(record.buffer,record.byteOffset,56);
        if(loc.getUint32(4,true)||loc.getUint32(16,true)!==1||view.getUint32(0,true)!==0x06064b50||backupGet64(view,4)<44||offset+12+backupGet64(view,4)!==directoryEnd-20||view.getUint32(16,true)||view.getUint32(20,true)||backupGet64(view,24)!==backupGet64(view,32))throw Error('ZIP64 备份目录无效');
        count=backupGet64(view,32);directoryBytes=backupGet64(view,40);directoryOffset=backupGet64(view,48);directoryEnd=offset;
      }else if(count===65535||directoryBytes===BACKUP_ZIP32||directoryOffset===BACKUP_ZIP32)throw Error('缺少 ZIP64 目录');
    }
    if(count<2||count>Math.floor(directoryBytes/46)||directoryOffset+directoryBytes!==directoryEnd)throw Error('备份目录范围无效');
    const entries=new Map(),ranges=[],decoder=new TextDecoder('utf-8',{fatal:true});let cursor=directoryOffset;
    for(let index=0;index<count;index++){
      const header=await read(cursor,46),view=new DataView(header.buffer,header.byteOffset,46);
      if(view.getUint32(0,true)!==0x02014b50||view.getUint16(8,true)&~0x800||view.getUint16(10,true)||view.getUint16(34,true))throw Error('备份条目不是未加密原件');
      const nameLength=view.getUint16(28,true),extraLength=view.getUint16(30,true),commentLength=view.getUint16(32,true),details=await read(cursor+46,nameLength+extraLength+commentLength),name=decoder.decode(details.subarray(0,nameLength));
      if(!/^(?:manifest\.json|planner\.json|assets\/[a-f0-9]{64})$/.test(name)||entries.has(name)||cursor+46+details.length>directoryEnd)throw Error('备份含未知或重复的条目');
      let packed=view.getUint32(20,true),bytes=view.getUint32(24,true),offset=view.getUint32(42,true),zip64=null;
      for(let at=nameLength;at<nameLength+extraLength;){if(at+4>nameLength+extraLength)throw Error('备份扩展字段损坏');const info=new DataView(details.buffer,details.byteOffset+at,details.length-at),length=info.getUint16(2,true);if(at+4+length>nameLength+extraLength)throw Error('备份扩展字段越界');if(info.getUint16(0,true)===1){if(zip64)throw Error('重复 ZIP64 字段');zip64=new DataView(details.buffer,details.byteOffset+at+4,length)}at+=4+length}
      let extraAt=0;const next64=()=>{if(!zip64||extraAt+8>zip64.byteLength)throw Error('ZIP64 字段不完整');const value=backupGet64(zip64,extraAt);extraAt+=8;return value};
      if(bytes===BACKUP_ZIP32)bytes=next64();if(packed===BACKUP_ZIP32)packed=next64();if(offset===BACKUP_ZIP32)offset=next64();
      if(packed!==bytes||offset>=directoryOffset)throw Error('备份文件大小或偏移无效');
      const localBytes=await read(offset,30),local=new DataView(localBytes.buffer,localBytes.byteOffset,30),localName=local.getUint16(26,true),localExtra=local.getUint16(28,true),start=offset+30+localName+localExtra,localDetails=await read(offset+30,localName+localExtra);
      if(local.getUint32(0,true)!==0x04034b50||local.getUint16(6,true)!==view.getUint16(8,true)||local.getUint16(8,true)||local.getUint32(14,true)!==view.getUint32(16,true)||decoder.decode(localDetails.subarray(0,localName))!==name||start+bytes>directoryOffset)throw Error('备份文件头与目录不一致');
      let localPacked=local.getUint32(18,true),localSize=local.getUint32(22,true);
      if(localPacked===BACKUP_ZIP32||localSize===BACKUP_ZIP32){let field=null;for(let at=localName;at<localDetails.length;){if(at+4>localDetails.length)throw Error('本地 ZIP64 字段损坏');const dv=new DataView(localDetails.buffer,localDetails.byteOffset+at,localDetails.length-at),length=dv.getUint16(2,true);if(at+4+length>localDetails.length)throw Error('本地 ZIP64 字段越界');if(dv.getUint16(0,true)===1){if(field)throw Error('重复本地 ZIP64 字段');field=new DataView(localDetails.buffer,localDetails.byteOffset+at+4,length)}at+=4+length}if(!field||field.byteLength<16)throw Error('缺少本地 ZIP64 大小');localSize=backupGet64(field,0);localPacked=backupGet64(field,8)}
      if(localPacked!==bytes||localSize!==bytes)throw Error('备份条目声明不一致');
      entries.set(name,{size:bytes,crc:view.getUint32(16,true),read:async(at,length)=>{if(at<0||length<0||at+length>bytes)throw Error('条目读取越界');return read(start+at,length)}});ranges.push({start:offset,end:start+bytes});cursor+=46+details.length;await archiveYield();
    }
    if(cursor!==directoryEnd)throw Error('备份目录尾部不一致');ranges.sort((a,b)=>a.start-b.start);for(let index=1;index<ranges.length;index++)if(ranges[index].start<ranges[index-1].end)throw Error('备份条目范围重叠');return entries;
  }
  async function backupVerifyEntry(entry,consume=null){const result=await archiveDigestSource(entry,consume);if(result.crc!==entry.crc)throw Error('备份条目 CRC 不一致');return result}
