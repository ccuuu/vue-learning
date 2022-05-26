/* @flow */

import Dep from "./dep";
import VNode from "../vdom/vnode";
import { arrayMethods } from "./array";
import {
  def,
  warn,
  hasOwn,
  hasProto,
  isObject,
  isPlainObject,
  isPrimitive,
  isUndef,
  isValidArrayIndex,
  isServerRendering,
} from "../util/index";

const arrayKeys = Object.getOwnPropertyNames(arrayMethods);

/**
 * In some cases we may want to disable observation inside a component's
 * update computation.
 */
export let shouldObserve: boolean = true;

export function toggleObserving(value: boolean) {
  shouldObserve = value;
}

/**
 * Observer class that is attached to each observed
 * object. Once attached, the observer converts the target
 * object's property keys into getter/setters that
 * collect dependencies and dispatch updates.
 */
export class Observer {
  value: any;
  dep: Dep;
  vmCount: number; // number of vms that have this object as root $data

  constructor(value: any) {
    this.value = value;
    this.dep = new Dep();
    this.vmCount = 0;
    //Object和Array的__ob__属性，都是指向observer实例
    def(value, "__ob__", this);
    //把Array的几个原生事件给observe起来
    if (Array.isArray(value)) {
      if (hasProto) {
        //value.__proto__ = Array.prototype
        //将包装过的prototype方法重新赋值给__proto__
        protoAugment(value, arrayMethods);
      } else {
        //merge formated Array.prototype as value's static methods
        //解决一些低版本浏览器没有prototype的情况
        copyAugment(value, arrayMethods, arrayKeys);
      }
      this.observeArray(value);
      //observe(items[i])
    } else {
      this.walk(value);
      //defineReactive(value, key)
    }
  }

  /**
   * Walk through all properties and convert them into
   * getter/setters. This method should only be called when
   * value type is Object.
   */
  walk(obj: Object) {
    const keys = Object.keys(obj);
    for (let i = 0; i < keys.length; i++) {
      defineReactive(obj, keys[i]);
    }
  }

  /**
   * Observe a list of Array items.
   */
  observeArray(items: Array<any>) {
    for (let i = 0, l = items.length; i < l; i++) {
      //把Array的每一项observe起来
      //array中的!Object item并没有被observe
      observe(items[i]);
    }
  }
}

// helpers

/**
 * Augment a target Object or Array by intercepting
 * the prototype chain using __proto__
 */
function protoAugment(target, src: Object) {
  /* eslint-disable no-proto */
  target.__proto__ = src;
  /* eslint-enable no-proto */
}

/**
 * Augment a target Object or Array by defining
 * hidden properties.
 */
/* istanbul ignore next */
function copyAugment(target: Object, src: Object, keys: Array<string>) {
  for (let i = 0, l = keys.length; i < l; i++) {
    const key = keys[i];
    def(target, key, src[key]);
  }
}

/**
 * Attempt to create an observer instance for a value,
 * returns the new observer if successfully observed,
 * or the existing observer if the value already has one.
 */

//如果value为primitive，则返回，如果有__ob__，则返回__ob__，如果没有__ob__，则添加__ob__并返回
export function observe(value: any, asRootData: ?boolean): Observer | void {
  //如果value不是对象，则不用observe
  if (!isObject(value) || value instanceof VNode) {
    return;
  }
  let ob: Observer | void;
  if (hasOwn(value, "__ob__") && value.__ob__ instanceof Observer) {
    ob = value.__ob__;
  } else if (
    shouldObserve &&
    !isServerRendering() &&
    (Array.isArray(value) || isPlainObject(value)) &&
    Object.isExtensible(value) &&
    !value._isVue
  ) {
    ob = new Observer(value);
  }
  if (asRootData && ob) {
    ob.vmCount++;
  }
  //return Observer 而不是 value
  return ob;
}

/**
 * Define a reactive property on an Object.
 */

