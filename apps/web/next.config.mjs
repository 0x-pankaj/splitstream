/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @arcane/* are workspace TS packages consumed as source.
  transpilePackages: ["@arcane/shared", "@arcane/server"],
  webpack: (config) => {
    // The shared package uses ESM ".js" import specifiers that point at ".ts"
    // source. Teach webpack to resolve them when bundling the workspace deps.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
