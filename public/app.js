import { readPdfResponse, triggerPdfDownload } from "./report-download.js";
import { createAuditPoller } from "./audit-polling.js";
import { detectTrackPlatform } from "./dsp-url.js?v=20261116-1";
const input=document.querySelector("#audioFile"),dropzone=document.querySelector("#dropzone"),filePanel=document.querySelector("#filePanel"),fileName=document.querySelector("#fileName"),fileDetails=document.querySelector("#fileDetails"),removeFile=document.querySelector("#removeFile"),submit=document.querySelector("#submitAudit"),actionMessage=document.querySelector("#actionMessage"),preflightState=document.querySelector("#preflightState"),resultPanel=document.querySelector("#resultPanel"),resultName=document.querySelector("#resultName"),jobId=document.querySelector("#jobId"),serverHash=document.querySelector("#serverHash");
const auditStatus=document.querySelector("#auditStatus"),resultMessage=document.querySelector("#resultMessage"),reportActions=document.querySelector("#reportActions"),sampleReportButton=document.querySelector("#sampleReportButton"),reportDownloadMessage=document.querySelector("#reportDownloadMessage"),evidenceChain=document.querySelector("#evidenceChain"),accessTokenDisplay=document.querySelector("#accessTokenDisplay"),revealAccessTokenButton=document.querySelector("#revealAccessTokenButton"),copyAccessTokenButton=document.querySelector("#copyAccessTokenButton"),fullReportAccessKey=document.querySelector("#fullReportAccessKey"),unlockFullReportButton=document.querySelector("#unlockFullReportButton"),tokenSaveMessage=document.querySelector("#tokenSaveMessage");
const catalogUrl=document.querySelector("#catalogUrl"),detectCatalog=document.querySelector("#detectCatalog"),catalogPlatform=document.querySelector("#catalogPlatform"),catalogPreview=document.querySelector("#catalogPreview"),catalogSourceStatuses=document.querySelector("#catalogSourceStatuses"),catalogState=document.querySelector("#catalogState"),catalogCheck=document.querySelector("#catalogCheck");
const checks={type:document.querySelector("#checkType"),size:document.querySelector("#checkSize"),hash:document.querySelector("#checkHash")};
const MAX_BYTES=50*1024*1024,AUDIO_EXTENSIONS=new Set(["mp3","wav","flac","aac","ogg","m4a"]);
const EVIDENCE_STEPS=[
  {number:"01",title:"Secure intake",description:"Private master + integrity hash"},
  {number:"02",title:"Recognition",description:"AudD evidence sample"},
  {number:"03",title:"Sonic measurement",description:"Full-master audio analysis"},
  {number:"04",title:"Reconciliation",description:"Identifiers + source evidence"},
  {number:"05",title:"A&R assessment",description:"Evidence-bound interpretation"},
  {number:"06",title:"Report",description:"Song-specific PDF output"}
];
let selectedFile=null,digest=null,catalogReady=false,currentAuditPayload=null,reportAccessToken=null,tokenRevealed=false;

function setCheck(el,state,value){el.classList.remove("ok","bad");if(state)el.classList.add(state);el.querySelector("b").textContent=value;}
function extensionOf(name){return name.includes(".")?name.split(".").pop().toLowerCase():"";}
function formatBytes(bytes){if(bytes<1024)return bytes+" B";if(bytes<1024*1024)return(bytes/1024).toFixed(1)+" KB";return(bytes/(1024*1024)).toFixed(2)+" MB";}
async function sha256(file){const buffer=await file.arrayBuffer(),hash=await crypto.subtle.digest("SHA-256",buffer);return[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,"0")).join("");}

