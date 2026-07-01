# Silent Catch Triage

Date: 2026-06-11

Task intent: classify silent catch paths and add visibility only to side-effect failures without changing runtime behavior.

## Scan

Command:

```bash
rg "\.catch\(\(\) =>|catch \{\s*\}" src -n
```

Findings:

- The instruction document mentioned 82 matches, but the current source contained 251 matches before Phase 4 edits.
- After logging the selected side-effect failures, the same scan reports 208 remaining silent fallback/probe matches.
- No catch was converted to throw. All changed paths still swallow after logging.
- Cleanup paths ignore `ENOENT` as intentional idempotency, and log only non-missing-file failures.

## Category A: Side-effect failures now logged

These paths perform notification delivery, ledger writes/cleanup, heartbeat/status writes, backup writes, or worker/ticker side effects. They now emit `console.error(...)` while preserving the prior swallow behavior.

| File:line | Context |
| --- | --- |
| `src/services/index.ts:53` | stale silence-recovery flag cleanup |
| `src/services/index.ts:66` | silence-recovery Telegram send fetch failure |
| `src/services/index.ts:71` | delivered silence-recovery flag cleanup |
| `src/services/callbackPollingWatchdog.ts:130` | opt-in resurface auto-push Telegram send |
| `src/services/artistPulseRateLimiter.ts:37` | artist pulse state backup |
| `src/services/telegramCallbackHandler.ts:215` | callback reply markup clear |
| `src/services/telegramCallbackHandler.ts:217` | callback reply message send |
| `src/services/telegramCallbackHandler.ts:345` | watchdog publish guard callback answer |
| `src/services/telegramCallbackHandler.ts:389` | proposal edit-open message send |
| `src/services/telegramCallbackHandler.ts:391` | proposal edit-open markup clear |
| `src/services/telegramCallbackHandler.ts:445` | daily voice edit message send |
| `src/services/telegramCallbackHandler.ts:447` | daily voice edit markup clear |
| `src/services/telegramCallbackHandler.ts:489` | song spawn edit message send |
| `src/services/telegramCallbackHandler.ts:491` | song spawn edit markup clear |
| `src/services/telegramCallbackHandler.ts:634` | planning skeleton edit message send |
| `src/services/telegramCallbackHandler.ts:636` | planning skeleton edit markup clear |
| `src/services/telegramCallbackHandler.ts:831` | unsupported callback markup clear |
| `src/services/runtimeConfig.ts:424` | runtime config override backup |
| `src/services/telegramBotWorker.ts:94` | startup persona announcement |
| `src/services/telegramBotWorker.ts:185` | unsupported callback answer |
| `src/services/telegramNotifier.ts:133` | distribution buttons attach |
| `src/services/telegramNotifier.ts:137` | daily voice buttons attach |
| `src/services/telegramNotifier.ts:147` | planning skeleton buttons attach |
| `src/services/telegramNotifier.ts:151` | take select buttons attach |
| `src/services/telegramNotifier.ts:609` | late artistReport rejection after timeout fallback |
| `src/services/callbackLedgerMaintenance.ts:59` | callback ledger backup |
| `src/services/telegramPersonaSession.ts:123` | persona session cleanup |
| `src/services/sunoBrowserWorker.ts:395` | Suno browser driver stop |
| `src/services/sunoBudget.ts:114` | Suno budget tmp cleanup |
| `src/services/autopilotTicker.ts:138` | autopilot heartbeat attempt write |
| `src/services/autopilotTicker.ts:236` | autopilot heartbeat result write |
| `src/services/processCrashReporter.ts:42` | uncaught exception crash report write |
| `src/services/processCrashReporter.ts:46` | unhandled rejection crash report write |
| `src/services/personaFileBuilder.ts:265` | persona completion marker cleanup |
| `src/services/personaFileBuilder.ts:270` | persona completion marker cleanup |
| `src/services/telegramCommandRouter.ts:530` | `/resume` immediate `runNow` kick |
| `src/services/songSpawnRateLimiter.ts:34` | song spawn state backup |
| `src/services/receiveHealthService.ts:55` | receive-health inbound timestamp write |
| `src/services/receiveHealthService.ts:65` | receive-health callback timestamp write |
| `src/services/socialPublishLedger.ts:45` | social ledger tmp cleanup after atomic write |
| `src/services/socialPublishLedger.ts:78` | previous queued ledger write rejection |
| `src/services/socialPublishLedger.ts:97` | stale social ledger tmp cleanup |
| `src/services/socialPublishLedger.ts:98` | stale social archive tmp cleanup |
| `src/services/telegramConversationalRouter.ts:169` | free-text song create `runCycle` kick |

## Category B: Intentionally silent fallback/probe paths

These remaining matches are retained as intentional fallbacks: optional file reads, cache misses, default material reads, JSON/body parsing fallbacks, Playwright visibility probes, and UI-fallback stat probes. Logging them would create expected-noise for missing optional artist files, missing caches, empty ledgers, or browser selector probes.

### Optional observation/cache reads

