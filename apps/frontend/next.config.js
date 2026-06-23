/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Transpile the shared TS workspace package (catalog of triggers/actions).
  transpilePackages: ['@web3-zapier/shared'],
};

module.exports = nextConfig;
