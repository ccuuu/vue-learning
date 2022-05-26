/* @flow */

import { warn } from "./debug";
import { observe, toggleObserving, shouldObserve } from "../observer/index";
import {
  hasOwn,
  isObject,
  toRawType,
  hyphenate,
  capitalize,
  isPlainObject,
} from "shared/util";

type PropOptions = {
  type: Function | Array<Function> | null,
  default: any,
  required: ?boolean,
  validator: ?Function,
};

export function validateProp(
  key: string,
  propOptions: Object,
  propsData: Object,
  vm?: Component
): any {
  /**
   * key:  $options.props 的 [key]
   * propOptions：$options.props
   * propData： 子组件的选项中声明了($options.props)，且父组件传递了(attrs或props)
   *
   * propOptions存放的是定义的格式，而propsData中存放的是实际传递的值
   */
  const prop = propOptions[key];
  const absent = !hasOwn(propsData, key);
  let value = propsData[key];
  // boolean casting
  const booleanIndex = getTypeIndex(Boolean, prop.type);

  //处理Boolean类型props的默认情况
  //如果是Boolean类型
  if (booleanIndex > -1) {
    //如果没有定义default，并且父组件没有传值，赋一个值默认值false给propsData[key]
    if (absent && !hasOwn(prop, "default")) {
      value = false;
    } else if (value === "" || value === hyphenate(key)) {
      // only cast empty string / same name to boolean if
      // boolean has higher priority
      const stringIndex = getTypeIndex(String, prop.type);
      //如果不是String，或者是String声明在Boolean后面  type:[Boolean,String]
      if (stringIndex < 0 || booleanIndex < stringIndex) {
        value = true;
      }
    }
  }
  // check default value
  //如果传进来的props为undefined，则取default的默认值，并observe
  if (value === undefined) {
    value = getPropDefaultValue(vm, prop, key);
    // since the default value is a fresh copy,
    // make sure to observe it.
    const prevShouldObserve = shouldObserve;
    toggleObserving(true);
    //observe props的default值
    observe(value);
    toggleObserving(prevShouldObserve);
  }
  if (
    process.env.NODE_ENV !== "production" &&
    // skip validation for weex recycle-list child component props
    !(__WEEX__ && isObject(value) && "@binding" in value)
  ) {
    assertProp(prop, key, value, vm, absent);
  }
  return value;
}

/**
 * Get the default value of a prop.
 */
function getPropDefaultValue(
  vm: ?Component,
  prop: PropOptions,
  key: string
): any {
  // no default, return undefined
  if (!hasOwn(prop, "default")) {
    return undefined;
  }
  const def = prop.default;
  // warn against non-factory defaults for Object & Array
  //default如果不为Function，报错
  if (process.env.NODE_ENV !== "production" && isObject(def)) {
    warn(
      'Invalid default value for prop "' +
        key +
        '": ' +
        "Props with type Object/Array must use a factory function " +
        "to return the default value.",
      vm
    );
  }
  // the raw prop value was also undefined from previous render,
  // return previous default value to avoid unnecessary watcher trigger
  //这是为了updateComponent的时候做处理，防止取default的情况下，更新组件导致
  //与更新之前的props指向不同对象(调用两次工厂函数)，触发不必要的响应
  if (
    vm &&
    vm.$options.propsData &&
    vm.$options.propsData[key] === undefined &&
    vm._props[key] !== undefined
  ) {
    return vm._props[key];
  }
  // call factory function for non-Function types
  // a value is Function if its prototype is function even across different execution context
  return typeof def === "function" && getType(prop.type) !== "Function"
    ? def.call(vm)
    : def;
}

/**
 * Assert whether a prop is valid.
 */
