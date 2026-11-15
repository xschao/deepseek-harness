/**
 * 下班烟花的 Host 半边：只提供一个 `quit_fireworks` 工具。
 * 真正的动画在浏览器端（client.js）：工具调用行渲染时点燃全屏烟花。
 *
 * 这里刻意不 import 任何包：树外插件从真实路径解析裸模块时会失败，
 * 直接用注册表接受的普通对象形状（与 defineTool 的产物同形）。
 */

/** 与 package.json 的 name 一致，便于插件页识别。 */
export const name = 'quit-fireworks'

/** 需要工具注册表就绪。 */
export const inject = ['tools']

const DESCRIPTION = [
  '在用户的浏览器页面上放一场全屏烟花（下线庆祝动画）。',
  '当用户说「下班」「收工」「走了」「拜拜」「今天到这」等结束语，或明确要烟花/庆祝动画时调用。',
  '这是纯前端动画，不写文件、不查数据、无副作用；一次调用放一场，用户说几次就调用几次。',
  '调用后无需再解释动画实现细节，简短回一句即可。'
].join('')

const parameters = {
  type: 'object',
  additionalProperties: false,
  properties: {
    note: {
      type: 'string',
      description: '可选：显示在烟花行上的短句，例如「今天辛苦了」。不传则用默认文案。'
    }
  }
}

const output = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      status: { type: 'string', description: 'fired' }
    }
  },
  render(_args, value) {
    return [{ type: 'text', text: value.status === 'fired' ? '已在页面上点燃一场全屏烟花。' : '烟花未能点燃。' }]
  }
}

/**
 * 注册工具。
 * @param ctx - 宿主插件上下文（已注入 tools）。
 */
export function apply(ctx) {
  ctx.tools.register({
    name: 'quit_fireworks',
    description: DESCRIPTION,
    parameters,
    output,
    execute() {
      return Promise.resolve({ status: 'fired' })
    },
    presentCall(args) {
      return {
        card: 'generic',
        title: '下班烟花',
        kind: 'other',
        rawInput: args
      }
    }
  })
}
