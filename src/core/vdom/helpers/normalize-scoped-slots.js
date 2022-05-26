/* @flow */

import { def } from "core/util/lang";
import { normalizeChildren } from "core/vdom/helpers/normalize-children";
import { emptyObject } from "shared/util";
import { isAsyncPlaceholder } from "./is-async-placeholder";

export function normalizeScopedSlots(
  slots: { [key: string]: Function } | void,
  normalSlots: { [key: string]: Array<VNode> },
  prevSlots?: { [key: string]: Function } | void
): any {
  //三个参数的分析：
  //slots，即 当前实例data中的scopedSlots属性
  //normalSlots，普通插槽，在created之前就已经初始化完成
  //prevSlots，当前实例的$slotScopes。存在这个属性，也就意味着该组件在之前的
  //某个时间点已经编译过了。
  let res;
  //hasNormalSlots是否存在普通插槽
  const hasNormalSlots = Object.keys(normalSlots).length > 0;
  const isStable = slots ? !!slots.$stable : !hasNormalSlots;
  const key = slots && slots.$key;
  if (!slots) {
    res = {};
  } else if (slots._normalized) {
    // fast path 1: child component re-render only, parent did not change
    //为了子组件重新渲染的时候父组件不用重新执行normalize操作
    return slots._normalized;
  } else if (
    isStable &&
    prevSlots &&
    prevSlots !== emptyObject &&
    key === prevSlots.$key &&
    !hasNormalSlots &&
    !prevSlots.$hasNormal
  ) {
    // fast path 2: stable scoped slots w/ no normal slots to proxy,
    // only need to normalize once
    return prevSlots;
  } else {
    res = {};
    for (const key in slots) {
      if (slots[key] && key[0] !== "$") {
        res[key] = normalizeScopedSlot(normalSlots, key, slots[key]);
      }
    }
  }
  // expose normal slots on scopedSlots

  //将所有非作用域插槽也添加至$slotScopes上
  for (const key in normalSlots) {
    if (!(key in res)) {
      res[key] = proxyNormalSlot(normalSlots, key);
    }
  }
  // avoriaz seems to mock a non-extensible $scopedSlots object
  // and when that is passed down this would cause an error
  if (slots && Object.isExtensible(slots)) {
    (slots: any)._normalized = res;
  }
  def(res, "$stable", isStable);
  def(res, "$key", key);
  def(res, "$hasNormal", hasNormalSlots);
  return res;
}

//此处就是为了规范化每一个slotScopes，包装其返回值
function normalizeScopedSlot(normalSlots, key, fn) {
  const normalized = function () {
    let res = arguments.length ? fn.apply(null, arguments) : fn({});
    res =
      res && typeof res === "object" && !Array.isArray(res)
        ? [res] // single vnode
        : normalizeChildren(res);
    let vnode: ?VNode = res && res[0];
    return res &&
      (!vnode ||
        (res.length === 1 && vnode.isComment && !isAsyncPlaceholder(vnode))) // #9658, #10391
      ? undefined
      : res;
  };
  // this is a slot using the new v-slot syntax without scope. although it is
  // compiled as a scoped slot, render fn users would expect it to be present
  // on this.$slots because the usage is semantically a normal slot.
  //如果函数上存在proxy属性( 针对的就是非作用域插槽的 v-slot )
  //则还会将其代理到normalSlots(普通插槽，即$slots)
  if (fn.proxy) {
    Object.defineProperty(normalSlots, key, {
      get: normalized,
      enumerable: true,
      configurable: true,
    });
  }
  return normalized;
}

function proxyNormalSlot(slots, key) {
  return () => slots[key];
}