- `src/services/xObservationCollector.ts:239,340,351,353`
- `src/services/newsObservationCollector.ts:207,241,243`
- `src/services/commandVoiceWrapper.ts:70,82,83,88`
- `src/services/songSpawnProposer.ts:61,73,75,81`

### Optional artist/persona/context reads

- `src/services/artistVoiceResponder.ts:142-148`
- `src/services/artistState.ts:256-259`
- `src/services/artistDailyVoiceComposer.ts:296-298`
- `src/services/personaFieldAuditor.ts:85-86`
- `src/services/artistWorkspace.ts:77-78`
- `src/services/telegramConversationalRouter.ts:86-91`
- `src/services/telegramCommandRouter.ts:612-613`
- `src/services/songCommissionHandler.ts:120-121`
- `src/services/personaMigrator.ts:313-314`
- `src/services/songSpawnProposer.ts:795-800`

### Optional song/material reads and directory scans

- `src/services/sunoPromptPackFiles.ts:91,177,180`
- `src/services/artistState.ts:226,239,267,276`
- `src/services/autopilotService.ts:174,542-544,574-577,1396`
- `src/services/songQueryService.ts:30`
- `src/services/songMaterialReader.ts:7,18,33,48`
- `src/services/planningSkeletonValidator.ts:140-141`
- `src/services/sunoTakeSelector.ts:23,26-27`
- `src/services/promptPackResurfaceService.ts:30-33,68`
- `src/services/sunoRuns.ts:69,79,111,132,139`
- `src/services/lyricsDrafting.ts:34,176-177`

### Optional ledger/state reads

- `src/services/spawnProposalQueue.ts:55`
- `src/services/socialPublishLedger.ts:26`
- `src/services/sunoBudget.ts:80,140`
- `src/services/artistPulseRateLimiter.ts:15,35`
- `src/services/songSpawnRateLimiter.ts:15,32`
- `src/services/conversationalSession.ts:48`
- `src/services/telegramBotWorker.ts:47`
- `src/services/runtimeEventsLedger.ts:17`
- `src/services/takeAttributionGuard.ts:57`
- `src/services/autopilotRecovery.ts:37,48`
- `src/services/runtimeConfig.ts:41,422`
- `src/services/failedNotifyLedger.ts:113`
- `src/services/receiveHealthService.ts:24`
- `src/services/supervisorHealth.ts:78`
- `src/services/alertAcks.ts:11`
- `src/services/callbackLedgerMaintenance.ts:44,57`
- `src/services/telegramPersonaSession.ts:69`
- `src/services/sunoBudgetLedger.ts:43` (retired in P2c; legacy dailyBudget generation-count gate removed)
- `src/services/birdRateLimiter.ts:74,84`
- `src/services/distributionLedgerReader.ts:14`
- `src/services/personaSetupDetector.ts:38,56,66`
- `src/services/personaFileBuilder.ts:209,232,263`
- `src/services/draftBoxProactiveNotice.ts:22`
- `src/services/soulFileBuilder.ts:102,111,142`
- `src/services/songDistributionPoller.ts:86`
- `src/services/sunoBrowserWorker.ts:168`

### Optional runtime decision fallbacks

- `src/services/changeSetApplier.ts:69`
- `src/services/staleQueueMaintenance.ts:138,207`
- `src/services/producerStatusComposer.ts:45`
- `src/services/degradedLyricsResurfaceService.ts:39`
- `src/services/draftBoxNextAction.ts:56,60`
- `src/services/callbackActionRegistry.ts:223,420`
- `src/services/autopilotService.ts:129,206,287,371,1155`
- `src/services/telegramCallbackHandler.ts:185,263`
- `src/services/telegramCommandRouter.ts:500,526`
- `src/services/telegramNotifier.ts:877,886,975,1076,1141,1148,1342,1372`
- `src/services/planningSkeletonVoiceComposer.ts:202-203`
- `src/services/songPitchContext.ts:228`
- `src/services/artistReflectionComposer.ts:61`
- `src/services/themeProposer.ts:90`
- `src/services/songbookValidator.ts:41`
- `src/services/songSpawnProposer.ts:225,802`
- `src/services/songIdeation.ts:37`

### Network/AI/body parsing fallbacks

- `src/services/aiProviderClient.ts:118,292,295`
- `src/services/callbackPollingWatchdog.ts:216` already logs with `console.warn("[artist-runtime] callback polling watchdog failed:", error)`

### Browser/UI probe fallbacks

- `src/services/sunoDoctor.ts:69,112,117`
- `src/services/sunoProfileLifecycle.ts:36,46,57,72,114,129,155,160`
- `src/services/sunoPlaywrightDriver.ts:76,110,127,161,202,239,300,405,430,502,566`
- `src/routes/index.ts:2233,2246`

### HTTP route read fallbacks

- `src/routes/index.ts:992,1286,1305,1486`

### Daily voice optional material

- `src/services/artistDailyVoiceComposer.ts:231,233,237,243-245`

## Category C: Unknown

None after inspection. Every remaining silent catch in the current scan was classified as optional fallback/probe/read behavior, or was already explicitly logged by existing code.
