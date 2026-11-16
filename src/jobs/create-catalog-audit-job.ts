import { randomBytes } from "node:crypto";
import { normalizeDspTrackLinks } from "../providers/dsp/intake.js";
import { sha256 } from "./content-hash.js";

export interface CreateCatalogAuditJobInput {
  ownerId: string | null;
  catalogUrl: string;
  catalogUrls?: readonly string[];
}

export interface CreateCatalogAuditJobDependencies {
  createCatalogJob: (input: {
    ownerId: string | null;
    catalogUrl: string;
    catalogUrls: string[];
    sha256: string;
    reportAccessTokenHash: string;
  }) => Promise<string>;
}

export async function createCatalogAuditJob(
  input: CreateCatalogAuditJobInput,
  deps: CreateCatalogAuditJobDependencies,
) {
  const links = normalizeDspTrackLinks(input.catalogUrls?.length ? input.catalogUrls : [input.catalogUrl]);
  const catalogUrls = links.map((link) => link.canonicalUrl);
  const catalogUrl = catalogUrls[0]!;
  const digest = await sha256(new TextEncoder().encode(catalogUrls.join("\n")));
  const reportAccessToken = randomBytes(32).toString("hex");
  const reportAccessTokenHash = await sha256(new TextEncoder().encode(reportAccessToken));
  const jobId = await deps.createCatalogJob({
    ownerId: input.ownerId,
    catalogUrl,
    catalogUrls,
    sha256: digest,
    reportAccessTokenHash,
  });
  return { jobId, sha256: digest, reportAccessToken, catalogUrls };
}
