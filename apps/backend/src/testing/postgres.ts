import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer
} from '@testcontainers/postgresql'
import postgres from 'postgres'
import type { TestProject } from 'vitest/node'
import { createDb, migrateDb } from '../infra/db.ts'

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string
  }
}

let container: StartedPostgreSqlContainer | undefined

// The app connects as a role that owns its tables but is not a superuser,
// as in production, so row level security applies to it.
export async function setup(project: TestProject): Promise<void> {
  container = await new PostgreSqlContainer('postgres:18').start()
  const admin = postgres(container.getConnectionUri(), {
    onnotice: () => undefined
  })
  await admin.unsafe(`create role app login password 'app'`)
  await admin.unsafe(`create database pages owner app`)
  await admin.end()

  const url = new URL(container.getConnectionUri())
  url.username = 'app'
  url.password = 'app'
  url.pathname = '/pages'
  const { sql, db } = createDb(url.toString())
  await migrateDb(db)
  await sql.end()
  project.provide('databaseUrl', url.toString())
}

export async function teardown(): Promise<void> {
  await container?.stop()
}
