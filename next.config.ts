import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 自建托管：标准 Next 静态导出（替代 vinext build），由 Caddy 直接托管 out/
  output: "export",
  // 静态导出无图片优化服务，关闭优化改用原图
  images: { unoptimized: true },
  // 扁平导出：/checkout -> out/checkout.html（配合 Caddy try_files {path}.html）
  trailingSlash: false,
};

export default nextConfig;
