/* @flow */

import VNode, { cloneVNode } from "./vnode";
import { createElement } from "./create-element";
import { resolveInject } from "../instance/inject";
import { normalizeChildren } from "../vdom/helpers/normalize-children";
import { resolveSlots } from "../instance/render-helpers/resolve-slots";
import { normalizeScopedSlots } from "../vdom/helpers/normalize-scoped-slots";
import { installRenderHelpers } from "../instance/render-helpers/index";

import {
  isDef,
  isTrue,
  hasOwn,
  camelize,
  emptyObject,
  validateProp,
} from "../util/index";

export function FunctionalRenderContext(
  data: VNodeData,
  props: Object,
  children: ?Array<VNode>,
  parent: Component,
  Ctor: Class<Component>
) {
  const options = Ctor.options;
  // ensure the createElement function in functional components
  // gets a unique context - this is necessary for correct named slot check
  let contextVm;
  //如果parent为vue实例
  if (hasOwn(parent, "_uid")) {
    //将contextVm的原型链指向parent
    contextVm = Object.create(parent);
    // $flow-disable-line
    contextVm._original = parent;
  } else {
    // the context vm passed in is a functional context as well.
    // in this case we want to make sure we are able to get a hold to the
    // real context instance.
    //如果其父元素不为实例，则代表其也是一个functional组件
    contextVm = parent;
    // $flow-disable-line
    parent = parent._original;
  }
  const isCompiled = isTrue(options._compiled);
  const needNormalization = !isCompiled;
  //接收一些选项
  this.data = data;
  this.props = props;
  this.children = children;
  this.parent = parent;
  this.listeners = data.on || emptyObject;
  this.injections = resolveInject(options.inject, parent);

  //处理slots
  //之所以functionalComponent会在次处理，是因为其不会调用ctor去真实的创建一个
  //vue实例，而正常情况下slots是在初始化，slotsScope是在_render中初始化

  this.slots = () => {
    //如果没有，则从新获取
    if (!this.$slots) {
      normalizeScopedSlots(
        data.scopedSlots,
        (this.$slots = resolveSlots(children, parent))
      );
    }
    return this.$slots;
  };

  Object.defineProperty(
    this,
    "scopedSlots",
    ({
      enumerable: true,
      get() {
        return normalizeScopedSlots(data.scopedSlots, this.slots());
      },
    }: any)
  );

  // support for compiled functional template
  if (isCompiled) {
    // exposing $options for renderStatic()
    this.$options = options;
    // pre-resolve slots for renderSlot()
    this.$slots = this.slots();
    this.$scopedSlots = normalizeScopedSlots(data.scopedSlots, this.$slots);
  }

  //_scopeId是在vue-cli中生成的
  if (options._scopeId) {
    this._c = (a, b, c, d) => {
      const vnode = createElement(contextVm, a, b, c, d, needNormalization);
      if (vnode && !Array.isArray(vnode)) {
        vnode.fnScopeId = options._scopeId;
        vnode.fnContext = parent;
      }
      return vnode;
    };
  } else {
    this._c = (a, b, c, d) =>
      createElement(contextVm, a, b, c, d, needNormalization);
  }
}

installRenderHelpers(FunctionalRenderContext.prototype);

export function createFunctionalComponent(
  Ctor: Class<Component>,
  propsData: ?Object,
  data: VNodeData,
  contextVm: Component,
  children: ?Array<VNode>
): VNode | Array<VNode> | void {
  const options = Ctor.options;
  const props = {};
  const propOptions = options.props;
  if (isDef(propOptions)) {
    for (const key in propOptions) {
      //最终的返回值为根据type转换的value，或者value为空时返回的default
      props[key] = validateProp(key, propOptions, propsData || emptyObject);
    }
  } else {
    //将data的props和attrs合并到props属性中
    if (isDef(data.attrs)) mergeProps(props, data.attrs);
    if (isDef(data.props)) mergeProps(props, data.props);
  }

  const renderContext = new FunctionalRenderContext(
    data,
    props,
    children,
    contextVm,
    Ctor
  );

  //调用render函数生成vnode节点。此处传递了两个参数：renderContext._c和renderContext
  //这也就是为什么在functional组件中可以接收第二个参数的原因
  //而整个functionalComponent的构建过程是不涉及ctor实例化的，因此，这也就是为什么
  //函数式组件没有上下文等概念的原因。
  const vnode = options.render.call(null, renderContext._c, renderContext);

  //最终，会将函数式组件生成的vnode拷贝一份作为结果返回出去
  if (vnode instanceof VNode) {
    return cloneAndMarkFunctionalResult(
      vnode,
      data,
      renderContext.parent,
      options,
      renderContext
    );
  } else if (Array.isArray(vnode)) {
    const vnodes = normalizeChildren(vnode) || [];
    const res = new Array(vnodes.length);
    for (let i = 0; i < vnodes.length; i++) {
      res[i] = cloneAndMarkFunctionalResult(
        vnodes[i],
        data,
        renderContext.parent,
        options,
        renderContext
      );
    }
    return res;
  }
}

function cloneAndMarkFunctionalResult(
  vnode,
  data,
  contextVm,
  options,
  renderContext
) {
  // #7817 clone node before setting fnContext, otherwise if the node is reused
  // (e.g. it was from a cached normal slot) the fnContext causes named slots
  // that should not be matched to match.
  const clone = cloneVNode(vnode);
  clone.fnContext = contextVm;
  clone.fnOptions = options;
  if (process.env.NODE_ENV !== "production") {
    (clone.devtoolsMeta = clone.devtoolsMeta || {}).renderContext =
      renderContext;
  }
  if (data.slot) {
    (clone.data || (clone.data = {})).slot = data.slot;
  }
  return clone;
}

function mergeProps(to, from) {
  for (const key in from) {
    to[camelize(key)] = from[key];
  }
}
