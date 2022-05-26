/* @flow */

import { parse } from "./parser/index";
import { optimize } from "./optimizer";
import { generate } from "./codegen/index";
import { createCompilerCreator } from "./create-compiler";

// `createCompilerCreator` allows creating compilers that use alternative
// parser/optimizer/codegen, e.g the SSR optimizing compiler.
// Here we just export a default compiler using the default parts.
export const createCompiler = createCompilerCreator(function baseCompile(
  template: string,
  options: CompilerOptions
): CompiledResult {
  //调用 parse 函数将字符串模板解析成抽象语法树(AST)
  const ast = parse(template.trim(), options);
  //调用 optimize 函数优化 ast

  //为节点加上static和staticRoot属性，表示其及其子节点是否都为“普通标签”
  if (options.optimize !== false) {
    optimize(ast, options);
  }
  // 调用 generate 函数将 ast 编译成渲染函数数字字符串(真正的变成render的过程是在
  //compilerToFUnctions)
  const code = generate(ast, options);
  return {
    ast,
    render: code.render,
    staticRenderFns: code.staticRenderFns,
  };
});
