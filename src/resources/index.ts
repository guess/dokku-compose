// src/resources/index.ts
import { Apps } from './lifecycle.js'
import { Domains, Ports, Storage } from './lists.js'
import { Nginx, Logs, Registry, Scheduler } from './properties.js'
import { Proxy } from './toggle.js'
import { Config } from './config.js'
import { Certs } from './certs.js'
import { Builder } from './builder.js'
import { DockerOptions } from './docker-options.js'
import { Git } from './git.js'
import { Scale, Ps } from './ps.js'
import { Checks } from './checks.js'
import { Networks, NetworkProps } from './network.js'
import type { Resource } from '../core/reconcile.js'

// Per-app resources split into explicit phases.
export const NETWORKING_RESOURCES: Resource[] = [
  Domains, Networks, NetworkProps, Proxy, Ports,
]

export const CONFIG_RESOURCES: Resource[] = [
  Certs, Storage, Nginx, Checks, Logs, Registry, Scheduler, Ps, Scale, Config,
]

export const BUILD_RESOURCES: Resource[] = [
  Builder, Git, DockerOptions,
]

export const ALL_APP_RESOURCES: Resource[] = [
  ...NETWORKING_RESOURCES, ...CONFIG_RESOURCES, ...BUILD_RESOURCES,
]

export {
  Apps, Domains, Ports, Storage, Nginx, Logs, Registry,
  Scheduler, Proxy, Config, Certs, Builder, DockerOptions,
  Git, Checks, Networks, NetworkProps, Scale, Ps,
}
