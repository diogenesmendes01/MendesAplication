import type { Config } from "jest";

const config: Config = {
  testEnvironment: "node",
  transform: {
    "^.+\\.tsx?$": "@swc/jest",
  },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  testMatch: ["**/__tests__/**/*.test.ts"],
};

export default config;
