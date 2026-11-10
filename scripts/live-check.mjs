import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { fetchUsageFromCandidates } from "../src/usage.js"

const execFileAsync = promisify(execFile)

const { stdout } = await execFileAsync("opencode", ["auth", "export"], { maxBuffer: 1024 * 1024 })
const credentials = JSON.parse(stdout)
const candidates = []
for (const integrationID of ["opencode", "opencode-go"]) {
  const entry = credentials.find((item) => item.integrationID === integrationID && item.value?.type === "key")
  if (entry?.value?.key) candidates.push({ key: entry.value.key, source: integrationID })
}

console.log("candidates:", candidates.map((candidate) => candidate.source).join(", "))
const result = await fetchUsageFromCandidates(candidates)
console.log("source:", result.source)
for (const [name, meter] of Object.entries(result.go)) {
  console.log(
    `${name}: ${meter.percent}% resetsAt=${new Date(meter.resetsAt).toISOString()} limited=${meter.limited}`,
  )
}
