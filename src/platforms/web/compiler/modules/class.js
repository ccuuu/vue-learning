/* @flow */

import { parseText } from "compiler/parser/text-parser";
import { getAndRemoveAttr, getBindingAttr, baseWarn } from "compiler/helpers";

function transformNode(el: ASTElement, options: CompilerOptions) {
  const warn = options.warn || baseWarn;
  const staticClass = getAndRemoveAttr(el, "class");
  //对于此种形式的声明<div class="{{ val }}">发出警告
  if (process.env.NODE_ENV !== "production" && staticClass) {
    const res = parseText(staticClass, options.delimiters);
    if (res) {
      warn(
        `class="${staticClass}": ` +
          "Interpolation inside attributes has been removed. " +
          "Use v-bind or the colon shorthand instead. For example, " +
          'instead of <div class="{{ val }}">, use <div :class="val">.',
        el.rawAttrsMap["class"]
      );
    }
  }
  if (staticClass) {
    //将多个空格或换行替换成一个空格，并trim
    //做stringify处理，防止解析
    el.staticClass = JSON.stringify(staticClass.replace(/\s+/g, " ").trim());
  }
  //获取动态绑定的class属性 :class="{'someclass':true}"
  const classBinding = getBindingAttr(el, "class", false /* getStatic */);
  if (classBinding) {
    el.classBinding = classBinding;
  }
}

function genData(el: ASTElement): string {
  let data = "";
  if (el.staticClass) {
    data += `staticClass:${el.staticClass},`;
  }
  if (el.classBinding) {
    data += `class:${el.classBinding},`;
  }
  return data;
}

export default {
  staticKeys: ["staticClass"],
  transformNode,
  genData,
};
