/* @flow */

import { cached } from "shared/util";
import { parseFilters } from "./filter-parser";

const defaultTagRE = /\{\{((?:.|\r?\n)+?)\}\}/g;
const regexEscapeRE = /[-.*+?^${}()|[\]\/\\]/g;

const buildRegex = cached((delimiters) => {
  const open = delimiters[0].replace(regexEscapeRE, "\\$&");
  const close = delimiters[1].replace(regexEscapeRE, "\\$&");
  return new RegExp(open + "((?:.|\\n)+?)" + close, "g");
});

type TextParseResult = {
  expression: string,
  tokens: Array<string | { "@binding": string }>,
};

export function parseText(
  text: string,
  delimiters?: [string, string]
): TextParseResult | void {
  //用户可以通过delimiters选项自定义字面量表达式的分隔符
  //比如可以将其配置为['${', '}']，而不使用{{}}，但是正则匹配的原理都一样
  //都是匹配模板的内容
  const tagRE = delimiters ? buildRegex(delimiters) : defaultTagRE;
  if (!tagRE.test(text)) {
    return;
  }
  const tokens = [];
  const rawTokens = [];
  let lastIndex = (tagRE.lastIndex = 0);
  let match, index, tokenValue;
  //通过正则的exec方法来遍历匹配文本内容中所有的模板语法

  //若text：abc {{name|filter}} cba {{age}} aaa
  //match = ['{{name|filter}}', 'name|filter']
  //match = ['{{age}}', 'age']
  while ((match = tagRE.exec(text))) {
    index = match.index;
    // push text token
    if (index > lastIndex) {
      //lastIndex为上次匹配模板语法的结尾，而index为当前匹配模板语法的起始
      //在此中间的即为未匹配的内容，即非模板语法中的普通文本
      rawTokens.push((tokenValue = text.slice(lastIndex, index)));
      tokens.push(JSON.stringify(tokenValue));
    }
    // tag token
    //解析filter语法
    const exp = parseFilters(match[1].trim());
    tokens.push(`_s(${exp})`);
    rawTokens.push({ "@binding": exp });
    //将lastIndex赋值为match的末尾位置(不包括)
    lastIndex = index + match[0].length;
    //第一次循环是的结果：
    // tokens = ["'abc'", '_s(_f("filter")(name))'];
    // rawTokens = [
    //   "abc",
    //   {
    //     "@binding": "_f('filter')(name)",
    //   },
    // ];
  }
  //处理aaa的情况
  //当模板语法之后仍然存在普通文本的时候，需要在循环之后手动处理，因为while中
  //只能处理开头的普通文本，模板语法，和模板语法之间的普通文本
  if (lastIndex < text.length) {
    rawTokens.push((tokenValue = text.slice(lastIndex)));
    tokens.push(JSON.stringify(tokenValue));
  }
  return {
    expression: tokens.join("+"),
    tokens: rawTokens,
  };
}
