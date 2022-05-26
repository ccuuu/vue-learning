/* @flow */

import { makeMap, isBuiltInTag, cached, no } from "shared/util";

let isStaticKey;
let isPlatformReservedTag;

const genStaticKeysCached = cached(genStaticKeys);

/**
 * Goal of the optimizer: walk the generated template AST tree
 * and detect sub-trees that are purely static, i.e. parts of
 * the DOM that never needs to change.
 *
 * Once we detect these sub-trees, we can:
 *
 * 1. Hoist them into constants, so that we no longer need to
 *    create fresh nodes for them on each re-render;
 * 2. Completely skip them in the patching process.
 */
export function optimize(root: ?ASTElement, options: CompilerOptions) {
  if (!root) return;
  //isStaticKey会变成一个function，输入key后判断其是否为map中设定的
  isStaticKey = genStaticKeysCached(options.staticKeys || "");
  //检查给定的标签是否是保留的标签。（HTML标签或SVG相关标签）
  isPlatformReservedTag = options.isReservedTag || no;
  // first pass: mark all non-static nodes.
  //"!或许!" 会递归某些节点，对其和其子元素都进行markStatic操作
  markStatic(root);
  // second pass: mark static roots.
  //"!或许!" 会递归某些节点，对其和其子元素都进行markStaticRoots操作
  markStaticRoots(root, false);
}

function genStaticKeys(keys: string): Function {
  return makeMap(
    "type,tag,attrsList,attrsMap,plain,parent,children,attrs,start,end,rawAttrsMap" +
      (keys ? "," + keys : "")
  );
}

function markStatic(node: ASTNode) {
  //如果type为3(纯文本或注释内容)，或者pre为true，或者
  //没有v-bind，v-for，v-if，且tag不为slot或component，且tag为HTML标签或SVG相关标签,
  //且祖先元素不为tag:template带for属性，且属性的每一项都isStaticKey
  node.static = isStatic(node);
  //如果是标签节点
  if (node.type === 1) {
    // do not make componentslot content static. this avoids
    // 1. components not able to mutate slot nodes
    // 2. static slot content fails for hot-reloading

    //如果不是HTML标签或者SVG相关标签，且tag不为slot，并且inline-template属性为null
    //如果tag为slot，则可能会被替换为插槽的其他内容，因此无法确定替换过后的标签为什么，
    //不可直接退出；inline-template类似

    //可以简单理解为只要元素和(HTML标签或SVG相关标签)不沾边，那么不用再对其后代元素进行
    //markStatic操作
    if (
      //HTML标签或SVG相关标签
      !isPlatformReservedTag(node.tag) &&
      node.tag !== "slot" &&
      node.attrsMap["inline-template"] == null
    ) {
      return;
    }
    //递归历遍其后代元素的每一项，若全部都为static，则其才为static
    //后代元素的形式有两种：children属性中，ifConditions属性中
    for (let i = 0, l = node.children.length; i < l; i++) {
      const child = node.children[i];
      markStatic(child);
      if (!child.static) {
        node.static = false;
      }
    }
    if (node.ifConditions) {
      for (let i = 1, l = node.ifConditions.length; i < l; i++) {
        const block = node.ifConditions[i].block;
        markStatic(block);
        if (!block.static) {
          node.static = false;
        }
      }
    }
  }
}

function markStaticRoots(node: ASTNode, isInFor: boolean) {
  if (node.type === 1) {
    if (node.static || node.once) {
      //该节点是否存在for属性
      node.staticInFor = isInFor;
    }
    // For a node to qualify as a static root, it should have children that
    // are not just static text. Otherwise the cost of hoisting out will
    // outweigh the benefits and it's better off to just always render it fresh.

    //如果此root的static为true，并且存在子节点，子节点不为文本节点

    //这是一个先序遍历，若找到第一个static为true，且存在子节点且子节点不为唯一的文本节点
    //则staticRoot置为true，并取消对其子节点的递归
    if (
      node.static &&
      node.children.length &&
      !(node.children.length === 1 && node.children[0].type === 3)
    ) {
      node.staticRoot = true;
      return;
    } else {
      node.staticRoot = false;
    }
    if (node.children) {
      for (let i = 0, l = node.children.length; i < l; i++) {
        markStaticRoots(node.children[i], isInFor || !!node.for);
      }
    }
    if (node.ifConditions) {
      for (let i = 1, l = node.ifConditions.length; i < l; i++) {
        markStaticRoots(node.ifConditions[i].block, isInFor);
      }
    }
  }
}

//如果type为3(纯文本或注释内容)，或者pre为true，且
//没有v-bind，v-for，v-if，且tag不为slot或component，且tag为HTML标签或SVG相关标签,
//且祖先元素不为tag:template带for属性，且属性的每一项都isStaticKey
function isStatic(node: ASTNode): boolean {
  if (node.type === 2) {
    // expression
    return false;
  }
  if (node.type === 3) {
    // text
    return true;
  }
  return !!(
    node.pre ||
    (!node.hasBindings && // no dynamic bindings
      !node.if &&
      !node.for && // not v-if or v-for or v-else
      //slot和component
      !isBuiltInTag(node.tag) && // not a built-in
      //HTML标签或SVG相关标签
      isPlatformReservedTag(node.tag) && // not a component
      !isDirectChildOfTemplateFor(node) &&
      Object.keys(node).every(isStaticKey))
  );
}

function isDirectChildOfTemplateFor(node: ASTElement): boolean {
  while (node.parent) {
    node = node.parent;
    //如果某个祖先元素节点不为template，return false
    if (node.tag !== "template") {
      return false;
    }
    //如果某个祖先节点存在for，return true
    if (node.for) {
      return true;
    }
  }
  //如果遍历完成还没找到带for且为template的祖先元素，返回false
  return false;
}
