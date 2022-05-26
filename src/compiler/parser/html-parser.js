/**
 * Not type-checking this file because it's mostly vendor code.
 */

/*!
 * HTML Parser By John Resig (ejohn.org)
 * Modified by Juriy "kangax" Zaytsev
 * Original code by Erik Arvidsson (MPL-1.1 OR Apache-2.0 OR GPL-2.0-or-later)
 * http://erik.eae.net/simplehtmlparser/simplehtmlparser.js
 */

import { makeMap, no } from "shared/util";
import { isNonPhrasingTag } from "web/compiler/util";
import { unicodeRegExp } from "core/util/lang";

// Regular Expressions for parsing tags and attributes
//attribute正则对应的匹配项：
// 1、使用双引号把值引起来：class="some-class"
// 2、使用单引号把值引起来：class='some-class'
// 3、不使用引号：class=some-class
// 4、单独的属性名：disabled
const attribute =
  /^\s*([^\s"'<>\/=]+)(?:\s*(=)\s*(?:"([^"]*)"+|'([^']*)'+|([^\s"'=<>`]+)))?/;
//匹配vue的指令
const dynamicArgAttribute =
  /^\s*((?:v-[\w-]+:|@|:|#)\[[^=]+?\][^\s"'<>\/=]*)(?:\s*(=)\s*(?:"([^"]*)"+|'([^']*)'+|([^\s"'=<>`]+)))?/;

//ncname正则对应的匹配项：XML没有使用空间命名的tag(用户自定义的tag<my-tag>)
const ncname = `[a-zA-Z_][\\-\\.0-9_a-zA-Z${unicodeRegExp.source}]*`;

//qnameCapture正则匹配项：
//实际上就是合法的标签名称，它是由可选项的 前缀、冒号 以及 名称 组成，观察qnameCapture
//可知它有一个捕获分组，捕获的内容就是整个 qname 名称，即整个标签的名称。
const qnameCapture = `((?:${ncname}\\:)?${ncname})`;

