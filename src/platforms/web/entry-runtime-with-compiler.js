/* @flow */

import config from "core/config";
import { warn, cached } from "core/util/index";
import { mark, measure } from "core/util/perf";

import Vue from "./runtime/index";
import { query } from "./util/index";
import { compileToFunctions } from "./compiler/index";
import {
  shouldDecodeNewlines,
  shouldDecodeNewlinesForHref,
} from "./util/compat";

//根据Id获取dom元素的后代
const idToTemplate = cached((id) => {
  const el = query(id);
  return el && el.innerHTML;
});

const mount = Vue.prototype.$mount;
//重写mount方法，为$mount增加了模板编译的功能
//第一次挂载是在 _VUEs\_vue\src\platforms\web\runtime\index.js
Vue.prototype.$mount = function (
  el?: string | Element,
  hydrating?: boolean
): Component {
  //挂载点
  el = el && query(el);

  /* istanbul ignore if */
  //载体的意思是组件挂载的占位，会被组件自身的模板给替换掉，但是body和html是不可替换的
  if (el === document.body || el === document.documentElement) {
    process.env.NODE_ENV !== "production" &&
      warn(
        `Do not mount Vue to <html> or <body> - mount to normal elements instead.`
      );
    return this;
  }

  const options = this.$options;
  // resolve template/el and convert to render function
  //如果有runder函数，则什么都不用做，不需要编译

  //这就意味着，如果options中已存在render属性，则template会被忽略
  if (!options.render) {
    let template = options.template;
    if (template) {
      if (typeof template === "string") {
        //如果第一个字符是 #，那么会把该字符串作为 css 选择符去选中对应的元素，并把
        //该元素的 innerHTML 作为模板

        //如果第一个字符不是 #，那么什么都不做，就用 template 自身的字符串值作为模板
        if (template.charAt(0) === "#") {
          template = idToTemplate(template);
          /* istanbul ignore if */
          if (process.env.NODE_ENV !== "production" && !template) {
            warn(
              `Template element not found or is empty: ${options.template}`,
              this
            );
          }
        }
        //template 的类型是元素节点(template.nodeType 存在),则使用该元素的
        //innerHTML 作为模板
      } else if (template.nodeType) {
        template = template.innerHTML;
      } else {
        if (process.env.NODE_ENV !== "production") {
          warn("invalid template option:" + template, this);
        }
        return this;
      }
    } else if (el) {
      //如果 template 选项不存在，那么使用 el 元素的 outerHTML 作为模板内容
      template = getOuterHTML(el);
    }

    //此时 template 变量中存储着最终用来生成渲染函数的字符串
    if (template) {
      /* istanbul ignore if */
      if (process.env.NODE_ENV !== "production" && config.performance && mark) {
        mark("compile");
      }

      //compileToFunctions 函数将模板(template)字符串编译为渲染函数(render)
      const { render, staticRenderFns } = compileToFunctions(
        template,
        {
          outputSourceRange: process.env.NODE_ENV !== "production",
          shouldDecodeNewlines,
          shouldDecodeNewlinesForHref,
          delimiters: options.delimiters,
          comments: options.comments,
        },
        this
      );
      //将最终生成的render函数和staticRenderFns挂载到$options上
      options.render = render;
      options.staticRenderFns = staticRenderFns;

      /* istanbul ignore if */
      if (process.env.NODE_ENV !== "production" && config.performance && mark) {
        mark("compile end");
        measure(`vue ${this._name} compile`, "compile", "compile end");
      }
    }
  }
  //经过上述的将模板编译为render函数的处理之后，再调用mount函数
  //而mount函数中只做了两件事情：处理el，即$mount传递的参数；调用mountComponent
  return mount.call(this, el, hydrating);
};

/**
 * Get outerHTML of elements, taking care
 * of SVG elements in IE as well.
 */
//获取outHtml：可替换当前dom
function getOuterHTML(el: Element): string {
  if (el.outerHTML) {
    return el.outerHTML;
  } else {
    const container = document.createElement("div");
    container.appendChild(el.cloneNode(true));
    return container.innerHTML;
  }
}

//将compile函数暴露给开发者
Vue.compile = compileToFunctions;

export default Vue;
