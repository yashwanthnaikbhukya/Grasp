/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages ship TypeScript source directly — no build step in the
  // monorepo. Next compiles them as part of the app.
  transpilePackages: ['@grasp/core', '@grasp/schema', '@grasp/prompts'],
  // The Mongo driver must not be bundled into the server output.
  serverExternalPackages: ['mongodb'],
};

export default nextConfig;
