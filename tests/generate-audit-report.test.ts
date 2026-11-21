import { PDFDocument } from "@cantoo/pdf-lib";
import { describe,expect,it,vi } from "vitest";
import { buildArNotesDecisionContext,checkLayout,checkPageDensity,chartLayoutIssuesForReport,coverVerdictLabel,generateAuditReport,metadataFieldSource,normalizeReportText,paginateArNotesSummary,planAuditReportPages,sonicDashboardRowsForReport,chartsForSection,type AuditReportInput } from "../src/reports/generate-audit-report.js";
import { fullAudioFixture,partialAudioFixture,metadataOnlyFixture,longFormAudioFixture } from "../scripts/fixtures/sample-report-input.mjs";
import { ambiguousAudioFixture } from "../scripts/fixtures/ambiguous-audio.mjs";
import { buildStrengthRiskChartRows,chartPanelDisplayStatus,chartPanelHeight,constellationLabelLineCount } from "../src/reports/charts.js";
const fixtures=[fullAudioFixture,partialAudioFixture,metadataOnlyFixture,longFormAudioFixture] as unknown as AuditReportInput[];
const allFixtures=[...fixtures,ambiguousAudioFixture as unknown as AuditReportInput];
const reportTiers=["sample","full"] as const;
// Embedded typography makes multi-fixture PDF rendering slower than pure unit tests.
vi.setConfig({ testTimeout: 30_000 });
describe("A4 report layout and fixture coverage",()=>{
 it("defines exactly five generic fixtures across two report tiers",()=>{
  expect(allFixtures).toHaveLength(5);
  expect(reportTiers).toEqual(["sample","full"]);
  expect(allFixtures.length*reportTiers.length).toBe(10);
 });
 it("detects element intersections and page overflow",()=>{
  expect(checkLayout([{x:0,y:0,width:20,height:20,id:"a"},{x:10,y:10,width:20,height:20,id:"b"}]).ok).toBe(false);
  expect(checkLayout([{x:590,y:0,width:20,height:20,id:"overflow"}]).ok).toBe(false);
 });
 it("enforces the 40 percent maximum empty-area threshold and rejects empty pages",()=>{
  expect(checkPageDensity([{x:48,y:76,width:499,height:659,id:"dense"}]).ok).toBe(true);
  expect(checkPageDensity([{x:48,y:600,width:499,height:100,id:"sparse"}]).ok).toBe(false);
  expect(checkPageDensity([]).ok).toBe(false);
 });
 it("keeps the strengths-versus-risks summary compact while full statements remain in the written report",()=>{
  const compact=chartPanelHeight("tension",buildStrengthRiskChartRows(["A","B","C"],["D","E"]));
  const maximum=chartPanelHeight("tension",buildStrengthRiskChartRows(Array.from({length:10},(_,i)=>"Strength "+i),Array.from({length:10},(_,i)=>"Risk "+i)));
  expect(compact).toBe(205);expect(maximum).toBe(205);
  expect(chartLayoutIssuesForReport(fullAudioFixture as any)).toEqual([]);
 });
 it("does not attach measured status to unavailable metadata-only charts",()=>{
  expect(chartPanelDisplayStatus({fixture:true,unavailable:true,evidenceClass:"measured"})).toBe("SAMPLE DATA · AUDIO REQUIRED");
  expect(chartPanelDisplayStatus({evidenceClass:"illustrative"})).toBe("ILLUSTRATIVE");
 });
 it("retains the DSP coverage panel when provider lookup outcomes are unavailable",()=>{
  const input=structuredClone(metadataOnlyFixture) as any;
  input.evidence.catalogSources=[];
  const panels=chartsForSection(input,"Identity and source reconciliation");
  expect(panels).toHaveLength(1);
  expect(panels[0]).toMatchObject({title:"Music platform coverage",unavailable:true,evidenceClass:"provider-recognized"});
  expect(panels[0].shows).toContain("coverage is unavailable, not zero");
 });
 it("reserves enough wrapped rows for long lane constellation labels",()=>{
  expect(constellationLabelLineCount({label:"Adjacent lane",value:"Alternative R&B (fixture lane hypothesis)"},499)).toBeGreaterThan(1);
 });
 it("collapses repeated industry-practice prefixes to one heading",()=>{
  const input=structuredClone(fullAudioFixture) as any;
  input.assessment.industryPractice="INDUSTRY PRACTICE — INDUSTRY PRACTICE — General guidance for release planning.";
  const report=planAuditReportPages(input,"full").flatMap(page=>page.text).join(" ");
  expect(report).not.toContain("INDUSTRY PRACTICE — INDUSTRY PRACTICE");
  expect(report).toContain("General industry guidance — General guidance for release planning.");
 });
 it("checks chart-caption separation for every chart in all four fixtures",()=>{
  for(const input of allFixtures)expect(chartLayoutIssuesForReport(input)).toEqual([]);
 });
 it("does not emit low-density warnings across all sample and full fixture variants",async()=>{
  const warning=vi.spyOn(console,"warn").mockImplementation(()=>{});
  try{
   for(const input of allFixtures)for(const tier of reportTiers)await generateAuditReport(input,tier);
   expect(warning.mock.calls.filter(([message])=>String(message).includes("[report-layout]"))).toEqual([]);
  }finally{warning.mockRestore();}
 });
 it("renders each fixture pair at A4 with exactly one isolated A&R notes field",async()=>{
  for(const input of allFixtures)for(const tier of reportTiers){
   const bytes=await generateAuditReport(input,tier),pdf=await PDFDocument.load(bytes);
   for(const page of pdf.getPages()){const size=page.getSize();expect(size.width).toBeCloseTo(595.28,0);expect(size.height).toBeCloseTo(841.89,0);}
   const fields=pdf.getForm().getFields();
   expect(fields.map(f=>f.getName())).toEqual(["ar_notes"]);
   const notesField=pdf.getForm().getTextField("ar_notes");
   const widgets=notesField.acroField.getWidgets();
   expect(widgets).toHaveLength(1);
   const notesWidgetPage=widgets[0].P();
   const notesPageIndex=pdf.getPages().findIndex(page=>page.ref.objectNumber===notesWidgetPage?.objectNumber&&page.ref.generationNumber===notesWidgetPage?.generationNumber);
   expect(notesPageIndex).toBeGreaterThanOrEqual(0);
   expect(notesPageIndex).toBe(pdf.getPageCount()-1);
   expect(pdf.getPageCount()).toBeLessThanOrEqual(20);
  }
 });
 it("normalizes extended Unicode without replacing unsupported glyphs with question marks",()=>{
  const normalized=normalizeReportText("Café — mix… 4×4 ♯ ♭ � 🎧");
  expect(normalized).toContain("Café - mix... 4x4 # b");
  expect(normalized).not.toContain("?");
 });
 it("normalizes extended technical and typographic Unicode without question-mark substitution",()=>{
  const normalized=normalizeReportText("LUFS −11.0 dB ≥ −1 dB; RMS × 2; arrow →; © ® ™; Café — “mix”…");
  expect(normalized).toContain("LUFS -11.0 dB >= -1 dB");
  expect(normalized).toContain("RMS x 2");
  expect(normalized).toContain("(c) (R) TM");
  expect(normalized).toContain("Café - \"mix\"...");
  expect(normalized).not.toContain("?");
 });
 it("shows tempo only when the master estimate passes the confidence gate",()=>{
  const tentative=structuredClone(fullAudioFixture) as any;
  tentative.sonicDna.tempoConfidence=0.08;
  tentative.sonicDna.bpm=96;
  expect(sonicDashboardRowsForReport(tentative.sonicDna,true).find(row=>row.label==="TEMPO BPM")?.value).toBeNull();
  const detected=structuredClone(fullAudioFixture) as any;
  detected.sonicDna.tempoConfidence=0.5;
  expect(sonicDashboardRowsForReport(detected.sonicDna,true).find(row=>row.label==="TEMPO BPM")?.value).not.toBeNull();
  const zero=structuredClone(fullAudioFixture) as any;
  zero.sonicDna.tempoConfidence=0;
  expect(sonicDashboardRowsForReport(zero.sonicDna,true).find(row=>row.label==="TEMPO BPM")?.value).toBeNull();
  const body=planAuditReportPages(tentative).flatMap(section=>section.text).join(" ");
  expect(body).not.toMatch(/Tentative candidate|96.0 BPM|Tempo: Detected|Tempo: Tentative/);
 });
 it("renders measured vocal presence, activity timestamps and pitch without inventing delivery or lyrics",()=>{
  const input=structuredClone(fullAudioFixture) as any;
  input.sonicDna.vocalFeatures={
   status:"analyzed",method:"open_unmix_umxhq_vocal_stem",model:{name:"Open-Unmix UMX-HQ vocals",artifactSha256:"f27742bb52b2"},
   voicePresence:"likely_present",vocalStemRmsDbfs:-18.4,vocalEnergyShare:0.12,vocalActivityRatio:0.35,activeDurationSeconds:42.0,
   activitySegments:[{startSeconds:4.2,endSeconds:12.6,meanLevelDbfs:-19.2,peakLevelDbfs:-12.4}],
   pitch:{medianHz:220,lowerHz:110,upperHz:440,voicedFrameRatio:0.82,track:[{timeSeconds:4.2,fundamentalHz:220}]},
   delivery:"not_classified",layering:"not_classified",lyrics:"not_requested",reviewStatus:"not_human_reviewed",
   limitations:["Vocal presence is a conservative separated-stem estimate, not a calibrated probability."]
  };
  const body=planAuditReportPages(input).flatMap((section)=>section.text).join(" ");
  expect(body).toContain("Vocal presence: likely_present");
  expect(body).toContain("activity intervals: 4.20–12.60 s");
  expect(body).toContain("estimated fundamental-frequency candidates: 110–440 Hz (median 220 Hz)");
  expect(body).toContain("delivery: not_classified; layering: not_classified");
  expect(body).not.toMatch(/Open-Unmix|reviewStatus|human review/i);
 });
 it("marks the audio fixture variants as synthetic, including partial null-key and low-confidence data",()=>{
  expect(fullAudioFixture.evidence.artist).toBe("Fixture Artist");
  expect(fullAudioFixture.sonicDna.bpm).toBe(96);
  expect(partialAudioFixture.sonicDna.key).toBeNull();
  expect(partialAudioFixture.assessment.confidence).toBe(0.28);
  expect(metadataOnlyFixture.sonicDna).toBeNull();
  expect(metadataOnlyFixture.evidence.artist).toBe("Fixture Artist");
  expect(longFormAudioFixture.evidence.fixture).toBe(true);
  expect(longFormAudioFixture.assessment.executiveSummary.split(/\s+/).length).toBeGreaterThan(70);
  expect(longFormAudioFixture.assessment.strengths.length).toBeGreaterThanOrEqual(4);
 });
 it("renders DSP source coverage and explicit conflict values in identity reconciliation",()=>{
  const input=structuredClone(fullAudioFixture) as AuditReportInput;
  input.evidence.catalogSources=[
   {platform:"spotify",catalogId:"sp-1",canonicalUrl:"https://open.spotify.com/track/sp-1",status:"recognized",error:null},
   {platform:"apple_music",catalogId:"am-1",canonicalUrl:"https://music.apple.com/us/album/song/1?i=2",status:"recognized",error:null},
   {platform:"deezer",catalogId:"dz-1",canonicalUrl:"https://www.deezer.com/track/dz-1",status:"recognized",error:null},
   {platform:"tidal",catalogId:"td-1",canonicalUrl:"https://tidal.com/browse/track/td-1",status:"partial",error:null},
   {platform:"youtube_music",catalogId:"yt-1",canonicalUrl:"https://www.youtube.com/watch?v=yt-1",status:"unavailable",error:"Provider lookup timed out"},
  ];
  input.evidence.reconciliation={conflicts:[{field:"artist",values:["Tems","Wrong Artist"]}]};
  const pages=planAuditReportPages(input,"full");
  const report=pages.flatMap(page=>[page.title,...page.text]).join(" ");
  expect(report).toContain("DSP provider lookup outcomes");
  expect(report).toContain("Apple Music — recognized");
  expect(report).toContain("YouTube Music — unavailable");
  expect(report).toContain("Conflict details: artist: Tems vs Wrong Artist");
  expect(report).not.toContain("Assessment confidence");
  expect(chartLayoutIssuesForReport(input)).toEqual([]);
 });
 it("keeps automatic ISRC lookup attempts out of submitted DSP coverage and the evidence chain",()=>{
   const input=structuredClone(fullAudioFixture) as AuditReportInput;
   input.evidence={
    ...input.evidence,
    isrc:"USSM10501515",
    fieldProvenance:{...((input.evidence.fieldProvenance as Record<string,unknown>)??{}),isrc:"musicbrainz"},
    metadataSourcesChecked:["tidal","apple_music","musicbrainz"],
    catalogSources:[
     {platform:"tidal",catalogId:"11335944",canonicalUrl:"https://tidal.com/browse/track/11335944",status:"recognized",reason:"Provider returned track metadata."},
     {platform:"apple_music",catalogId:"322847207",canonicalUrl:"https://music.apple.com/ng/song/will-you-be-there/322847207",status:"recognized",reason:"Provider returned track metadata."}
    ],
    isrcCatalogSources:[
     {platform:"musicbrainz",canonicalUrl:"https://musicbrainz.org/ws/2/isrc/USSM10501515",status:"recognized",reason:"MusicBrainz returned an ISRC recording match."},
     {platform:"spotify",canonicalUrl:"https://api.spotify.com/v1/search?q=isrc%3AUSSM10501515",status:"unavailable",reason:"Spotify API returned HTTP 403 Forbidden."}
    ]
   };
   const pages=planAuditReportPages(input,"full");
   const report=pages.flatMap(page=>[page.title,...page.text]).join(" ");
   expect(report).toContain("TIDAL — recognized");
   expect(report).toContain("Apple Music — recognized");
   expect(report).toContain("Field source: MusicBrainz");
   expect(report).not.toContain("api.spotify.com");
   expect(report).not.toContain("Spotify — unavailable");
   expect(report).not.toContain("musicbrainz.org/ws/2/isrc/");
  });
  it("abstains when no provisional mood or energy outputs were produced",()=>{
  const input=structuredClone(fullAudioFixture) as AuditReportInput;
  input.evidence={...input.evidence,fixture:false,masterAudio:{evidenceClass:"OBSERVED",provenance:"uploaded_audio_master"}};
  const report=planAuditReportPages(input,"full").flatMap(page=>[page.title,...page.text]).join(" ");
  expect(report).toContain("No supported mood or energy description is available from this recording.");
  expect(report).not.toMatch(/confidence|calibrated|Goertzel|FFT|harmonic chroma/i);
  expect(report).not.toMatch(/Mood classification: Not performed — no validated audio mood model is configured/i);
 });
 it("uses evidence-derived dimensions and keeps artistic judgement unscored",()=>{
  const pages=planAuditReportPages(fixtures[0],"full");
  const report=pages.flatMap(p=>[p.title,...p.text]).join(" ");
  expect(report).toContain("Tempo and lane fit");expect(report).toContain("Rhythmic consistency");
  expect(report).toContain("RMS-envelope spread (internal proxy) and RMS signal level");expect(report).toContain("Human listening checklist");
  expect(report).toContain("General industry guidance");expect(report).toContain("references to verify");
 });
 it("prints field-level source attribution and leaves absent provenance explicitly unavailable",()=>{
  expect(metadataFieldSource({fieldProvenance:{title:"spotify",artist:"id3",album:"filename"}}, "title")).toBe("Field source: Spotify");
  expect(metadataFieldSource({fieldProvenance:{title:"spotify",artist:"id3",album:"filename"}}, "artist")).toBe("Field source: Embedded audio tags");
  expect(metadataFieldSource({fieldProvenance:{title:"spotify",artist:"id3",album:"filename"}}, "album")).toBe("Field source: Uploaded filename");
  expect(metadataFieldSource({fieldProvenance:{}}, "isrc")).toBe("Field source: unavailable");
  expect(metadataFieldSource({fieldProvenance:{genre:"apple_music"}}, "genre")).toBe("Field source: Apple Music");
  const input=structuredClone(fullAudioFixture) as any;
  input.evidence.fieldProvenance={title:"spotify",artist:"id3",album:null,isrc:null,upc:null,label:null,releaseDate:null};
  const identity=planAuditReportPages(input,"full").find(page=>page.title==="Identity and source reconciliation");
  expect(identity?.text.join(" ")).toContain("Track: ");
  expect(identity?.text.join(" ")).toContain("Field source: Spotify");
  expect(identity?.text.join(" ")).toContain("Field source: Embedded audio tags");
 });
 it("collapses all missing audio measurements into one empty state without master-derived provenance claims",()=>{
  const report=planAuditReportPages(fixtures[2],"full").flatMap(p=>p.text).join(" ");
  expect(report).toContain("No uploaded master was supplied; tempo, key/mode, loudness and spectral measurements require the recording itself.");
  expect(sonicDashboardRowsForReport(null,false).every(row=>row.value===null)).toBe(true);
  expect(report).not.toContain("Measured from the uploaded master");
  expect(report).not.toContain("fixture.sonicDna.bpm");
  expect(report).toContain("No uploaded audio master or Sonic DNA measurements are supplied");
  expect(report).toContain("Required next input: upload the actual master audio file");
  expect(report).toContain("Do not infer genre, production quality or mastering readiness from DSP metadata alone");
 });
 it("builds the A&R Notes decision-context structure used by the generated PDF",()=>{
  const context=buildArNotesDecisionContext(ambiguousAudioFixture as any);
  expect(context.heading).toBe("DECISION CONTEXT");
  expect(context.verdict).toBe("PROPOSED A&R THESIS");
  expect(context.summary).not.toContain("zero-confidence tempo candidate");
  expect(context.summary).not.toMatch(/\b(?:128\s*BPM|Afrobeats|streams?)\b/i);
  expect(context.prompts).toHaveLength(3);
  expect(context.prompts[0]).toContain("change the current decision");
  expect(context.prompts[1]).toContain("identity, rights or source gaps");
  expect(context.prompts[2]).toContain("before any external pitch");
 });
 it("splits long A&R Notes summaries into ordered, lossless continuation chunks",()=>{
  const source=Array.from({length:100},(_,index)=>"summary-segment-"+(index+1));
  const chunks=paginateArNotesSummary(source);
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks.flat()).toEqual(source);
  expect(new Set(chunks.flat()).size).toBe(source.length);
  expect(chunks.slice(0,-1).every(chunk=>chunk.length<=42)).toBe(true);
  expect(chunks[chunks.length-1].length).toBeLessThanOrEqual(16);
 });
 it("uses the same evidence-sanitized assessment for A&R Notes and the report body",async()=>{
  const input=structuredClone(ambiguousAudioFixture) as AuditReportInput;
  input.assessment.executiveSummary=[
   "The recording is a 128 BPM high-energy Afrobeats release.",
   "The release has 24000 streams, strong market demand and high commercial potential.",
   "Further listening and source verification are required before any external decision."
  ].join(" ");
  const context=buildArNotesDecisionContext(input);
  const forbidden=/\b(?:128\s*BPM(?!\s*candidate\b)|high-energy|Afrobeats|24000 streams|market demand|commercial potential)\b/i;
  expect(context.summary).not.toMatch(forbidden);
  expect(context.summary).toContain("Further listening and source verification are required");
  const report=planAuditReportPages(input,"full").flatMap(page=>[page.title,...page.text]).join(" ");
  expect(report).not.toMatch(forbidden);
  const pdf=await generateAuditReport(input,"full");
  const generated=await PDFDocument.load(pdf);
  expect(generated.getPageCount()).toBeLessThanOrEqual(20);
  expect(generated.getForm().getTextField("ar_notes").acroField.getWidgets()).toHaveLength(1);
 });

 it("builds an actionable A&R Notes decision context instead of repeating the executive summary",()=>{
  const context=buildArNotesDecisionContext(longFormAudioFixture as any);
  expect(context.summary).toContain("Decision basis:");
  expect(context.summary).toContain("Open diligence:");
  expect(context.summary).toContain("Next action:");
  expect(context.summary).not.toBe(longFormAudioFixture.assessment.executiveSummary);
  expect(context.prompts).toHaveLength(3);
 });
 it("uses the evidence-sanitized commercial verdict on the PDF cover",()=>{
  expect(coverVerdictLabel(ambiguousAudioFixture as any)).toBe("PROPOSED A&R THESIS");
 });
 it("renders the generic ambiguous-audio regression fixture with tempo, key, genre and commercial claims withheld",()=>{
  const pages=planAuditReportPages(ambiguousAudioFixture as any,"full");
  const report=pages.flatMap(page=>[page.title,...page.text]).join(" ");
  const rows=sonicDashboardRowsForReport((ambiguousAudioFixture as any).sonicDna,true);
  expect(rows.find(row=>row.label==="TEMPO BPM")?.value).toBeNull();
  expect(rows.find(row=>row.label==="KEY / MODE")?.value).toBeNull();
  expect(report).not.toMatch(/Tempo confidence score|Key confidence estimator score|Tempo: Detected|Key \/ mode: C major/);
  expect(report).toContain("album: Sample Release - EP vs Sample Release");
  expect(report).toContain("Unconfirmed — insufficient provider-backed genre evidence");
  expect(report).toContain("Verdict: PROPOSED A&R THESIS");
  expect(report).toContain("Tempo and lane fit — NOT SCORED");
  expect(report).toContain("Rhythmic consistency — NOT SCORED");
  expect(report).toMatch(/Metadata completeness — \d+\/100/);
  expect(report).toContain("Album metadata is present but conflicting");
  expect(report).not.toMatch(/128\s*BPM(?!\s*candidate\b)|high-energy|album title is missing/i);
 });
 it("reports present-but-conflicting generic release metadata instead of calling it missing",()=>{
  const input=structuredClone(fullAudioFixture) as any;
  input.evidence.fixture=true;
  input.evidence.album="Sample Release";
  input.evidence.fieldProvenance={...input.evidence.fieldProvenance,album:"id3"};
  input.evidence.reconciliation={conflicts:[{field:"album",values:["Sample Release - EP","Sample Release"]}]};
  const report=planAuditReportPages(input,"full").flatMap(page=>[page.title,...page.text]).join(" ");
  expect(report).toContain("Album: Synthetic test value — not a real identity match");
  expect(report).toContain("album: Sample Release - EP vs Sample Release");
  expect(report).not.toContain("Album: Unavailable — no source result");
  input.evidence.fixture=false;
  input.evidence.sources=[];
  const sourceBackedReport=planAuditReportPages(input,"full").flatMap(page=>[page.title,...page.text]).join(" ");
  expect(sourceBackedReport).toContain("Album: Conflicting source values");
  expect(sourceBackedReport).toContain("album: Sample Release - EP vs Sample Release");
 });
 it("reports detector-confirmed key and mode when the shared detector gates pass",()=>{
  const input=structuredClone(fullAudioFixture) as any;
  input.sonicDna={...input.sonicDna,key:"A",mode:"minor",keyConfidence:0.8,keySegmentAgreement:0.9};
  expect(sonicDashboardRowsForReport(input.sonicDna,true).find(row=>row.label==="KEY / MODE")?.value).toBe("A minor");
  const dashboardRows=sonicDashboardRowsForReport(input.sonicDna,true);
  expect(dashboardRows.find(row=>row.label==="KEY / MODE")?.value).toBe("A minor");
  expect(dashboardRows.find(row=>row.label==="TEMPO BPM")?.value).toBe("96.0");
 });
 it("withholds a low-confidence harmonic key and its diagnostic model score from the report",()=>{
  const input=structuredClone(fullAudioFixture) as any;
  input.sonicDna={...input.sonicDna,key:"C",mode:"major",keyConfidence:0.06,keySegmentAgreement:0.16};
  const pages=planAuditReportPages(input,"full");
  const report=pages.flatMap(page=>[page.title,...page.text]).join(" ");
  expect(sonicDashboardRowsForReport(input.sonicDna,true).find(row=>row.label==="KEY / MODE")?.value).toBeNull();
  expect(report).not.toContain("Key confidence estimator score");
  expect(report).not.toContain("Key / mode: C major");
 });
 it("withholds zero-confidence BPM and tempo-derived A&R assertions from the rendered report",()=>{
  const input=structuredClone(fullAudioFixture) as any;
  input.sonicDna={...input.sonicDna,bpm:128,tempoConfidence:0,rhythmFeatures:{status:"measured"},genreClassification:{primaryGenre:null,abstained:true}};
  input.assessment.executiveSummary="The recording is a 128 BPM high-energy release with a strong rhythmic lane.";
  input.assessment.aAndRPositioning.primaryLane="Unconfirmed";
  input.assessment.aAndRPositioning.adjacentLanes=[];
  const pages=planAuditReportPages(input,"full");
  const report=pages.flatMap(page=>[page.title,...page.text]).join(" ");
  expect(sonicDashboardRowsForReport(input.sonicDna,true).find(row=>row.label==="TEMPO BPM")?.value).toBeNull();
  expect(report).not.toContain("Tempo confidence score");
  expect(report).not.toMatch(/128\s*BPM|high-energy/);
  expect(report).toContain("Unconfirmed — insufficient provider-backed genre evidence");
  expect(report).toContain("Tempo and lane fit — NOT SCORED");
  expect(report).toContain("Rhythmic consistency — NOT SCORED");
 });
 it("checks generated-output pagination, chart-bearing pages, continuation pages, footer clearance, disclosures and the 20-page cap",async()=>{
  const longInput=structuredClone(longFormAudioFixture) as AuditReportInput;
  longInput.evidence={...longInput.evidence,fixture:true};
  longInput.assessment={...longInput.assessment,executiveSummary:Array(100).fill("A long-form evidence paragraph must wrap at word boundaries and continue without clipping or overlapping the footer.").join(" ")};
  expect(longInput.evidence.fixture).toBe(true);
  const planned=planAuditReportPages(longInput,"full");
  expect(planned.some(section=>section.title==="Sonic DNA and technical profile")).toBe(true);
  expect(planned.flatMap(section=>section.text).join(" ")).toContain("FIXTURE — synthetic renderer test data; not a real analysis.");
  expect(chartLayoutIssuesForReport(longInput)).toEqual([]);
  for(const tier of ["sample","full"] as const){
   const baseline=await generateAuditReport(longFormAudioFixture,tier);
   const baselinePages=(await PDFDocument.load(baseline)).getPageCount();
   const bytes=await generateAuditReport(longInput,tier),pdf=await PDFDocument.load(bytes);
   const pages=pdf.getPages();
   expect(pages.length).toBeGreaterThan(baselinePages);
   expect(pages.length).toBeLessThanOrEqual(20);
   for(const page of pages){
    const size=page.getSize();
    expect(size.width).toBeCloseTo(595.28,0);
    expect(size.height).toBeCloseTo(841.89,0);
    const contents=page.node.Contents();
    expect(contents).toBeTruthy();
   }
   expect(pdf.getForm().getTextField("ar_notes").acroField.getWidgets()).toHaveLength(1);
   expect(pdf.getPageCount()).toBeLessThanOrEqual(20);
  }
 });
});

