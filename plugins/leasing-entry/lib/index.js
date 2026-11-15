// Host 侧占位插件：本包的能力全在浏览器端（lib/client.js）。
// 存在的意义是让 profile 里有一行可加载的 entry，插件页能看到并启停。
/** 插件名，与 package.json 的 name 一致。 */
export const name = 'dsh-leasing-entry'

/** 不依赖任何服务。 */
export const inject = []

/** 无宿主行为：入口由客户端 slot 提供。 */
export function apply() {}
