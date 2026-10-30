import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 桌面安装包用 Next standalone 产物：server.js + 最小 node_modules，
  // 由 Electron 以本机 Node 身份启动，不要求老师安装 Node。
  output: "standalone",
  // 工作区、OCR 运行时和安装包产物都不是应用代码；不排除的话 Next 会把
  // 整个 document（含老师教材）追进 standalone，既撑大安装包又泄露数据。
  outputFileTracingExcludes: {
    "/*": [
      "./document/**",
      "./build/**",
      "./release/**",
      "./resources/ocr/**",
      "./.git/**",
    ],
  },
};

export default nextConfig;
