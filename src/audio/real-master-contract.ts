import { z } from "zod";

const DiagnosticSchema = z.object({
  code: z.string().min(2),
  message: z.string().min(1),
  stage: z.string().min(1).optional(),
  retryable: z.boolean().default(false),
}).strict();

const RealMasterSourceSchema = z.object({
  sourceKind: z.literal("uploaded_master"),
  sourceAudioPath: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  mimeType: z.enum(["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/flac", "audio/x-flac", "audio/aac", "audio/ogg", "audio/mp4"]),
  byteLength: z.number().int().positive(),
}).strict();

const MeasurementSchema = z.discriminatedUnion("status", [
  z.object({
    name: z.string().min(1),
    status: z.literal("measured"),
    value: z.number().finite(),
    unit: z.string().min(1),
    method: z.string().min(1),
    measuredAt: z.string().datetime(),
    diagnostics: z.array(DiagnosticSchema).default([]),
  }).strict(),
  z.object({
    name: z.string().min(1),
    status: z.literal("unavailable"),
    value: z.null(),
    unit: z.string().min(1),
    method: z.string().min(1),
    diagnostics: z.array(DiagnosticSchema).min(1),
  }).strict(),
]);

const CalibrationSchema = z.object({
  calibrated: z.literal(true),
  method: z.enum(["isotonic", "platt", "temperature_scaling", "cross_validated"]),
  modelVersion: z.string().min(1),
  validationDataset: z.string().min(1),
  validationSamples: z.number().int().positive(),
  expectedCalibrationError: z.number().min(0).max(1),
  brierScore: z.number().min(0).max(1),
}).strict();

const PredictionSchema = z.discriminatedUnion("status", [
  z.object({
    name: z.string().min(1),
    status: z.literal("predicted"),
    label: z.string().min(1),
    probability: z.number().min(0).max(1),
    calibration: CalibrationSchema,
    modelVersion: z.string().min(1),
    featureDrivers: z.array(z.object({
      feature: z.string().min(1),
      contribution: z.number().finite(),
      direction: z.enum(["supports", "opposes"]),
    }).strict()),
    diagnostics: z.array(DiagnosticSchema).default([]),
  }).strict(),
  z.object({
    name: z.string().min(1),
    status: z.literal("unavailable"),
    label: z.null(),
    probability: z.null(),
    reasonCodes: z.array(z.string().min(2)).min(1),
    diagnostics: z.array(DiagnosticSchema).min(1),
  }).strict(),
]);

const ExternalRecordSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("verified"),
    provider: z.string().min(1),
    recordId: z.string().min(1),
    retrievedAt: z.string().datetime(),
    sourceUrl: z.string().url().optional(),
    fields: z.record(z.string(), z.unknown()),
    fieldProvenance: z.record(z.string(), z.object({
      provider: z.string().min(1),
      recordId: z.string().min(1),
      retrievedAt: z.string().datetime(),
    }).strict()),
  }).strict(),
  z.object({
    status: z.literal("unavailable"),
    provider: z.string().min(1),
    reasonCode: z.string().min(2),
    diagnostic: DiagnosticSchema,
    attemptedAt: z.string().datetime(),
  }).strict(),
]);

const StrategicSynthesisSchema = z.object({
  claim: z.string().min(1),
  evidenceRefs: z.array(z.string().min(1)).min(1),
  evidenceClass: z.enum(["OBSERVED", "RECOGNIZED", "RECONCILED", "INFERRED"]),
  confidence: z.number().min(0).max(1).optional(),
  limitations: z.array(z.string()).default([]),
}).strict();

export const RealMasterAuditContractSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  auditId: z.string().min(1),
  source: RealMasterSourceSchema,
  directSignalMeasurements: z.array(MeasurementSchema),
  calibratedPredictions: z.array(PredictionSchema),
  externalRecords: z.array(ExternalRecordSchema),
  strategicSynthesis: z.array(StrategicSynthesisSchema),
  pipelineDiagnostics: z.array(DiagnosticSchema).default([]),
}).strict().superRefine((contract, ctx) => {
  const refs = new Set<string>();
  contract.directSignalMeasurements.forEach((metric, index) => refs.add(`signal:${metric.name}`));
  contract.calibratedPredictions.forEach((prediction) => refs.add(`prediction:${prediction.name}`));
  contract.externalRecords.forEach((record, index) => refs.add(`external:${record.status === "verified" ? record.recordId : record.provider}`));
  contract.strategicSynthesis.forEach((claim, index) => {
    for (const ref of claim.evidenceRefs) {
      if (!refs.has(ref)) {
        ctx.addIssue({
          code: "custom",
          path: ["strategicSynthesis", index, "evidenceRefs"],
          message: `Unknown evidence reference: ${ref}`,
        });
      }
    }
  });
});

export type RealMasterAuditContract = z.infer<typeof RealMasterAuditContractSchema>;
export type DirectSignalMeasurement = z.infer<typeof MeasurementSchema>;
export type CalibratedPrediction = z.infer<typeof PredictionSchema>;
export type VerifiedExternalRecord = z.infer<typeof ExternalRecordSchema>;
export type StrategicSynthesisClaim = z.infer<typeof StrategicSynthesisSchema>;

export interface RealMasterInput {
  sourceKind: "uploaded_master" | "synthetic_fixture";
  sourceAudioPath: string | null;
  sha256: string | null;
  mimeType: string | null;
  byteLength: number;
}

/** Production execution is deliberately fail-closed: fixture data cannot enter the real-master path. */
export function requireRealMasterInput(input: RealMasterInput): asserts input is RealMasterInput & {
  sourceKind: "uploaded_master";
  sourceAudioPath: string;
  sha256: string;
  mimeType: string;
  byteLength: number;
} {
  if (input.sourceKind !== "uploaded_master") {
    throw new Error("REAL_MASTER_REQUIRED: synthetic fixtures are prohibited in production audit execution.");
  }
  if (!input.sourceAudioPath?.trim()) throw new Error("MASTER_SOURCE_PATH_MISSING");
  if (!input.sha256 || !/^[a-f0-9]{64}$/i.test(input.sha256)) throw new Error("MASTER_SHA256_INVALID");
  if (!input.mimeType?.trim()) throw new Error("MASTER_MIME_TYPE_MISSING");
  if (!Number.isSafeInteger(input.byteLength) || input.byteLength <= 0) {
    throw new Error("MASTER_BYTES_EMPTY");
  }
}

export function buildUnavailableMetric(
  name: string,
  reasonCode: string,
  message: string,
  unit = "unknown",
  method = "not_available",
): DirectSignalMeasurement {
  return {
    name,
    status: "unavailable",
    value: null,
    unit,
    method,
    diagnostics: [{ code: reasonCode, message, retryable: false }],
  };
}

export function parseRealMasterAuditContract(input: unknown): RealMasterAuditContract {
  return RealMasterAuditContractSchema.parse(input);
}
