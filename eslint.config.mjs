import next from "eslint-config-next";

const config = [
  { ignores: [".next/**", "node_modules/**", ".data/**", "next-env.d.ts"] },
  ...next,
  {
    rules: {
      // Our effects call async loaders that set state after an await (fetch-on-mount), which this rule over-reports.
      "react-hooks/set-state-in-effect": "warn",
      // Full page loads after sign-in/out are intentional: server components must re-read the session cookie.
      "@next/next/no-location-assign-relative-destination": "off",
    },
  },
];

export default config;
