/* @flow */

import { noop, extend } from "shared/util";
import { warn as baseWarn, tip } from "core/util/debug";
import { generateCodeFrame } from "./codeframe";

type CompiledFunctionResult = {
  render: Function,
  staticRenderFns: Array<Function>,
};

function createFunction(code, errors) {
  try {
    return new Function(code);
  } catch (err) {
    errors.push({ err, code });
    return noop;
  }
}

export function createCompileToFunctionFn(compile: Function): Function {
  //利用闭包缓存
  //缓存编译结果，防止重复编译(即当某个公用组件在同一个组件或不同组件重复引入的时候，只会编译一次)

  const cache = Object.create(null);

  //编译的主要过程：
  //1，将编译模板缓存，以防重复编译
  //2，调用compile将模板编译为render函数数字字符串
  //3，调用createFunction将render函数数字字符串转换为真实渲染函数
  //4，打印上述过程产生的错误或提示信息

  return function compileToFunctions(
    template: string,
    options?: CompilerOptions,
    vm?: Component
  ): CompiledFunctionResult {
    options = extend({}, options);
    const warn = options.warn || baseWarn;
    delete options.warn;

    /* istanbul ignore if */
    //环境策略检测；compiler的编译过程依赖于new Function()，如果此时用户定义的
    //策略不支持new Function，则会提示用户修改策略，或者直接使用render函数编写代码
    if (process.env.NODE_ENV !== "production") {
      // detect possible CSP restriction
      try {
        new Function("return 1");
      } catch (e) {
        if (e.toString().match(/unsafe-eval|CSP/)) {
          warn(
            "It seems you are using the standalone build of Vue.js in an " +
              "environment with Content Security Policy that prohibits unsafe-eval. " +
              "The template compiler cannot work in this environment. Consider " +
              "relaxing the policy to allow unsafe-eval or pre-compiling your " +
              "templates into render functions."
          );
        }
      }
    }

    // check cache
    //缓存编译结果，防止重复编译
    const key = options.delimiters
      ? String(options.delimiters) + template
      : template;
    //如果该模板已被编译，则不会进行重复编译，直接返回cache的缓存结果
    if (cache[key]) {
      return cache[key];
    }

    // compile
    //compile函数从createCompiler处当作参数传递过来
    const compiled = compile(template, options);

    //
    //compile函数的作用
    // 1、生成最终编译器选项 finalOptions
    // 2、对错误的收集
    // 3、调用 baseCompile 编译模板

    // check compilation errors/tips
    //打印出模板编译时产生的错误和提示信息
    if (process.env.NODE_ENV !== "production") {
      if (compiled.errors && compiled.errors.length) {
        if (options.outputSourceRange) {
          compiled.errors.forEach((e) => {
            warn(
              `Error compiling template:\n\n${e.msg}\n\n` +
                generateCodeFrame(template, e.start, e.end),
              vm
            );
          });
        } else {
          warn(
            `Error compiling template:\n\n${template}\n\n` +
              compiled.errors.map((e) => `- ${e}`).join("\n") +
              "\n",
            vm
          );
        }
      }
      if (compiled.tips && compiled.tips.length) {
        if (options.outputSourceRange) {
          compiled.tips.forEach((e) => tip(e.msg, vm));
        } else {
          compiled.tips.forEach((msg) => tip(msg, vm));
        }
      }
    }

    // turn code into functions
    //作为最后的结果
    const res = {};
    //收集createFunction产生的错误
    const fnGenErrors = [];
    //将生成的render函数字符串和staticRenderFns字符串通过New Function最终生成为函数
    res.render = createFunction(compiled.render, fnGenErrors);
    res.staticRenderFns = compiled.staticRenderFns.map((code) => {
      return createFunction(code, fnGenErrors);
    });

    // check function generation errors.
    // this should only happen if there is a bug in the compiler itself.
    // mostly for codegen development use
    /* istanbul ignore if */
    if (process.env.NODE_ENV !== "production") {
      if ((!compiled.errors || !compiled.errors.length) && fnGenErrors.length) {
        warn(
          `Failed to generate render function:\n\n` +
            fnGenErrors
              .map(({ err, code }) => `${err.toString()} in\n\n${code}\n`)
              .join("\n"),
          vm
        );
      }
    }

    return (cache[key] = res);
  };
}