function updateSubmit(){
  const hasMaster=Boolean(selectedFile&&digest),hasCatalog=catalogReady;
  submit.disabled=!(hasMaster||hasCatalog);
  submit.querySelector("span").textContent=hasMaster&&hasCatalog?"Start combined A&R audit":hasMaster?"Start master A&R audit":hasCatalog?"Start DSP A&R audit":"Start A&R audit";
}
async function inspect(file){
  selectedFile=file;digest=null;resultPanel.classList.add("hidden");filePanel.classList.remove("hidden");fileName.textContent=file.name;fileDetails.textContent=formatBytes(file.size)+" · "+(file.type||"audio")+" · "+extensionOf(file.name).toUpperCase();
  const validType=AUDIO_EXTENSIONS.has(extensionOf(file.name)),validSize=file.size>0&&file.size<=MAX_BYTES;
  setCheck(checks.type,validType?"ok":"bad",validType?"PASS":"INVALID");setCheck(checks.size,validSize?"ok":"bad",validSize?"PASS":"OVER LIMIT");
  if(validType&&validSize){preflightState.textContent="Computing integrity…";try{digest=await sha256(file);setCheck(checks.hash,"ok",digest.slice(0,12)+"…");preflightState.textContent="Ready for secure intake";actionMessage.textContent="Ready. Anonymous audit intake is enabled.";}catch{setCheck(checks.hash,"bad","FAILED");preflightState.textContent="Integrity check failed";actionMessage.textContent="Could not calculate the local integrity hash.";}}
  else{setCheck(checks.hash,"","—");preflightState.textContent="Fix the source file";actionMessage.textContent="Choose a supported audio file under 50 MB.";}
  updateSubmit();
}
function clearFile(){selectedFile=null;digest=null;input.value="";filePanel.classList.add("hidden");preflightState.textContent="Waiting for source";setCheck(checks.type,"","—");setCheck(checks.size,"","—");setCheck(checks.hash,"","—");updateSubmit();}
function getCatalogUrls(){
  return catalogUrl.value.split(/\r?\n/).map(value=>value.trim()).filter(Boolean);
}

async function previewCatalog(){
  const urls=getCatalogUrls();catalogReady=false;catalogPreview.classList.add("hidden");catalogPreview.textContent="";catalogSourceStatuses.classList.add("hidden");catalogSourceStatuses.textContent="";catalogState.textContent="Validating…";
  if(!urls.length){catalogState.textContent="Waiting for URLs";catalogPlatform.textContent="No DSP links submitted";setCheck(catalogCheck,"","—");updateSubmit();return;}
  try{
    if(urls.length>8)throw new Error("A maximum of 8 DSP track links is allowed");
    const platforms=urls.map(detectTrackPlatform);
    catalogPlatform.textContent=platforms.join(" · ");
    setCheck(catalogCheck,"ok",urls.length+" LINKS");
    catalogState.textContent="Ready for server verification";
    catalogReady=true;
    catalogPreview.textContent=urls.length+" track link(s) will be normalized, deduplicated and checked against official provider endpoints. Duplicate platform + track IDs are processed once.";
    catalogPreview.classList.remove("hidden");
    catalogSourceStatuses.textContent="Provider lookup statuses will appear here after secure submission.";
    catalogSourceStatuses.classList.remove("hidden");
    actionMessage.textContent="Ready. One audit will reconcile all submitted DSP sources.";
  }catch(e){
    catalogState.textContent="Invalid source";
    catalogPlatform.textContent="One or more links are unsupported";
    setCheck(catalogCheck,"bad","INVALID");
    actionMessage.textContent=e instanceof Error?e.message:"Invalid catalog URL";
  }
  updateSubmit();
}
function renderCatalogStatuses(payload){
  if(!catalogSourceStatuses)return;
  const statuses=Array.isArray(payload.catalogSources)?payload.catalogSources:[];
  const submitted=Array.isArray(payload.catalogUrlsSubmitted)?payload.catalogUrlsSubmitted:[];
  catalogSourceStatuses.replaceChildren();
  if(!submitted.length&&!statuses.length){catalogSourceStatuses.classList.add("hidden");return;}
  const heading=document.createElement("strong");
  heading.textContent="DSP provider status";
  catalogSourceStatuses.appendChild(heading);
  const list=document.createElement("ul");
  for(const item of statuses){
    const li=document.createElement("li");
    li.textContent=[item.platform,item.catalogId,item.status?.toUpperCase(),item.error].filter(Boolean).join(" · ");
    list.appendChild(li);
  }
  if(!statuses.length){
    const li=document.createElement("li");
    li.textContent=submitted.length+" source link(s) queued for lookup";
    list.appendChild(li);
  }
  catalogSourceStatuses.appendChild(list);
  catalogSourceStatuses.classList.remove("hidden");
}
function renderEvidenceChain(currentStepIndex=0){
  if(!evidenceChain)return;
  const active=Math.min(Math.max(Number(currentStepIndex)||0,0),EVIDENCE_STEPS.length-1);
  evidenceChain.innerHTML=EVIDENCE_STEPS.map((step,index)=>{
    const current=index===active,completed=index<active;
    const classes=[current?"current":"",completed?"completed":""].filter(Boolean).join(" ");
    return '<li class="'+classes+'" aria-current="'+(current?"step":"false")+'"><span>'+step.number+'</span><div><strong>'+step.title+'</strong><small>'+step.description+'</small></div></li>';
  }).join("");
}
function stopPolling(){auditPoller.stop();}
function applyAuditPayload(payload){
  currentAuditPayload={...payload,displayName:currentAuditPayload?.displayName??payload.displayName};
  renderCatalogStatuses(payload);
  unlockFullReportButton.disabled=!(payload.status==="completed"&&payload.full?.available);
  renderEvidenceChain(payload.currentStepIndex ?? (payload.status==="completed" ? 5 : 0));
  auditStatus.textContent=(payload.status||"unknown").toUpperCase();
  auditStatus.className=payload.status==="failed"?"failed":payload.status==="completed"?"completed":"queued";
  if(payload.status==="completed"&&payload.full?.available){
    reportActions.classList.remove("hidden");
    sampleReportButton.disabled=false;
    resultMessage.textContent="Audit complete. Your sample report is available through the private access token issued for this audit.";
  }
}
const auditPoller=createAuditPoller({onPayload:applyAuditPayload,onMessage:message=>{resultMessage.textContent=message;}});
async function pollAudit(job,token){await auditPoller.poll(job,token);}

