import express from "express";
import request from "supertest";
import invokeRoute from "../src/routes/invoke.js";

const app = express();
app.use(express.json());
app.use("/api/invoke", invokeRoute);

// A valid Stellar contract ID: 'C' followed by 55 uppercase alphanumeric chars
const VALID_CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("POST /api/invoke", () => {
  describe("Success cases", () => {
    it("returns 200 with correct payload for valid request without args", async () => {
      const res = await request(app).post("/api/invoke").send({
        contractId: VALID_CONTRACT_ID,
        functionName: "get_balance",
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe("success");
      expect(res.body.contractId).toBe(VALID_CONTRACT_ID);
      expect(res.body.functionName).toBe("get_balance");
      expect(res.body.args).toEqual({});
      expect(res.body.output).toBe("Success");
      expect(res.body.message).toBe('Function "get_balance" invoked successfully');
      expect(typeof res.body.invokedAt).toBe("string");
    });

    it("returns 200 and echoes args.name as output when args.name is provided", async () => {
      const res = await request(app).post("/api/invoke").send({
        contractId: VALID_CONTRACT_ID,
        functionName: "hello",
        args: { name: "Alice" },
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.args).toEqual({ name: "Alice" });
      expect(res.body.output).toBe("Alice");
    });

    it("returns 200 with empty args when args is omitted", async () => {
      const res = await request(app).post("/api/invoke").send({
        contractId: VALID_CONTRACT_ID,
        functionName: "_internal_fn",
      });

      expect(res.status).toBe(200);
      expect(res.body.args).toEqual({});
    });

    it("returns 200 with empty args when args is null", async () => {
      const res = await request(app).post("/api/invoke").send({
        contractId: VALID_CONTRACT_ID,
        functionName: "transfer",
        args: null,
      });

      expect(res.status).toBe(200);
      expect(res.body.args).toEqual({});
    });

    it("returns a valid ISO timestamp in invokedAt", async () => {
      const before = Date.now();
      const res = await request(app).post("/api/invoke").send({
        contractId: VALID_CONTRACT_ID,
        functionName: "init",
      });
      const after = Date.now();

      expect(res.status).toBe(200);
      const ts = new Date(res.body.invokedAt).getTime();
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });
  });

  describe("Validation failures — missing fields", () => {
    it("returns 400 when contractId is missing", async () => {
      const res = await request(app).post("/api/invoke").send({
        functionName: "get_balance",
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.status).toBe("error");
      expect(res.body.error).toBe("Validation failed");
      expect(res.body.details).toContain("contractId is required");
    });

    it("returns 400 when functionName is missing", async () => {
      const res = await request(app).post("/api/invoke").send({
        contractId: VALID_CONTRACT_ID,
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.details).toContain("functionName is required");
    });

    it("returns 400 when both contractId and functionName are missing", async () => {
      const res = await request(app).post("/api/invoke").send({});

      expect(res.status).toBe(400);
      expect(res.body.details).toContain("contractId is required");
      expect(res.body.details).toContain("functionName is required");
    });
  });

  describe("Validation failures — invalid formats", () => {
    it("returns 400 when contractId does not start with C", async () => {
      const res = await request(app).post("/api/invoke").send({
        contractId: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        functionName: "get_balance",
      });

      expect(res.status).toBe(400);
      expect(res.body.details[0]).toMatch(/valid Stellar contract ID/);
    });

    it("returns 400 when contractId is too short", async () => {
      const res = await request(app).post("/api/invoke").send({
        contractId: "CSHORT",
        functionName: "get_balance",
      });

      expect(res.status).toBe(400);
      expect(res.body.details[0]).toMatch(/valid Stellar contract ID/);
    });

    it("returns 400 when contractId contains lowercase letters", async () => {
      const res = await request(app).post("/api/invoke").send({
        contractId: "Caaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        functionName: "get_balance",
      });

      expect(res.status).toBe(400);
      expect(res.body.details[0]).toMatch(/valid Stellar contract ID/);
    });

    it("returns 400 when functionName starts with a digit", async () => {
      const res = await request(app).post("/api/invoke").send({
        contractId: VALID_CONTRACT_ID,
        functionName: "1invalid",
      });

      expect(res.status).toBe(400);
      expect(res.body.details[0]).toMatch(/valid identifier/);
    });

    it("returns 400 when functionName contains hyphens", async () => {
      const res = await request(app).post("/api/invoke").send({
        contractId: VALID_CONTRACT_ID,
        functionName: "get-balance",
      });

      expect(res.status).toBe(400);
      expect(res.body.details[0]).toMatch(/valid identifier/);
    });

    it("returns 400 when args is an array", async () => {
      const res = await request(app).post("/api/invoke").send({
        contractId: VALID_CONTRACT_ID,
        functionName: "get_balance",
        args: ["not", "an", "object"],
      });

      expect(res.status).toBe(400);
      expect(res.body.details).toContain("args must be an object");
    });

    it("returns 400 when args is a string", async () => {
      const res = await request(app).post("/api/invoke").send({
        contractId: VALID_CONTRACT_ID,
        functionName: "get_balance",
        args: "invalid",
      });

      expect(res.status).toBe(400);
      expect(res.body.details).toContain("args must be an object");
    });
  });
});