describe("extended Unicode report text normalization",()=>{
 it("normalizes supported punctuation without question-mark substitutions",()=>{
  const source="A’B “C”—D… E F G −2 × 3 ≤ 4 ≥ 1 ≠ 0 • item → next ™ © ®";
  const normalized=normalizeReportText(source);
  expect(normalized).toContain("A'B");
  expect(normalized).toContain('"C"');
  expect(normalized).toContain("-D...");
  expect(normalized).toContain("E F G -2 x 3 <= 4 >= 1 != 0 - item");
  expect(normalized).not.toContain("?");
  expect(normalized).not.toContain("\uFFFD");
 });
});
 
describe("report evidence integrity",()=>{
 it("omits disabled detector status, suppresses unreliable candidate values and supplies taxonomy-backed adjacent lanes",()=>{
  const input=structuredClone(fullAudioFixture) as any;
  const genreClassification={
   taxonomyVersion:"2026.2",method:"weighted_provider_evidence_with_limited_tempo_prior",
   primaryGenre:"Pop",genres:[{id:"pop",label:"Pop",confidence:0.9,sources:["apple_music"]}],
   confidence:0.9,abstained:false,adjacentLanes:["R&B","Hip-Hop","House"],
   regionTags:[],sceneTags:[],unmappedTags:[],model:{status:"disabled",predictions:[]},
  };
  input.sonicDna={...input.sonicDna,provenance:"uploaded_audio_master",bpm:165,tempoConfidence:0.08,key:"C",mode:"major",keyConfidence:0.12,keySegmentAgreement:0.5,vocalFeatures:{status:"not_analyzed",reason:"Vocal analysis is temporarily disabled to keep the audit worker within its memory limit."},genreClassification};
  input.evidence={...input.evidence,genreClassification};
  const report=planAuditReportPages(input,"full").flatMap(page=>page.text).join(" ");
  expect(report).toContain("Primary lane: Pop");
  expect(report).toContain("Adjacent lanes: R&B, Hip-Hop, House");
  expect(chartLayoutIssuesForReport(input)).toEqual([]);
  expect(report).not.toMatch(/165(?:\.0)?\s*BPM|key confidence estimator score|confidence diagnostic|fft_harmonic_chroma_ensemble|high_frequency_transient_autocorrelation/i);
  expect(report).not.toMatch(/Vocal analysis: Not performed|vocal presence\/absence is unknown|temporarily disabled to keep the audit worker|learned audio model: disabled|Learned audio-genre model status: disabled/i);
  expect(report).not.toContain("Not asserted: the measured technical profile does not support that claim.");
 });

  it("lists provider-separated DSP playlist candidates with source-attributed mood alignment",()=>{
    const input=structuredClone(fullAudioFixture) as any;
    input.evidence={...input.evidence,playlistDiscovery:{
      status:"available",moodTagsUsed:["Energetic"],moodSource:"TIDAL catalogue sonic profile",
      outcomes:[{provider:"spotify",status:"available",reason:"Spotify playlist search returned matching public playlist metadata."},{provider:"apple_music",status:"available",reason:"Apple Music catalog playlist tracks were inspected."}],
      candidates:[
        {provider:"spotify",id:"sp-1",name:"Afrobeats Focus",url:"https://open.spotify.com/playlist/sp-1",curatorName:"Owner One",playlistType:null,trackCount:30,genreMatches:["Afrobeats"],moodMatches:["Energetic"],moodSource:"TIDAL catalogue sonic profile",matchBasis:["Primary genre match: Afrobeats","Mood tag match: Energetic"],containsIsrc:null,retrievedAt:"2026-11-19T12:00:00.000Z"},
        {provider:"apple_music",id:"am-1",name:"Afrobeats Radio",url:"https://music.apple.com/ng/playlist/afrobeats-radio/pl.am-1",curatorName:"Apple Music",playlistType:"editorial",trackCount:50,genreMatches:["Afrobeats"],moodMatches:["Energetic"],moodSource:"TIDAL catalogue sonic profile",matchBasis:["Primary genre match: Afrobeats","Mood tag match: Energetic"],containsIsrc:false,retrievedAt:"2026-11-19T12:00:00.000Z"}
      ]
    }};
    const report=planAuditReportPages(input,"full").flatMap(page=>page.text).join(" ");
    expect(report).toContain("SPOTIFY PLAYLIST RESULTS");
    expect(report).toContain("APPLE MUSIC PLAYLIST RESULTS");
    expect(report).toContain("AVAILABLE PLAYLIST 1: Afrobeats Focus - Spotify");
    expect(report).toContain("AVAILABLE PLAYLIST 1: Afrobeats Radio - Apple Music");
    expect(report).toContain("Mood evidence source: TIDAL catalogue sonic profile");
    expect(report).toContain("Mood search tags: Energetic");
    expect(report).toContain("not an audio-derived mood measurement");
    expect(report.indexOf("SPOTIFY PLAYLIST RESULTS")).toBeLessThan(report.indexOf("APPLE MUSIC PLAYLIST RESULTS"));
  });

});


