/* @flow */

import config from "../config";
import VNode, { createEmptyVNode } from "./vnode";
import { createComponent } from "./create-component";
import { traverse } from "../observer/traverse";

import {
  warn,
  isDef,
  isUndef,
  isTrue,
  isObject,
  isPrimitive,
  resolveAsset,
} from "../util/index";

import { normalizeChildren, simpleNormalizeChildren } from "./helpers/index";

const SIMPLE_NORMALIZE = 1;
const ALWAYS_NORMALIZE = 2;

// wrapper function for providing a more flexible interface
// without getting yelled at by flow
export function createElement(
  context: Component,
  tag: any,
  data: any,
  children: any,
  normalizationType: any,
  alwaysNormalize: boolean
): VNode | Array<VNode> {
  //处理没有data的情况: h('div',[...]),将所有参数向前挪一位
  if (Array.isArray(data) || isPrimitive(data)) {
    normalizationType = children;
    children = data;
    data = undefined;
  }
  if (isTrue(alwaysNormalize)) {
    normalizationType = ALWAYS_NORMALIZE;
  }
  return _createElement(context, tag, data, children, normalizationType);
}

export function _createElement(
  context: Component,
  tag?: string | Class<Component> | Function | Object,
  data?: VNodeData,
  children?: any,
  normalizationType?: number
): VNode | Array<VNode> {
  //不能在render上使用 observe的数据
  if (isDef(data) && isDef((data: any).__ob__)) {
    process.env.NODE_ENV !== "production" &&
      warn(
        `Avoid using observed data object as vnode data: ${JSON.stringify(
          data
        )}\n` + "Always create fresh vnode data objects in each render!",
        context
      );
    return createEmptyVNode();
  }
  // object syntax in v-bind
  //如果data中存在is属性，则将tag改为is的值
  if (isDef(data) && isDef(data.is)) {
    tag = data.is;
  }
  //如果tag为空，则返回空节点
  if (!tag) {
    // in case of component :is set to falsy value
    return createEmptyVNode();
  }
  // warn against non-primitive key
  //如果key使用了非primitive的数据类型，则报错
  if (
    process.env.NODE_ENV !== "production" &&
    isDef(data) &&
    isDef(data.key) &&
    !isPrimitive(data.key)
  ) {
    if (!__WEEX__ || !("@binding" in data.key)) {
      warn(
        "Avoid using non-primitive value as key, " +
          "use string/number value instead.",
        context
      );
    }
  }
  // support single function children as default scoped slot
  //如果children(render的第三个参数是一个数组，且数组第一项是一个function)，则
  //将其默认作为default的作用域插槽，并且忽略剩下的children
  if (Array.isArray(children) && typeof children[0] === "function") {
    data = data || {};
    data.scopedSlots = { default: children[0] };
    children.length = 0;
  }
  if (normalizationType === ALWAYS_NORMALIZE) {
    //因为createElement是一个深度优先的遍历过程，因此其children在父节点解析到
    //这一步的时候就已经完成了vNode的转换生成，只需要对其做normalize处理即可，
    //而不需要关心其生成过程

    //而normalizeChildren的作用，就是递归的规范化每一个textNode和primitive类型
    //的后代(也就是在手写render函数的时候写的string，number等)，以及对v-for指令
    //且没有绑定key的节点，自动生成一个key
    children = normalizeChildren(children);
  } else if (normalizationType === SIMPLE_NORMALIZE) {
    children = simpleNormalizeChildren(children);
  }
  let vnode, ns;
  //如果tag是string，即_c('div')，_c('children-component')
  if (typeof tag === "string") {
    let Ctor;
    //如果其父节点存在且有namespace，或者此标签必须要有namespace
    ns = (context.$vnode && context.$vnode.ns) || config.getTagNamespace(tag);
    //如果此tag是保留标签，也就是普通html标签或者svg相关标签
    if (config.isReservedTag(tag)) {
      // platform built-in elements

      //如果其为一个单纯的保留标签，且其存在nativeOn属性，则代表其在v-on的
      //时候使用了.native的修饰符，而这在普通标签是不被允许的。
      if (
        process.env.NODE_ENV !== "production" &&
        isDef(data) &&
        isDef(data.nativeOn) &&
        data.tag !== "component"
      ) {
        warn(
          `The .native modifier for v-on is only valid on components but it was used on <${tag}>.`,
          context
        );
      }
      //为其创建vNode节点
      //context为当前vm实例
      vnode = new VNode(
        config.parsePlatformTagName(tag),
        data,
        children,
        undefined,
        undefined,
        context
      );
    } else if (
      //如果不在 v-pre 指令包裹下
      (!data || !data.pre) &&
      //这种写法就是赋值与判断同时进行。在patch中也会存在大量的这种写法。
      isDef((Ctor = resolveAsset(context.$options, "components", tag)))
    ) {
      //Ctor即为在创建vue的时候options中的components选项。
      // component
      vnode = createComponent(Ctor, data, context, children, tag);
    } else {
      // unknown or unlisted namespaced elements
      // check at runtime because it may get assigned a namespace when its
      // parent normalizes children
      vnode = new VNode(tag, data, children, undefined, undefined, context);
    }
  } else {
    // direct component options / constructor
    //tag不为string，也就意味着其就是选项中的某个构造函数Ctor
    vnode = createComponent(tag, data, context, children);
  }
  if (Array.isArray(vnode)) {
    return vnode;
  } else if (isDef(vnode)) {
    if (isDef(ns)) applyNS(vnode, ns);
    //历遍style和class属性。确保绑定的数据被添加deep依赖
    if (isDef(data)) registerDeepBindings(data);
    return vnode;
  } else {
    return createEmptyVNode();
  }
}

function applyNS(vnode, ns, force) {
  vnode.ns = ns;
  if (vnode.tag === "foreignObject") {
    // use default namespace inside foreignObject
    ns = undefined;
    force = true;
  }
  if (isDef(vnode.children)) {
    for (let i = 0, l = vnode.children.length; i < l; i++) {
      const child = vnode.children[i];
      if (
        isDef(child.tag) &&
        (isUndef(child.ns) || (isTrue(force) && child.tag !== "svg"))
      ) {
        applyNS(child, ns, force);
      }
    }
  }
}

// ref #5318
// necessary to ensure parent re-render when deep bindings like :style and
// :class are used on slot nodes
function registerDeepBindings(data) {
  if (isObject(data.style)) {
    traverse(data.style);
  }
  if (isObject(data.class)) {
    traverse(data.class);
  }
}
