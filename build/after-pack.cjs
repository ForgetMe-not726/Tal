/**
 * electron-builder 默认会把 extraResources 里的 node_modules 过滤掉。
 * Next standalone 的 server.js 需要它，这里在打包后显式补上。
 */
const fs = require("node:fs");
const path = require("node:path");

module.exports = async function afterPack(context) {
  const projectDir = context.packager.projectDir;
  const source = path.join(projectDir, ".next", "standalone", "node_modules");
  const target = path.join(context.appOutDir, "resources", "app", "node_modules");
  if (!fs.existsSync(source)) {
    throw new Error(`缺少 Next standalone node_modules：${source}`);
  }
  fs.cpSync(source, target, { recursive: true, force: true });
  console.log(`afterPack: copied node_modules -> ${target}`);
};
