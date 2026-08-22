/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // src/** uses NodeNext-style relative imports ending in ".js" (required so the
    // same source also runs directly under Node/tsx for the CLI). Teach webpack to
    // resolve those specifiers back to the .ts source files.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
