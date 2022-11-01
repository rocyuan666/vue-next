import {
  createRenderer,
  createHydrationRenderer,
  warn,
  RootRenderFunction,
  CreateAppFunction,
  Renderer,
  HydrationRenderer,
  App,
  RootHydrateFunction,
  isRuntimeOnly,
  DeprecationTypes,
  compatUtils
} from '@vue/runtime-core'
import { nodeOps } from './nodeOps'
import { patchProp } from './patchProp'
// 从编译器导入，将在prod中摇动树
// Importing from the compiler, will be tree-shaken in prod
import {
  isFunction,
  isString,
  isHTMLTag,
  isSVGTag,
  extend,
  NOOP
} from '@vue/shared'

declare module '@vue/reactivity' {
  export interface RefUnwrapBailTypes {
    // 注意：如果更新此项，请同时更新`types/refBail.d.ts`。
    // Note: if updating this, also update `types/refBail.d.ts`.
    runtimeDOMBailTypes: Node | Window
  }
}

const rendererOptions = /*#__PURE__*/ extend({ patchProp }, nodeOps)

// 懒惰地创建渲染器-这使得核心渲染器逻辑树可以摇晃
// lazy create the renderer - this makes core renderer logic tree-shakable
// 如果用户仅从Vue导入反应性实用程序。
// in case the user only imports reactivity utilities from Vue.
let renderer: Renderer<Element | ShadowRoot> | HydrationRenderer

let enabledHydration = false

function ensureRenderer() {
  return (
    renderer ||
    (renderer = createRenderer<Node, Element | ShadowRoot>(rendererOptions))
  )
}

function ensureHydrationRenderer() {
  renderer = enabledHydration
    ? renderer
    : createHydrationRenderer(rendererOptions)
  enabledHydration = true
  return renderer as HydrationRenderer
}

// 在这里使用显式类型强制转换以避免在汇总的d.ts中调用import（）
// use explicit type casts here to avoid import() calls in rolled-up d.ts
export const render = ((...args) => {
  ensureRenderer().render(...args)
}) as RootRenderFunction<Element | ShadowRoot>

export const hydrate = ((...args) => {
  ensureHydrationRenderer().hydrate(...args)
}) as RootHydrateFunction

export const createApp = ((...args) => {
  const app = ensureRenderer().createApp(...args)

  if (__DEV__) {
    injectNativeTagCheck(app)
    injectCompilerOptionsCheck(app)
  }

  const { mount } = app
  app.mount = (containerOrSelector: Element | ShadowRoot | string): any => {
    const container = normalizeContainer(containerOrSelector)
    if (!container) return

    const component = app._component
    if (!isFunction(component) && !component.render && !component.template) {
      // __不安全的__
      // 原因：可能在DOM模板中执行JS表达式。
      // 用户必须确保DOM中的模板是可信的。如果是
      // 模板不应包含任何用户数据。
      // __UNSAFE__
      // Reason: potential execution of JS expressions in in-DOM template.
      // The user must make sure the in-DOM template is trusted. If it's
      // rendered by the server, the template should not contain any user data.
      component.template = container.innerHTML
      // 2.x compat check
      if (__COMPAT__ && __DEV__) {
        for (let i = 0; i < container.attributes.length; i++) {
          const attr = container.attributes[i]
          if (attr.name !== 'v-cloak' && /^(v-|:|@)/.test(attr.name)) {
            compatUtils.warnDeprecation(
              DeprecationTypes.GLOBAL_MOUNT_CONTAINER,
              null
            )
            break
          }
        }
      }
    }

    // 安装前清除内容
    // clear content before mounting
    container.innerHTML = ''
    const proxy = mount(container, false, container instanceof SVGElement)
    if (container instanceof Element) {
      container.removeAttribute('v-cloak')
      container.setAttribute('data-v-app', '')
    }
    return proxy
  }

  return app
}) as CreateAppFunction<Element>

