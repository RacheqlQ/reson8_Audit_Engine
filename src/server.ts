import Fastify from "fastify";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createAuditJob } from "./jobs/create-audit-job.js";
import { createCatalogAuditJob } from "./jobs/create-catalog-audit-job.js";
import { MAX_AUDIO_FILE_BYTES } from "./jobs/audio-intake.js";
import { createSupabaseAuditStore } from "./integrations/supabase-audit-store.js";
import type { CreateAuditJobDependencies } from "./jobs/create-audit-job.js";
import { ensurePdfReport } from "./reports/pdf-output.js";

export interface AuditStore {
  createJobDependencies(): CreateAuditJobDependencies;
  getAuditStatus(jobId: string): Promise<{
    jobId: string;
    status: "queued" | "processing" | "completed" | "failed";
    currentStepIndex: number;
    errorMessage?: string | null;
    full: { available: boolean; version?: number };
  }>;
  getAuditReport(jobId: string, tier: "sample" | "full", ownerId?: string): Promise<{
    bytes: Uint8Array;
    contentType: string;
    filename: string;
  }>;
  getAuditReportPayload?(jobId: string, tier: "sample" | "full", ownerId?: string): Promise<unknown | null>;
  verifySampleReportAccess?(jobId: string, token: string): Promise<boolean>;
}

const PUBLIC_RATE_LIMIT = Number(process.env.PUBLIC_AUDIT_RATE_LIMIT_PER_HOUR ?? 30);
const publicRequests = new Map<string, { count: number; resetAt: number }>();

function allowPublicRequest(ip: string): boolean {
  const now = Date.now();
  const current = publicRequests.get(ip);

  if (!current || current.resetAt <= now) {
    publicRequests.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return true;
  }

  if (current.count >= PUBLIC_RATE_LIMIT) return false;
  current.count += 1;
  return true;
}

async function servePublicFile(filename: string) {
  return readFile(new URL(`../public/${filename}`, import.meta.url));
}

export function paymentsEnabled(value: string | undefined = process.env.PAYMENTS_ENABLED): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "true";
}

/** Operator access fails closed unless a strong secret is configured. */
export function operatorAuthorized(
  suppliedKey: string | undefined,
  expectedKey: string | undefined = process.env.RESON8_OPERATOR_KEY,
): boolean {
  if (typeof suppliedKey !== "string" || typeof expectedKey !== "string") return false;
  const expected = Buffer.from(expectedKey, "utf8");
  const supplied = Buffer.from(suppliedKey, "utf8");
  if (expected.length < 32 || supplied.length !== expected.length) return false;
  return timingSafeEqual(supplied, expected);
}

