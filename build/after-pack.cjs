/**
 * electron-builder 默认会把 extraResources 里的 node_modules 过滤掉。
 * Next standalone 的 server.js 需要它，这里在打包后显式补上。
 */
const fs = require("node:fs");
const path = require("node:path");

module.exports = async function afterPack(context) {
  const projectDir = context.packager.projectDir;
  // 如果打包前从解包目录运行过应用，appOutDir 里会有 document（老师/测试数据）。
  // 绝不能把它带进安装包；工作区应由首次启动创建。
  const strayDocument = path.join(context.appOutDir, "document");
  if (fs.existsSync(strayDocument)) {
    fs.rmSync(strayDocument, { recursive: true, force: true });
    console.log(`afterPack: removed stray document -> ${strayDocument}`);
  }
  const source = path.join(projectDir, ".next", "standalone", "node_modules");
  const target = path.join(context.appOutDir, "resources", "app", "node_modules");
  if (!fs.existsSync(source)) {
    throw new Error(`缺少 Next standalone node_modules：${source}`);
  }
  fs.cpSync(source, target, { recursive: true, force: true });
  console.log(`afterPack: copied node_modules -> ${target}`);
};