export const createSSRApp = ((...args) => {
  const app = ensureHydrationRenderer().createApp(...args)

  if (__DEV__) {
    injectNativeTagCheck(app)
    injectCompilerOptionsCheck(app)
  }

  const { mount } = app
  app.mount = (containerOrSelector: Element | ShadowRoot | string): any => {
    const container = normalizeContainer(containerOrSelector)
    if (container) {
      return mount(container, true, container instanceof SVGElement)
    }
  }

  return app
}) as CreateAppFunction<Element>

function injectNativeTagCheck(app: App) {
  // 插入`isNativeTag`
  // 这用于组件名称验证（仅限dev）
  // Inject `isNativeTag`
  // this is used for component name validation (dev only)
  Object.defineProperty(app.config, 'isNativeTag', {
    value: (tag: string) => isHTMLTag(tag) || isSVGTag(tag),
    writable: false
  })
}

// 仅dev
// dev only
function injectCompilerOptionsCheck(app: App) {
  if (isRuntimeOnly()) {
    const isCustomElement = app.config.isCustomElement
    Object.defineProperty(app.config, 'isCustomElement', {
      get() {
        return isCustomElement
      },
      set() {
        warn(
          `The \`isCustomElement\` config option is deprecated. Use ` +
            `\`compilerOptions.isCustomElement\` instead.`
        )
      }
    })

    const compilerOptions = app.config.compilerOptions
    const msg =
      `The \`compilerOptions\` config option is only respected when using ` +
      `a build of Vue.js that includes the runtime compiler (aka "full build"). ` +
      `Since you are using the runtime-only build, \`compilerOptions\` ` +
      `must be passed to \`@vue/compiler-dom\` in the build setup instead.\n` +
      `- For vue-loader: pass it via vue-loader's \`compilerOptions\` loader option.\n` +
      `- For vue-cli: see https://cli.vuejs.org/guide/webpack.html#modifying-options-of-a-loader\n` +
      `- For vite: pass it via @vitejs/plugin-vue options. See https://github.com/vitejs/vite/tree/main/packages/plugin-vue#example-for-passing-options-to-vuecompiler-dom`

    Object.defineProperty(app.config, 'compilerOptions', {
      get() {
        warn(msg)
        return compilerOptions
      },
      set() {
        warn(msg)
      }
    })
  }
}

function normalizeContainer(
  container: Element | ShadowRoot | string
): Element | null {
  if (isString(container)) {
    const res = document.querySelector(container)
    if (__DEV__ && !res) {
      warn(
        `Failed to mount app: mount target selector "${container}" returned null.`
      )
    }
    return res
  }
  if (
    __DEV__ &&
    window.ShadowRoot &&
    container instanceof window.ShadowRoot &&
    container.mode === 'closed'
  ) {
    warn(
      `mounting on a ShadowRoot with \`{mode: "closed"}\` may lead to unpredictable bugs`
    )
  }
  return container as any
}

// 自定义元素支持
// Custom element support
export {
  defineCustomElement,
  defineSSRCustomElement,
  VueElement,
  VueElementConstructor
} from './apiCustomElement'

// SFC CSS实用程序
// SFC CSS utilities
export { useCssModule } from './helpers/useCssModule'
export { useCssVars } from './helpers/useCssVars'

// 仅DOM组件
// DOM-only components
export { Transition, TransitionProps } from './components/Transition'
export {
  TransitionGroup,
  TransitionGroupProps
} from './components/TransitionGroup'

// **内部**仅DOM运行时指令帮助程序
// **Internal** DOM-only runtime directive helpers
export {
  vModelText,
  vModelCheckbox,
  vModelRadio,
  vModelSelect,
  vModelDynamic
} from './directives/vModel'
export { withModifiers, withKeys } from './directives/vOn'
export { vShow } from './directives/vShow'

import { initVModelForSSR } from './directives/vModel'
import { initVShowForSSR } from './directives/vShow'

let ssrDirectiveInitialized = false

/**
 * @internal
 */
export const initDirectivesForSSR = __SSR__
  ? () => {
      if (!ssrDirectiveInitialized) {
        ssrDirectiveInitialized = true
        initVModelForSSR()
        initVShowForSSR()
      }
    }
  : NOOP

// 从核心重新导出所有内容
// re-export everything from core
// h, Component, reactivity API, nextTick, flags & types
export * from '@vue/runtime-core'
