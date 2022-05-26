/* @flow */

import { cached, extend, toObject } from "shared/util";

export const parseStyleText = cached(function (cssText) {
  const res = {};
  //匹配括号外的；，如下：则不会进入匹配
  //background: url(www.xxx.com?a=1&amp;copy=3)
  const listDelimiter = /;(?![^(]*\))/g;
  const propertyDelimiter = /:(.+)/;
  //首先，将属性值以非括号内的";"分割
  cssText.split(listDelimiter).forEach(function (item) {
    if (item) {
      //再将属性值以":"分割
      const tmp = item.split(propertyDelimiter);
      tmp.length > 1 && (res[tmp[0].trim()] = tmp[1].trim());
    }
  });
  //style="color:red;border:none"
  //转换为：
  // res = {
  //  color:'red',
  //  border:'none'
  //}
  return res;
});

// merge static and dynamic style data on the same vnode
function normalizeStyleData(data: VNodeData): ?Object {
  const style = normalizeStyleBinding(data.style);
  // static style is pre-processed into an object during compilation
  // and is always a fresh object, so it's safe to merge into it
  return data.staticStyle ? extend(data.staticStyle, style) : style;
}

// normalize possible array / string values into Object
export function normalizeStyleBinding(bindingStyle: any): ?Object {
  if (Array.isArray(bindingStyle)) {
    return toObject(bindingStyle);
  }
  if (typeof bindingStyle === "string") {
    return parseStyleText(bindingStyle);
  }
  return bindingStyle;
}

/**
 * parent component style should be after child's
 * so that parent component's style could override it
 */
export function getStyle(vnode: VNodeWithData, checkChild: boolean): Object {
  const res = {};
  let styleData;

  //这里的处理与 class的处理类似。向上，向下去找到所有占位vNode的style，
  //并且合并为当前节点的style

  if (checkChild) {
    let childNode = vnode;
    while (childNode.componentInstance) {
      childNode = childNode.componentInstance._vnode;
      if (
        childNode &&
        childNode.data &&
        (styleData = normalizeStyleData(childNode.data))
      ) {
        extend(res, styleData);
      }
    }
  }

  if ((styleData = normalizeStyleData(vnode.data))) {
    extend(res, styleData);
  }

  let parentNode = vnode;
  while ((parentNode = parentNode.parent)) {
    if (parentNode.data && (styleData = normalizeStyleData(parentNode.data))) {
      extend(res, styleData);
    }
  }
  return res;
}
