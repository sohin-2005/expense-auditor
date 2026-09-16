#!/usr/bin/env node
/**
 * Verify every module imports the shared names it uses, from the module that
 * actually exports them.
 *
 * Why this exists: `vite build` succeeds on a bad import. A bare identifier
 * that resolves to nothing is not a build error — it is a runtime
 * ReferenceError on whichever route touches it. That is how
 * "normalizeStatus is not defined" reached the browser from a green build.
 *
 * Two failures, both invisible to the bundler:
 *
 *   missing       the name is used but never imported  -> ReferenceError
 *   wrong source  the name is imported from a module that does not export
 *                 it -> `undefined` at runtime, no error at all
 *
 * Deliberately narrow: only the known shared exports are checked, so there
 * are no false positives, which is what makes it worth gating the build on.
 *
 *   npm run check
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const SRC = fileURLToPath(new URL("../src", import.meta.url))

// name -> the module that exports it
const SHARED = {
  API: "lib/api", API_TIMEOUT_MS: "lib/api", API_CONFIG_ERROR: "lib/api",
  getToken: "lib/api", rememberSession: "lib/api", SPLASH_FLOOR_MS: "lib/api",

  THEME: "theme/tokens", primaryBtnStyle: "theme/tokens",
  BRAND_NAME: "theme/tokens", BRAND_LOGO: "theme/tokens",
  S: "theme/tokens", R: "theme/tokens", T: "theme/tokens", SHADOW: "theme/tokens",
  ROLE_STYLE: "theme/tokens", roleStyle: "theme/tokens", money: "theme/tokens",

  formatClaimDate: "lib/format", getClaimDisplayName: "lib/format",
  STATUS_STYLES: "lib/format", normalizeStatus: "lib/format",
  getISTGreeting: "lib/format",

  useIsMobile: "lib/useIsMobile",

  StatusBadge: "components/ui", Input: "components/ui", Select: "components/ui",
  Card: "components/ui", PageHeader: "components/ui", Stat: "components/ui",
  StatRow: "components/ui", Button: "components/ui", TableWrap: "components/ui",
  Th: "components/ui", Td: "components/ui", EmptyState: "components/ui",
  RoleBadge: "components/ui", Notice: "components/ui",

  supabase: "supabase", readPersistedSession: "supabase",
  clearPersistedSession: "supabase",

  useState: "react", useEffect: "react", useRef: "react", useMemo: "react",
  useCallback: "react", forwardRef: "react", lazy: "react", Suspense: "react",
  axios: "axios",
}

// Bare package specifiers are not paths, so the source comparison is skipped.
const PACKAGES = new Set(["react", "axios"])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.jsx?$/.test(name)) out.push(p)
  }
  return out
}

/** Strip comments and string/template literals so scans see only code. */
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    // Keep ${...} interpolations — they are real code. Blanking whole
    // template literals is what hid `${getISTGreeting()}` from this check,
    // the same mistake the Python import scanner made with f-strings.
    .replace(/`(?:[^`\\]|\\.)*`/g, (lit) =>
      [...lit.matchAll(/\$\{([^{}]*)\}/g)].map((m) => m[1]).join(";") || "``")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
}

/** imported name -> the module specifier it came from */
function importedFrom(src) {
  const map = new Map()
  for (const m of src.matchAll(/import\s+([^;]+?)\s+from\s+["']([^"']+)["']/g)) {
    const clause = m[1]
    const spec = m[2]
    const braced = clause.match(/\{([^}]*)\}/)
    if (braced) {
      for (const part of braced[1].split(",")) {
        const bit = part.trim().split(/\s+as\s+/).pop()
        if (bit) map.set(bit.trim(), spec)
      }
    }
    const bare = clause.replace(/\{[^}]*\}/, "").replace(/,/g, " ").trim()
    for (const bit of bare.split(/\s+/)) {
      const clean = bit.replace(/^\*\s*as\s*/, "").trim()
      if (clean && clean !== "as") map.set(clean, spec)
    }
  }
  return map
}

/** Top-level names this module declares itself. */
function declaredNames(src) {
  const names = new Set()
  for (const m of src.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(m[1])
  }
  return names
}

/** "../lib/format" or "./lib/format.js" -> "lib/format" */
function normalizeSpec(spec) {
  return spec.replace(/^(?:\.\.?\/)+/, "").replace(/\.jsx?$/, "")
}

let problems = 0

for (const file of walk(SRC)) {
  const raw = readFileSync(file, "utf8")
  const src = codeOnly(raw)
  const sources = importedFrom(raw)
  const declared = declaredNames(src)

  const missing = []
  const wrongSource = []

  for (const [name, home] of Object.entries(SHARED)) {
    // Used as a value or as a JSX element — not as an object key or a
    // property access on something else.
    const usedAsValue = new RegExp(`(?<![.\\w$])${name}\\s*[({[.,;)=<]`).test(src)
    const usedAsJsx = new RegExp(`<${name}[\\s/>]`).test(src)
    if (!usedAsValue && !usedAsJsx) continue
    if (declared.has(name)) continue

    const spec = sources.get(name)
    if (!spec) {
      missing.push({ name, home })
    } else if (!PACKAGES.has(home) && normalizeSpec(spec) !== home) {
      wrongSource.push({ name, home, spec })
    }
  }

  if (missing.length || wrongSource.length) {
    problems += missing.length + wrongSource.length
    console.log(`\n  ${relative(SRC, file)}`)
    for (const { name, home } of missing) {
      console.log(`     ${name}  ->  not imported; it lives in "${home}"`)
    }
    for (const { name, home, spec } of wrongSource) {
      console.log(`     ${name}  ->  imported from "${spec}", but it lives in "${home}"`)
    }
  }
}

if (problems === 0) {
  console.log("check-imports: every shared name resolves to the module that exports it.")
  process.exit(0)
}
console.log(`\ncheck-imports: ${problems} problem(s). Each is broken at runtime on a route the bundler never checked.\n`)
process.exit(1)
