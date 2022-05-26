/* @flow */

import { remove, isDef } from "shared/util";

export default {
  create(_: any, vnode: VNodeWithData) {
    registerRef(vnode);
  },
  update(oldVnode: VNodeWithData, vnode: VNodeWithData) {
    if (oldVnode.data.ref !== vnode.data.ref) {
      registerRef(oldVnode, true);
      registerRef(vnode);
    }
  },
  destroy(vnode: VNodeWithData) {
    registerRef(vnode, true);
  },
};

export function registerRef(vnode: VNodeWithData, isRemoval: ?boolean) {
  const key = vnode.data.ref;
  //如果没有定义ref，则直接返回
  if (!isDef(key)) return;
  //vm为当前vnode所在的实例( vnode中的context即对应vnode的父实例)
  const vm = vnode.context;
  //ref为当前节点对应的实例，或者所对应的DOM元素
  const ref = vnode.componentInstance || vnode.elm;
  //refs为父实例的$refs
  const refs = vm.$refs;
  //如果执行的是删除操作
  if (isRemoval) {
    //从父实例中移除该实例的ref
    if (Array.isArray(refs[key])) {
      remove(refs[key], ref);
    } else if (refs[key] === ref) {
      refs[key] = undefined;
    }
    //如果不是移除，则应该是新增操作（更新操作实际上会调用两次registerRef，一次移除，一次新增）
  } else {
    if (vnode.data.refInFor) {
      if (!Array.isArray(refs[key])) {
        refs[key] = [ref];
      } else if (refs[key].indexOf(ref) < 0) {
        // $flow-disable-line
        refs[key].push(ref);
      }
    } else {
      refs[key] = ref;
    }
  }
}
