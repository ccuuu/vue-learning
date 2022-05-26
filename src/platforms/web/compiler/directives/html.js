/* @flow */

import { addProp } from "compiler/helpers";

export default function html(el: ASTElement, dir: ASTDirective) {
  if (dir.value) {
    //_s为toString
    //会将v-html指令解析为一个名为innerHTML的HTML属性（最终会在patch中对其做处理）
    addProp(el, "innerHTML", `_s(${dir.value})`, dir);
  }
}
