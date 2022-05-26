/* @flow */

import he from "he";
import { parseHTML } from "./html-parser";
import { parseText } from "./text-parser";
import { parseFilters } from "./filter-parser";
import { genAssignmentCode } from "../directives/model";
import { extend, cached, no, camelize, hyphenate } from "shared/util";
import { isIE, isEdge, isServerRendering } from "core/util/env";

import {
  addProp,
  addAttr,
  baseWarn,
  addHandler,
  addDirective,
  getBindingAttr,
  getAndRemoveAttr,
  getRawBindingAttr,
  pluckModuleFunction,
  getAndRemoveAttrByRegex,
} from "../helpers";

//匹配监听事件的指令。
export const onRE = /^@|^v-on:/;
//匹配所有vue指令
export const dirRE = process.env.VBIND_PROP_SHORTHAND
  ? /^v-|^@|^:|^\.|^#/
  : /^v-|^@|^:|^#/;
//用来匹配 v-for 属性的值，并捕获 in 或 of 前后的字符串。
//如：v-for:"(item, index) in arr"，会匹配到(item,index)和arr
//    v-for:"(item,key,index) in arr"，会匹配到(item,key,index)和arr
//    v-for:"item of arr"，会匹配到item和arr
export const forAliasRE = /([\s\S]*?)\s+(?:in|of)\s+([\s\S]*)/;
//用来匹配“in”形式的v-for的迭代生成对象，如(item,key,index)，会匹配到item,key,index
export const forIteratorRE = /,([^,\}\]]*)(?:,([^,\}\]]*))?$/;
//用来去掉v-for的()
const stripParensRE = /^\(|\)$/g;
const dynamicArgRE = /^\[.*\]$/;