describe("Phase 2 window-consensus report diagnostics", () => {
 it("summarizes tempo and key consistency without exposing raw diagnostics", () => {
  const rows=sonicDashboardRowsForReport({
   provenance:"uploaded_audio_master",
   rhythmFeatures:{windowConsensus:{winner:"120",windowCount:6,observedAgreement:1,lowerAgreementBound:0.67,upperAgreementBound:1,method:"deterministic_window_bootstrap"}},
   harmonicFeatures:{windowConsensus:{winner:"C:major",windowCount:8,observedAgreement:0.875,lowerAgreementBound:0.5,upperAgreementBound:1,method:"deterministic_window_bootstrap"}},
  },true);
  expect(rows.find(row=>row.label==="TEMPO READINGS ACROSS SECTIONS")?.value).toContain("broadly consistent across the analyzed sections");
  expect(rows.find(row=>row.label==="TEMPO READINGS ACROSS SECTIONS")?.value).not.toMatch(/confidence|probability|bootstrap|window count/i);
  expect(rows.find(row=>row.label==="KEY READINGS ACROSS SECTIONS")).toBeUndefined();
  expect(rows.find(row=>row.label==="KEY / MODE CANDIDATES")?.value).toBeNull();
 });
 it("states unavailable when window evidence is absent or tied",()=>{
  const rows=sonicDashboardRowsForReport({
   provenance:"uploaded_audio_master",
   rhythmFeatures:{windowConsensus:{winner:null,windowCount:0,observedAgreement:null,lowerAgreementBound:null,upperAgreementBound:null}},
   harmonicFeatures:{windowConsensus:{winner:null,windowCount:4,observedAgreement:null,lowerAgreementBound:null,upperAgreementBound:null}},
  },true);
  expect(rows.find(row=>row.label==="TEMPO READINGS ACROSS SECTIONS")?.value).toBeNull();
  expect(rows.find(row=>row.label==="KEY READINGS ACROSS SECTIONS")).toBeUndefined();
 });
});