//startTagOpen正则匹配项：用来捕获匹配的起始标签的开始
const startTagOpen = new RegExp(`^<${qnameCapture}`);
//startTagClose正则匹配项：起始标签的结尾
const startTagClose = /^\s*(\/?)>/;
//endTag正则匹配项：结束标签
const endTag = new RegExp(`^<\\/${qnameCapture}[^>]*>`);
//doctype正则匹配项：<!DOCTYPE>
const doctype = /^<!DOCTYPE [^>]+>/i;
// #7298: escape - to avoid being passed as HTML comment when inlined in page
//commoent正则匹配项：注释<!-->
const comment = /^<!\--/;
//conditionalComment正则匹配项：匹配条件注释：<![
const conditionalComment = /^<!\[/;

// Special Elements (can contain anything)
//用来检测给定的标签名字是不是纯文本标签（包括：script、style、textarea）
export const isPlainTextElement = makeMap("script,style,textarea", true);
const reCache = {};

//常量 decodingMap 以及两个正则 encodedAttr 和 encodedAttrWithNewLines 的作用
//就是用来完成对 html 实体进行解码
const decodingMap = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&amp;": "&",
  "&#10;": "\n",
  "&#9;": "\t",
  "&#39;": "'",
};
const encodedAttr = /&(?:lt|gt|quot|amp|#39);/g;
const encodedAttrWithNewLines = /&(?:lt|gt|quot|amp|#39|#10|#9);/g;

// #5992
//用来判断是否应该忽略标签内容的第一个换行符的，如果满足：标签是 pre 或者
//textarea 且 标签内容的第一个字符是换行符，则返回 true，否则为 false
const isIgnoreNewlineTag = makeMap("pre,textarea", true);
const shouldIgnoreFirstNewline = (tag, html) =>
  tag && isIgnoreNewlineTag(tag) && html[0] === "\n";

//解码
function decodeAttr(value, shouldDecodeNewlines) {
  const re = shouldDecodeNewlines ? encodedAttrWithNewLines : encodedAttr;
  return value.replace(re, (match) => decodingMap[match]);
}

export function parseHTML(html, options) {
  //处理标签不闭合问题，利用解括号闭合的思想( [{({)}] )入栈出栈
  const stack = [];
  const expectHTML = options.expectHTML;
  const isUnaryTag = options.isUnaryTag || no;
  const canBeLeftOpenTag = options.canBeLeftOpenTag || no;
  let index = 0;
  let last, lastTag;
  while (html) {
    last = html;
    // Make sure we're not in a plaintext content element like script/style
    //如果不存在栈顶标签或栈顶不是纯文本标签(script,style,textarea)
    if (!lastTag || !isPlainTextElement(lastTag)) {
      let textEnd = html.indexOf("<");
      //如果 < 出现在0位置
      //可能出现的情况：
      // 1、可能是注释节点：<!-- -->
      // 2、可能是条件注释节点：<![ ]>
      // 3、可能是 doctype：<!DOCTYPE >
      // 4、可能是结束标签：</xxx>
      // 5、可能是开始标签：<xxx>
      // 6、可能只是一个单纯的字符串：<abcdefg
      if (textEnd === 0) {
        // Comment:
        //如果(可能)是注释节点(必须满足<!--开头-->结尾才是注释节点)
        if (comment.test(html)) {
          //注释节点必须以 --> 结尾
          const commentEnd = html.indexOf("-->");

          if (commentEnd >= 0) {
            //如果需要保留注释，则截取<!--  -->之间的内容
            if (options.shouldKeepComment) {
              options.comment(
                html.substring(4, commentEnd),
                index,
                index + commentEnd + 3
              );
            }
            advance(commentEnd + 3);
            continue;
          }
        }

        // http://en.wikipedia.org/wiki/Conditional_comment#Downlevel-revealed_conditional_comment
        if (conditionalComment.test(html)) {
          const conditionalEnd = html.indexOf("]>");
          //编译结果不会保留条件注释的值，只会做简单的跳过处理
          if (conditionalEnd >= 0) {
            advance(conditionalEnd + 2);
            continue;
          }
        }

        // Doctype:
        //数组的第一项保存着整个匹配项的字符串，即整个 Doctype 标签的字符串
        const doctypeMatch = html.match(doctype);
        if (doctypeMatch) {
          //不做编译处理，直接跳过(原则上vue模板中不会出现<!DOCTYPE>)
          advance(doctypeMatch[0].length);
          continue;
        }

        // Start tag:
        const startTagMatch = parseStartTag();
        if (startTagMatch) {
          handleStartTag(startTagMatch);
          //处理"pre,textarea"第一个字符串的浏览器自定忽略换行问题
          if (shouldIgnoreFirstNewline(startTagMatch.tagName, html)) {
            advance(1);
          }
          continue;
        }

        // End tag:
        const endTagMatch = html.match(endTag);
        if (endTagMatch) {
          const curIndex = index;
          advance(endTagMatch[0].length);
          parseEndTag(endTagMatch[1], curIndex, index);
          continue;
        }
      }

      let text, rest, next;
      //如果textEnd >= 0 ；即html起始为<，但是不是以上标签，或者存在<，但是不是起始
      if (textEnd >= 0) {
        rest = html.slice(textEnd);
        //一直找到最后一个不为标签的<的位置，为textEnd，并将之前的内容赋值为text
        while (
          !endTag.test(rest) &&
          !startTagOpen.test(rest) &&
          !comment.test(rest) &&
          !conditionalComment.test(rest)
        ) {
          // < in plain text, be forgiving and treat it as text
          next = rest.indexOf("<", 1);
          if (next < 0) break;
          textEnd += next;
          rest = html.slice(textEnd);
        }
        //textEnd之前的内容，即为标签之间的内容，即text
        text = html.substring(0, textEnd);
      }

      //如果textEnd小于0，则代表所有的内容都为text(找不到<)；则将全部都赋值为text
      if (textEnd < 0) {
        text = html;
      }

      if (text) {
        advance(text.length);
      }

      if (options.chars && text) {
        options.chars(text, index - text.length, index);
      }

      //如果标签为纯文本标签(script，style，textarea)，则会执行else分支

      //目的是为了吧纯文本标签的内容处理为text
    } else {
      let endTagLength = 0;
      const stackedTag = lastTag.toLowerCase();
      //用来匹配纯文本标签之间text的正则
      const reStackedTag =
        reCache[stackedTag] ||
        (reCache[stackedTag] = new RegExp(
          "([\\s\\S]*?)(</" + stackedTag + "[^>]*>)",
          "i"
        ));
      const rest = html.replace(reStackedTag, function (all, text, endTag) {
        endTagLength = endTag.length;
        if (!isPlainTextElement(stackedTag) && stackedTag !== "noscript") {
          text = text
            .replace(/<!\--([\s\S]*?)-->/g, "$1") // #7298
            .replace(/<!\[CDATA\[([\s\S]*?)]]>/g, "$1");
        }
        if (shouldIgnoreFirstNewline(stackedTag, text)) {
          text = text.slice(1);
        }
        if (options.chars) {
          options.chars(text);
        }
        return "";
      });
      index += html.length - rest.length;
      html = rest;
      parseEndTag(stackedTag, index - endTagLength, index);
    }

    //html === last，代表其为纯文本字符串
    //当结尾的text为0<1<2的时候，最后的<2无法处理，因为
    //在text处理循环中匹配不到下一个<则无法截取到这部分文本

    if (html === last) {
      //将html全部处理为text类型
      options.chars && options.chars(html);
      //进入此判断的必要条件，就是末尾没有标签，若此时stack还存在标签，则代表
      //此文本内容出现在了标签以外
      if (
        process.env.NODE_ENV !== "production" &&
        //如果此时栈中不存在标签，则代表为这种情况:<div></div>aaa,则警告
        !stack.length &&
        options.warn
      ) {
        options.warn(`Mal-formatted tag at end of template: "${html}"`, {
          start: index + html.length,
        });
      }
      break;
    }
  }

  // Clean up any remaining tags

  //循环完毕时，检测stack中是否还存在标签，若有则代表有不闭合标签，利用parseEndTag
  //发出警告
  parseEndTag();

  //用来去掉已编译过的html，截取待解析的html
  function advance(n) {
    index += n;
    html = html.substring(n);
  }

  //用来解析开始标签
  function parseStartTag() {
    const start = html.match(startTagOpen);
    if (start) {
      //match用来记录标签名(如div)，属性，html匹配的起始index，匹配完毕的结束位置，以及是否为一元标签
      //标签
      const match = {
        tagName: start[1],
        attrs: [],
        start: index,
      };
      advance(start[0].length);
      let end, attr;
      while (
        !(end = html.match(startTagClose)) &&
        (attr = html.match(dynamicArgAttribute) || html.match(attribute))
      ) {
        attr.start = index;
        advance(attr[0].length);
        attr.end = index;
        match.attrs.push(attr);
      }
      if (end) {
        //end为['/>','/']，或者['>',undefined]
        //拥有end[1]即表示其为一元标签
        match.unarySlash = end[1];
        advance(end[0].length);
        match.end = index;
        return match;
      }
    }
  }
  //handleStartTag 函数用来处理 parseStartTag 的结果
  //主要是用来处理attrs
  function handleStartTag(match) {
    const tagName = match.tagName;
    const unarySlash = match.unarySlash;

    if (expectHTML) {
      //如果stack顶的标签是p标签，且当前正在解析的开始标签必须不能是 段落式内容。
      //否则将做特殊处理：
      // <p><div>123</div></p> ==> <p></p><div>123</div><p></p>
      if (lastTag === "p" && isNonPhrasingTag(tagName)) {
        parseEndTag(lastTag);
      }
      //如果标签可以省略结束标签，且当当前正在解析的标签与上一个标签相同，则自动闭合
      //上一个标签
      if (canBeLeftOpenTag(tagName) && lastTag === tagName) {
        parseEndTag(tagName);
      }
    }

    //标识是否是一元标签
    //除了标准规定的一元标签外，自定义组件依旧可能是一元标签<my-component/>
    const unary = isUnaryTag(tagName) || !!unarySlash;

    const l = match.attrs.length;
    const attrs = new Array(l);
    for (let i = 0; i < l; i++) {
      const args = match.attrs[i];
      //修复火狐的bug；
      //当捕获组匹配不到值时那么捕获组对应变量的值应该是 undefined 而不是空字符串
      if (IS_REGEX_CAPTURING_BROKEN && args[0].indexOf('""') === -1) {
        if (args[3] === "") {
          delete args[3];
        }
        if (args[4] === "") {
          delete args[4];
        }
        if (args[5] === "") {
          delete args[5];
        }
      }
      //取得捕获组中的value, 如果没有value，则给value赋值空字符串(for v-else，v-pre等)
      const value = args[3] || args[4] || args[5] || "";
      const shouldDecodeNewlines =
        tagName === "a" && args[1] === "href"
          ? options.shouldDecodeNewlinesForHref
          : options.shouldDecodeNewlines;
      //此时，每一个attrs就变成了{name,value}的形式
      attrs[i] = {
        name: args[1],
        value: decodeAttr(value, shouldDecodeNewlines),
      };
      if (process.env.NODE_ENV !== "production" && options.outputSourceRange) {
        attrs[i].start = args.start + args[0].match(/^\s*/).length;
        attrs[i].end = args.end;
      }
    }
    //如果不是一元标签，则入栈
    if (!unary) {
      stack.push({
        tag: tagName,
        lowerCasedTag: tagName.toLowerCase(),
        attrs: attrs,
        start: match.start,
        end: match.end,
      });
      lastTag = tagName;
    }

    if (options.start) {
      options.start(tagName, attrs, unary, match.start, match.end);
    }
  }
  //用来解析结束标签
  //主要是检索栈中是否有与其对应的且位置正确的起始标签tagName，
  //正确情况下，一定匹配到的是栈顶的标签，若出现了匹配项不为栈顶的情况，则
  //代表在此匹配项之前的标签为不闭合标签，则需要warn，并从栈中清除这些项
  function parseEndTag(tagName, start, end) {
    let pos, lowerCasedTagName;
    if (start == null) start = index;
    if (end == null) end = index;

    // Find the closest opened tag of the same type
    if (tagName) {
      lowerCasedTagName = tagName.toLowerCase();
      //去栈中寻找是否存在相同的tag，方向从栈顶往栈尾
      for (pos = stack.length - 1; pos >= 0; pos--) {
        if (stack[pos].lowerCasedTag === lowerCasedTagName) {
          break;
        }
      }
    } else {
      // If no tag name is provided, clean shop
      //这是为了调用parseEndTag()，不传参从而达到检索stack是否清空的手段
      //如果没有tagName，则将pos置为0，代表栈中所有的标签都不闭合，需要warn并清理
      pos = 0;
    }

    if (pos >= 0) {
      // Close all the open elements, up the stack
      for (let i = stack.length - 1; i >= pos; i--) {
        //如果stack的i>pos，则代表在pos之前的标签是未闭合的，则warn
        if (
          process.env.NODE_ENV !== "production" &&
          (i > pos || !tagName) &&
          options.warn
        ) {
          options.warn(`tag <${stack[i].tag}> has no matching end tag.`, {
            start: stack[i].start,
            end: stack[i].end,
          });
        }
        //调用 options.end(stack[i].tag, start, end) 立即将其闭合，这是为了保证
        //解析结果的正确性
        if (options.end) {
          options.end(stack[i].tag, start, end);
        }
      }

      // Remove the open elements from the stack
      //清除掉匹配项及其之前的所有不闭合标签
      stack.length = pos;
      //重置lastTag
      lastTag = pos && stack[pos - 1].tag;

      //将</br>解析为<br>，</p>解析为<p>，与浏览器行为保持一致
    } else if (lowerCasedTagName === "br") {
      if (options.start) {
        options.start(tagName, [], true, start, end);
      }
    } else if (lowerCasedTagName === "p") {
      if (options.start) {
        options.start(tagName, [], false, start, end);
      }
      if (options.end) {
        options.end(tagName, start, end);
      }
    }
  }
}

('<div v-if="isSucceed" v-for="v in map"></div>');
//其startTag会匹配成如下
match = {
  tagName: "div",
  attrs: [
    [' v-if="isSucceed"', "v-if", "=", "isSucceed", undefined, undefined],
    [' v-for="v in map"', "v-for", "=", "v in map", undefined, undefined],
  ],
  start: index,
  unarySlash: undefined,
  end: index,
};

match = {
  tag: "div",
  lowerCasedTag: "div",
  attrs: [
    {
      name: "v-if",
      value: "isSucceed",
    },
    {
      name: "v-for",
      value: "v in map",
    },
  ],
  start: index,
  end: index,
};
