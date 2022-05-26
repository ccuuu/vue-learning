/* @flow */

import { extend, warn, isObject } from "core/util/index";

/**
 * Runtime helper for rendering <slot>
 */
export function renderSlot(
  name: string,
  fallbackRender: ?((() => Array<VNode>) | Array<VNode>),
  props: ?Object,
  bindObject: ?Object
): ?Array<VNode> {
  const scopedSlotFn = this.$scopedSlots[name];
  let nodes;
  if (scopedSlotFn) {
    // scoped slot
    props = props || {};
    //将v-bind="{name:name,age:age}"的内部属性和props进行合并
    if (bindObject) {
      if (process.env.NODE_ENV !== "production" && !isObject(bindObject)) {
        warn("slot v-bind without argument expects an Object", this);
      }

      props = extend(extend({}, bindObject), props);
    }
    //如果父组件中使用了该作用域插槽，则使用scopedSlotFn(props)作为node，否则用自身的
    //children作为nodes，这就是为什么slot元素的内容可以作为默认显示的原因
    nodes =
      scopedSlotFn(props) ||
      (typeof fallbackRender === "function"
        ? fallbackRender()
        : fallbackRender);
  } else {
    //如果没有使用作用域插槽，则同样的逻辑去静态插槽里面取
    nodes =
      this.$slots[name] ||
      (typeof fallbackRender === "function"
        ? fallbackRender()
        : fallbackRender);
  }
  //如果属性中设置了slot属性，也就是该插槽同时作为其他子元素的插槽，则将此作为生成函数
  //的slot属性，并包裹已成template
  const target = props && props.slot;
  if (target) {
    return this.$createElement("template", { slot: target }, nodes);
  } else {
    return nodes;
  }
}
