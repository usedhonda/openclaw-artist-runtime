import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { instagramAuthorityModes, tiktokAuthorityModes, xAuthorityModes } from "../types.js";

const PLUGIN_ROOT = (() => {
  try {
    return join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  } catch {
    return process.cwd();
  }
})();

export async function uiBuildIsFresh(projectRoot = PLUGIN_ROOT): Promise<boolean> {
  const uiRoot = join(projectRoot, "ui");
  const distIndexPath = join(uiRoot, "dist", "index.html");
  const distIndexStat = await stat(distIndexPath).catch(() => undefined);
  if (!distIndexStat) {
    return false;
  }

  const sourcePaths = [
    join(uiRoot, "index.html"),
    join(uiRoot, "package.json"),
    join(uiRoot, "vite.config.ts"),
    join(uiRoot, "src", "App.tsx"),
    join(uiRoot, "src", "main.tsx"),
    join(uiRoot, "src", "styles.css")
  ];
  const sourceStats = await Promise.all(sourcePaths.map(async (path) => stat(path).catch(() => undefined)));
  return sourceStats.every((sourceStat) => !sourceStat || sourceStat.mtimeMs <= distIndexStat.mtimeMs);
}

function stripUiBasePath(assetPath: string): string {
  return assetPath.replace(/^\/plugins\/artist-runtime\/ui\//, "").replace(/^\//, "");
}

async function builtProducerConsoleHtml(projectRoot = PLUGIN_ROOT): Promise<string | undefined> {
  try {
    if (!(await uiBuildIsFresh(projectRoot))) {
      return undefined;
    }

    const uiRoot = join(projectRoot, "ui", "dist");
    const indexHtml = await readFile(join(uiRoot, "index.html"), "utf8");
    const cssMatches = Array.from(indexHtml.matchAll(/<link[^>]+href="([^"]+\.css)"[^>]*>/g)).map((match) => match[1]);
    const scriptMatches = Array.from(indexHtml.matchAll(/<script[^>]+src="([^"]+\.js)"[^>]*><\/script>/g)).map((match) => match[1]);
    const cssChunks = await Promise.all(cssMatches.map(async (href) => readFile(join(uiRoot, stripUiBasePath(href)), "utf8")));
    const scriptChunks = await Promise.all(scriptMatches.map(async (src) => readFile(join(uiRoot, stripUiBasePath(src)), "utf8")));

    const inlineStyles = `<style>${cssChunks.join("\n")}</style></head>`;
    const inlineScripts = `<script type="module">${scriptChunks.join("\n")}</script></body>`;
    return indexHtml
      .replace(/<link[^>]+href="[^"]+\.css"[^>]*>/g, "")
      .replace(/<script[^>]+src="[^"]+\.js"[^>]*><\/script>/g, "")
      .replace("</head>", () => inlineStyles)
      .replace("</body>", () => inlineScripts);
  } catch {
    return undefined;
  }
}

export async function producerConsoleHtml(projectRoot = PLUGIN_ROOT): Promise<string> {
  const built = await builtProducerConsoleHtml(projectRoot);
  if (built) {
    return built;
  }

  const authorityOptions = <T extends string>(modes: readonly T[]) =>
    modes.map((mode) => `<option value="${mode}">${mode}</option>`).join("");
  const xAuthorityOptions = authorityOptions(xAuthorityModes);
  const instagramAuthorityOptions = authorityOptions(instagramAuthorityModes);
  const tiktokAuthorityOptions = authorityOptions(tiktokAuthorityModes);

  return [
    "<!doctype html>",
    "<meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    "<title>Artist Runtime</title>",
    "<style>",
    ":root{--bg:#f4efe7;--ink:#1d1a17;--muted:#6c6257;--line:#d5cabc;--card:#fbf7f1;--accent:#9d4f2e;--accent2:#224d4a;font-family:Georgia,'Iowan Old Style',serif}",
    "body{margin:0;background:radial-gradient(circle at top,#fff8ef,transparent 35%),linear-gradient(180deg,#f4efe7,#e8dfd3);color:var(--ink)}",
    "main{max-width:1120px;margin:0 auto;padding:32px 20px 64px}",
    "header{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:24px}",
    "h1{margin:0;font-size:clamp(2rem,4vw,3.5rem);letter-spacing:.02em}",
    "p{color:var(--muted)}",
    ".actions{display:flex;gap:8px;flex-wrap:wrap}",
    "button{border:1px solid var(--line);background:var(--card);padding:10px 14px;border-radius:999px;cursor:pointer}",
    "button.primary{background:var(--accent);color:#fff;border-color:var(--accent)}",
    ".grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}",
    ".panel{background:rgba(251,247,241,.88);border:1px solid var(--line);border-radius:20px;padding:18px;box-shadow:0 8px 30px rgba(61,40,20,.05)}",
    ".metric{font-size:1.8rem;margin:8px 0 0}",
    ".list{display:grid;gap:10px;margin-top:10px}",
    ".item{padding:12px;border-radius:14px;background:#fff;border:1px solid #e4d8cb}",
    ".config-form{display:grid;gap:10px}",
    ".field-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}",
    ".toggle{display:flex;align-items:center;gap:10px}",
    ".warning{padding:12px;border-radius:14px;background:#f4e3c4;color:#996400;border:1px solid rgba(153,100,0,.24)}",
    ".field-error{color:#8f2016;font-weight:600}",
    ".pill{display:inline-block;padding:4px 8px;border-radius:999px;background:#efe2d6;color:var(--accent);font-size:.8rem;margin-right:6px}",
    ".alert{border-left:4px solid var(--accent);padding-left:12px}",
    ".alert.warning{border-color:#a06b08}",
    ".alert.critical{border-color:#8c1d18}",
    ".outcome-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}",
    ".badge{display:inline-block;padding:4px 8px;border-radius:999px;font-size:.72rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase}",
    ".badge.dry-run{background:rgba(153,100,0,.12);color:#996400;border:1px solid rgba(153,100,0,.22)}",
    ".muted{color:var(--muted)}",
    "pre{white-space:pre-wrap;background:#fff;border:1px solid var(--line);padding:12px;border-radius:14px;overflow:auto}",
    "</style>",
    "<main>",
    "<header><div><p class=\"muted\">Producer Console</p><h1>Artist Runtime</h1><p>Runtime-first control tower for status, songs, alerts, and cycle actions.</p></div><div class=\"actions\"><button id=\"pause\">Pause</button><button id=\"resume\">Resume</button><button class=\"primary\" id=\"run-cycle\">Run Cycle Now</button></div></header>",
    "<section class=\"grid\">",
    "<article class=\"panel\"><div class=\"muted\">Autopilot</div><div class=\"metric\" id=\"autopilot-stage\">-</div><div id=\"autopilot-meta\" class=\"muted\"></div></article>",
    "<article class=\"panel\"><div class=\"muted\">Ticker</div><div class=\"metric\" id=\"ticker-outcome\">-</div><div id=\"ticker-meta\" class=\"muted\"></div></article>",
    "<article class=\"panel\"><div class=\"muted\">Suno</div><div class=\"metric\" id=\"suno-state\">-</div><div id=\"suno-meta\" class=\"muted\"></div><div class=\"list\"><div class=\"item\"><div class=\"muted\">Suno Current Run</div><strong id=\"suno-current-run\">-</strong></div><div class=\"item\"><div class=\"muted\">Last Imported</div><strong id=\"suno-last-imported\">-</strong></div><div class=\"item\"><div class=\"outcome-heading\"><div class=\"muted\">Last Create</div><span class=\"badge dry-run\" id=\"suno-last-create-badge\" hidden>Dry-run</span></div><strong id=\"suno-last-create\">-</strong><div id=\"suno-last-create-meta\" class=\"muted\"></div></div><div class=\"item\"><div class=\"outcome-heading\"><div class=\"muted\">Last Import</div><span class=\"badge dry-run\" id=\"suno-last-import-badge\" hidden>Dry-run</span></div><strong id=\"suno-last-import\">-</strong><div id=\"suno-last-import-meta\" class=\"muted\"></div></div></div></article>",
    "<article class=\"panel\"><div class=\"muted\">Music Budget</div><div class=\"metric\" id=\"music-budget\">-</div><div id=\"music-meta\" class=\"muted\"></div></article>",
    "<article class=\"panel\"><div class=\"muted\">Distribution</div><div class=\"metric\" id=\"distribution-meta\">-</div><div id=\"platform-meta\" class=\"muted\"></div></article>",
    "</section>",
    "<section class=\"grid\" style=\"margin-top:16px\">",
    "<article class=\"panel\"><div class=\"muted\">Songs</div><div id=\"songs\" class=\"list\"></div></article>",
    "<article class=\"panel\"><div class=\"muted\">Alerts</div><div id=\"alerts\" class=\"list\"></div></article>",
    "<article class=\"panel\"><div class=\"muted\">Current Song Detail</div><div id=\"song-detail\" class=\"list\"></div></article>",
    "</section>",
    "<section class=\"grid\" style=\"margin-top:16px\">",
    "<article class=\"panel\"><div class=\"muted\">Recent X Result</div><div id=\"recent-x-result\" class=\"list\"></div></article>",
    "<article class=\"panel\"><div class=\"muted\">Simulate Reply</div><form id=\"reply-form\" class=\"list\"><input id=\"reply-target\" placeholder=\"target tweet id or URL\" /><textarea id=\"reply-text\" placeholder=\"reply text\" rows=\"4\"></textarea><button class=\"primary\" type=\"submit\">Simulate Dry-Run Reply</button></form></article>",
    "</section>",
    "<section class=\"grid\" style=\"margin-top:16px\">",
    `<article class="panel"><div class="muted">Config Editor</div><form id="config-form" class="config-form"><label class="toggle"><input id="cfg-autopilot-enabled" type="checkbox" />Autopilot enabled</label><label class="toggle"><input id="cfg-dry-run" type="checkbox" />Dry-run safety</label><div id="cfg-dry-run-warning" class="warning" hidden>Dry-run is OFF. The runtime stays fail-closed, but this arm can permit live side effects if the connectors are ready.</div><div class="field-grid"><label><div class="muted">Songs Per Week</div><input id="cfg-songs-per-week" type="number" min="0" max="21" /></label><label><div class="muted">Cycle Interval Minutes</div><input id="cfg-cycle-interval" type="number" min="15" max="1440" /></label></div><div class="field-grid"><label><div class="toggle"><input id="cfg-x-enabled" type="checkbox" />X enabled</div><div class="muted">X Authority</div><select id="cfg-x-authority">${xAuthorityOptions}</select></label><label><div class="toggle"><input id="cfg-instagram-enabled" type="checkbox" />Instagram enabled</div><div class="muted">Instagram Authority</div><select id="cfg-instagram-authority">${instagramAuthorityOptions}</select></label><label><div class="toggle"><input id="cfg-tiktok-enabled" type="checkbox" />TikTok enabled</div><div class="muted">TikTok Authority</div><select id="cfg-tiktok-authority">${tiktokAuthorityOptions}</select></label></div><div class="muted" id="cfg-meta"></div><div id="config-error" class="field-error"></div><div class="actions"><button class="primary" id="config-save" type="submit">Save Settings</button><button id="config-reset" type="button">Reset Draft</button><button id="config-refresh" type="button">Refresh</button></div></form></article>`,
    "</section>",
    "<section class=\"panel\" style=\"margin-top:16px\"><div class=\"muted\">API Debug</div><pre id=\"debug\">loading...</pre></section>",
    "<script type=\"module\">",
    "const base='/plugins/artist-runtime/api';",
    "let configDirty=false;",
    "async function get(path){const res=await fetch(base+path);if(!res.ok) throw new Error(path+' '+res.status);return res.json();}",
    "async function post(path,body={}){const res=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});if(!res.ok) throw new Error(path+' '+res.status);return res.json();}",
    "function text(id,value){document.getElementById(id).textContent=value;}",
    "function html(id,value){document.getElementById(id).innerHTML=value;}",
    "function checked(id){return document.getElementById(id).checked;}",
    "function value(id){return document.getElementById(id).value;}",
    `const xAuthorityModes=${JSON.stringify(xAuthorityModes)};`,
    `const instagramAuthorityModes=${JSON.stringify(instagramAuthorityModes)};`,
    `const tiktokAuthorityModes=${JSON.stringify(tiktokAuthorityModes)};`,
    "function formatOutcome(label,outcome){if(!outcome) return {title:`${label}: none`,detail:'No recorded outcome yet.',dryRun:false}; const status=outcome.accepted===false?'blocked':'accepted'; const runId=outcome.runId??'unknown'; const reason=outcome.reason??(typeof outcome.urlCount==='number'?`${outcome.urlCount} urls imported`:'no reason'); const at=outcome.at??'time unknown'; return {title:`${label}: ${status} (${runId})`,detail:`${reason} · ${at}`,dryRun:Boolean(outcome.dryRun)};}",
    "function renderSongs(songs){html('songs',songs.length?songs.map(song=>`<div class=\"item\"><span class=\"pill\">${song.status}</span><strong>${song.title}</strong><div class=\"muted\">${song.songId} · runs ${song.runCount}</div></div>`).join(''):'<div class=\"item muted\">No songs yet.</div>')}",
    "function renderAlerts(alerts){html('alerts',alerts.length?alerts.map(alert=>`<div class=\"item alert ${alert.severity}\"><strong>${alert.message}</strong><div class=\"muted\">${alert.source}${alert.ackedAt?' · acknowledged':''}</div></div>`).join(''):'<div class=\"item muted\">No active alerts.</div>')}",
    "function renderSongDetail(detail){if(!detail||!detail.song){html('song-detail','<div class=\"item muted\">No current song.</div>');return;} html('song-detail',`<div class=\"item\"><strong>${detail.song.title}</strong><div class=\"muted\">${detail.song.songId} · ${detail.song.status}</div></div><div class=\"item\"><div class=\"muted\">Prompt Ledger</div><strong>${detail.promptLedger.length} entries</strong></div><div class=\"item\"><div class=\"muted\">Suno Runs</div><strong>${detail.sunoRuns.length}</strong></div><div class=\"item\"><div class=\"muted\">Latest Prompt Pack</div><strong>${detail.latestPromptPack?`v${detail.latestPromptPack.version}`:'none'}</strong></div>`)}",
    "function renderRecentX(status){const action=status.lastSocialAction; if(!action||action.platform!=='x'){html('recent-x-result','<div class=\"item muted\">No X result yet.</div>'); return;} html('recent-x-result',`<div class=\"item\"><strong>${action.action}</strong><div class=\"muted\">${action.accepted?'accepted':'blocked'} · ${action.reason??'no reason'}</div><div class=\"muted\">${action.url??'no url'}</div></div>`)}",
    "function syncConfigForm(config){if(configDirty) return; document.getElementById('cfg-autopilot-enabled').checked=Boolean(config.autopilot.enabled); document.getElementById('cfg-dry-run').checked=Boolean(config.autopilot.dryRun); document.getElementById('cfg-songs-per-week').value=String(config.autopilot.songsPerWeek ?? 0); document.getElementById('cfg-cycle-interval').value=String(config.autopilot.cycleIntervalMinutes ?? 180); document.getElementById('cfg-x-enabled').checked=Boolean(config.distribution.platforms.x.enabled); document.getElementById('cfg-x-authority').value=String(config.distribution.platforms.x.authority ?? 'draft_only'); document.getElementById('cfg-instagram-enabled').checked=Boolean(config.distribution.platforms.instagram.enabled); document.getElementById('cfg-instagram-authority').value=String(config.distribution.platforms.instagram.authority ?? 'draft_only'); document.getElementById('cfg-tiktok-enabled').checked=Boolean(config.distribution.platforms.tiktok.enabled); document.getElementById('cfg-tiktok-authority').value=String(config.distribution.platforms.tiktok.authority ?? 'draft_only'); text('cfg-meta',`artist ${config.artist.artistId} · workspace ${config.artist.workspaceRoot}`); document.getElementById('cfg-dry-run-warning').hidden=Boolean(config.autopilot.dryRun); text('config-error','');}",
    "function buildConfigPatch(){const songsPerWeek=Number(value('cfg-songs-per-week')); const cycleIntervalMinutes=Number(value('cfg-cycle-interval')); const xAuthority=value('cfg-x-authority'); const instagramAuthority=value('cfg-instagram-authority'); const tiktokAuthority=value('cfg-tiktok-authority'); if(!Number.isInteger(songsPerWeek)||songsPerWeek<0||songsPerWeek>21) throw new Error('songsPerWeek must be between 0 and 21'); if(!Number.isInteger(cycleIntervalMinutes)||cycleIntervalMinutes<15||cycleIntervalMinutes>1440) throw new Error('cycleIntervalMinutes must be between 15 and 1440'); if(!xAuthorityModes.includes(xAuthority)) throw new Error('xAuthority must be one of the supported X authority modes'); if(!instagramAuthorityModes.includes(instagramAuthority)) throw new Error('instagramAuthority must be one of the supported Instagram authority modes'); if(!tiktokAuthorityModes.includes(tiktokAuthority)) throw new Error('tiktokAuthority must be one of the supported TikTok authority modes'); return {autopilot:{enabled:checked('cfg-autopilot-enabled'),dryRun:checked('cfg-dry-run'),songsPerWeek,cycleIntervalMinutes},distribution:{platforms:{x:{enabled:checked('cfg-x-enabled'),authority:xAuthority},instagram:{enabled:checked('cfg-instagram-enabled'),authority:instagramAuthority},tiktok:{enabled:checked('cfg-tiktok-enabled'),authority:tiktokAuthority}}}};}",
    "async function refresh(){const [status,songs,alerts,config,suno]=await Promise.all([get('/status'),get('/songs'),get('/alerts'),get('/config'),get('/suno/status')]); text('autopilot-stage',status.autopilot.stage); text('autopilot-meta',`${status.autopilot.nextAction} · run ${status.autopilot.currentRunId??'none'}`); text('ticker-outcome',status.ticker.lastOutcome??'never'); text('ticker-meta',status.ticker.lastTickAt?`${status.ticker.lastTickAt} · ${status.ticker.intervalMs}ms`:`interval ${status.ticker.intervalMs}ms`); text('suno-state',suno.worker.state); text('suno-meta',suno.worker.pendingAction??suno.worker.hardStopReason??'worker ready'); text('suno-current-run',suno.currentRunId??suno.worker.currentRunId??'-'); text('suno-last-imported',suno.lastImportedRunId??suno.worker.lastImportedRunId??'-'); const createOutcome=formatOutcome('Last Create',suno.lastCreateOutcome??suno.worker.lastCreateOutcome); text('suno-last-create',createOutcome.title); text('suno-last-create-meta',createOutcome.detail); document.getElementById('suno-last-create-badge').hidden=!createOutcome.dryRun; const importOutcome=formatOutcome('Last Import',suno.lastImportOutcome??suno.worker.lastImportOutcome); text('suno-last-import',importOutcome.title); text('suno-last-import-meta',importOutcome.detail); document.getElementById('suno-last-import-badge').hidden=!importOutcome.dryRun; text('music-budget',`${status.musicSummary.monthlyRuns}/${status.musicSummary.monthlyGenerationBudget}`); text('music-meta',`today ${status.musicSummary.dailyRuns} · prompt pack ${status.musicSummary.latestPromptPackVersion??'none'}`); text('distribution-meta',`posts ${status.distributionSummary.postsToday} · replies ${status.distributionSummary.repliesToday}`); text('platform-meta',Object.entries(status.platforms).map(([id,p])=>`${id}:${p.connected?'connected':'offline'}`).join(' · ')); renderSongs(songs); renderAlerts(alerts); renderRecentX(status); syncConfigForm(config); if(status.recentSong){document.getElementById('reply-form').dataset.songId=status.recentSong.songId; renderSongDetail(await get('/songs/'+status.recentSong.songId));} else {document.getElementById('reply-form').dataset.songId=''; renderSongDetail(null);} text('debug',JSON.stringify(status,null,2)); }",
    "document.getElementById('pause').addEventListener('click',async()=>{await post('/pause');await refresh();});",
    "document.getElementById('resume').addEventListener('click',async()=>{await post('/resume');await refresh();});",
    "document.getElementById('run-cycle').addEventListener('click',async()=>{try{const r=await post('/run-cycle');await refresh();text('debug',`run-cycle ${r.tickerOutcome??'unknown'}\\n`+JSON.stringify(r,null,2));}catch(error){text('debug',String(error instanceof Error ? error.message : error));}});",
    "document.getElementById('reply-form').addEventListener('submit',async(event)=>{event.preventDefault(); const songId=event.currentTarget.dataset.songId; if(!songId) return; await post('/platforms/x/simulate-reply',{songId,targetId:document.getElementById('reply-target').value,text:document.getElementById('reply-text').value}); await refresh();});",
    "document.querySelectorAll('#config-form input, #config-form select').forEach((input)=>{const markDirty=()=>{configDirty=true; document.getElementById('cfg-dry-run-warning').hidden=checked('cfg-dry-run');}; input.addEventListener('input',markDirty); input.addEventListener('change',markDirty);});",
    "document.getElementById('config-form').addEventListener('submit',async(event)=>{event.preventDefault(); try{text('config-error',''); await post('/config/update',{patch:buildConfigPatch()}); configDirty=false; await refresh();}catch(error){text('config-error',String(error instanceof Error ? error.message : error));}});",
    "document.getElementById('config-reset').addEventListener('click',async()=>{configDirty=false; await refresh();});",
    "document.getElementById('config-refresh').addEventListener('click',async()=>{configDirty=false; await refresh();});",
    "setInterval(()=>{void refresh().catch(error=>{text('debug',String(error));});},5000);",
    "refresh().catch(error=>{text('debug',String(error));});",
    "</script>",
    "</main>"
  ].join("");
}
