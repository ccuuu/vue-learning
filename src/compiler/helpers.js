/* @flow */

import { emptyObject } from "shared/util";
import { parseFilters } from "./parser/filter-parser";

type Range = { start?: number, end?: number };

/* eslint-disable no-unused-vars */
export function baseWarn(msg: string, range?: Range) {
  console.error(`[Vue compiler]: ${msg}`);
}
/* eslint-enable no-unused-vars */

export function pluckModuleFunction<F: Function>(
  modules: ?Array<Object>,
  key: string
): Array<F> {
  return modules ? modules.map((m) => m[key]).filter((_) => _) : [];
}

export function addProp(
  el: ASTElement,
  name: string,
  value: string,
  range?: Range,
  dynamic?: boolean
) {
  (el.props || (el.props = [])).push(
    rangeSetItem({ name, value, dynamic }, range)
  );
  el.plain = false;
}

export function addAttr(
  el: ASTElement,
  name: string,
  value: any,
  range?: Range,
  dynamic?: boolean
) {
  const attrs = dynamic
    ? el.dynamicAttrs || (el.dynamicAttrs = [])
    : el.attrs || (el.attrs = []);
  attrs.push(rangeSetItem({ name, value, dynamic }, range));
  el.plain = false;
}

// add a raw attr (use this in preTransforms)
export function addRawAttr(
  el: ASTElement,
  name: string,
  value: any,
  range?: Range
) {
  el.attrsMap[name] = value;
  el.attrsList.push(rangeSetItem({ name, value }, range));
}

export function addDirective(
  el: ASTElement,
  name: string,
  rawName: string,
  value: string,
  arg: ?string,
  isDynamicArg: boolean,
  modifiers: ?ASTModifiers,
  range?: Range
) {
  (el.directives || (el.directives = [])).push(
    rangeSetItem(
      {
        name,
        rawName,
        value,
        arg,
        isDynamicArg,
        modifiers,
      },
      range
    )
  );
  el.plain = false;
}

function prependModifierMarker(
  symbol: string,
  name: string,
  dynamic?: boolean
): string {
  return dynamic ? `_p(${name},"${symbol}")` : symbol + name; // mark the event as captured
}

export function addHandler(
  el: ASTElement,
  name: string,
  value: string,
  modifiers: ?ASTModifiers,
  important?: boolean,
  warn?: ?Function,
  range?: Range,
  dynamic?: boolean
) {
  modifiers = modifiers || emptyObject;
  // warn prevent and passive modifier
  /* istanbul ignore if */
  if (
    process.env.NODE_ENV !== "production" &&
    warn &&
    modifiers.prevent &&
    modifiers.passive
  ) {
    warn(
      "passive and prevent can't be used together. " +
        "Passive handler can't prevent default event.",
      range
    );
  }

  // normalize click.right and click.middle since they don't actually fire
  // this is technically browser-specific, but at least for now browsers are
  // the only target envs that have right/middle clicks.
  //通过修饰符手动改写事件，只给使用者暴露出语法糖
  if (modifiers.right) {
    //如果事件是click，且添加了修饰符right，则将事件重置为contextMenu事件

    //MDN
    //任何没有被禁用的鼠标右击事件 (通过调用事件的 preventDefault() 方法)
    //将会使得 contextmenu 事件在目标元素上被触发。
    if (dynamic) {
      name = `(${name})==='click'?'contextmenu':(${name})`;
    } else if (name === "click") {
      name = "contextmenu";
      delete modifiers.right;
    }
  } else if (modifiers.middle) {
    //如果设置了middle修饰符，则自动将click事件重置为mouseup，因为浏览器并没有
    //提供滚轮click事件，只能用mouseup触发。通过mouseup的event.button可以区分
    //按下的是鼠标的哪一个按键
    if (dynamic) {
      name = `(${name})==='click'?'mouseup':(${name})`;
    } else if (name === "click") {
      name = "mouseup";
    }
  }

  // check capture modifier
  if (modifiers.capture) {
    delete modifiers.capture;
    name = prependModifierMarker("!", name, dynamic);
  }
  if (modifiers.once) {
    delete modifiers.once;
    name = prependModifierMarker("~", name, dynamic);
  }
  /* istanbul ignore if */
  if (modifiers.passive) {
    delete modifiers.passive;
    name = prependModifierMarker("&", name, dynamic);
  }

  let events;
  //如果设置了native属性，则为元素添加上nativeEvents属性，否则则使用events属性
  if (modifiers.native) {
    delete modifiers.native;
    events = el.nativeEvents || (el.nativeEvents = {});
  } else {
    events = el.events || (el.events = {});
  }

  const newHandler: any = rangeSetItem({ value: value.trim(), dynamic }, range);
  if (modifiers !== emptyObject) {
    newHandler.modifiers = modifiers;
  }

  //events对象：
  // {
  //   若只存在一个handler，则会对象，否则则为数组
  //   click:[{value:'clickHandler',dynamic:Boolean,modifiers:{...}},{...}]
  //   `_p(select,"!")`:{...}
  // }
  const handlers = events[name];
  /* istanbul ignore if */
  //无论有多少个同名事件的监听，都不会落下任何一个监听函数的执行，因此，可以在同一个
  //元素下绑定多个同名事件
  if (Array.isArray(handlers)) {
    //根据是否设置important属性决定将事件从后/前添加至events的某个name属性上
    important ? handlers.unshift(newHandler) : handlers.push(newHandler);
  } else if (handlers) {
    //如果已存在handler，则将newHandler和handler合并为数组(根据important取优先级)
    events[name] = important ? [newHandler, handlers] : [handlers, newHandler];
  } else {
    //如果此事件名还未添加事件，则：
    events[name] = newHandler;
  }
  el.plain = false;
}

