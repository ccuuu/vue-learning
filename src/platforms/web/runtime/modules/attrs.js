/* @flow */

import { isIE, isIE9, isEdge } from "core/util/env";

import { extend, isDef, isUndef } from "shared/util";

import {
  isXlink,
  xlinkNS,
  getXlinkProp,
  isBooleanAttr,
  isEnumeratedAttr,
  isFalsyAttrValue,
  convertEnumeratedValue,
} from "web/util/index";
//isBooleanAttr = makeMap(
//   'allowfullscreen,async,autofocus,autoplay,checked,compact,controls,declare,' +
//   'default,defaultchecked,defaultmuted,defaultselected,defer,disabled,' +
//   'enabled,formnovalidate,hidden,indeterminate,inert,ismap,itemscope,loop,multiple,' +
//   'muted,nohref,noresize,noshade,novalidate,nowrap,open,pauseonexit,readonly,' +
//   'required,reversed,scoped,seamless,selected,sortable,' +
//   'truespeed,typemustmatch,visible'
// )

//isEnumeratedAttr = makeMap('contenteditable,draggable,spellcheck')

//isFalsyAttrValue value为null或false

function updateAttrs(oldVnode: VNodeWithData, vnode: VNodeWithData) {
  const opts = vnode.componentOptions;
  //如果Vue的options中声明了inheritAttrs为false，则直接返回
  if (isDef(opts) && opts.Ctor.options.inheritAttrs === false) {
    return;
  }
  //如果old和new没有有定义 attrs，则返回
  if (isUndef(oldVnode.data.attrs) && isUndef(vnode.data.attrs)) {
    return;
  }
  let key, cur, old;
  const elm = vnode.elm;
  const oldAttrs = oldVnode.data.attrs || {};
  let attrs: any = vnode.data.attrs || {};
  // clone observed objects, as the user probably wants to mutate it
  //如果 attrs属性是响应式对象，则拷贝一份非相应式对象添加
  if (isDef(attrs.__ob__)) {
    attrs = vnode.data.attrs = extend({}, attrs);
  }

  //先循环new attrs。若old中不存在或者没有，则setAttribute
  for (key in attrs) {
    cur = attrs[key];
    old = oldAttrs[key];
    //如果新老不相同，则重新赋值为最新的
    if (old !== cur) {
      setAttr(elm, key, cur, vnode.data.pre);
    }
  }
  // #4391: in IE9, setting type can reset value for input[type=radio]
  // #6666: IE/Edge forces progress value down to 1 before setting a max
  /* istanbul ignore if */
  if ((isIE || isEdge) && attrs.value !== oldAttrs.value) {
    setAttr(elm, "value", attrs.value);
  }

  //循环old attrs 如果new中不存在，则removeAttribute
  for (key in oldAttrs) {
    if (isUndef(attrs[key])) {
      if (isXlink(key)) {
        elm.removeAttributeNS(xlinkNS, getXlinkProp(key));
      } else if (!isEnumeratedAttr(key)) {
        elm.removeAttribute(key);
      }
    }
  }
}

//对不同的属性做区别处理。
function setAttr(el: Element, key: string, value: any, isInPre: any) {
  if (isInPre || el.tagName.indexOf("-") > -1) {
    baseSetAttr(el, key, value);

    //也就是 单独出现的属性，其值为Boolean。如 required，disabled等
  } else if (isBooleanAttr(key)) {
    // set attribute for blank value
    // e.g. <option disabled>Select one</option>
    //如果对于单独出现的属性，值为null或者false的时候，直接移除该属性
    if (isFalsyAttrValue(value)) {
      el.removeAttribute(key);
    } else {
      //否则，通过 setAttribute 设置属性
      // technically allowfullscreen is a boolean attribute for <iframe>,
      // but Flash expects a value of "true" when used on <embed> tag
      value =
        key === "allowfullscreen" && el.tagName === "EMBED" ? "true" : key;
      el.setAttribute(key, value);
    }
    //isEnumeratedAttr: contenteditable,draggable,spellcheck
  } else if (isEnumeratedAttr(key)) {
    //添加属性
    el.setAttribute(key, convertEnumeratedValue(key, value));
  } else if (isXlink(key)) {
    if (isFalsyAttrValue(value)) {
      el.removeAttributeNS(xlinkNS, getXlinkProp(key));
    } else {
      el.setAttributeNS(xlinkNS, key, value);
    }
  } else {
    baseSetAttr(el, key, value);
  }
}

function baseSetAttr(el, key, value) {
  //如果属性为false或null，则直接移除该属性
  if (isFalsyAttrValue(value)) {
    el.removeAttribute(key);
  } else {
    // #7138: IE10 & 11 fires input event when setting placeholder on
    // <textarea>... block the first input event and remove the blocker
    // immediately.
    /* istanbul ignore if */
    if (
      isIE &&
      !isIE9 &&
      el.tagName === "TEXTAREA" &&
      key === "placeholder" &&
      value !== "" &&
      !el.__ieph
    ) {
      const blocker = (e) => {
        e.stopImmediatePropagation();
        el.removeEventListener("input", blocker);
      };
      el.addEventListener("input", blocker);
      // $flow-disable-line
      el.__ieph = true; /* IE placeholder patched */
    }
    //通过 setAttribute设置值
    el.setAttribute(key, value);
  }
}

export default {
  create: updateAttrs,
  update: updateAttrs,
};