describe("Sonic DNA provisional candidate reporting", () => {
  it("shows tempo and key candidates without promoting them to confirmed measurements", () => {
    const rows = sonicDashboardRowsForReport({
      provenance: "uploaded_audio_master",
      bpm: null,
      tempoCandidateBpm: 165,
      tempoConfidence: 0.16,
      key: null,
      mode: null,
      keyConfidence: 0.12,
      keySegmentAgreement: 0.5,
      keyTuningCents: 18,
      tuningEvidenceWindows: 3,
      rhythmFeatures: { abstentionReason: "Tempo candidate prominence is too weak to support a reliable result.", beatGridStatus: "tentative", beatTimesSeconds: Array.from({ length: 512 }, (_, index) => index * 0.36) },
      harmonicFeatures: {
        limitation: "Key estimates varied across audio segments; no single key is asserted.",
        topCandidates: [
          { key: "C", mode: "major", score: 0.42 },
          { key: "A", mode: "minor", score: 0.39 },
        ],
      },
    }, true);
    expect(rows.find((row) => row.label === "TEMPO BPM")?.value).toBeNull();
    expect(rows.find((row) => row.label === "TEMPO CANDIDATE BPM")?.value).toContain("165 BPM (provisional; confirm by listening)");
    expect(rows.find((row) => row.label === "ALTERNATIVE PULSE READINGS")?.value)
      .toContain("half-time 82.5 BPM");
    expect(rows.find((row) => row.label === "ALTERNATIVE PULSE READINGS")?.value)
      .not.toContain("double-time 330.0 BPM");
    expect(rows.find((row) => row.label === "ALTERNATIVE PULSE READINGS")?.value)
      .not.toMatch(/independently validated|candidate|confidence|score/i);
    const reportInput=structuredClone(fullAudioFixture) as AuditReportInput;
    reportInput.sonicDna={...reportInput.sonicDna,provenance:"uploaded_audio_master",tempoCandidateBpm:165,tempoConfidence:0.28};
    const reportText=planAuditReportPages(reportInput,"full").flatMap((page)=>[page.title,...page.text]).join(" ");
    expect(reportText).toContain("Possible tempo readings: 165 BPM");
    expect(reportText).toContain("half-time 82.5 BPM");
    expect(reportText).not.toContain("double-time 330.0 BPM");
    expect(reportText).not.toMatch(/derived arithmetic relationships|independently validated beat interpretations|confidence|Goertzel|FFT|energy-model-v2|isotonic|Brier|\bECE\b/i);
    expect(rows.find((row) => row.label === "TEMPO DETECTION REASON")?.value).toContain("could not be confirmed");
    expect(rows.find((row) => row.label === "BEAT TIMING")?.value).toContain("tentative beat guide");
    expect(rows.find((row) => row.label === "BEAT TIMESTAMP COUNT")).toBeUndefined();
    expect(rows.find((row) => row.label === "KEY / MODE")?.value).toBeNull();
    expect(rows.find((row) => row.label === "KEY / MODE CANDIDATES")?.value).toContain("C major");
    expect(rows.find((row) => row.label === "KEY CONFIDENCE DIAGNOSTIC")).toBeUndefined();
    expect(rows.find((row) => row.label === "TUNING OFFSET CANDIDATE CENTS")).toBeUndefined();
  });
});

