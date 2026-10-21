import { formBindingData, FormExtensionAbility, formInfo } from '@kit.FormKit';
import { Want } from '@kit.AbilityKit';

export default class XixuFormAbility extends FormExtensionAbility {
  onAddForm(_want: Want) {
    return formBindingData.createFormBindingData({});
  }

  onAcquireFormState(_want: Want) {
    return formInfo.FormState.READY;
  }
}