function assertProp(
  prop: PropOptions,
  name: string,
  value: any,
  vm: ?Component,
  absent: boolean
) {
  if (prop.required && absent) {
    warn('Missing required prop: "' + name + '"', vm);
    return;
  }
  if (value == null && !prop.required) {
    return;
  }
  let type = prop.type;
  //不设置type，或给type设置true，都代表着可以无差别通过校验
  let valid = !type || type === true;
  const expectedTypes = [];
  if (type) {
    if (!Array.isArray(type)) {
      type = [type];
    }
    for (let i = 0; i < type.length && !valid; i++) {
      const assertedType = assertType(value, type[i], vm);
      expectedTypes.push(assertedType.expectedType || "");
      valid = assertedType.valid;
    }
  }

  const haveExpectedTypes = expectedTypes.some((t) => t);
  if (!valid && haveExpectedTypes) {
    warn(getInvalidTypeMessage(name, value, expectedTypes), vm);
    return;
  }
  //prop.validator为用户自定义的校验规则，应该返回Boolean
  const validator = prop.validator;
  if (validator) {
    if (!validator(value)) {
      warn(
        'Invalid prop: custom validator check failed for prop "' + name + '".',
        vm
      );
    }
  }
}

const simpleCheckRE = /^(String|Number|Boolean|Function|Symbol|BigInt)$/;

function assertType(
  value: any,
  type: Function,
  vm: ?Component
): {
  valid: boolean,
  expectedType: string,
} {
  let valid;
  //因为传进来的type类型都是构造函数(String,Boolean等)，因此需要将其变为string值来检测
  const expectedType = getType(type);
  //如果是基本类型
  if (simpleCheckRE.test(expectedType)) {
    const t = typeof value;
    valid = t === expectedType.toLowerCase();
    // for primitive wrapper objects
    //处理基本类型包装类的情况
    if (!valid && t === "object") {
      valid = value instanceof type;
    }
  } else if (expectedType === "Object") {
    valid = isPlainObject(value);
  } else if (expectedType === "Array") {
    valid = Array.isArray(value);
  } else {
    try {
      valid = value instanceof type;
    } catch (e) {
      warn(
        'Invalid prop type: "' + String(type) + '" is not a constructor',
        vm
      );
      valid = false;
    }
  }
  return {
    valid,
    expectedType,
  };
}

const functionTypeCheckRE = /^\s*function (\w+)/;

/**
 * Use function string name to check built-in types,
 * because a simple equality check will fail when running
 * across different vms / iframes.
 */
function getType(fn) {
  const match = fn && fn.toString().match(functionTypeCheckRE);
  return match ? match[1] : "";
}

function isSameType(a, b) {
  return getType(a) === getType(b);
}

function getTypeIndex(type, expectedTypes): number {
  if (!Array.isArray(expectedTypes)) {
    return isSameType(expectedTypes, type) ? 0 : -1;
  }
  for (let i = 0, len = expectedTypes.length; i < len; i++) {
    if (isSameType(expectedTypes[i], type)) {
      return i;
    }
  }
  return -1;
}

function getInvalidTypeMessage(name, value, expectedTypes) {
  let message =
    `Invalid prop: type check failed for prop "${name}".` +
    ` Expected ${expectedTypes.map(capitalize).join(", ")}`;
  const expectedType = expectedTypes[0];
  const receivedType = toRawType(value);
  // check if we need to specify expected value
  if (
    expectedTypes.length === 1 &&
    isExplicable(expectedType) &&
    isExplicable(typeof value) &&
    !isBoolean(expectedType, receivedType)
  ) {
    message += ` with value ${styleValue(value, expectedType)}`;
  }
  message += `, got ${receivedType} `;
  // check if we need to specify received value
  if (isExplicable(receivedType)) {
    message += `with value ${styleValue(value, receivedType)}.`;
  }
  return message;
}

function styleValue(value, type) {
  if (type === "String") {
    return `"${value}"`;
  } else if (type === "Number") {
    return `${Number(value)}`;
  } else {
    return `${value}`;
  }
}

const EXPLICABLE_TYPES = ["string", "number", "boolean"];
function isExplicable(value) {
  return EXPLICABLE_TYPES.some((elem) => value.toLowerCase() === elem);
}

function isBoolean(...args) {
  return args.some((elem) => elem.toLowerCase() === "boolean");
}