//原理：闭包
//JavaScript闭包的形成原理是基于函数变量作用域链的规则 和 垃圾回收机制的引用计数规则。
export function defineReactive(
  obj: Object,
  key: string,
  val: any,
  customSetter?: ?Function,
  shallow?: boolean
  //shallow: 浅观察
) {
  //每个属性内部闭包的dep和其对象的dep并无关系
  const dep = new Dep();
  //Object.getOwnPropertyDescriptor() 方法返回指定对象上一个自有属性对应的属性描述符
  const property = Object.getOwnPropertyDescriptor(obj, key);
  //当且仅当该属性的 configurable 键值为 true 时，该属性的描述符才能够被改变
  if (property && property.configurable === false) {
    return;
  }

  // cater for pre-defined getter/setters
  const getter = property && property.get;
  const setter = property && property.set;
  //没有get 或者有set
  if ((!getter || setter) && arguments.length === 2) {
    val = obj[key];
  }
  //如果不是浅观察，则将val都observer一遍；如果val为!isObject或者设置了取消observe，则直接return
  //此处的childOb实际上指的是当前属性名指向的那个对象的__ob__
  let childOb = !shallow && observe(val);

  //get添加依赖，set下发通知
  Object.defineProperty(obj, key, {
    enumerable: true,
    configurable: true,
    get: function reactiveGetter() {
      const value = getter ? getter.call(obj) : val;
      if (Dep.target) {
        //如果有目标依赖，则添加target为依赖
        dep.depend();

        if (childOb) {
          //Observe.dep是为了对象新增和删除属性的时候触发notify，或数组触发notify
          //在此处收集属性指向的对象的依赖，就是因为在外界无法访问到闭包中的dep，进而
          //无法触发subs.update，而$set和$delete需要手动触发，则此时将依赖同样收集到
          //Observe的dep中，利用__ob__可以手动触发依赖
          //为什么要设置两个dep？ 这其实是一个妥协的结果，因为对于基本类型数据，无法
          //observe，但是依旧需要收集依赖和sub
          childOb.dep.depend();

          //数组收集依赖
          //数组的dep在自身的__ob__上

          //
          //无论是数组还是Object，我们都可以顺利为其绑定dep(其中数组为__ob__.dep，而
          //对象为闭包dep加__ob__.dep)

          //对象在收集依赖时，是利用了get方法收集依赖
          //如：a.b.c.d.f ;会触发每个属性的get； 则某个Watcher的dep就应该为[a,b,c,d,f]

          //但是数组无法defineProperty从而通过get收集依赖(唯一可以的是data的属性，此时
          //key作为$data的属性，依旧是对象，尽管其指针指向的是数组)
          //因此，当我们需要用到数组时，应该在此根属性get的时候，就循环为其每一个子属性也
          //添加依赖
          //否则会出现如下情况：
          //$data.a[0][2]，虽然用到了很多子属性，但是只会添加a依赖，这种现象是不正确的

          //因此，妥协的结果就是只要用到了根属性(值为数组)，就为其子属性的每一个后代绑定
          //当前依赖

          //关于父子组件的更新：
          //本质上update并无先后顺序。导致先后顺序的是flashQueue插入的顺序
          //如果子组件用到的是父组件传值的子属性，则父组件不一定会update，如: (a.b.c)，而父组件
          //传值穿的是a
          if (Array.isArray(value)) {
            dependArray(value);
          }
        }
      }
      return value;
    },
    //!!!!!!!这就是为什么给初始化为null的data属性赋值还是为响应式的原因
    //如果为一个observe的属性赋一个新的值(不包括删除属性添加属性)，那么这个值的所有属性都会被observe
    set: function reactiveSetter(newVal) {
      const value = getter ? getter.call(obj) : val;
      /* eslint-disable no-self-compare */
      //to solution the problem that when oldVal and newval both are NaN,
      //because NaN === NaN is always false
      //如果newValue和原来的value相等，直接return
      if (newVal === value || (newVal !== newVal && value !== value)) {
        return;
      }
      /* eslint-enable no-self-compare */
      if (process.env.NODE_ENV !== "production" && customSetter) {
        customSetter();
      }
      // #7981: for accessor properties without setter
      //如果属性是用defineProperty定义的，但是没有定义
      //  defineProperty的arguments[2],设置了set和get任意一个，另一个若没定义会自动设置undefined
      if (getter && !setter) return;
      if (setter) {
        setter.call(obj, newVal);
      } else {
        val = newVal;
      }
      //将newVal给observe
      //这就是为什么 this.initedData 重新赋值也是响应式的原因；
      childOb = !shallow && observe(newVal);
      //下发通知
      dep.notify();
    },
  });
}