export function buildServer(store: AuditStore = createSupabaseAuditStore()) {
  const app = Fastify({
    logger: true,
    trustProxy: true,
    bodyLimit: MAX_AUDIO_FILE_BYTES,
  });

  app.addContentTypeParser(new RegExp("^audio/.+$", "i"), { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });

  app.get("/", async (_request, reply) => {
    return reply.type("text/html; charset=utf-8").send(await servePublicFile("index.html"));
  });

  app.get("/styles.css", async (_request, reply) => {
    return reply.type("text/css; charset=utf-8").send(await servePublicFile("styles.css"));
  });

  app.get("/app.js", async (_request, reply) => {
    return reply.type("text/javascript; charset=utf-8").send(await servePublicFile("app.js"));
  });

  app.post<{
    Body: { url?: string };
  }>("/v1/audits/catalog", async (request, reply) => {
    try {
      if (!allowPublicRequest(request.ip)) {
        return reply.code(429).send({
          error: "PUBLIC_RATE_LIMITED",
          message: "Public audit limit reached. Please try again later.",
        });
      }

      const ownerId = null;

      const url = typeof request.body?.url === "string" ? request.body.url : "";
      if (!url) {
        return reply.code(400).send({
          error: "CATALOG_URL_REQUIRED",
          message: "A DSP or catalog URL is required",
        });
      }

      const result = await createCatalogAuditJob(
        { ownerId, catalogUrl: url },
        {
          createCatalogJob: async (input) => {
            const deps = store.createJobDependencies();
            return deps.createCatalogJob(input);
          },
        },
      );

      return reply.code(201).send({
        jobId: result.jobId,
        status: "queued",
        sourceType: "dsp_link",
        sha256: result.sha256,
        reportAccessToken: result.reportAccessToken,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create catalog audit job";
      request.log.error({ err: error }, "catalog audit job creation failed");
      return reply.code(400).send({ error: "INVALID_CATALOG_URL", message });
    }
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "reson8-audit-engine",
  }));
  app.get<{
    Params: { jobId: string };
  }>("/v1/audits/:jobId", async (request, reply) => {
    try {
      return reply.send(await store.getAuditStatus(request.params.jobId));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to read audit status";
      if (message === "Audit job not found") {
        return reply.code(404).send({ error: "AUDIT_NOT_FOUND", message });
      }
      request.log.error({ err: error }, "audit status lookup failed");
      return reply.code(500).send({ error: "AUDIT_STATUS_FAILED", message: "Unable to read audit status" });
    }
  });

  app.get<{
    Params: { jobId: string; tier: "sample" | "full" };
    Headers: { "x-reson8-operator-key"?: string; "x-reson8-report-token"?: string };
  }>("/v1/audits/:jobId/reports/:tier", async (request, reply) => {
    const tier = request.params.tier;
    if (tier !== "sample" && tier !== "full") return reply.code(404).send({ error: "REPORT_NOT_FOUND", message: "Report not found" });

    const isOperator = operatorAuthorized(request.headers["x-reson8-operator-key"]);
    let isSampleAuthorized = false;
    const reportToken = request.headers["x-reson8-report-token"];
    if (tier === "sample" && reportToken && store.verifySampleReportAccess) {
      try {
        isSampleAuthorized = await store.verifySampleReportAccess(request.params.jobId, reportToken);
      } catch (error) {
        request.log.error({ err: error }, "sample report access verification failed");
        return reply.code(500).send({ error: "REPORT_ACCESS_VERIFICATION_FAILED", message: "Unable to verify sample report access" });
      }
    }
    if (!isOperator && !isSampleAuthorized) {
      if (tier === "full" && paymentsEnabled()) {
        return reply.code(402).send({
          error: "PAYMENT_REQUIRED",
          message: "Verified payment is required; payment verification is not configured.",
        });
      }
      return reply.code(403).send({
        error: "OPERATOR_AUTH_REQUIRED",
        message: "Report retrieval is restricted to an authorized Reson8 operator.",
      });
    }

    try {
      const sendPdf = async (source: unknown, sampleFilename?: string) => {
        const pdf = await ensurePdfReport(source, tier);
        const safeSampleFilename = sampleFilename && /^[A-Za-z0-9._-]+\.pdf$/i.test(sampleFilename)
          ? sampleFilename
          : "audit-report-sample.pdf";
        const disposition = tier === "full"
          ? 'inline; filename="audit-report.pdf"'
          : `attachment; filename="${safeSampleFilename}"`;
        return reply.type("application/pdf").header("content-disposition", disposition).send(Buffer.from(pdf));
      };

      let report: { bytes: Uint8Array; contentType: string; filename: string };
      try {
        report = await store.getAuditReport(request.params.jobId, tier);
      } catch (error) {
        if (!store.getAuditReportPayload) throw error;
        const payload = await store.getAuditReportPayload(request.params.jobId, tier);
        if (payload === null || payload === undefined) throw error;
        return await sendPdf(payload);
      }
      return await sendPdf(report.bytes, report.filename);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to retrieve report";
      if (message === "Audit job not found" || message === "Report not found") return reply.code(404).send({ error: "REPORT_NOT_FOUND", message: "Report not found" });
      request.log.error({ err: error }, "audit report retrieval failed");
      return reply.code(500).send({ error: "REPORT_RETRIEVAL_FAILED", message: "Unable to retrieve report" });
    }
  });


  app.post<{
    Headers: {
      authorization?: string;
      "x-audio-filename"?: string;
      "x-catalog-url"?: string;
    };
  }>("/v1/audits", async (request, reply) => {
    try {
      if (!allowPublicRequest(request.ip)) {
        return reply.code(429).send({
          error: "PUBLIC_RATE_LIMITED",
          message: "Public audit limit reached. Please try again later.",
        });
      }

      const ownerId = null;

      const filename = request.headers["x-audio-filename"];

      if (!filename) {
        return reply.code(400).send({
          error: "AUDIO_FILENAME_REQUIRED",
          message: "x-audio-filename is required",
        });
      }

      const contentType = String(request.headers["content-type"] ?? "").split(";")[0].trim();
      const bytes = request.body as Buffer;

      const result = await createAuditJob(
        {
          ownerId,
          filename,
          mimeType: contentType,
          bytes,
          catalogUrl: request.headers["x-catalog-url"] ?? null,
        },
        store.createJobDependencies(),
      );

      return reply.code(201).send({
        jobId: result.jobId,
        status: "queued",
        sha256: result.sha256,
        sourceType: result.sourceType,
        reportAccessToken: result.reportAccessToken,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create audit job";

      if (
        message === "Audio filename is required" ||
        message === "Unsupported audio type" ||
        message === "Audio file is empty" ||
        message === "Audio file exceeds the 50 MB limit" ||
        message === "DSP URL must use HTTPS" ||
        message === "DSP URL must not contain credentials" ||
        message === "Unsupported DSP or catalog URL" ||
        message === "Invalid URL"
      ) {
        return reply.code(400).send({
          error: message.startsWith("DSP URL") || message === "Unsupported DSP or catalog URL" || message === "Invalid URL" ? "INVALID_CATALOG_URL" : "INVALID_AUDIO_UPLOAD",
          message,
        });
      }

      request.log.error({ err: error }, "audit job creation failed");
      return reply.code(500).send({
        error: "AUDIT_JOB_CREATION_FAILED",
        message: "Unable to create audit job",
      });
    }
  });

  return app;
}