async function submitAudit(){
  stopPolling();reportAccessToken=null;currentAuditPayload=null;tokenRevealed=false;accessTokenDisplay.textContent="••••••••••••••••••••••••••••••••";revealAccessTokenButton.disabled=true;copyAccessTokenButton.disabled=true;fullReportAccessKey.value="";tokenSaveMessage.textContent="";
  submit.disabled=true;submit.querySelector("span").textContent="Submitting…";
  try{
    const hasMaster=Boolean(selectedFile&&digest),hasCatalog=catalogReady;
    const urls=hasCatalog?getCatalogUrls():[];
    let response;
    if(hasMaster){
      const extension=extensionOf(selectedFile.name);
      const audioMimeTypes={mp3:"audio/mpeg",wav:"audio/wav",flac:"audio/flac",aac:"audio/aac",ogg:"audio/ogg",m4a:"audio/mp4"};
      const headers={"Content-Type":audioMimeTypes[extension]||selectedFile.type||"application/octet-stream","X-Audio-Filename":selectedFile.name};
      if(hasCatalog){headers["X-Catalog-Url"]=urls[0];headers["X-Catalog-Urls"]=JSON.stringify(urls);}
      response=await fetch("/v1/audits",{method:"POST",headers,body:selectedFile});
    }else if(hasCatalog){
      response=await fetch("/v1/audits/catalog",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({urls})});
    }else throw new Error("Provide a valid master file, DSP link, or both.");
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(payload.message||"Audit intake failed");
    const submittedName=hasMaster?selectedFile.name.replace(/\.[^.]+$/,""):catalogPlatform.textContent+" "+(new URL(urls[0]).pathname.split("/").filter(Boolean).at(-1)||"catalog");
    const displayName=submittedName.replace(/[\s]+/g," ").trim().slice(0,100)||"Untitled audit";
    jobId.textContent=payload.jobId||"—";resultName.textContent=displayName+" — AUDIT ACCEPTED";serverHash.textContent=payload.sha256||"—";reportAccessToken=payload.reportAccessToken||null;currentAuditPayload={jobId:payload.jobId,status:"queued",currentStepIndex:0,displayName};resultPanel.classList.remove("hidden");reportActions.classList.add("hidden");auditStatus.textContent="QUEUED";auditStatus.className="queued";
    resultMessage.textContent=hasMaster&&hasCatalog?"Accepted. Master Sonic DNA and DSP catalog evidence will be reconciled into one report.":hasMaster?"Accepted. Master Sonic DNA analysis is processing.":"Accepted. DSP catalog analysis is processing.";
    if(reportAccessToken){
      revealAccessTokenButton.disabled=false;
      copyAccessTokenButton.disabled=false;
      tokenSaveMessage.textContent="Private key issued. Reveal or copy it now, or paste it into the access-key field to unlock the full report. It cannot be recovered after this page is closed or reloaded.";
    }else{
      revealAccessTokenButton.disabled=true;
      copyAccessTokenButton.disabled=true;
      tokenSaveMessage.textContent="The server did not return an access key. Contact support before leaving this page.";
    }
    submit.querySelector("span").textContent="Audit processing";pollAudit(payload.jobId,reportAccessToken);
  }catch(e){actionMessage.textContent=e instanceof Error?e.message:"Audit intake failed.";submit.disabled=false;updateSubmit();}
}
function renderAccessToken(){
  accessTokenDisplay.textContent=reportAccessToken
    ? tokenRevealed?reportAccessToken:"•".repeat(Math.min(reportAccessToken.length,64))
    : "No key issued";
  revealAccessTokenButton.textContent=tokenRevealed?"Hide":"Reveal";
}
async function copyAccessToken(){
  if(!reportAccessToken){tokenSaveMessage.textContent="No private key is available to copy.";return;}
  try{
    await navigator.clipboard.writeText(reportAccessToken);
    tokenSaveMessage.textContent="Private audit key copied. Keep it secure.";
  }catch{
    tokenSaveMessage.textContent="Clipboard access was unavailable. Reveal the key and copy it manually.";
  }
}
function revealAccessToken(){
  if(!reportAccessToken)return;
  tokenRevealed=!tokenRevealed;
  renderAccessToken();
}
async function unlockFullReport(){
  const pastedKey=fullReportAccessKey.value.trim();
  const accessToken=pastedKey||reportAccessToken;
  if(!accessToken){tokenSaveMessage.textContent="Paste this audit's private key before unlocking.";return;}
  await downloadReport("full",accessToken);
}
async function downloadReport(tier,accessToken=reportAccessToken){
  if(!accessToken){reportDownloadMessage.textContent="This audit's private access token is unavailable. Submit a new audit to receive a fresh token.";return;}
  reportDownloadMessage.textContent="Retrieving "+tier+" PDF…";
  try{
    const response=await fetch("/v1/audits/"+encodeURIComponent(currentAuditPayload.jobId)+"/reports/"+tier,{headers:{"x-reson8-report-token":accessToken}});
    const blob=await readPdfResponse(response);
    const name=(currentAuditPayload?.displayName||currentAuditPayload?.jobName||"audit").replace(/[^A-Za-z0-9._-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,80)||"audit";
    triggerPdfDownload(blob,"reson8-"+name+"-"+tier+".pdf");
    reportDownloadMessage.textContent=tier+" PDF downloaded successfully.";
  }catch(error){reportDownloadMessage.textContent=error instanceof Error?error.message:"Report retrieval failed.";}
}
input.addEventListener("change",()=>input.files?.[0]&&inspect(input.files[0]));removeFile.addEventListener("click",clearFile);detectCatalog.addEventListener("click",previewCatalog);catalogUrl.addEventListener("input",()=>{
  catalogReady=false;setCheck(catalogCheck,"","—");
  const urls=getCatalogUrls();
  const complete=urls.length>0&&urls.every(value=>/^https:\/\/\S+$/i.test(value.trim())||/^\[[^\]]+\]\(https:\/\/[^)\s]+\)$/i.test(value.trim())||/^<https:\/\/[^<>]+>$/i.test(value.trim()));
  if(complete)previewCatalog();else updateSubmit();
});catalogUrl.addEventListener("blur",previewCatalog);submit.addEventListener("click",submitAudit);
sampleReportButton.addEventListener("click",()=>downloadReport("sample"));
revealAccessTokenButton.addEventListener("click",revealAccessToken);
copyAccessTokenButton.addEventListener("click",copyAccessToken);
unlockFullReportButton.addEventListener("click",unlockFullReport);
["dragenter","dragover"].forEach(type=>dropzone.addEventListener(type,e=>{e.preventDefault();dropzone.classList.add("dragover");}));
["dragleave","drop"].forEach(type=>dropzone.addEventListener(type,e=>{e.preventDefault();dropzone.classList.remove("dragover");}));
dropzone.addEventListener("drop",e=>{const f=e.dataTransfer?.files?.[0];if(f)inspect(f);});
renderEvidenceChain(0);
updateSubmit();
