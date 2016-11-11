
import * as env from './config/env'
import * as cache from './config/cache'
import * as logger from './config/logger'
import * as syntax from './config/syntax'
import * as pattern from './config/pattern'
import * as registry from './config/registry'
import * as switcher from './config/switcher'
import * as lifecycle from './config/lifecycle'

import * as mustache from './compiler/parser/mustache'

import * as is from './util/is'
import * as event from './util/event'
import * as array from './util/array'
import * as object from './util/object'
import * as keypath from './util/keypath'
import * as nextTask from './util/nextTask'
import * as component from './util/component'

import * as vdom from './platform/web/vdom'
import * as helper from './platform/web/helper'

import * as refDir from './directive/ref'
import * as eventDir from './directive/event'
import * as modelDir from './directive/model'
import * as componentDir from './directive/component'

registry.directive.set({
  ref: refDir,
  event: eventDir,
  model: modelDir,
  component: componentDir,
})

export default class Yox {

  /**
   * 配置项
   *
   * @constructor
   * @param {Object} options
   */
  constructor(options) {

    let {
      el,
      data,
      props,
      parent,
      replace,
      computed,
      template,
      watchers,
      components,
      directives,
      events,
      filters,
      methods,
      partials,
    } = options

    // el 和 template 都可以传选择器
    template = pattern.tag.test(template)
      ? template
      : helper.find(template).innerHTML

    el = is.string(el)
      ? helper.find(el)
      : el

    if (!el || el.nodeType !== 1) {
      logger.error('Passing a `el` option must be a html element.')
    }
    if (props && (is.object(data) || is.array(data))) {
      logger.warn('Passing a `data` option with object and array to component is discouraged.')
    }

    if (!replace) {
      el.innerHTML = '<div></div>'
      el = el.firstChild
    }

    let instance = this

    if (parent) {
      instance.$parent = parent
    }

    // 拆分实例方法和生命周期函数
    let hooks = { }
    object.each(
      lifecycle,
      function (name) {
        hooks[`on${name}`] = name
      }
    )

    // 监听各种事件
    instance.$eventEmitter = new event.Emitter()

    object.each(
      hooks,
      function (value, key) {
        if (is.func(options[key])) {
          instance.on(value, options[key])
        }
      }
    )

    instance.fire(lifecycle.INIT)

    if (is.object(methods)) {
      object.each(
        methods,
        function (value, key) {
          instance[key] = value
        }
      )
    }

    data = is.func(data) ? data.call(instance) : data
    if (is.object(props)) {
      if (!is.object(data)) {
        data = { }
      }
      object.extend(data, props)
    }
    if (data) {
      instance.$data = data
    }

    if (is.object(components)) {
      instance.$components = components
    }
    if (is.object(directives)) {
      instance.$directives = directives
    }
    if (is.object(filters)) {
      instance.$filters = filters
    }
    if (is.object(partials)) {
      instance.$partials = partials
    }

    if (is.object(computed)) {

      // 把计算属性拆为 getter 和 setter
      let $computedGetters =
      instance.$computedGetters = { }

      let $computedSetters =
      instance.$computedSetters = { }

      // 存储计算属性的值，提升性能
      let $computedCache =
      instance.$computedCache = { }

      // 辅助获取计算属性的依赖
      let $computedStack =
      instance.$computedStack = [ ]
      // 计算属性的依赖关系
      // dep => [ computed1, computed2, ... ]
      let $computedWatchers =
      instance.$computedWatchers = { }
      // computed => [ dep1, dep2, ... ]
      let $computedDeps =
      instance.$computedDeps = { }

      object.each(
        computed,
        function (item, keypath) {
          let get, set, cache = env.TRUE
          if (is.func(item)) {
            get = item
          }
          else if (is.object(item)) {
            if (object.has(item, 'cache')) {
              cache = item.cache
            }
            if (is.func(item.get)) {
              get = item.get
            }
            if (is.func(item.set)) {
              set = item.set
            }
          }

          if (get) {
            let getter = function () {

              if (cache && object.has($computedCache, keypath)) {
                return $computedCache[keypath]
              }

              // 新推一个依赖收集数组
              $computedStack.push([ ])
              let result = get.call(instance)

              // 处理收集好的依赖
              let newDeps = $computedStack.pop()
              let oldDeps = $computedDeps[keypath]
              $computedDeps[keypath] = newDeps

              // 增加了哪些依赖，删除了哪些依赖
              let addedDeps = [ ]
              let removedDeps = [ ]
              if (is.array(oldDeps)) {
                array.each(
                  array.merge(oldDeps, newDeps),
                  function (dep) {
                    let oldExisted = array.hasItem(oldDeps, dep)
                    let newExisted = array.hasItem(newDeps, dep)
                    if (oldExisted && !newExisted) {
                      removedDeps.push(dep)
                    }
                    else if (!oldExisted && newExisted) {
                      addedDeps.push(dep)
                    }
                  }
                )
              }
              else {
                addedDeps = newDeps
              }

              array.each(
                addedDeps,
                function (dep) {
                  if (!is.array($computedWatchers[dep])) {
                    $computedWatchers[dep] = []
                  }
                  $computedWatchers[dep].push(keypath)
                }
              )

              array.each(
                removedDeps,
                function (dep) {
                  array.removeItem($computedWatchers[dep], keypath)
                }
              )

              // 不论是否开启 computed cache，获取 oldValue 时还有用
              // 因此要存一下
              $computedCache[keypath] = result

              return result
            }
            getter.computed = env.TRUE
            $computedGetters[keypath] = getter
          }

          if (set) {
            $computedSetters[keypath] = set.bind(instance)
          }

        }
      )
    }

    if (is.object(events)) {
      object.each(
        events,
        function (listener, type) {
          if (is.func(listener)) {
            instance.on(type, listener)
          }
        }
      )
    }

    // 监听数据变化
    instance.$watchEmitter = new event.Emitter()

    if (is.object(watchers)) {
      object.each(
        watchers,
        function (watcher, keypath) {
          instance.watch(keypath, watcher)
        }
      )
    }

    // 准备就绪
    instance.fire(lifecycle.CREATE)

    // 编译结果
    instance.$template = mustache.parse(
      template,
      function (name) {
        return instance.getPartial(name)
      },
      function (name, node) {
        component.set(instance, 'partial', name, node)
      }
    )

    instance.fire(lifecycle.COMPILE)

    // 第一次渲染组件
    instance.updateView(el)

  }

