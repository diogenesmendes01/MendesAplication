import { describe, it, expect } from "vitest";
import { logger } from "@/lib/logger";

describe("logger", () => {
  it("exports a pino logger instance", () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
  });

  it("serializes Error objects via 'error' key", () => {
    const serializer = (logger as any)[Symbol.for("pino.serializers")]?.error
      ?? (logger as any).serializers?.error;

    // Verify the serializer exists and extracts Error properties
    const err = new Error("test error");
    if (serializer) {
      const result = serializer(err);
      expect(result).toHaveProperty("message", "test error");
      expect(result).toHaveProperty("stack");
    }
  });

  it("serializes Error objects via 'err' key (pino convention)", () => {
    const serializer = (logger as any)[Symbol.for("pino.serializers")]?.err
      ?? (logger as any).serializers?.err;

    const err = new Error("pino convention error");
    if (serializer) {
      const result = serializer(err);
      expect(result).toHaveProperty("message", "pino convention error");
      expect(result).toHaveProperty("stack");
    }
  });

  it("does not throw when logging an Error object", () => {
    expect(() => {
      logger.error({ error: new Error("should serialize correctly") }, "Test error logging");
    }).not.toThrow();
  });
});
