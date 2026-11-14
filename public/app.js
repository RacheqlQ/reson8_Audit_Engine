const input=document.querySelector("#audioFile"),dropzone=document.querySelector("#dropzone"),filePanel=document.querySelector("#filePanel"),fileName=document.querySelector("#fileName"),fileDetails=document.querySelector("#fileDetails"),removeFile=document.querySelector("#removeFile"),submit=document.querySelector("#submitAudit"),actionMessage=document.querySelector("#actionMessage"),preflightState=document.querySelector("#preflightState"),resultPanel=document.querySelector("#resultPanel"),jobId=document.querySelector("#jobId"),serverHash=document.querySelector("#serverHash");
const auditStatus=document.querySelector("#auditStatus"),resultMessage=document.querySelector("#resultMessage"),reportActions=document.querySelector("#reportActions"),sampleReportButton=document.querySelector("#sampleReportButton"),fullReportButton=document.querySelector("#fullReportButton"),operatorKey=document.querySelector("#operatorKey"),reportDownloadMessage=document.querySelector("#reportDownloadMessage"),evidenceChain=document.querySelector("#evidenceChain");
const catalogUrl=document.querySelector("#catalogUrl"),detectCatalog=document.querySelector("#detectCatalog"),catalogPlatform=document.querySelector("#catalogPlatform"),catalogPreview=document.querySelector("#catalogPreview"),catalogState=document.querySelector("#catalogState"),catalogCheck=document.querySelector("#catalogCheck");
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
let selectedFile=null,digest=null,catalogReady=false,pollTimer=null,currentAuditPayload=null;

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
async function previewCatalog(){
  const url=catalogUrl.value.trim();catalogReady=false;catalogPreview.classList.add("hidden");catalogPreview.textContent="";catalogState.textContent="Validating…";catalogPlatform.textContent="Detecting platform…";
  if(!url){catalogState.textContent="Waiting for URL";catalogPlatform.textContent="Platform not detected";setCheck(catalogCheck,"","—");updateSubmit();return;}
  try{
    const u=new URL(url);if(u.protocol!=="https:")throw new Error("Use an HTTPS URL");const host=u.hostname.toLowerCase();let platform="Unknown";
    if(host.includes("spotify"))platform="Spotify";else if(host.includes("apple.com")||host.includes("itunes.apple"))platform="Apple Music";else if(host.includes("youtube")||host==="youtu.be")platform="YouTube / YouTube Music";else if(host.includes("deezer"))platform="Deezer";else if(host.includes("tidal"))platform="Tidal";else throw new Error("Unsupported DSP or catalog host");
    catalogPlatform.textContent=platform;setCheck(catalogCheck,"ok","PASS");catalogState.textContent="URL accepted";catalogReady=true;
    catalogPreview.textContent="Catalog evidence will be collected server-side. Where the provider exposes a public audio preview, AudD will be used as an additional recognition evidence source.";catalogPreview.classList.remove("hidden");
    actionMessage.textContent="Ready. Anonymous catalog intake is enabled.";
  }catch(e){catalogState.textContent="Invalid source";catalogPlatform.textContent="Unsupported or malformed URL";setCheck(catalogCheck,"bad","INVALID");actionMessage.textContent=e instanceof Error?e.message:"Invalid catalog URL";}
  updateSubmit();
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
function stopPolling(){if(pollTimer){clearTimeout(pollTimer);pollTimer=null;}}
function applyAuditPayload(payload){
  currentAuditPayload=payload;
  renderEvidenceChain(payload.currentStepIndex ?? (payload.status==="completed" ? 5 : 0));
  auditStatus.textContent=(payload.status||"unknown").toUpperCase();
  auditStatus.className=payload.status==="failed"?"failed":payload.status==="completed"?"completed":"queued";
  if(payload.status==="completed"&&payload.full?.available){
    reportActions.classList.remove("hidden");
    sampleReportButton.disabled=false;
    fullReportButton.disabled=false;
    resultMessage.textContent="Audit complete. Sample and full report retrieval are available to an authorized operator.";
  }
}
async function pollAudit(job){
  stopPolling();const started=Date.now(),maxWait=10*60*1000;
  async function check(){
    try{
      const response=await fetch("/v1/audits/"+encodeURIComponent(job));const payload=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(payload.message||"Could not read audit status");
      applyAuditPayload(payload);
      if(payload.status==="completed"&&payload.full?.available)return;
      if(payload.status==="failed"){resultMessage.textContent="Audit failed: "+(payload.errorMessage||"processing error");return;}
      if(Date.now()-started>=maxWait){resultMessage.textContent="Audit is still processing. Keep this page open and check the job again shortly.";return;}
      pollTimer=setTimeout(check,2500);
    }catch(e){
      if(Date.now()-started>=maxWait){resultMessage.textContent=e instanceof Error?e.message:"Could not read audit status";return;}
      pollTimer=setTimeout(check,3000);
    }
  }
  check();
}
async function submitAudit(){
  submit.disabled=true;submit.querySelector("span").textContent="Submitting…";
  try{
    const hasMaster=Boolean(selectedFile&&digest),hasCatalog=catalogReady;
    let response;
    if(hasMaster){
      const headers={"Content-Type":selectedFile.type||"application/octet-stream","X-Audio-Filename":selectedFile.name};
      if(hasCatalog)headers["X-Catalog-Url"]=catalogUrl.value.trim();
      response=await fetch("/v1/audits",{method:"POST",headers,body:selectedFile});
    }else if(hasCatalog){
      response=await fetch("/v1/audits/catalog",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:catalogUrl.value.trim()})});
    }else throw new Error("Provide a valid master file, DSP link, or both.");
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(payload.message||"Audit intake failed");
    jobId.textContent=payload.jobId||"—";serverHash.textContent=payload.sha256||"—";resultPanel.classList.remove("hidden");reportActions.classList.add("hidden");auditStatus.textContent="QUEUED";auditStatus.className="queued";
    resultMessage.textContent=hasMaster&&hasCatalog?"Accepted. Master Sonic DNA and DSP catalog evidence will be reconciled into one report.":hasMaster?"Accepted. Master Sonic DNA analysis is processing.":"Accepted. DSP catalog analysis is processing.";
    submit.querySelector("span").textContent="Audit processing";pollAudit(payload.jobId);
  }catch(e){actionMessage.textContent=e instanceof Error?e.message:"Audit intake failed.";submit.disabled=false;updateSubmit();}
}
async function downloadReport(tier){
  const key=operatorKey.value.trim();
  if(!key){reportDownloadMessage.textContent="Enter the operator access key. It is sent only in the request header and is not stored.";return;}
  reportDownloadMessage.textContent="Retrieving "+tier+" PDF…";
  try{
    const response=await fetch("/v1/audits/"+encodeURIComponent(currentAuditPayload.jobId)+"/reports/"+tier,{headers:{"x-reson8-operator-key":key}});
    const type=(response.headers.get("content-type")||"").toLowerCase();
    if(!response.ok||!type.includes("application/pdf")){
      const error=await response.json().catch(()=>({}));
      throw new Error(error.message||"Report retrieval failed (HTTP "+response.status+")");
    }
    const blob=await response.blob(),bytes=new Uint8Array(await blob.arrayBuffer());
    if(new TextDecoder().decode(bytes.slice(0,5))!=="%PDF-")throw new Error("Server response was not a valid PDF. No file was downloaded.");
    const url=URL.createObjectURL(blob),anchor=document.createElement("a");
    anchor.href=url;anchor.download="reson8-audit-"+tier+"-"+currentAuditPayload.jobId+".pdf";document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    reportDownloadMessage.textContent=tier+" PDF downloaded successfully.";
  }catch(error){reportDownloadMessage.textContent=error instanceof Error?error.message:"Report retrieval failed.";}
}
input.addEventListener("change",()=>input.files?.[0]&&inspect(input.files[0]));removeFile.addEventListener("click",clearFile);detectCatalog.addEventListener("click",previewCatalog);catalogUrl.addEventListener("input",()=>{catalogReady=false;setCheck(catalogCheck,"","—");updateSubmit();});catalogUrl.addEventListener("blur",previewCatalog);submit.addEventListener("click",submitAudit);
sampleReportButton.addEventListener("click",()=>downloadReport("sample"));fullReportButton.addEventListener("click",()=>downloadReport("full"));
["dragenter","dragover"].forEach(type=>dropzone.addEventListener(type,e=>{e.preventDefault();dropzone.classList.add("dragover");}));
["dragleave","drop"].forEach(type=>dropzone.addEventListener(type,e=>{e.preventDefault();dropzone.classList.remove("dragover");}));
dropzone.addEventListener("drop",e=>{const f=e.dataTransfer?.files?.[0];if(f)inspect(f);});
renderEvidenceChain(0);
updateSubmit();
