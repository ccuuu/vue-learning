/* @flow */

import { isDef, isUndef } from "shared/util";
import { updateListeners } from "core/vdom/helpers/index";
import { isIE, isFF, supportsPassive, isUsingMicroTask } from "core/util/index";
import {
  RANGE_TOKEN,
  CHECKBOX_RADIO_TOKEN,
} from "web/compiler/directives/model";
import { currentFlushTimestamp } from "core/observer/scheduler";
import { emptyNode } from "core/vdom/patch";

// normalize v-model event tokens that can only be determined at runtime.
// it's important to place the event as the first in the array because
// the whole point is ensuring the v-model callback gets called before
// user-attached handlers.
function normalizeEvents(on) {
  /* istanbul ignore if */
  //为了处理  input type 为 range 的情况。在生成on属性的时候，会将input的type为
  //range的事件名 命名为RANGE_TOKEN，就是为了在此做区别处理。
  if (isDef(on[RANGE_TOKEN])) {
    // IE input[type=range] only supports `change` event
    //如果是IE，则采用change事件；如果是input，则采用input事件。
    const event = isIE ? "change" : "input";
    //合并事件，并删除 RANGE_TOKEN 事件
    on[event] = [].concat(on[RANGE_TOKEN], on[event] || []);
    delete on[RANGE_TOKEN];
  }
  // This was originally intended to fix #4521 but no longer necessary
  // after 2.5. Keeping it for backwards compat with generated code from < 2.4
  /* istanbul ignore if */

  //这是一段用于修复某些bug，但是现在无用的代码。
  if (isDef(on[CHECKBOX_RADIO_TOKEN])) {
    on.change = [].concat(on[CHECKBOX_RADIO_TOKEN], on.change || []);
    delete on[CHECKBOX_RADIO_TOKEN];
  }
}

let target: any;

function createOnceHandler(event, handler, capture) {
  //同样利用闭包
  const _target = target; // save current target element in closure
  return function onceHandler() {
    //用apply调用该函数。若返回值不为null，则remove
    const res = handler.apply(null, arguments);
    if (res !== null) {
      remove(event, onceHandler, capture, _target);
    }
  };
}

// #9446: Firefox <= 53 (in particular, ESR 52) has incorrect Event.timeStamp
// implementation and does not fire microtasks in between event propagation, so
// safe to exclude.
const useMicrotaskFix = isUsingMicroTask && !(isFF && Number(isFF[1]) <= 53);

function add(
  name: string,
  handler: Function,
  capture: boolean,
  passive: boolean
) {
  // async edge case #6566: inner click event triggers patch, event handler
  // attached to outer element during patch, and triggered again. This
  // happens because browsers fire microtask ticks between event propagation.
  // the solution is simple: we save the timestamp when a handler is attached,
  // and the handler would only fire if the event passed to it was fired
  // AFTER it was attached.
  if (useMicrotaskFix) {
    const attachedTimestamp = currentFlushTimestamp;
    const original = handler;
    handler = original._wrapper = function (e) {
      if (
        // no bubbling, should always fire.
        // this is just a safety net in case event.timeStamp is unreliable in
        // certain weird environments...
        e.target === e.currentTarget ||
        // event is fired after handler attachment

        //timeStamp: 返回事件发生时的时间戳
        e.timeStamp >= attachedTimestamp ||
        // bail for environments that have buggy event.timeStamp implementations
        // #9462 iOS 9 bug: event.timeStamp is 0 after history.pushState
        // #9681 QtWebEngine event.timeStamp is negative value
        e.timeStamp <= 0 ||
        // #9448 bail if event is fired in another document in a multi-page
        // electron/nw.js app, since event.timeStamp will be using a different
        // starting reference
        e.target.ownerDocument !== document
      ) {
        return original.apply(this, arguments);
      }
    };
  }
  target.addEventListener(
    name,
    handler,
    supportsPassive ? { capture, passive } : capture
  );
}

//remove就是利用 removeEventListener移除事件监听
function remove(
  name: string,
  handler: Function,
  capture: boolean,
  _target?: HTMLElement
) {
  (_target || target).removeEventListener(
    name,
    handler._wrapper || handler,
    capture
  );
}

function updateDOMListeners(oldVnode: VNodeWithData, vnode: VNodeWithData) {
  //如果old和new都没有on属性，则直接return
  if (isUndef(oldVnode.data.on) && isUndef(vnode.data.on)) {
    return;
  }
  const on = vnode.data.on || {};
  const oldOn = oldVnode.data.on || {};
  // vnode is empty when removing all listeners,
  // and use old vnode dom element
  //targe先从new中取element，若没有则取old的element(针对的就是移除的情况)
  //target并非该函数的局部变量，而是当前文件的变量。因此  remove和add等都可以直接使用
  target = vnode.elm || oldVnode.elm;
  //normalize只是为了处理  input元素type为range的情况
  normalizeEvents(on);

  //updateListeners：
  //1，就是将之前句法分析中对once，capture，passive的处理给解析回事件当中。
  //   然后根据这些属性的不同，做区别的添加处理。
  //2，一并处理了一个回调和多个回调的场景(统一包装一个invoker函数)
  //3，对于old和new做处理
  updateListeners(on, oldOn, add, remove, createOnceHandler, vnode.context);
  target = undefined;
}

export default {
  create: updateDOMListeners,
  update: updateDOMListeners,
  destroy: (vnode: VNodeWithData) => updateDOMListeners(vnode, emptyNode),
};
