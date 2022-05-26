/* @flow */

import { isDef, isUndef } from "shared/util";

import { concat, stringifyClass, genClassForVnode } from "web/util/index";

function updateClass(oldVnode: any, vnode: any) {
  const el = vnode.elm;
  const data: VNodeData = vnode.data;
  const oldData: VNodeData = oldVnode.data;
  //如果old 和 new 都不存在 class相关的数据，则直接return
  if (
    isUndef(data.staticClass) &&
    isUndef(data.class) &&
    (isUndef(oldData) ||
      (isUndef(oldData.staticClass) && isUndef(oldData.class)))
  ) {
    return;
  }

  //对vnode中 父级占位vnode(对应的是实例，而不是DOM的vnode)，后代占位vnode 所有的
  //class都给统一合并，并且最终的返回形式为一个classNames字符串
  let cls = genClassForVnode(vnode);

  // handle transition classes
  // 这是与 transition 相关的内容
  const transitionClass = el._transitionClasses;
  if (isDef(transitionClass)) {
    cls = concat(cls, stringifyClass(transitionClass));
  }

  // set the class
  //如果当前classNames不等于上一次的classNames，则重新setAttribute
  if (cls !== el._prevClass) {
    el.setAttribute("class", cls);
    //将设置的class赋值给_prevClass，供下一次对比使用
    el._prevClass = cls;
  }
}

export default {
  create: updateClass,
  update: updateClass,
};