/**
 * Collect dependencies on array elements when the array is touched, since
 * we cannot intercept array element access like property getters.
 */
function dependArray(value: Array<any>) {
  for (let e, i = 0, l = value.length; i < l; i++) {
    e = value[i];
    e && e.__ob__ && e.__ob__.dep.depend();
    if (Array.isArray(e)) {
      dependArray(e);
    }
  }
}

/**
 * Set a property on an object. Adds the new property and
 * triggers change notification if the property doesn't
 * already exist.
 */
//this.$set
export function set(target: Array<any> | Object, key: any, val: any): any {
  //如果是primative或者undefined，报错
  if (
    process.env.NODE_ENV !== "production" &&
    (isUndef(target) || isPrimitive(target))
  ) {
    warn(
      `Cannot set reactive property on undefined, null, or primitive value: ${(target: any)}`
    );
  }
  if (Array.isArray(target) && isValidArrayIndex(key)) {
    target.length = Math.max(target.length, key);
    //用下标设置属性不会触发observe，因此先设置length(如需要)，再用splice修改属性
    target.splice(key, 1, val);
    return val;
  }
  //等同于Object.hasOwnProperty(key)
  if (key in target && !(key in Object.prototype)) {
    //如果目标对象已有这个属性，则直接赋值；
    //如果此对象已是observe对象，则会触发相应(description set的作用)
    target[key] = val;
    return val;
  }
  const ob = (target: any).__ob__;
  //不能向实例或者$data设置对象
  if (target._isVue || (ob && ob.vmCount)) {
    process.env.NODE_ENV !== "production" &&
      warn(
        "Avoid adding reactive properties to a Vue instance or its root $data " +
          "at runtime - declare it upfront in the data option."
      );
    return val;
  }
  //if this target is not from vue's $data
  //如果他不是一个响应式对象，则不会把其本身变为响应式，而是直接添加非相应式属性
  if (!ob) {
    target[key] = val;
    return val;
  }
  defineReactive(ob.value, key, val);
  //手动触发第一次设置时候的依赖notify
  ob.dep.notify();
  return val;
}

/**
 * Delete a property and trigger change if necessary.
 */
export function del(target: Array<any> | Object, key: any) {
  //如果目标是primative或者undefined，报错
  if (
    process.env.NODE_ENV !== "production" &&
    (isUndef(target) || isPrimitive(target))
  ) {
    warn(
      `Cannot delete reactive property on undefined, null, or primitive value: ${(target: any)}`
    );
  }
  //如果是array，则用splice删除，以此触发依赖
  if (Array.isArray(target) && isValidArrayIndex(key)) {
    target.splice(key, 1);
    return;
  }
  const ob = (target: any).__ob__;
  //不能删除实例和$data的属性
  if (target._isVue || (ob && ob.vmCount)) {
    process.env.NODE_ENV !== "production" &&
      warn(
        "Avoid deleting properties on a Vue instance or its root $data " +
          "- just set it to null."
      );
    return;
  }
  if (!hasOwn(target, key)) {
    return;
  }
  delete target[key];
  if (!ob) {
    return;
  }
  //用delete 操作符删除一个属性，然后手动触发依赖
  ob.dep.notify();
}
