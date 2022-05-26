/* @flow */

import { isDef, isObject } from "shared/util";

export function genClassForVnode(vnode: VNodeWithData): string {
  //data为当前节点的data
  let data = vnode.data;
  let parentNode = vnode;
  //children为子组件实例中对应的根节点
  let childNode = vnode;
  //向下找
  while (isDef(childNode.componentInstance)) {
    childNode = childNode.componentInstance._vnode;
    if (childNode && childNode.data) {
      //将每一个占位vnode的data中的class都给合并
      data = mergeClassData(childNode.data, data);
    }
  }
  //向上找
  while (isDef((parentNode = parentNode.parent))) {
    //将父组件实例中的class也合并在一起
    if (parentNode && parentNode.data) {
      data = mergeClassData(data, parentNode.data);
    }
  }
  //最终的返回形式为一个字符串。“a b c d”
  return renderClass(data.staticClass, data.class);
}

function mergeClassData(
  child: VNodeData,
  parent: VNodeData
): {
  staticClass: string,
  class: any,
} {
  return {
    staticClass: concat(child.staticClass, parent.staticClass),
    class: isDef(child.class) ? [child.class, parent.class] : parent.class,
  };
}

export function renderClass(staticClass: ?string, dynamicClass: any): string {
  if (isDef(staticClass) || isDef(dynamicClass)) {
    return concat(staticClass, stringifyClass(dynamicClass));
  }
  /* istanbul ignore next */
  return "";
}

export function concat(a: ?string, b: ?string): string {
  return a ? (b ? a + " " + b : a) : b || "";
}

//针对于class的不同形式（数组，对象），做格式化处理，最终都拼接为字符串 “a b c”的形式
export function stringifyClass(value: any): string {
  if (Array.isArray(value)) {
    return stringifyArray(value);
  }
  if (isObject(value)) {
    return stringifyObject(value);
  }
  if (typeof value === "string") {
    return value;
  }
  /* istanbul ignore next */
  return "";
}

function stringifyArray(value: Array<any>): string {
  let res = "";
  let stringified;
  for (let i = 0, l = value.length; i < l; i++) {
    if (isDef((stringified = stringifyClass(value[i]))) && stringified !== "") {
      if (res) res += " ";
      res += stringified;
    }
  }
  return res;
}

function stringifyObject(value: Object): string {
  let res = "";
  for (const key in value) {
    if (value[key]) {
      if (res) res += " ";
      res += key;
    }
  }
  return res;
}
