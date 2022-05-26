/* @flow */

import { warn, extend, isPlainObject } from "core/util/index";

export function bindObjectListeners(data: any, value: any): VNodeData {
  //value即为 v-on="{click:handler,mousemove:moveHandler}" 的value
  if (value) {
    //v-on语法支支持绑定对象：{click:handler,mousemove:moveHandler}
    if (!isPlainObject(value)) {
      process.env.NODE_ENV !== "production" &&
        warn("v-on without argument expects an Object value", this);
    } else {
      //只会从on中取事件，因为v-on的语法不支持修饰符，也就不会存在nativeOn
      const on = (data.on = data.on ? extend({}, data.on) : {});
      //如果某个事件被v-on: 或 @ 也绑定过 ，则将其合并，否则做赋值操作，如：
      //<button @click="handler" v-on="{ click: doThis, mouseup: doThat }"></button>
      //则 on.click = [handler, doThis]; on.mouseup = doThat
      for (const key in value) {
        const existing = on[key];
        const ours = value[key];
        on[key] = existing ? [].concat(existing, ours) : ours;
      }
    }
  }
  return data;
}
