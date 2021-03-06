/* @flow */

import VNode, { createTextVNode } from "core/vdom/vnode";
import { isFalse, isTrue, isDef, isUndef, isPrimitive } from "shared/util";

// The template compiler attempts to minimize the need for normalization by
// statically analyzing the template at compile time.
//
// For plain HTML markup, normalization can be completely skipped because the
// generated render function is guaranteed to return Array<VNode>. There are
// two cases where extra normalization is needed:

// 1. When the children contains components - because a functional component
// may return an Array instead of a single root. In this case, just a simple
// normalization is needed - if any child is an Array, we flatten the whole
// thing with Array.prototype.concat. It is guaranteed to be only 1-level deep
// because functional components already normalize their own children.
export function simpleNormalizeChildren(children: any) {
  for (let i = 0; i < children.length; i++) {
    if (Array.isArray(children[i])) {
      return Array.prototype.concat.apply([], children);
    }
  }
  return children;
}

// 2. When the children contains constructs that always generated nested Arrays,
// e.g. <template>, <slot>, v-for, or when the children is provided by user
// with hand-written render functions / JSX. In such cases a full normalization
// is needed to cater to all possible types of children values.
export function normalizeChildren(children: any): ?Array<VNode> {
  return isPrimitive(children)
    ? [createTextVNode(children)]
    : Array.isArray(children)
    ? normalizeArrayChildren(children)
    : undefined;
}

function isTextNode(node): boolean {
  return isDef(node) && isDef(node.text) && isFalse(node.isComment);
}

function normalizeArrayChildren(
  children: any,
  nestedIndex?: string
): Array<VNode> {
  const res = [];
  let i, c, lastIndex, last;
  for (i = 0; i < children.length; i++) {
    c = children[i];
    if (isUndef(c) || typeof c === "boolean") continue;
    lastIndex = res.length - 1;
    last = res[lastIndex];
    //  nested
    if (Array.isArray(c)) {
      if (c.length > 0) {
        //nestedIndex会最终变为   1_2_3的形式，其中，从前往后以此为在某个数组的index
        c = normalizeArrayChildren(c, `${nestedIndex || ""}_${i}`);
        // merge adjacent text nodes
        //如果递归生成的c[0]为文本，且最后一个节点也为文本节点，则将其合并
        if (isTextNode(c[0]) && isTextNode(last)) {
          res[lastIndex] = createTextVNode(last.text + (c[0]: any).text);
          c.shift();
        }
        res.push.apply(res, c);
      }
      //如果子节点是基本类型
      //这种情况只存在于自己写的render，在第三个参数中使用了primitive。因为
      //从template解析的render已经处理过了primitive，包装成了只有文本的vNode
    } else if (isPrimitive(c)) {
      //如果最后一个节点为文本vNode
      if (isTextNode(last)) {
        // merge adjacent text nodes
        // this is necessary for SSR hydration because text nodes are
        // essentially merged when rendered to HTML strings
        //则将此基本类型的数据添加至最后一个文本节点当中
        res[lastIndex] = createTextVNode(last.text + c);
      } else if (c !== "") {
        // convert primitive to vnode
        //如果最后一个node不是文本vNode，则将其自己生成一个文本vNode，并添加

        res.push(createTextVNode(c));
      }
    } else {
      //如果当前节点为文本节点，且最后一个节点也为文本节点，则将其合并至末尾的
      //文本节点处
      if (isTextNode(c) && isTextNode(last)) {
        // merge adjacent text nodes
        res[lastIndex] = createTextVNode(last.text + c.text);
      } else {
        // default key for nested array children (likely generated by v-for)
        //符合下述条件，则为节点默认生成一个key

        //nestedIndex为处理children中数组的时候生成的。
        //如果
        //当前的处理节点的children如果是一个数组，且其是_isVList(该属性在
        //generate中调用的renderList函数中添加，对应的是v-for指令)。

        //也就意味着v-for没有指定key的话，则其会自动生成一个key。
        if (
          isTrue(children._isVList) &&
          isDef(c.tag) &&
          isUndef(c.key) &&
          isDef(nestedIndex)
        ) {
          c.key = `__vlist${nestedIndex}_${i}__`;
        }
        res.push(c);
      }
    }
  }
  return res;
}
