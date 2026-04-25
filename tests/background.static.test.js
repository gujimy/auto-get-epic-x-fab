const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const rootDir = path.resolve(__dirname, "..")

test("background action icon uses packaged png asset", () => {
  const source = fs.readFileSync(path.join(rootDir, "background.js"), "utf8")

  assert.match(source, /ACTION_BASE_ICON_PATH = "icon\.png"/u)
  assert.doesNotMatch(source, /icon\.ico/u)
  assert.equal(fs.existsSync(path.join(rootDir, "icon.png")), true)
})
