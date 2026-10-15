import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

/**
 * Uploads the Nest build source maps to Sentry when a token exists. Without
 * SENTRY_AUTH_TOKEN the build continues: source maps only matter in Sentry.
 */
const authToken = process.env.SENTRY_AUTH_TOKEN?.trim()
if (!authToken) {
  console.log("SENTRY_AUTH_TOKEN no definido: no se suben source maps.")
  process.exit(0)
}

const org = process.env.SENTRY_ORG?.trim()
const project = process.env.SENTRY_PROJECT?.trim()
if (!org || !project) {
  throw new Error(
    "SENTRY_ORG y SENTRY_PROJECT son obligatorios para subir source maps."
  )
}

const version = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8")
).version

execFileSync(
  "pnpm",
  [
    "exec",
    "sentry-cli",
    "sourcemaps",
    "upload",
    "--org",
    org,
    "--project",
    project,
    "--release",
    version,
    "dist",
  ],
  { stdio: "inherit" }
)
