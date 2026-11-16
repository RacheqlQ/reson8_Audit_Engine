export function detectTrackPlatform(value){
  const u=new URL(value),host=u.hostname.toLowerCase(),parts=u.pathname.split("/").filter(Boolean);
  if(u.protocol!=="https:"||u.username||u.password||u.port)throw new Error("Use a credential-free HTTPS track URL");
  if(["open.spotify.com","play.spotify.com"].includes(host)&&parts.includes("track")&&parts[parts.indexOf("track")+1])return "Spotify";
  if(["music.apple.com","itunes.apple.com"].includes(host)&&parts.includes("album")&&/^\d+$/.test(parts[parts.indexOf("album")+2]||"")&&u.searchParams.get("i"))return "Apple Music";
  if(["deezer.com","www.deezer.com"].includes(host)&&parts[0]==="track"&&parts[1])return "Deezer";
  if(["tidal.com","listen.tidal.com"].includes(host)&&parts.includes("track")&&parts[parts.indexOf("track")+1])return "TIDAL";
  if(host==="music.youtube.com"&&u.pathname==="/watch"&&u.searchParams.get("v"))return "YouTube Music";
  if(["audiomack.com","www.audiomack.com"].includes(host)&&parts.length>=2)return "Audiomack";
  throw new Error("Unsupported DSP or non-track URL");
}
