// Pure routing policy, also consumed by the opt-in offline evaluation runner.
function assistantRouteIntent(input,pending=false){
  const text=String(input||'').normalize('NFKC').trim();
  if(/联网|上网|网页搜索|全网|网上查|web search/i.test(text)&&!/(?:不用|不要|无需|不必|不想|不需要|别)[^，。！？\n]{0,8}(?:联网|上网|网页搜索|全网|网上查)/.test(text))return 'search_web';
  if(pending&&/^(?:算了|取消|不用了|重新开始)[。！!\s]*$/.test(text))return 'cancel_pending';
  if(/调课|换课|互换|对调|节.*(?:调到|改到|换到)|(?:把|将).*(?:课|节).*(?:调到|改到|换到)/.test(text))return 'reschedule';
  if(/^(?:添加|新增|创建|记录|记住|保存|修改|更新|删除|完成).*(?:需要什么|什么步骤|是什么意思|是什么|怎么|如何|为什么)/.test(text)&&!/[：:]/.test(text))return 'model';
  const question=/是什么|什么意思|什么时候|几点|多少|几项|怎么|怎样|如何|为什么|哪里|能否|是否|[?？]|吗\s*$/.test(text),explicit=/^(?:(?:请|麻烦)(?:你)?\s*)?(?:(?:帮我|替我|给我|我想要?|我要)\s*)?(?:添加|新增|创建|安排|提醒我|记录|记下|记住|记一下|新建|保存|修改|更新|删除|完成)/.test(text);
  if(question&&!explicit){if(/日程|课程|有课|安排|空闲|有空|冲突|踢球|足球/.test(text))return 'get_schedule';if(/笔记|备忘录|记录|资料|搜索|查找/.test(text))return 'search_notes';return 'model'}
  if(/^(?:(?:请|麻烦)(?:你)?\s*)?(?:(?:帮我|替我|给我|我想要?|我要)\s*)?(?:记下(?:来)?|记住|记一下|记录(?:一下)?|(?:新建|保存|添加)(?:一条|一个)?(?:笔记|备忘录))[\s：:，,]*/.test(text))return 'create_note';
  if(/^(?:查找|搜索|查一下|找一下|找出|打开)/.test(text))return 'search_notes';
  if(pending&&!explicit&&text.length<=100&&/^(?:是|在|改成|改为|就|那就)?\s*(?:(?:下下|上上|本|这|下|上)?周|\d|[零一二三四五六七八九十两]+[点时月]|今天|明天|明晚|后天|上午|下午|晚上|早上|中午|凌晨)/.test(text))return 'continue_event';
  if(/^(?:修改|更新|删除|完成|把|将)|^(?:帮我|请你?|替我)(?:修改|更新|删除|完成|把|将)/.test(text))return 'model';
  if(explicit||/\bddl\b|截止|交作业|交报告|交论文|提交|考试|期末/i.test(text))return /作业|报告|论文|ddl|截止|提交|考试|期末|会议|开会|汇报/i.test(text)?'create_event':'create_todo';
  return 'model';
}
if(typeof module!=='undefined'&&module.exports)module.exports={assistantRouteIntent};