//用来匹配并捕获指令中的参数，如：v-on:click.stop="handleClick"
const argRE = /:(.*)$/;
//用来匹配v-bind，可以是:，或者v-bind
export const bindRE = /^:|^\.|^v-bind:/;
const propBindRE = /^\./;
//用来匹配指令中的参数，如：v-on:click.stop="handleClick"，但不进行捕获
const modifierRE = /\.[^.\]]+(?=[^\]]*$)/g;
//用来匹配v-slot，可以是#，或者v-slot
const slotRE = /^v-slot(:|$)|^#/;
//匹配换行
const lineBreakRE = /[\r\n]/;
//匹配空格
const whitespaceRE = /[ \f\t\r\n]+/g;
//匹配不合规的属性名
const invalidAttributeRE = /[\s"'<>\/=]/;

//cached的作用是接收一个函数作为参数并返回一个新的函数，新函数的功能与作为参数传递
//的函数功能相同，唯一不同的是新函数具有缓存值的功能，如果一个函数在接收相同参数的情
//况下所返回的值总是相同的，那么 cached 函数将会为该函数提供性能提升的优势。

//he 为第三方的库，he.decode 函数用于 HTML 字符实体的解码工作
//如：he.decode('&#x26;')  // &#x26; -> '&'
const decodeHTMLCached = cached(he.decode);

export const emptySlotScopeToken = `_empty_`;

// configurable state
export let warn: any;
let delimiters;
let transforms;
let preTransforms;
let postTransforms;
let platformIsPreTag;
let platformMustUseProp;
let platformGetTagNamespace;
let maybeComponent;

//例：<div v-for="obj of list" class="box"></div>
// element = {
//   type: 1,
//   tag: 'div',
//   attrsList: [
//     {
//       name: 'v-for',
//       value: 'obj of list'
//     },
//     {
//       name: 'class',
//       value: 'box'
//     }
//   ],
//   attrsMap: {
//     'v-for': 'obj of list',
//     'class': 'box'
//   },
//   parent,
//   children: []
// }
export function createASTElement(
  tag: string,
  attrs: Array<ASTAttr>,
  parent: ASTElement | void
): ASTElement {
  return {
    type: 1,
    tag,
    attrsList: attrs,
    attrsMap: makeAttrsMap(attrs),
    rawAttrsMap: {},
    parent,
    children: [],
  };
}

/**
 * Convert HTML string to AST.
 */
export function parse(
  template: string,
  options: CompilerOptions
): ASTElement | void {
  warn = options.warn || baseWarn;
  //通过给定的标签名字检查标签是否是 'pre' 标签。
  //HTML里的pre元素，可定义预格式化的文本。即保留pre子节点中的原有格式
  platformIsPreTag = options.isPreTag || no;
  //用来检测一个属性在标签中是否要使用元素对象原生的 prop 进行绑定
  platformMustUseProp = options.mustUseProp || no;
  //获取元素(标签)的命名空间。
  platformGetTagNamespace = options.getTagNamespace || no;
  //检查给定的标签是否是保留的标签。
  const isReservedTag = options.isReservedTag || no;
  maybeComponent = (el: ASTElement) =>
    !!(
      el.component ||
      el.attrsMap[":is"] ||
      el.attrsMap["v-bind:is"] ||
      !(el.attrsMap.is ? isReservedTag(el.attrsMap.is) : isReservedTag(el.tag))
    );
  transforms = pluckModuleFunction(options.modules, "transformNode");
  preTransforms = pluckModuleFunction(options.modules, "preTransformNode");
  postTransforms = pluckModuleFunction(options.modules, "postTransformNode");

  delimiters = options.delimiters;

  //用stack来存储每一次的currentParent，当遇到结束标签时，则利用此stack将currentParent
  //回退到上一次的currentParent
  const stack = [];
  const preserveWhitespace = options.preserveWhitespace !== false;
  const whitespaceOption = options.whitespace;
  //用来存放最终AST结果
  let root;
  //用来存放上一次解析的节点
  let currentParent;
  //inVPre 变量用来标识当前解析的标签是否在拥有 v-pre 的标签之内
  let inVPre = false;
  //inPre 变量用来标识当前正在解析的标签是否在 <pre></pre> 标签之内
  let inPre = false;
  //用来控制warnOnce函数值执行一次
  let warned = false;

  //只会执行一次警告
  function warnOnce(msg, range) {
    if (!warned) {
      warned = true;
      warn(msg, range);
    }
  }

  //每当遇到一个标签的结束标签时，或遇到一元标签时都会调用该方法“闭合”标签
  function closeElement(element) {
    trimEndingWhitespace(element);
    if (!inVPre && !element.processed) {
      //处理ref,key,slot,component等
      element = processElement(element, options);
    }
    // tree management
    //stack为空，则代表root内的所有标签都解析完毕，若此时还有element，则代表
    //其位置为根元素同级，此时需要判断最终是否存在多个根元素，若是则报错
    //在根元素中，允许存在v-if v-else-if v-else
    if (!stack.length && element !== root) {
      // allow root elements with v-if, v-else-if and v-else
      if (root.if && (element.elseif || element.else)) {
        if (process.env.NODE_ENV !== "production") {
          checkRootConstraints(element);
        }
        //将当前元素添加到root的ifConditions当中
        addIfCondition(root, {
          exp: element.elseif,
          block: element,
        });
        //若当前元素即存在于根元素中，且不为if else，则报错
      } else if (process.env.NODE_ENV !== "production") {
        warnOnce(
          `Component template should contain exactly one root element. ` +
            `If you are using v-if on multiple elements, ` +
            `use v-else-if to chain them instead.`,
          { start: element.start }
        );
      }
    }
    if (currentParent && !element.forbidden) {
      //如果当前元素是if else元素，则不会将其加入到真实的AST树当中，而是将其
      //加入到相对应的v-if元素的ifConditions当中
      if (element.elseif || element.else) {
        processIfConditions(element, currentParent);
      } else {
        //如果当前元素是slotScope元素
        if (element.slotScope) {
          // scoped slot
          // keep it in the children list so that v-else(-if) conditions can
          // find it as the prev node.
          const name = element.slotTarget || '"default"';
          (currentParent.scopedSlots || (currentParent.scopedSlots = {}))[
            name
          ] = element;
        }
        currentParent.children.push(element);
        element.parent = currentParent;
      }
    }

    // final children cleanup
    // filter out scoped slots
    element.children = element.children.filter((c) => !(c: any).slotScope);
    // remove trailing whitespace node again
    trimEndingWhitespace(element);

    // check pre state
    if (element.pre) {
      inVPre = false;
    }
    if (platformIsPreTag(element.tag)) {
      inPre = false;
    }
    // apply post-transforms
    for (let i = 0; i < postTransforms.length; i++) {
      postTransforms[i](element, options);
    }
  }

  function trimEndingWhitespace(el) {
    // remove trailing whitespace node
    if (!inPre) {
      let lastNode;
      while (
        (lastNode = el.children[el.children.length - 1]) &&
        lastNode.type === 3 &&
        lastNode.text === " "
      ) {
        el.children.pop();
      }
    }
  }

  function checkRootConstraints(el) {
    if (el.tag === "slot" || el.tag === "template") {
      warnOnce(
        `Cannot use <${el.tag}> as component root element because it may ` +
          "contain multiple nodes.",
        { start: el.start }
      );
    }
    if (el.attrsMap.hasOwnProperty("v-for")) {
      warnOnce(
        "Cannot use v-for on stateful component root element because " +
          "it renders multiple elements.",
        el.rawAttrsMap["v-for"]
      );
    }
  }
  //parseHTML 函数的作用就是用来做词法分析的，而 parse 函数的作用则
  //是在词法分析的基础上做句法分析从而生成一棵 AST

  parseHTML(template, {
    warn,
    expectHTML: options.expectHTML,
    isUnaryTag: options.isUnaryTag,
    canBeLeftOpenTag: options.canBeLeftOpenTag,
    shouldDecodeNewlines: options.shouldDecodeNewlines,
    shouldDecodeNewlinesForHref: options.shouldDecodeNewlinesForHref,
    shouldKeepComment: options.comments,
    outputSourceRange: options.outputSourceRange,
    start(tag, attrs, unary, start, end) {
      // check namespace.
      // inherit parent ns if there is one
      //ns：nameSpace，即命名空间；
      //如果父级元素存在命名空间，则将父级元素的命名空间指定为自身的命名空间（继承）
      //如果不存在，则调用getTagNamespace函数，函数内部：
      // if (isSVG(tag)) {
      //   return 'svg'
      // }
      // if (tag === 'math') {
      //   return 'math'
      // }
      const ns =
        (currentParent && currentParent.ns) || platformGetTagNamespace(tag);

      // handle IE svg bug
      /* istanbul ignore if */
      //修复ie svg namespace的bug：<svg xmlns:NS1="" NS1:xmlns:feature="http://www.openplans.org/topp"></svg>
      if (isIE && ns === "svg") {
        attrs = guardIESVGBug(attrs);
      }

      let element: ASTElement = createASTElement(tag, attrs, currentParent);
      if (ns) {
        element.ns = ns;
      }

      if (process.env.NODE_ENV !== "production") {
        if (options.outputSourceRange) {
          element.start = start;
          element.end = end;
          element.rawAttrsMap = element.attrsList.reduce((cumulated, attr) => {
            cumulated[attr.name] = attr;
            return cumulated;
          }, {});
        }
        attrs.forEach((attr) => {
          if (invalidAttributeRE.test(attr.name)) {
            warn(
              `Invalid dynamic argument expression: attribute names cannot contain ` +
                `spaces, quotes, <, >, / or =.`,
              {
                start: attr.start + attr.name.indexOf(`[`),
                end: attr.start + attr.name.length,
              }
            );
          }
        });
      }
      //Vue 认为模板应该只负责做数据状态到 UI 的映射，而不应该存在引起副作用的代码
      //如：script，style；但是<script type="text/x-template" id="hello-world-template">
      //将模板放到script标签内，是可行的
      if (isForbiddenTag(element) && !isServerRendering()) {
        element.forbidden = true;
        process.env.NODE_ENV !== "production" &&
          warn(
            "Templates should only be responsible for mapping the state to the " +
              "UI. Avoid placing tags with side-effects in your templates, such as " +
              `<${tag}>` +
              ", as they will not be parsed.",
            { start: element.start }
          );
      }

      // apply pre-transforms
      //处理tag为input，且制定了type属性的元素
      //如果时input，则将此input分为三种不同情况的type，一并添加至input的ifCondition中
      //以作区分
      //三种不同的情况为：checkbox，radio，和其他type
      for (let i = 0; i < preTransforms.length; i++) {
        element = preTransforms[i](element, options) || element;
      }
      //如果设置了v-pre，则保持inVpre的状态，直到该标签关闭
      //会给设置v-pre的元素标记上pre为true，而其子元素会被标记上plain
      if (!inVPre) {
        processPre(element);
        if (element.pre) {
          inVPre = true;
        }
      }
      //如果是pre标签，则应该保留其本身的数据格式，即不会做trimEndingWhitespace
      //并标记plain为true
      if (platformIsPreTag(element.tag)) {
        inPre = true;
      }
      //如果此时处于inVPre状态，则不会做额外解析
      if (inVPre) {
        //JSON.stringify(attr.value)
        processRawAttrs(element);
        //如果元素进行过了预处理，则不会重复处理
      } else if (!element.processed) {
        //通常，v-for，v-if，v-once被认作是结构化属性

        // structural directives

        //给此元素添加如下属性：
        // {
        //   for: "arr",
        //   alias: "item",
        //   iterator1: "key",
        //   iterator2: "index",
        // };
        processFor(element);
        //给v-if的元素加上如下属性：
        // {
        //   if: 'ifTrue',
        //   ifCondition:[
        //     {
        //       exp:'ifTrue',
        //       block: element,
        //     },
        //     {
        //       exp:'elseIfTrue',
        //       block: element,
        //     },
        //     {
        //       exp:undefined,
        //       block: element,
        //     }
        //   ]
        // }
        //给v-else的元素加上else为true的标识
        //给v-else-if的元素加上elseif：ifElseTrue(为用户指定的对象：v-else-if="ifElseTrue")
        processIf(element);
        //给此元素标记once为true
        processOnce(element);
      }

      if (!root) {
        root = element;
        if (process.env.NODE_ENV !== "production") {
          //检测root是否可用
          //如果是slot，template，或者有v-for，则会报错

          //模板必须有且仅有一个被渲染的根元素

          //为什么不能使用 slot 和 template 标签作为模板根元素，这是因为 slot 作为
          //插槽，它的内容是由外界决定的，而插槽的内容很有可能渲染多个节点，template
          // 元素的内容虽然不是由外界决定的，但它本身作为抽象组件是不会渲染任何内容到
          //页面的，而其又可能包含多个子节点，所以也不允许使用 template 标签作为根节
          //点。总之这些限制都是出于 必须有且仅有一个根元素 考虑的。
          checkRootConstraints(root);
        }
      }

      //如果不是一元标签，则将此标签设置为currentParent供下一次使用，并添加入栈
      if (!unary) {
        currentParent = element;
        stack.push(element);
      } else {
        closeElement(element);
      }
    },

    end(tag, start, end) {
      const element = stack[stack.length - 1];
      // pop stack
      //从stack拿出相对应的起始标签，并将currentParent回退到上一次的值
      stack.length -= 1;
      currentParent = stack[stack.length - 1];
      if (process.env.NODE_ENV !== "production" && options.outputSourceRange) {
        //更新元素的end属性值
        element.end = end;
      }
      closeElement(element);
    },

    chars(text: string, start: number, end: number) {
      //如果没有currentParent，则代表位置处于根节点处
      if (!currentParent) {
        if (process.env.NODE_ENV !== "production") {
          //如果此时text和传入的template字符串相同，则代表template即为一个纯文本
          if (text === template) {
            warnOnce(
              "Component template requires a root element, rather than just text.",
              { start }
            );
            //文本内容处于根元素外部
          } else if ((text = text.trim())) {
            warnOnce(`text "${text}" outside root element will be ignored.`, {
              start,
            });
          }
        }
        return;
      }
      // IE textarea placeholder bug
      //IE的textArea获取innerHTML时，会错误的将placeholder解析为innerHTML内容
      /* istanbul ignore if */
      //如果是IE，且此时的元素为textArea，placeholder与文本内容相同，
      //则代表文本内容为innerHTML的bug产生的，此时忽略文本
      if (
        isIE &&
        currentParent.tag === "textarea" &&
        currentParent.attrsMap.placeholder === text
      ) {
        return;
      }
      const children = currentParent.children;
      //如果在pre标签下，或者text不为空白
      if (inPre || text.trim()) {
        //isTextTag: script, style
        //如果当前元素不是文本节点，对text进行解码
        text = isTextTag(currentParent) ? text : decodeHTMLCached(text);
      } else if (!children.length) {
        // remove the whitespace-only node right after an opening tag
        //如果父节点没有其他子元素，则移除text的空白
        text = "";
      } else if (whitespaceOption) {
        if (whitespaceOption === "condense") {
          // in condense mode, remove the whitespace node if it contains
          // line break, otherwise condense to a single space
          text = lineBreakRE.test(text) ? "" : " ";
        } else {
          text = " ";
        }
      } else {
        //如果设置了preserveWhitespace，则保留空白
        text = preserveWhitespace ? " " : "";
      }
      //如果经过处理之后不为空字符串
      if (text) {
        if (!inPre && whitespaceOption === "condense") {
          // condense consecutive whitespace into single space
          //将多个空格(包括换行缩进等)转换成一个空格
          text = text.replace(whitespaceRE, " ");
        }
        let res;
        let child: ?ASTNode;
        //当前元素不在v-pre标签内,且元素不为空，且能正常进行parseText(包含字面量表达式)

        //parseText:解析模板语法，用来识别一段文本节点内容中的普通文本和字面量表达式
        //并把他们按顺序拼接起来。
        if (!inVPre && text !== " " && (res = parseText(text, delimiters))) {
          child = {
            //type：2 包含字面量表达式的文本
            type: 2,
            //expression即为带解析的string
            // 'stringify('abc') + _s(_f('filter')(name)) + stringify('cba') + _s(age) + stringify('aaa')'
            expression: res.expression,
            //tokens是提供给weex使用的
            //tokens为expression对应的数组，其中模板语法被处理为
            // 'abc',
            // {
            //    "@binding":"_f('filter')(name)"
            // }
            // 'cba',
            // {
            //    "@binding":"age"
            // }
            // 'aaa'
            tokens: res.tokens,
            text,
          };
          //否则，则text不为空白，或者不为currentParent的第一个子节点，或者parent的
          //children中的最后一个不为空白

          //唯一不会处理的情况：此时文本为空白，且currentParent的最后一个元素也是空白文本
          //(只有文本节点才会有text属性)
        } else if (
          text !== " " ||
          !children.length ||
          children[children.length - 1].text !== " "
        ) {
          //type：3 普通文本
          child = {
            type: 3,
            text,
          };
        }
        if (child) {
          if (
            process.env.NODE_ENV !== "production" &&
            options.outputSourceRange
          ) {
            child.start = start;
            child.end = end;
          }
          children.push(child);
        }
      }
    },
    comment(text: string, start, end) {
      // adding anything as a sibling to the root node is forbidden
      // comments should still be allowed, but ignored
      //如果注释内容在根节点处，则忽略
      if (currentParent) {
        const child: ASTText = {
          type: 3,
          text,
          isComment: true,
        };
        if (
          process.env.NODE_ENV !== "production" &&
          options.outputSourceRange
        ) {
          child.start = start;
          child.end = end;
        }
        currentParent.children.push(child);
      }
    },
  });
  return root;
}

function processPre(el) {
  //注意，在句法解析中很多地方都用到了 != null，
  //是因为在HTMLParse词法解析的时候，将value为空的属性value都赋值为空字符串
  //是为了在句法解析方便做特殊处理，如v-pre本身就不需要value，则应该让其正确
  //解析；而v-for则一定需要value，如果为空字符串应该阻止
  if (getAndRemoveAttr(el, "v-pre") != null) {
    el.pre = true;
  }
}

function processRawAttrs(el) {
  const list = el.attrsList;
  const len = list.length;
  if (len) {
    const attrs: Array<ASTAttr> = (el.attrs = new Array(len));
    for (let i = 0; i < len; i++) {
      attrs[i] = {
        name: list[i].name,
        //此处对value进行stringify的作用，是为了将属性的值只作为字符串使用，而
        //不会在 new Function中被当作语句处理
        value: JSON.stringify(list[i].value),
      };
      if (list[i].start != null) {
        attrs[i].start = list[i].start;
        attrs[i].end = list[i].end;
      }
    }
    //如果没有属性，且不是设置v-pre的元素，则代表是其子元素，此时，为这个元素设置
    //plain标签
  } else if (!el.pre) {
    // non root node in pre blocks with no attributes
    el.plain = true;
  }
}

export function processElement(element: ASTElement, options: CompilerOptions) {
  //为元素添加上key属性，值为绑定的value
  processKey(element);

  // determine whether this is a plain element after
  // removing structural attributes

  //若元素没有使用key，且元素只使用了结构化属性，则被认为是plain元素
  element.plain =
    !element.key && !element.scopedSlots && !element.attrsList.length;

  //给元素添加上ref属性和refInfor属性(可能为false或true)
  processRef(element);

  //给元素添加上：
  //slotScope属性(若有)，slot-scope="value", v-slot:name="value" , #name="value"
  //slotTarget属性(若无则默认为"default")，v-slot:name  #name  slot="name"
  //以及slotTargetDynamic(Boolean，表示slotTarget是否是动态绑定的)
  processSlotContent(element);

  //若tag为slot，则给元素添加上slotName(若没有指定name属性，则为空字符串)
  processSlotOutlet(element);

  //为元素添加上component属性，值为is属性动态绑定的值
  //若元素设置了inline-template属性，则添加inlineTemplate属性，设置为true
  processComponent(element);

  //中置处理；用来处理class属性和style属性

  //class：
  //对于静态属性class，做空格格式化和stringify处理，并添加至元素的staticClass属性中
  //对于动态绑定的class，添加至classBinding属性中
  //style：
  //对于静态属性值，做如下格式化：
  //style="color:red;border:none"
  //转换为：
  // res = {
  //  color:'red',
  //  border:'none'
  //}
  //将静态属性style，格式化后stringify，添加至元素的staticStyle
  //将动态绑定的style，添加至元素的styleBinding中
  for (let i = 0; i < transforms.length; i++) {
    element = transforms[i](element, options) || element;
  }
  //处理其他还未处理的元素，包括v-model,v-clock,v-html,v-text,v-show,v-on,v-bind等

  //v-bind:
  //若属性设置了sync修饰符，则自动为元素添加update:name的事件
  //根据不同的属性和设置的修饰符，将绑定的属性添加到attrs或props中
  //如果属性名为dynamic(即v-bind[name])，且为attr，则将属性添加至dynamicAttrs中

  //v-on: 在元素上添加events和nativeEvents属性，存放绑定的事件

  //v-directives|v-model|v-html|v-text|v-clock|v-show等：
  //在元素上添加directives属性，存放自定义指令
  processAttrs(element);
  return element;
}

function processKey(el) {
  const exp = getBindingAttr(el, "key");
  if (exp) {
    if (process.env.NODE_ENV !== "production") {
      //如果给虚拟节点template加上key，则会报错
      if (el.tag === "template") {
        warn(
          `<template> cannot be keyed. Place the key on real elements instead.`,
          getRawBindingAttr(el, "key")
        );
      }
      //如果为transition-group的key设置为iterator，则报错
      if (el.for) {
        const iterator = el.iterator2 || el.iterator1;
        const parent = el.parent;
        if (
          iterator &&
          iterator === exp &&
          parent &&
          parent.tag === "transition-group"
        ) {
          warn(
            `Do not use v-for index as key on <transition-group> children, ` +
              `this is the same as not using keys.`,
            getRawBindingAttr(el, "key"),
            true /* tip */
          );
        }
      }
    }
    //添加key属性
    el.key = exp;
  }
}

function processRef(el) {
  const ref = getBindingAttr(el, "ref");
  if (ref) {
    el.ref = ref;
    //检测元素是否是在v-for元素的包裹下；返回值为Boolean
    el.refInFor = checkInFor(el);
  }
}

export function processFor(el: ASTElement) {
  let exp;
  if ((exp = getAndRemoveAttr(el, "v-for"))) {
    // res = {
    //   for: "arr",
    //   alias: "item",
    //   iterator1: "key",
    //   iterator2: "index",
    // };
    //解析v-for的value
    const res = parseFor(exp);
    if (res) {
      extend(el, res);
    } else if (process.env.NODE_ENV !== "production") {
      warn(`Invalid v-for expression: ${exp}`, el.rawAttrsMap["v-for"]);
    }
  }
}

type ForParseResult = {
  for: string,
  alias: string,
  iterator1?: string,
  iterator2?: string,
};

//主要核心就是正则表达式的匹配，捕获，和替换，将v-for的value转换为相应的格式，如：
//v-for="item of arr" or  v-for="item in arr"
// {
//   for:'arr',
//   alias:'item'
// }

//v-for="(item,index) in arr"
// {
//   for:'arr',
//   alias:'item'
//   iterator1:'index'
// }

//v-for="(item,key,index) in arr"
// {
//   for:'arr',
//   alias:'item'
//   iterator1:'key'
//   iterator2:'index'
// }
export function parseFor(exp: string): ?ForParseResult {
  const inMatch = exp.match(forAliasRE);
  if (!inMatch) return;
  const res = {};
  //inMatch[2]为循环的目标对象
  res.for = inMatch[2].trim();
  //inMatch[1]为复制的(item,index)，此处是为了去掉括号(若有)
  const alias = inMatch[1].trim().replace(stripParensRE, "");
  //item,key,index会转换成[',key,index', 'key' , 'index']
  const iteratorMatch = alias.match(forIteratorRE);
  if (iteratorMatch) {
    //取得生成对象(item,key,index)的第一项
    res.alias = alias.replace(forIteratorRE, "").trim();
    //可能是key，也可能是index
    res.iterator1 = iteratorMatch[1].trim();
    //若存在，则一定是key
    if (iteratorMatch[2]) {
      res.iterator2 = iteratorMatch[2].trim();
    }
  } else {
    res.alias = alias;
  }
  return res;
}

function processIf(el) {
  const exp = getAndRemoveAttr(el, "v-if");
  if (exp) {
    //将if赋值为exp
    el.if = exp;
    addIfCondition(el, {
      exp: exp,
      block: el,
    });
  } else {
    if (getAndRemoveAttr(el, "v-else") != null) {
      //将else赋值为true
      el.else = true;
    }
    const elseif = getAndRemoveAttr(el, "v-else-if");
    //将elseif赋值为elseif
    if (elseif) {
      el.elseif = elseif;
    }
  }
}

//找到同级元素下的前一个元素，并将此el加入到这个元素的
//ifConditions下，而不会将v-else-if或v-else也解析为一个节点
function processIfConditions(el, parent) {
  const prev = findPrevElement(parent.children);
  if (prev && prev.if) {
    addIfCondition(prev, {
      exp: el.elseif,
      block: el,
    });
  } else if (process.env.NODE_ENV !== "production") {
    warn(
      `v-${el.elseif ? 'else-if="' + el.elseif + '"' : "else"} ` +
        `used on element <${el.tag}> without corresponding v-if.`,
      el.rawAttrsMap[el.elseif ? "v-else-if" : "v-else"]
    );
  }
}

function findPrevElement(children: Array<any>): ASTElement | void {
  let i = children.length;
  while (i--) {
    if (children[i].type === 1) {
      return children[i];
    } else {
      if (process.env.NODE_ENV !== "production" && children[i].text !== " ") {
        warn(
          `text "${children[i].text.trim()}" between v-if and v-else(-if) ` +
            `will be ignored.`,
          children[i]
        );
      }
      children.pop();
    }
  }
}

export function addIfCondition(el: ASTElement, condition: ASTIfCondition) {
  if (!el.ifConditions) {
    el.ifConditions = [];
  }
  el.ifConditions.push(condition);
}

function processOnce(el) {
  const once = getAndRemoveAttr(el, "v-once");
  if (once != null) {
    el.once = true;
  }
}

// handle content being passed to a component as slot,
// e.g. <template slot="xxx">, <div slot-scope="xxx">
function processSlotContent(el) {
  let slotScope;
  if (el.tag === "template") {
    //注意，此处是getAndRemoveAttr，而不是getBindingAttr，故而无法在vue中:slot-scope="some"
    slotScope = getAndRemoveAttr(el, "scope");
    /* istanbul ignore if */
    if (process.env.NODE_ENV !== "production" && slotScope) {
      warn(
        `the "scope" attribute for scoped slots have been deprecated and ` +
          `replaced by "slot-scope" since 2.5. The new "slot-scope" attribute ` +
          `can also be used on plain elements in addition to <template> to ` +
          `denote scoped slots.`,
        el.rawAttrsMap["scope"],
        true
      );
    }
    el.slotScope = slotScope || getAndRemoveAttr(el, "slot-scope");
  } else if ((slotScope = getAndRemoveAttr(el, "slot-scope"))) {
    /* istanbul ignore if */
    //v-for有更高的优先级，若将其和slot-scope同时使用，会导致其值的来源不为子组件通
    //过作用域插槽传递的值，而是当前组件的值
    //因此，若需要使用v-for，则需要在插槽内部
    if (process.env.NODE_ENV !== "production" && el.attrsMap["v-for"]) {
      warn(
        `Ambiguous combined usage of slot-scope and v-for on <${el.tag}> ` +
          `(v-for takes higher priority). Use a wrapper <template> for the ` +
          `scoped slot to make it clearer.`,
        el.rawAttrsMap["slot-scope"],
        true
      );
    }
    el.slotScope = slotScope;
  }

  // slot="xxx"
  const slotTarget = getBindingAttr(el, "slot");
  if (slotTarget) {
    el.slotTarget = slotTarget === '""' ? '"default"' : slotTarget;
    el.slotTargetDynamic = !!(
      el.attrsMap[":slot"] || el.attrsMap["v-bind:slot"]
    );
    // preserve slot as an attribute for native shadow DOM compat
    // only for non-scoped slots.
    //如果设置了slot，又没有设置slotScope，并且其为原生DOM元素，则将slot
    //当作DOM元素的原生slot属性处理
    if (el.tag !== "template" && !el.slotScope) {
      addAttr(el, "slot", slotTarget, getRawBindingAttr(el, "slot"));
    }
  }

  // 2.6 v-slot syntax
  if (process.env.NEW_SLOT_SYNTAX) {
    if (el.tag === "template") {
      // v-slot on <template>
      //返回name为v-slot的属性
      const slotBinding = getAndRemoveAttrByRegex(el, slotRE);
      if (slotBinding) {
        if (process.env.NODE_ENV !== "production") {
          //不能混合使用v-slot和slot-scope
          if (el.slotTarget || el.slotScope) {
            warn(`Unexpected mixed usage of different slot syntaxes.`, el);
          }
          //如果其父元素不为一个组件的话，则warn
          if (el.parent && !maybeComponent(el.parent)) {
            warn(
              `<template v-slot> can only appear at the root level inside ` +
                `the receiving component`,
              el
            );
          }
        }
        const { name, dynamic } = getSlotName(slotBinding);
        el.slotTarget = name;
        el.slotTargetDynamic = dynamic;
        //注意，在此一定会添加一个slotScope属性。即使没有value，也会默认为
        //emptySlotScopeToken
        //这样就会导致 v-slot 的写法，无论后面是否带value，即无论是：
        //v-slot:name  或者 v-slot:name = "value"
        //都会使其添加至父组件的scopedSlots中。
        //但是，会在最终生成render字符串(generate处)将其标志上一个.proxy的标识
        //而在最终生成vNode的时候，会将带有proxy标识的render节点，即生成为$slotScopes
        //也代理为$slots
        el.slotScope = slotBinding.value || emptySlotScopeToken; // force it into a scoped slot for perf
      }
      //tag不为template
    } else {
      // v-slot on component, denotes default slot
      //匹配v-slot和#
      const slotBinding = getAndRemoveAttrByRegex(el, slotRE);
      if (slotBinding) {
        if (process.env.NODE_ENV !== "production") {
          if (!maybeComponent(el)) {
            warn(
              `v-slot can only be used on components or <template>.`,
              slotBinding
            );
          }
          if (el.slotScope || el.slotTarget) {
            warn(`Unexpected mixed usage of different slot syntaxes.`, el);
          }
          if (el.scopedSlots) {
            warn(
              `To avoid scope ambiguity, the default slot should also use ` +
                `<template> syntax when there are other named slots.`,
              slotBinding
            );
          }
        }
        // add the component's children to its default slot
        const slots = el.scopedSlots || (el.scopedSlots = {});
        //取得v-slot的name(为自定义的name或者default)
        const { name, dynamic } = getSlotName(slotBinding);
        //创建了一个中间元素：
        //<div v-slot:fantasy="value">不为slotScope的元素</div>
        //<div v-slot:fantasy="value"><template v-slot:fantasy="value" >把不为slotScope的元素放入，且指定其为parent</template></div>
        const slotContainer = (slots[name] = createASTElement(
          "template",
          [],
          el
        ));
        slotContainer.slotTarget = name;
        slotContainer.slotTargetDynamic = dynamic;
        slotContainer.children = el.children.filter((c: any) => {
          if (!c.slotScope) {
            c.parent = slotContainer;
            return true;
          }
        });
        slotContainer.slotScope = slotBinding.value || emptySlotScopeToken;
        // remove children as they are returned from scopedSlots now
        //将div本身的children转移到创建的template中
        el.children = [];
        // mark el non-plain so data gets generated
        el.plain = false;
      }
    }
  }
}

function getSlotName(binding) {
  let name = binding.name.replace(slotRE, "");
  if (!name) {
    //如果截取掉v-slot或#后没有name，则为#时报错，为v-slot时指定为default
    if (binding.name[0] !== "#") {
      name = "default";
    } else if (process.env.NODE_ENV !== "production") {
      warn(`v-slot shorthand syntax requires a slot name.`, binding);
    }
  }
  return dynamicArgRE.test(name)
    ? // dynamic [name]
      { name: name.slice(1, -1), dynamic: true }
    : // static name
      { name: `"${name}"`, dynamic: false };
}

// handle <slot/> outlets
function processSlotOutlet(el) {
  if (el.tag === "slot") {
    el.slotName = getBindingAttr(el, "name");
    if (process.env.NODE_ENV !== "production" && el.key) {
      warn(
        `\`key\` does not work on <slot> because slots are abstract outlets ` +
          `and can possibly expand into multiple elements. ` +
          `Use the key on a wrapping element instead.`,
        getRawBindingAttr(el, "key")
      );
    }
  }
}

function processComponent(el) {
  let binding;
  if ((binding = getBindingAttr(el, "is"))) {
    el.component = binding;
  }
  if (getAndRemoveAttr(el, "inline-template") != null) {
    el.inlineTemplate = true;
  }
}

function processAttrs(el) {
  const list = el.attrsList;
  let i, l, name, rawName, value, modifiers, syncGen, isDynamic;
  for (i = 0, l = list.length; i < l; i++) {
    name = rawName = list[i].name;
    value = list[i].value;
    //v-，@, :
    if (dirRE.test(name)) {
      // mark element as dynamic
      //给拥有绑定属性的元素设置上hasBindings属性
      el.hasBindings = true;
      // modifiers
      //modifiers为修饰符。若不存在修饰符，则为undefined
      // {
      //   stop:true,
      //   native:true,
      //   sync:true
      // }
      modifiers = parseModifiers(name.replace(dirRE, ""));
      // support .foo shorthand syntax for the .prop modifier
      if (process.env.VBIND_PROP_SHORTHAND && propBindRE.test(name)) {
        (modifiers || (modifiers = {})).prop = true;
        name = `.` + name.slice(1).replace(modifierRE, "");
      } else if (modifiers) {
        name = name.replace(modifierRE, "");
      }
      if (bindRE.test(name)) {
        // v-bind
        name = name.replace(bindRE, "");
        value = parseFilters(value);
        //如果属性名是动态的，即 [name]形式
        isDynamic = dynamicArgRE.test(name);
        if (isDynamic) {
          //将属性名截取掉左右的[]
          name = name.slice(1, -1);
        }
        if (
          process.env.NODE_ENV !== "production" &&
          value.trim().length === 0
        ) {
          warn(
            `The value for a v-bind expression cannot be empty. Found in "v-bind:${name}"`
          );
        }
        if (modifiers) {
          //如果为v-bind属性设置了prop修饰符
          if (modifiers.prop && !isDynamic) {
            //将属性名转换为驼峰
            name = camelize(name);
            if (name === "innerHtml") name = "innerHTML";
          }
          //如果为v-bind属性设置了camelize修饰符
          if (modifiers.camel && !isDynamic) {
            name = camelize(name);
          }
          //如果为v-bind属性设置了sync修饰符，则将sync自动解析:
          //:data.sync="value"
          // :data="value" @update:data="function(val){data=value}"
          if (modifiers.sync) {
            syncGen = genAssignmentCode(value, `$event`);
            if (!isDynamic) {
              //将驼峰和连字符两种形式的属性名都添加update:${name}事件
              addHandler(
                el,
                `update:${camelize(name)}`,
                syncGen,
                null,
                false,
                warn,
                list[i]
              );
              if (hyphenate(name) !== camelize(name)) {
                addHandler(
                  el,
                  `update:${hyphenate(name)}`,
                  syncGen,
                  null,
                  false,
                  warn,
                  list[i]
                );
              }
            } else {
              // handler w/ dynamic event name
              addHandler(
                el,
                `"update:"+(${name})`,
                syncGen,
                null,
                false,
                warn,
                list[i],
                true // dynamic
              );
            }
          }
        }
        //根据不同情况选择将属性添加至props或者attrs
        //如果属性设置了prop，或者不为component且在平台化包装中必须要用prop使用的属性

        //platformMustUseProp:
        // input,textarea,option,select,progress 这些标签的 value 属性都应该使用元素对象的原生的 prop 绑定（除了 type === 'button' 之外）
        // option 标签的 selected 属性应该使用元素对象的原生的 prop 绑定
        // input 标签的 checked 属性应该使用元素对象的原生的 prop 绑定
        // video 标签的 muted 属性应该使用元素对象的原生的 prop 绑定

        //意味着即使你在绑定以上属性时没有使用 prop 修饰符，那么它们依然会被当做原生DOM对象的属性。

        //为什么需要排除component
        //platformMustUseProp 函数在判断的时候需要标签的名字(el.tag)，而
        //el.component 会在元素渲染阶段替换掉 el.tag 的值。所以如果 el.component
        //存在则会影响 platformMustUseProp 的判断结果。
        if (
          (modifiers && modifiers.prop) ||
          (!el.component && platformMustUseProp(el.tag, el.attrsMap.type, name))
        ) {
          addProp(el, name, value, list[i], isDynamic);
        } else {
          addAttr(el, name, value, list[i], isDynamic);
        }
        //如果是v-on
      } else if (onRE.test(name)) {
        // v-on
        name = name.replace(onRE, "");
        //动态属性名[name]
        isDynamic = dynamicArgRE.test(name);
        if (isDynamic) {
          name = name.slice(1, -1);
        }
        //在元素上添加了events和nativeEvents属性，来存放所绑定的事件
        addHandler(el, name, value, modifiers, false, warn, list[i], isDynamic);
      } else {
        //如果符合dirRE条件的属性名不为bind和on，可能为自定义指令，也可能为v-model, v-text等
        // normal directives
        name = name.replace(dirRE, "");
        // parse arg
        const argMatch = name.match(argRE);
        //捕获属性名中的key，如v-directive:key
        let arg = argMatch && argMatch[1];
        isDynamic = false;
        if (arg) {
          //只留下指令名：directive
          name = name.slice(0, -(arg.length + 1));
          //去除[]
          if (dynamicArgRE.test(arg)) {
            arg = arg.slice(1, -1);
            isDynamic = true;
          }
        }
        addDirective(
          el,
          name,
          rawName,
          value,
          arg,
          isDynamic,
          modifiers,
          list[i]
        );
        //如果该指令是v-model，则check其是否在v-for的后代元素节点(childNodes)内，
        //若是则警告
        //如下述情况：若item为基本类型
        //<div v-for="item of list">
        //  <input v-model="item" />
        //</div>
        //会导致v-model无效，因为其绑定的是函数的局部作用域内的变量，而非指向vue的data

        //但是，若item引用类型，则可以正常绑定
        if (process.env.NODE_ENV !== "production" && name === "model") {
          checkForAliasModel(el, value);
        }
      }
    } else {
      //处理非指令的属性，即普通指令  style="" class=""
      // literal attribute
      if (process.env.NODE_ENV !== "production") {
        //如果在非绑定属性中使用了模板语法
        const res = parseText(value, delimiters);
        if (res) {
          warn(
            `${name}="${value}": ` +
              "Interpolation inside attributes has been removed. " +
              "Use v-bind or the colon shorthand instead. For example, " +
              'instead of <div id="{{ val }}">, use <div :id="val">.',
            list[i]
          );
        }
      }
      //将属性添加至attrs中，并且stringify限制解析
      addAttr(el, name, JSON.stringify(value), list[i]);
      // #6887 firefox doesn't update muted state if set via attribute
      // even immediately after element creation

      //火狐浏览器中存在无法通过DOM元素的 setAttribute 方法为 video 标签添加
      // muted 属性

      //如果满足下述条件，则会将muted属性额外添加至props中，因为在生成真实的
      //dom时，attrs是通过setAttribute实现，而props则是直接添加属性，dom.muted = true
      if (
        !el.component &&
        name === "muted" &&
        platformMustUseProp(el.tag, el.attrsMap.type, name)
      ) {
        addProp(el, name, "true", list[i]);
      }
    }
  }
}

function checkInFor(el: ASTElement): boolean {
  let parent = el;
  while (parent) {
    if (parent.for !== undefined) {
      return true;
    }
    parent = parent.parent;
  }
  return false;
}

function parseModifiers(name: string): Object | void {
  //用来处理属性中的修饰符，如：@click.stop.native="handler"的stop和native,
  const match = name.match(modifierRE);
  if (match) {
    const ret = {};
    match.forEach((m) => {
      ret[m.slice(1)] = true;
    });
    return ret;
  }
}

function makeAttrsMap(attrs: Array<Object>): Object {
  const map = {};
  for (let i = 0, l = attrs.length; i < l; i++) {
    if (
      process.env.NODE_ENV !== "production" &&
      map[attrs[i].name] &&
      !isIE &&
      !isEdge
    ) {
      warn("duplicate attribute: " + attrs[i].name, attrs[i]);
    }
    map[attrs[i].name] = attrs[i].value;
  }
  return map;
}

// for script (e.g. type="x/template") or style, do not decode content
function isTextTag(el): boolean {
  return el.tag === "script" || el.tag === "style";
}

function isForbiddenTag(el): boolean {
  return (
    el.tag === "style" ||
    (el.tag === "script" &&
      (!el.attrsMap.type || el.attrsMap.type === "text/javascript"))
  );
}

const ieNSBug = /^xmlns:NS\d+/;
const ieNSPrefix = /^NS\d+:/;

/* istanbul ignore next */
function guardIESVGBug(attrs) {
  const res = [];
  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs[i];
    if (!ieNSBug.test(attr.name)) {
      attr.name = attr.name.replace(ieNSPrefix, "");
      res.push(attr);
    }
  }
  return res;
}

function checkForAliasModel(el, value) {
  let _el = el;
  while (_el) {
    if (_el.for && _el.alias === value) {
      warn(
        `<${el.tag} v-model="${value}">: ` +
          `You are binding v-model directly to a v-for iteration alias. ` +
          `This will not be able to modify the v-for source array because ` +
          `writing to the alias is like modifying a function local variable. ` +
          `Consider using an array of objects and use v-model on an object property instead.`,
        el.rawAttrsMap["v-model"]
      );
    }
    _el = _el.parent;
  }
}