export function getRawBindingAttr(el: ASTElement, name: string) {
  return (
    el.rawAttrsMap[":" + name] ||
    el.rawAttrsMap["v-bind:" + name] ||
    el.rawAttrsMap[name]
  );
}

//属性有可能是如下形式：key="abc"或者 :key="abc"
//则需要根据形式的不同，做出不同的处理。此函数就是为了做分类处理
export function getBindingAttr(
  el: ASTElement,
  name: string,
  getStatic?: boolean
): ?string {
  const dynamicValue =
    getAndRemoveAttr(el, ":" + name) || getAndRemoveAttr(el, "v-bind:" + name);
  if (dynamicValue != null) {
    //parseFilters就是为了正确处理过滤器的函数；:key="name | filterName"
    return parseFilters(dynamicValue);
    //如果没有显式的规定getStatic为false，则进入下述分支
  } else if (getStatic !== false) {
    const staticValue = getAndRemoveAttr(el, name);
    if (staticValue != null) {
      //如果存在staticValue(即普通字符串，而不是对应着某个变量)，则将其
      //做stringify处理(防止在new Function的时候被转换成变量)
      return JSON.stringify(staticValue);
    }
  }
}

// note: this only removes the attr from the Array (attrsList) so that it
// doesn't get processed by processAttrs.
// By default it does NOT remove it from the map (attrsMap) because the map is
// needed during codegen.
export function getAndRemoveAttr(
  el: ASTElement,
  name: string,
  removeFromMap?: boolean
): ?string {
  let val;
  if ((val = el.attrsMap[name]) != null) {
    const list = el.attrsList;
    for (let i = 0, l = list.length; i < l; i++) {
      if (list[i].name === name) {
        list.splice(i, 1);
        break;
      }
    }
  }
  if (removeFromMap) {
    delete el.attrsMap[name];
  }
  return val;
}

export function getAndRemoveAttrByRegex(el: ASTElement, name: RegExp) {
  const list = el.attrsList;
  for (let i = 0, l = list.length; i < l; i++) {
    const attr = list[i];
    if (name.test(attr.name)) {
      list.splice(i, 1);
      return attr;
    }
  }
}

function rangeSetItem(item: any, range?: { start?: number, end?: number }) {
  if (range) {
    if (range.start != null) {
      item.start = range.start;
    }
    if (range.end != null) {
      item.end = range.end;
    }
  }
  return item;
}
