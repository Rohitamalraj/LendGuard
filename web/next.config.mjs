/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // The Encrypt + Ika pre-alpha SDKs ship .ts source via their `exports` field.
  // Next.js needs to transpile them (and their protobuf-ts transport) for them
  // to run in the browser.
  transpilePackages: [
    "@encrypt.xyz/pre-alpha-solana-client",
    "@ika.xyz/pre-alpha-solana-client",
    "@protobuf-ts/grpcweb-transport",
    "@protobuf-ts/runtime-rpc",
    "@protobuf-ts/runtime",
  ],
}

export default nextConfig
