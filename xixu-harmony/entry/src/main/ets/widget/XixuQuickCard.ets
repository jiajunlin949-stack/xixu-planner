@Entry
@Component
struct XixuQuickCard {
  build() {
    Column({ space: 10 }) {
      Row() {
        Column({ space: 2 }) {
          Text('汐序').fontSize(20).fontWeight(FontWeight.Bold).fontColor('#244650')
          Text('先记下来，之后再安排。').fontSize(12).fontColor('#68818A')
        }.alignItems(HorizontalAlign.Start)
      }.width('100%').justifyContent(FlexAlign.Start)

      FormLink({ action: 'router', abilityName: 'EntryAbility', params: { route: 'task' } }) {
        Row({ space: 8 }) {
          Text('+').fontSize(22).fontWeight(FontWeight.Medium).fontColor('#FFFFFF')
          Text('添加事项').fontSize(15).fontWeight(FontWeight.Medium).fontColor('#FFFFFF')
        }.width('100%').height(48).justifyContent(FlexAlign.Center).backgroundColor('#4B7D8B').borderRadius(16)
      }

      FormLink({ action: 'router', abilityName: 'EntryAbility', params: { route: 'memory' } }) {
        Row({ space: 8 }) {
          Text('✦').fontSize(16).fontColor('#4B7D8B')
          Text('记录一个想法').fontSize(15).fontWeight(FontWeight.Medium).fontColor('#315F6A')
        }.width('100%').height(42).justifyContent(FlexAlign.Center).backgroundColor('#E4F0F1').borderRadius(14)
      }
    }
    .width('100%').height('100%').padding(16).backgroundColor('#F6FBFB')
  }
}
