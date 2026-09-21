/** @type {import('next').NextConfig} */
const nextConfig = {
  // Don't advertise the framework version (minor info-leak hardening).
  poweredByHeader: false,
  // firebase-admin (and its jwks-rsa → jose@6 transitive dep) ships as
  // CommonJS that dynamically requires ESM internals. Bundling it into the
  // serverless output breaks at runtime on Vercel with ERR_REQUIRE_ESM.
  // Treating it as external keeps Node resolving it normally at runtime.
  serverExternalPackages: ["firebase-admin", "firebase-admin/app", "firebase-admin/auth"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