  get(keypath) {

    let {
      $data,
      $computedStack,
      $computedGetters,
    } = this

    if (is.array($computedStack)) {
      let deps = array.lastItem($computedStack)
      if (deps) {
        deps.push(keypath)
      }

      let getter = $computedGetters[keypath]
      if (getter) {
        return getter()
      }
    }

    let result = object.get($data, keypath)
    if (result) {
      return result.value
    }

  }

  set(keypath, value) {
    let model = keypath
    if (is.string(keypath)) {
      model = { }
      model[keypath] = value
    }
    let instance = this
    if (instance.updateModel(model)) {
      if (switcher.sync) {
        instance.updateView()
      }
      else if (!instance.$syncing) {
        instance.$syncing = env.TRUE
        nextTask.add(function () {
          delete instance.$syncing
          instance.updateView()
        })
      }
    }
  }

  on(type, listener) {
    this.$eventEmitter.on(type, listener)
  }

  once(type, listener) {
    this.$eventEmitter.once(type, listener)
  }

  off(type, listener) {
    this.$eventEmitter.off(type, listener)
  }

  fire(type, data, bubble) {
    if (arguments.length === 2 && data === env.TRUE) {
      bubble = env.TRUE
      data = env.NULL
    }
    if (data && object.has(data, 'length') && !is.array(data)) {
      data = array.toArray(data)
    }
    let instance = this
    let { $parent, $eventEmitter } = instance
    if (!$eventEmitter.fire(type, data, instance)) {
      if (bubble && $parent) {
        $parent.fire(type, data, bubble)
      }
    }
  }

  watch(keypath, watcher) {
    this.$watchEmitter.on(keypath, watcher)
  }

  watchOnce(keypath, watcher) {
    this.$watchEmitter.once(keypath, watcher)
  }

  toggle(keypath) {
    this.set(
      keypath,
      !this.get(keypath)
    )
  }

