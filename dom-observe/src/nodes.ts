import Observer from './Observer'

let objectCounter = 0
const objectWeakMap = new WeakMap()
const instanceMap = {}

export const getNode = dep => (dep instanceof Node ? dep : null)

export const getInstance = dep => (dep instanceof Instance ? dep : null)

const isObject = dep => dep instanceof Object || typeof dep === 'function'

export type NodeType = 'observe' | 'event' | 'context'

export class Node {
  // tslint:disable-next-line ban-types
  public func: Function
  public type: NodeType
  public deps: any[]
  constructor(func, deps, type) {
    this.func = func
    this.type = type
    this.deps = deps
  }
}

export class Instance extends Node {
  public value: any
  public id: string
  public refs: number
  public args: any[]

  constructor(id, func, deps, type) {
    super(func, deps, type)
    this.id = id
    this.args = []
    this.value = undefined
    this.refs = 0
  }

  public ref(_) {
    this.refs++
  }

  public unref(_) {
    --this.refs
    if (this.refs <= 0) {
      delete instanceMap[this.id]
    }
  }

  public resolve() {
    const depCount = this.deps.length
    let same = this.value !== undefined

    for (let i = 0, dep; i < depCount; i++) {
      dep = this.deps[i]
      const arg = resolve(dep)
      same = same && arg === this.args[i]
      this.args[i] = arg
    }

    if (same) {
      return this.value
    }

    this.value = this.func(...this.args)
    return this.value
  }

  public debug(collector) {
    collector[this.id] = this

    const depCount = this.deps.length
    for (let i = 0, instance; i < depCount; i++) {
      instance = getInstance(this.deps[i])
      if (instance) {
        instance.debug(collector)
      }
    }
    return collector
  }
}

class EventInstance extends Instance {
  public observers = [] as Array<() => void>
  public value = 0
  public unsubscribe?: () => void

  public ref(observer) {
    super.ref(observer)

    this.observers.push(observer)
    if (this.refs === 1) {
      this.unsubscribe = this.func(this.onChange, ...this.deps)
    }
  }

  public unref(observer) {
    super.unref(observer)

    const index = this.observers.indexOf(observer)
    this.observers.splice(index, 1)
    if (this.refs === 0 && this.unsubscribe) {
      this.unsubscribe()
    }
  }

  public resolve() {
    // no-op. value is updated by event handler.
    return this.value
  }

  public onChange = () => {
    this.value++
    for (let i = 0, observer; (observer = this.observers[i]); i++) {
      observer.triggerResolve()
    }
  }
}

// Updates a dependency and returns it's new value.
export const resolve = dep => {
  const instance = getInstance(dep)
  if (!instance) {
    return dep
  }

  return instance.resolve()
}

const lookup = val => {
  // Special case undefined.
  if (val === undefined) {
    return 'undefined'
  }

  // Other primitives, null, boolean, number, string.
  if (!isObject(val)) {
    return JSON.stringify(val, objectWeakMap.get(val))
  }

  // Use ids and a WeakMap for Object, Arrays and Functions.
  // Do we already recognize this object?
  let id = objectWeakMap.get(val)
  if (id) {
    return id
  }

  // Create an id for it.
  id = `#${objectCounter++}`
  if (process.env.NODE_ENV === 'development') {
    let friendlyName = val.constructor.name
    if (friendlyName === 'Function' && val.name) {
      friendlyName = val.name
    }
    if (friendlyName === 'Instance' && val.func.name) {
      friendlyName = `Instance:${val.func.name}`
    }
    id = `${friendlyName}${id}`
  }
  objectWeakMap.set(val, id)

  return id
}

const createKey = (node, deps) => {
  const func = lookup(node.func)
  const depString = deps.map(dep => lookup(dep)).join(', ')
  return `${func}(${depString})`
}

const factory = (node, deps) => {
  const id = createKey(node, deps)
  let instance = instanceMap[id]

  if (instance) {
    return instance
  }

  switch (node.type) {
    case 'event':
      instance = new EventInstance(id, node.func, deps, node.type)
      break
    default:
      instance = new Instance(id, node.func, deps, node.type)
      break
  }

  instanceMap[id] = instance
  return instance
}

// Updates a dependency. If newDep is a node, return a singleton node instance
// based on its dependencies.
export const update = (newDep, oldDep?: Instance, observer?: Observer) => {
  // Dep can be any value as well as a node. Node is a stricter structure.
  const oldInstance = getInstance(oldDep)
  const newNode = getNode(newDep)
  const isContextNode = newNode && newNode.type === 'context'

  if (!newNode || isContextNode) {
    if (oldInstance) {
      oldInstance.deps.forEach(dep => update(undefined, dep, observer))
      oldInstance.unref(observer)
    }

    return newNode && isContextNode
      ? newNode.func(observer && observer.context, ...newNode.deps)
      : newDep
  }

  // Track if newNode differs in any way from oldNode.
  let same = oldInstance && oldInstance.func === newNode.func
  const deps = [] as any[]
  let index = 0

  // Update all deps, depth first.
  while (index < newNode.deps.length) {
    const dep = update(
      newNode.deps[index],
      oldInstance && oldInstance.deps[index],
      observer
    )

    // Did dep change?
    same = same && oldInstance && oldInstance.deps[index] !== dep

    deps.push(dep)
    index++
  }

  // If oldNode had more deps, then nodes are not the same. Unref oldNode.
  if (oldInstance && oldInstance.deps.length > index) {
    same = false
  }

  // If nodes are same, return existing singleton node.
  if (same) {
    return oldInstance
  }

  // Find or create singleton node based on deps.
  const newInstance = factory(newNode, deps)
  newInstance.ref(observer)

  // Clean up the existing instance.
  if (oldInstance) {
    oldInstance.unref(observer)
  }

  return newInstance
}