describe("Phase 1 real-master report contract",()=>{
 it("renders source identity, measured values, unavailable diagnostics and calibration abstention",()=>{
  const input=structuredClone(fullAudioFixture) as AuditReportInput;
  input.executionMode="master";
  input.realMasterContract={
   schemaVersion:"1.0.0",auditId:"audit-real-1",
   source:{sourceKind:"uploaded_master",sourceAudioPath:"jobs/audit-real-1/master.wav",sha256:"a".repeat(64),mimeType:"audio/wav",byteLength:4096},
   directSignalMeasurements:[
    {name:"tempo_bpm",status:"measured",value:96,unit:"BPM",method:"transient_autocorrelation",measuredAt:"2026-11-19T12:00:00.000Z",diagnostics:[]},
    {name:"true_peak_dbfs",status:"unavailable",value:null,unit:"dBFS",method:"decoder_true_peak",diagnostics:[{code:"DECODER_METRIC_MISSING",message:"The decoder did not return a true-peak measurement.",retryable:false}]},
   ],
   calibratedPredictions:[{name:"calibrated_audio_mood",status:"unavailable",label:null,probability:null,reasonCodes:["VALIDATED_MODEL_NOT_CONFIGURED"],diagnostics:[{code:"VALIDATED_MODEL_NOT_CONFIGURED",message:"No calibrated mood model is configured.",retryable:false}]},{name:"calibrated_key_mode_probability",status:"unavailable",label:null,probability:null,reasonCodes:["CALIBRATED_CLASSIFIER_NOT_CONFIGURED"],diagnostics:[{code:"CALIBRATED_CLASSIFIER_NOT_CONFIGURED",message:"The tonal estimator candidate score is not a calibrated class probability.",retryable:false}]},{name:"calibrated_energy_classification",status:"predicted",label:"high",probability:0.84,modelVersion:"energy-model-v2",calibration:{calibrated:true,method:"isotonic",modelVersion:"energy-calibration-v1",validationDataset:"held-out-validation-2026",validationSamples:240,expectedCalibrationError:0.042,brierScore:0.116},featureDrivers:[{feature:"rms_energy",contribution:0.62,direction:"supports"},{feature:"spectral_flux",contribution:-0.18,direction:"opposes"}],diagnostics:[]}],
   externalRecords:[{status:"verified",provider:"musicbrainz",recordId:"recording-mbid",retrievedAt:"2026-11-19T12:05:00.000Z",fields:{isrc:"USAAA2600001"},fieldProvenance:{isrc:{provider:"musicbrainz",recordId:"recording-mbid",retrievedAt:"2026-11-19T12:05:00.000Z"}}}],
   strategicSynthesis:[{claim:"Tempo was measured from the uploaded master.",evidenceRefs:["signal:tempo_bpm"],evidenceClass:"OBSERVED",limitations:[]}],
   pipelineDiagnostics:[],
  };
  const pages=planAuditReportPages(input,"full");
  const report=pages.flatMap(page=>[page.title,...page.text]).join(" ");
  expect(report).toContain("Master evidence contract and provenance");
  expect(report).toContain("SOURCE SHA-256: "+"a".repeat(64));
  expect(report).toContain("Confirmed tempo: 96 BPM; method: transient-based tempo estimator");
  expect(report).toContain("Confirmed tempo: 96 BPM; method: transient-based tempo estimator; measured: 2026-11-19T12:00:00.000Z");
  expect(report).toContain("True peak: Not reported as a confirmed measurement; The decoder did not return a true-peak measurement.");
  expect(report).not.toMatch(/Calibrated Audio Mood|Calibrated Energy Classification|calibrated model|energy-model-v2|isotonic|Brier|\bECE\b/i);
  expect(report).not.toMatch(/calibrated key\/mode probability|CALIBRATED_CLASSIFIER_NOT_CONFIGURED/i);
  expect(report).not.toMatch(/84\.0% calibrated|energy-model-v2|isotonic|Brier|\bECE\b/i);
  expect(report).not.toMatch(/held-out-validation-2026|ECE 0\.042|Brier 0\.116/i);
  expect(report).not.toMatch(/rms_energy|spectral_flux|feature drivers/i);
  expect(report).toContain("EXTERNAL RECORD: musicbrainz / recording-mbid; retrieved: 2026-11-19T12:05:00.000Z");
  expect(report).toContain("field provenance: isrc=musicbrainz/recording-mbid@2026-11-19T12:05:00.000Z");
  expect(report).toContain("Provenance rule: direct signal measurements are observed from the uploaded master");
 });
 it("labels DSP-link-only reports as metadata-only and never claims master measurements",()=>{
  const input=structuredClone(metadataOnlyFixture) as AuditReportInput;
  input.executionMode="dsp_link";
  input.realMasterContract=undefined;
  const report=planAuditReportPages(input,"full").flatMap(page=>[page.title,...page.text]).join(" ");
  expect(report).toContain("AUDIT EXECUTION MODE: METADATA-ONLY — no uploaded master was analysed");
  expect(report).toContain("No uploaded master was supplied; tempo, key/mode, loudness and spectral measurements require the recording itself.");
  expect(report).not.toContain("SOURCE SHA-256:");
 });
});
