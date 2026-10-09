/**
 * 页图的命名与参数——**不含任何 Node 依赖**，界面（客户端组件）也能安全引用。
 *
 * 渲染页图那部分在 `pages.ts` 里（它要 spawn 子进程）；命名与参数单独放这里，
 * 否则客户端组件一 import 就会把 `node:child_process` 拖进浏览器包。
 */

export type PageImageOptions = {
  format: "jpeg" | "png";
  dpi: number;
  quality: number;
};

/** 默认页图参数：实测学生用书 131 页落在约 30–50 MB。 */
export const DEFAULT_PAGE_IMAGE: PageImageOptions = { format: "jpeg", dpi: 150, quality: 85 };

export function pageImageName(index: number, format: PageImageOptions["format"] = "jpeg"): string {
  return `p${String(index).padStart(4, "0")}.${format === "jpeg" ? "jpg" : "png"}`;
}
