/* @flow */

import { isDef, isUndef, extend, toNumber } from "shared/util";
import { isSVG } from "web/util/index";

let svgContainer;

//关于为什么不使用 setAttribute来处理这些属性：
//setAttribute可以实现添加任意存在，或者本身不属于DOM元素属性的任意属性。
//所以无论是  id ，或者 fantasy 这样的自定义属性，都可以通过setAttribute
//添加。但是，只有 id 这样的原生属性 才可以通过访问对象属性的方式( target.id )
//访问和修改。
//同时，setAttribute存在着一个限制：setAttribute(key,value)的value总会被
//转换成 string 的形式。也就是说，如果你需要设置 checked 属性 为 true，但是
//通过setAttribute会最终设置上的为一个字符串。

//因此，对于这样的属性，我能应该直接通过访问器的形式去修改，而非setAttribute
function updateDOMProps(oldVnode: VNodeWithData, vnode: VNodeWithData) {
  if (isUndef(oldVnode.data.domProps) && isUndef(vnode.data.domProps)) {
    return;
  }
  let key, cur;
  const elm: any = vnode.elm;
  const oldProps = oldVnode.data.domProps || {};
  let props = vnode.data.domProps || {};
  // clone observed objects, as the user probably wants to mutate it
  if (isDef(props.__ob__)) {
    props = vnode.data.domProps = extend({}, props);
  }

  //先遍历old domProps，如果在new中不存在，则赋值为空字符串
  for (key in oldProps) {
    if (!(key in props)) {
      elm[key] = "";
    }
  }

  for (key in props) {
    cur = props[key];
    // ignore children if the node has textContent or innerHTML,
    // as these will throw away existing DOM nodes and cause removal errors
    // on subsequent patches (#3360)

    //在进行v-directives codeGenerate的时候，会将 v-text和 v-html 分别解析为
    //两个 domProps属性： textContent 和 innerHTML。
    //而在这里，就是将 带有两个属性的节点 的后代做忽略处理
    if (key === "textContent" || key === "innerHTML") {
      if (vnode.children) vnode.children.length = 0;
      if (cur === oldProps[key]) continue;
      // #6601 work around Chrome version <= 55 bug where single textNode
      // replaced by innerHTML/textContent retains its parentNode property
      if (elm.childNodes.length === 1) {
        elm.removeChild(elm.childNodes[0]);
      }
    }

    //  value  对应的就是解析 v-model 指令的时候自动添加的 value属性(也或许是自己添加的)
    if (key === "value" && elm.tagName !== "PROGRESS") {
      // store value as _value as well since
      // non-string values will be stringified
      elm._value = cur;
      // avoid resetting cursor position when value is the same
      const strCur = isUndef(cur) ? "" : String(cur);
      //检测是否需要重置value
      if (shouldUpdateValue(elm, strCur)) {
        elm.value = strCur;
      }
    } else if (
      key === "innerHTML" &&
      isSVG(elm.tagName) &&
      isUndef(elm.innerHTML)
    ) {
      // IE doesn't support innerHTML for SVG elements
      svgContainer = svgContainer || document.createElement("div");
      svgContainer.innerHTML = `<svg>${cur}</svg>`;
      const svg = svgContainer.firstChild;
      //我也不知道为什么要写的这么骚。
      //就是一个清空elm元素，然后将svg的元素插入的过程

      //首先清空elm子元素
      while (elm.firstChild) {
        elm.removeChild(elm.firstChild);
      }
      //将svg中的元素从头至尾全部插入elm之后
      while (svg.firstChild) {
        elm.appendChild(svg.firstChild);
      }
    } else if (
      // skip the update if old and new VDOM state is the same.
      // `value` is handled separately because the DOM value may be temporarily
      // out of sync with VDOM state due to focus, composition and modifiers.
      // This  #4521 by skipping the unnecessary `checked` update.
      cur !== oldProps[key]
    ) {
      // some property updates can throw
      // e.g. `value` on <progress> w/ non-finite value
      //若不满足上述几种情况，发生改变，则直接赋值
      try {
        elm[key] = cur;
      } catch (e) {}
    }
  }
}

// check platforms/web/util/attrs.js acceptValue
type acceptValueElm = HTMLInputElement | HTMLSelectElement | HTMLOptionElement;

function shouldUpdateValue(elm: acceptValueElm, checkVal: string): boolean {
  return (
    //输入框没有正在输入
    !elm.composing &&
    (elm.tagName === "OPTION" ||
      //元素没有获取焦点，且value有变化
      isNotInFocusAndDirty(elm, checkVal) ||
      //再通过修饰符转换之后，value发生了变化
      isDirtyWithModifiers(elm, checkVal))
  );
}

//元素没有获取焦点，且value有变化
function isNotInFocusAndDirty(elm: acceptValueElm, checkVal: string): boolean {
  // return true when textbox (.number and .trim) loses focus and its value is
  // not equal to the updated value
  let notInFocus = true;
  // #6157
  // work around IE bug when accessing document.activeElement in an iframe
  try {
    notInFocus = document.activeElement !== elm;
  } catch (e) {}
  return notInFocus && elm.value !== checkVal;
}

//再通过修饰符转换之后，value是否发生了变化
function isDirtyWithModifiers(elm: any, newVal: string): boolean {
  const value = elm.value;
  const modifiers = elm._vModifiers; // injected by v-model runtime
  if (isDef(modifiers)) {
    if (modifiers.number) {
      return toNumber(value) !== toNumber(newVal);
    }
    if (modifiers.trim) {
      return value.trim() !== newVal.trim();
    }
  }
  return value !== newVal;
}

export default {
  create: updateDOMProps,
  update: updateDOMProps,
};