  updateModel(model) {

    let instance = this

    let {
      $data,
      $watchEmitter,
      $computedCache,
      $computedWatchers,
      $computedSetters,
    } = instance

    let hasComputed = is.object($computedWatchers),
      changes = { },
      setter,
      oldValue

    object.each(
      model,
      function (value, key) {
        oldValue = instance.get(key)
        if (value !== oldValue) {

          changes[key] = [ value, oldValue ]

          if (hasComputed && is.array($computedWatchers[key])) {
            array.each(
              $computedWatchers[key],
              function (watcher) {
                if (object.has($computedCache, watcher)) {
                  delete $computedCache[watcher]
                }
              }
            )
          }

          // 计算属性优先
          if (hasComputed) {
            setter = $computedSetters[key]
            if (setter) {
              setter(value)
              return
            }
          }

          object.set($data, key, value)

        }
      }
    )

    if (object.count(changes)) {
      object.each(
        changes,
        function (args, key) {
          array.each(
            keypath.getWildcardMatches(key),
            function (wildcardKeypath) {
              $watchEmitter.fire(
                wildcardKeypath,
                array.merge(args, keypath.getWildcardNames(key, wildcardKeypath)),
                instance
              )
            }
          )
        }
      )
      return changes
    }

  }

  updateView(el) {

    let instance = this

    let {
      $data,
      $filters,
      $template,
      $currentNode,
      $computedGetters,
    } = instance

    let context = { }

    // 在 data 中也能写函数
    object.extend(context, registry.filter.data, $data, $filters)
    object.each(
      context,
      function (value, key) {
        if (is.func(value)) {
          context[key] = value.bind(instance)
        }
      }
    )

    if (is.object($computedGetters)) {
      object.extend(context, $computedGetters)
    }

    let newNode = vdom.create(
      mustache.render($template, context),
      instance
    )

    if ($currentNode) {
      $currentNode = vdom.patch($currentNode, newNode)
      instance.fire(lifecycle.UPDATE)
    }
    else {
      $currentNode = vdom.patch(el, newNode)
      instance.$el = $currentNode.elm
      instance.fire(lifecycle.ATTACH)
    }

    instance.$currentNode = $currentNode

  }

  create(options, extra) {
    options = object.extend({ }, options, extra)
    options.parent = this
    return new Yox(options)
  }

  compileAttr(keypath, value) {
    return component.compileAttr(this, keypath, value)
  }

  getComponent(name) {
    return component.get(this, 'component', name)
  }

  getFilter(name) {
    return component.get(this, 'filter', name)
  }

  getDirective(name) {
    return component.get(this, 'directive', name, true)
  }

  getPartial(name) {
    return component.get(this, 'partial', name)
  }

  dispose() {
    this.$watchEmitter.off()
    this.$eventEmitter.off()
    this.fire(lifecycle.DETACH)
  }

}

/**
 * 开关配置
 *
 * @type {Object}
 */
Yox.switcher = switcher

/**
 * 模板语法配置
 *
 * @type {Object}
 */
Yox.syntax = syntax

/**
 * 全局缓存，方便外部清缓存
 *
 * @type {Object}
 */
Yox.cache = cache

Yox.component = function (id, value) {
  registry.component.set(id, value)
}

Yox.directive = function (id, value) {
  registry.directive.set(id, value)
}

Yox.filter = function (id, value) {
  registry.filter.set(id, value)
}

Yox.partial = function (id, value) {
  registry.partial.set(id, value)
}

Yox.nextTick = function (fn) {
  nextTask.add(fn)
}

Yox.use = function (plugin) {
  plugin.install(Yox)
}

Yox.is = is
Yox.event = event
Yox.array = array
Yox.object = object

/**
 * [TODO]
 * 1. snabbdom prop 和 attr 的区分
 * 2. 组件之间的事件传递（解决）
 * 3. Emitter 的事件广播、冒泡（解决）
 * 4. 组件属性的组织形式（解决）
 * 5. 计算属性是否可以 watch（不可以）
 * 6. 需要转义的文本节点如果出现在属性值里，是否需要 encode
 * 7. 数组方法的劫持（不需要劫持，改完再 set 即可）
 * 8. 属性延展（用 #array.each 遍历数据）
 * 9. 报错信息完善
 * 10. SEO友好
 */