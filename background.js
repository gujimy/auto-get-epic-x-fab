if (typeof importScripts === "function") {
  importScripts("common.js")
  importScripts("background.logic.js")
}

/* global chrome, EpicFabBackgroundLogic, EpicFabCommon */

const {
  STORAGE_KEYS,
  SITE_LABELS,
  mergeSettings,
  nowIso,
  parseEpicPromotionsResponse,
  serializeError,
} = EpicFabCommon
const {
  buildNextDebugLog,
  getRunScope,
  pickBestFrameResponse,
  pickFabCampaignEndDate,
  shouldSkipFabDetailInspection,
} = EpicFabBackgroundLogic

const CHECK_ALARM_NAME = "epic-fab-weekly-check"
const MAX_AUTOMATION_STEPS = 20
const DEBUG_LOG_LIMIT = 200
const OFFER_CONCURRENCY = 3
const ACTION_BASE_ICON_PATH = "icon.ico"
const ACTION_ICON_SIZES = [16, 32, 48, 128]
const ACTION_INDICATOR_COLORS = {
  pending: "#d9a404",
  claimed: "#1f9d55",
}

let activeRunPromise = null
let debugLogWriteQueue = Promise.resolve()
let baseActionIconBitmapPromise = null

chrome.runtime.onInstalled.addListener(async () => {
  await ensureInitialized()
  await configureSidePanel()
  await scheduleAlarm()
  await runCheck({
    reason: "install",
    forceClaimEpic: false,
    forceClaimFab: false,
  })
})

chrome.runtime.onStartup.addListener(async () => {
  await ensureInitialized()
  await configureSidePanel()
  await scheduleAlarm()
})

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm && alarm.name === CHECK_ALARM_NAME) {
    await runCheck({
      reason: "alarm",
      forceClaimEpic: false,
      forceClaimFab: false,
    })
  }
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) =>
      sendResponse({
        ok: false,
        error: serializeError(error),
      }),
    )

  return true
})

async function handleMessage(message) {
  switch (message && message.type) {
    case "get-state":
      return await getPopupPayload()
    case "manual-check":
      return await runCheck({
        reason: "manual",
        forceClaimEpic: false,
        forceClaimFab: false,
      })
    case "claim-site":
      return await runCheck({
        reason: `manual-${message.site || "unknown"}`,
        forceClaimEpic: message.site === "epic",
        forceClaimFab: message.site === "fab",
      })
    case "get-settings":
      return await getSettings()
    case "save-settings":
      return await saveSettings(message.settings || {})
    default:
      throw new Error("不支持的消息类型")
  }
}

async function ensureInitialized() {
  const settings = await getSettings()
  await chrome.storage.local.set({
    [STORAGE_KEYS.settings]: settings,
  })
}

async function configureSidePanel() {
  if (!chrome.sidePanel || !chrome.sidePanel.setPanelBehavior) {
    return
  }

  try {
    await chrome.sidePanel.setPanelBehavior({
      openPanelOnActionClick: true,
    })
  } catch (_error) {
    // 浏览器若暂不支持 Side Panel，这里保持静默，避免影响主流程。
  }
}

async function getSettings() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.settings)
  return mergeSettings(stored[STORAGE_KEYS.settings])
}

async function saveSettings(nextSettings) {
  const merged = mergeSettings(nextSettings)
  await chrome.storage.local.set({
    [STORAGE_KEYS.settings]: merged,
  })
  await scheduleAlarm()
  return merged
}

async function getState() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.state)
  return (
    stored[STORAGE_KEYS.state] || {
      running: false,
      lastCheckAt: null,
      epic: { current: [], upcoming: [] },
      fab: { current: [], upcoming: [] },
      lastError: null,
      debugLog: [],
    }
  )
}

async function setState(patch) {
  const previous = await getState()
  const nextState = {
    ...previous,
    ...patch,
  }

  await chrome.storage.local.set({
    [STORAGE_KEYS.state]: nextState,
  })

  await updateBadge(nextState)
  return nextState
}

async function scheduleAlarm() {
  const settings = await getSettings()
  await chrome.alarms.clear(CHECK_ALARM_NAME)
  await chrome.alarms.create(CHECK_ALARM_NAME, {
    delayInMinutes: 1,
    periodInMinutes: Math.max(30, Number(settings.checkIntervalMinutes) || 360),
  })
}

async function updateBadge(state) {
  const currentItems = [
    ...((((state && state.epic) || {}).current || []).filter(Boolean)),
    ...((((state && state.fab) || {}).current || []).filter(Boolean)),
  ]
  const indicatorState = getActionIndicatorState(currentItems)

  await chrome.action.setBadgeText({ text: "" })

  if (indicatorState === "idle") {
    await chrome.action.setIcon({
      path: ACTION_BASE_ICON_PATH,
    })
    return
  }

  try {
    const imageData = await buildActionIconSet(ACTION_INDICATOR_COLORS[indicatorState])
    await chrome.action.setIcon({
      imageData,
    })
  } catch (_error) {
    await chrome.action.setIcon({
      path: ACTION_BASE_ICON_PATH,
    })
  }
}

function getActionIndicatorState(items) {
  const currentItems = (items || []).filter(Boolean)
  if (!currentItems.length) {
    return "idle"
  }

  const allClaimed = currentItems.every((item) =>
    ["claimed", "already-owned"].includes(item && item.claimResult),
  )

  if (allClaimed) {
    return "claimed"
  }

  return "pending"
}

async function buildActionIconSet(dotColor) {
  const bitmap = await getBaseActionIconBitmap()
  const entries = await Promise.all(
    ACTION_ICON_SIZES.map(async (size) => {
      const canvas = new OffscreenCanvas(size, size)
      const ctx = canvas.getContext("2d")
      ctx.clearRect(0, 0, size, size)
      ctx.drawImage(bitmap, 0, 0, size, size)

      const radius = Math.max(2.5, size * 0.14)
      const centerX = size - radius - Math.max(1.5, size * 0.1)
      const centerY = size - radius - Math.max(1.5, size * 0.1)

      ctx.beginPath()
      ctx.arc(centerX, centerY, radius + Math.max(1.2, size * 0.04), 0, Math.PI * 2)
      ctx.fillStyle = "#ffffff"
      ctx.fill()

      ctx.beginPath()
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2)
      ctx.fillStyle = dotColor
      ctx.fill()

      return [size, ctx.getImageData(0, 0, size, size)]
    }),
  )

  return Object.fromEntries(entries)
}

async function getBaseActionIconBitmap() {
  if (!baseActionIconBitmapPromise) {
    baseActionIconBitmapPromise = fetch(chrome.runtime.getURL(ACTION_BASE_ICON_PATH))
      .then((response) => response.blob())
      .then((blob) => createImageBitmap(blob))
  }

  return await baseActionIconBitmapPromise
}

async function getPopupPayload() {
  const [settings, state] = await Promise.all([getSettings(), getState()])
  return { settings, state }
}

async function runCheck(options) {
  if (activeRunPromise) {
    return await activeRunPromise
  }

  activeRunPromise = runCheckInternal(options)
    .catch((error) => {
      throw error
    })
    .finally(() => {
      activeRunPromise = null
    })

  return await activeRunPromise
}

async function runCheckInternal({
  reason,
  forceClaimEpic,
  forceClaimFab,
}) {
  const settings = await getSettings()
  const previousState = await getState()

  const isManualTrigger = reason !== "alarm"
  const { shouldProcessEpic, shouldProcessFab } = getRunScope({
    forceClaimEpic,
    forceClaimFab,
  })

  if (
    !settings.autoCheck &&
    !isManualTrigger &&
    !forceClaimEpic &&
    !forceClaimFab
  ) {
    return await getPopupPayload()
  }

  await setState({
    running: true,
    lastError: null,
    lastRunReason: reason,
    lastRunStartedAt: nowIso(),
    debugLog: [],
  })
  await appendDebugLog(`开始执行任务，触发原因：${reason}`)

  try {
    let epicUpcoming = previousState && previousState.epic && previousState.epic.upcoming
      ? previousState.epic.upcoming
      : []
    let epicCurrent = previousState && previousState.epic && previousState.epic.current
      ? previousState.epic.current
      : []

    if (shouldProcessEpic) {
      const epicOffers = await fetchEpicOffers(settings)
      await appendDebugLog(`Epic 当前免费数量：${epicOffers.current.length}`)
      epicUpcoming = epicOffers.upcoming
      epicCurrent = await inspectAndMaybeClaimOffers({
        site: "epic",
        offers: epicOffers.current,
        mode:
          forceClaimEpic || settings.autoClaimEpic ? "claim" : "inspect",
        closeFinishedTabs: settings.closeFinishedTabs,
      })
    } else {
      await appendDebugLog("本次跳过 Epic 流程")
    }

    let fabCurrent = previousState && previousState.fab && previousState.fab.current
      ? previousState.fab.current
      : []

    if (shouldProcessFab) {
      const fabListings = await detectFabListings({
        closeFinishedTabs: settings.closeFinishedTabs,
      })
      const shouldSkipFabDetails =
        !fabListings.challengeRequired &&
        shouldSkipFabDetailInspection(fabListings.items, {
          isManualTrigger,
          forceClaimFab,
        })

      await appendDebugLog(
        fabListings.challengeRequired
          ? "Fab 列表页触发 Cloudflare 验证"
          : `Fab 限免列表数量：${fabListings.items.length}`,
      )
      fabCurrent = fabListings.challengeRequired
        ? [
            {
              id: "fab-cloudflare-challenge",
              title: "Fab 需要 Cloudflare 验证",
              url: fabListings.url,
              site: "fab",
              inspectedAt: nowIso(),
              claimResult: "challenge-required",
              claimResultLabel: "需要 Cloudflare 验证",
              claimMessage: "请在弹出的 Fab 标签页完成验证后，再次点击检查",
              finalUrl: fabListings.url,
            },
          ]
        : shouldSkipFabDetails
          ? buildFabResultsFromListing(fabListings.items)
          : await inspectAndMaybeClaimOffers({
              site: "fab",
              offers: fabListings.items,
              mode:
                forceClaimFab || settings.autoClaimFab ? "claim" : "inspect",
              closeFinishedTabs: settings.closeFinishedTabs,
            })

      if (shouldSkipFabDetails) {
        const nextFabDeadline = pickFabCampaignEndDate(fabCurrent)
        await appendDebugLog(
          `Fab 列表页确认当前批次已全部在库，截止前跳过详情页执行：${nextFabDeadline || "未记录截止时间"}`,
        )
      }
    } else {
      await appendDebugLog("本次跳过 Fab 流程")
    }

    const nextState = await setState({
      running: false,
      lastCheckAt: nowIso(),
      lastRunFinishedAt: nowIso(),
      epic: {
        current: epicCurrent,
        upcoming: epicUpcoming,
      },
      fab: {
        current: fabCurrent,
        upcoming: [],
      },
      lastError: null,
    })
    await appendDebugLog("本次任务执行完成")

    await maybeNotify(settings, nextState)
    return { settings, state: nextState }
  } catch (error) {
    await appendDebugLog(`任务执行失败：${serializeError(error)}`)
    const failedState = await setState({
      running: false,
      lastRunFinishedAt: nowIso(),
      lastError: serializeError(error),
    })
    throw new Error(failedState.lastError)
  }
}

async function maybeNotify(settings, state) {
  if (!settings.desktopNotifications) {
    return
  }

  const claimableItems = [
    ...(state.epic && state.epic.current ? state.epic.current : []),
    ...(state.fab && state.fab.current ? state.fab.current : []),
  ].filter(
    (item) =>
      item &&
      (item.claimResult === "claimable" || item.claimResult === "login-required"),
  )

  if (!claimableItems.length) {
    return
  }

  const lines = claimableItems
    .slice(0, 4)
    .map(
      (item) =>
        `${SITE_LABELS[item.site]} · ${item.title} · ${item.claimResultLabel}`,
    )

  await chrome.notifications.create({
    type: "basic",
    iconUrl: chrome.runtime.getURL("icon.png"),
    title: "Epic/Fab 每周免费助手",
    message: lines.join("\n"),
  })
}

async function fetchEpicOffers(settings) {
  const url =
    "https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions" +
    `?locale=${encodeURIComponent(settings.locale)}` +
    `&country=${encodeURIComponent(settings.country)}` +
    `&allowCountries=${encodeURIComponent(settings.country)}`

  const response = await fetch(url, {
    credentials: "omit",
  })

  if (!response.ok) {
    throw new Error(`Epic 接口请求失败：${response.status}`)
  }

  const payload = await response.json()
  return parseEpicPromotionsResponse(payload, settings.locale)
}

async function detectFabListings({ closeFinishedTabs }) {
  const tab = await chrome.tabs.create({
    url: "https://www.fab.com/limited-time-free",
    active: false,
  })

  let shouldCloseTab = Boolean(closeFinishedTabs)

  try {
    await waitForTabComplete(tab.id, {
      timeoutMs: 15000,
      continueOnTimeout: true,
    })
    const result = await sendMessageWithRetry(tab.id, {
      type: "scan-fab-listings",
    }, {
      frameMode: "top-only",
    })

    if (!result) {
      throw new Error("Fab 限免列表解析失败")
    }

    if (result.status === "challenge-required") {
      shouldCloseTab = false
      await focusTab(tab.id)
      return {
        items: [],
        challengeRequired: true,
        url: result.url || tab.url,
      }
    }

    if (!Array.isArray(result.items)) {
      throw new Error("Fab 限免列表解析失败")
    }

    return {
      items: result.items,
      challengeRequired: false,
      url: tab.url,
    }
  } finally {
    if (shouldCloseTab) {
      await closeTabQuietly(tab.id)
    }
  }
}

async function inspectAndMaybeClaimOffers({
  site,
  offers,
  mode,
  closeFinishedTabs,
}) {
  const indexedOffers = (offers || []).map((offer, index) => ({
    offer,
    index,
  }))
  const indexedResults = await mapWithConcurrency(
    indexedOffers,
    OFFER_CONCURRENCY,
    async ({ offer, index }) => ({
      index,
      value: await inspectAndMaybeClaimSingleOffer({
        site,
        offer,
        mode,
        closeFinishedTabs,
      }),
    }),
  )

  return indexedResults
    .sort((left, right) => left.index - right.index)
    .map((item) => item.value)
}

async function inspectAndMaybeClaimSingleOffer({
  site,
  offer,
  mode,
  closeFinishedTabs,
}) {
  if (site === "fab" && offer && offer.status === "already-owned") {
    await appendDebugLog(`Fab · ${offer.title}：列表页已识别为在库中，跳过详情页`)
    return {
      ...offer,
      site,
      inspectedAt: nowIso(),
      claimResult: "already-owned",
      claimResultLabel: "已在库中",
      claimMessage: "已在 Fab 限免列表页识别为在库中，跳过详情页检查",
      finalUrl: offer.url,
    }
  }

  const tab = await chrome.tabs.create({
    url: offer.url,
    active: false,
  })
  await appendDebugLog(`${SITE_LABELS[site]} · ${offer.title}：已打开页面`)

  let shouldCloseTab = Boolean(closeFinishedTabs)

  try {
    const claimResult = await driveAutomation({
      tabId: tab.id,
      site,
      mode,
      offer,
    })

    if (claimResult.keepTabOpen) {
      shouldCloseTab = false
    }

    await appendDebugLog(
      `${SITE_LABELS[site]} · ${offer.title}：${claimResult.label}，${claimResult.message || "无附加信息"}`,
    )

    return {
      ...offer,
      site,
      inspectedAt: nowIso(),
      endDate: claimResult.pageEndDate || offer.endDate || null,
      claimResult: claimResult.status,
      claimResultLabel: claimResult.label,
      claimMessage: claimResult.message || null,
      claimTrace: claimResult.trace || [],
      finalUrl: claimResult.finalUrl || offer.url,
    }
  } finally {
    if (shouldCloseTab) {
      await closeTabQuietly(tab.id)
      await appendDebugLog(`${SITE_LABELS[site]} · ${offer.title}：已关闭页面`)
    }
  }
}

async function driveAutomation({ tabId, site, mode, offer }) {
  const trace = []

  for (let step = 0; step < MAX_AUTOMATION_STEPS; step += 1) {
    const waitResult = await waitForTabComplete(tabId, {
      timeoutMs: step === 0 ? 15000 : 2500,
      continueOnTimeout: true,
    })
    if (waitResult && waitResult.timedOut) {
      await appendDebugLog(
        `${SITE_LABELS[site]} · ${offer && offer.title ? offer.title : "未知项目"} · 页面仍在 loading，继续直接检测 DOM`,
      )
    }

    const response = await sendMessageWithRetry(tabId, {
      type: "automation-step",
      site,
      mode,
      offer,
      step,
    }, {
      frameMode: "all-frames",
    })

    if (!response) {
      throw new Error(`${SITE_LABELS[site]} 页面通信失败`)
    }

    trace.push(formatAutomationTrace(step, response))
    await appendDebugLog(
      `${SITE_LABELS[site]} · ${offer && offer.title ? offer.title : "未知项目"} · ${trace[trace.length - 1]}`,
    )

    if (response.status === "navigating") {
      await delay(response.delayMs || 1500)
      continue
    }

    return {
      status: response.status,
      label: response.label,
      message: response.message,
      finalUrl: response.url,
      keepTabOpen: Boolean(response.keepTabOpen),
      trace,
    }
  }

  return {
    status: "needs-manual",
    label: "需要人工确认",
    message: "自动化步骤超出上限，请手动检查页面",
    trace,
  }
}

function formatAutomationTrace(step, response) {
  const status = response && response.status ? response.status : "unknown"
  const message = response && response.message ? response.message : "无消息"
  const url = response && response.url ? response.url : "未知URL"
  const debugBefore =
    response && response.debug && response.debug.before
      ? response.debug.before
      : null

  const flags = []
  if (debugBefore) {
    if (debugBefore.loading) {
      flags.push("loading")
    }
    if (debugBefore.checkout) {
      flags.push("checkout")
    }
    if (debugBefore.hasFabSuccess) {
      flags.push("fabSuccess")
    }
    if (debugBefore.hasGenericSuccess) {
      flags.push("genericSuccess")
    }
  }

  const confirmSnapshot =
    debugBefore && debugBefore.hostedConfirmButton
      ? debugBefore.hostedConfirmButton
      : null
  const confirmText =
    confirmSnapshot && confirmSnapshot.text
      ? confirmSnapshot.text
      : "未找到"
  const confirmState =
    confirmSnapshot && typeof confirmSnapshot.actionable === "boolean"
      ? confirmSnapshot.actionable
        ? "可点"
        : "不可点"
      : "未知"
  const frameText =
    response && typeof response.frameId === "number"
      ? ` | frame=${response.frameId}`
      : ""

  return `[step ${step}] status=${status} | msg=${message} | flags=${flags.join(",") || "none"} | confirm=${confirmText}(${confirmState})${frameText} | url=${url}`
}

async function appendDebugLog(message) {
  const timestampText = formatDebugTimestamp()
  debugLogWriteQueue = debugLogWriteQueue
    .catch(() => {})
    .then(async () => {
      const currentState = await getState()
      const nextLog = buildNextDebugLog(
        currentState && currentState.debugLog,
        message,
        timestampText,
        DEBUG_LOG_LIMIT,
      )

      await setState({
        debugLog: nextLog,
      })
    })

  await debugLogWriteQueue
}

function formatDebugTimestamp() {
  return new Date().toLocaleTimeString("zh-CN", {
    hour12: false,
  })
}

async function sendMessageWithRetry(tabId, message, options) {
  let lastError = null

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const responses = await sendMessageToCandidateFrames(tabId, message, options)
      if (responses.length) {
        return pickBestFrameResponse(responses)
      }

      lastError = new Error("目标 frame 暂未响应")
    } catch (error) {
      lastError = error
    }

    await delay(500)
  }

  throw lastError || new Error("消息发送失败")
}

async function sendMessageToCandidateFrames(tabId, message, options) {
  const frameMode = options && options.frameMode ? options.frameMode : "all-frames"
  const frameIds = await getCandidateFrameIds(tabId, frameMode)
  const responses = []

  for (const frameId of frameIds) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, message, {
        frameId,
      })
      if (response) {
        responses.push({
          ...response,
          frameId,
        })
      }
    } catch (_error) {
      // 某些 frame 尚未注入或不可通信，继续尝试其他 frame。
    }
  }

  return responses
}

async function getCandidateFrameIds(tabId, frameMode) {
  if (frameMode === "top-only") {
    return [0]
  }

  if (!chrome.webNavigation || !chrome.webNavigation.getAllFrames) {
    return [0]
  }

  try {
    const frames = await chrome.webNavigation.getAllFrames({
      tabId,
    })
    const frameIds = (frames || [])
      .map((frame) => frame && frame.frameId)
      .filter((frameId) => Number.isInteger(frameId))

    const unique = Array.from(new Set(frameIds))
    unique.sort((left, right) => {
      if (left === 0) {
        return 1
      }

      if (right === 0) {
        return -1
      }

      return left - right
    })

    return unique.length ? unique : [0]
  } catch (_error) {
    return [0]
  }
}

function cloneFabItems(items) {
  return (items || []).map((item) => ({
    ...item,
  }))
}

function buildFabResultsFromListing(items) {
  return cloneFabItems(items).map((item) => ({
    ...item,
    site: "fab",
    inspectedAt: nowIso(),
    claimResult: "already-owned",
    claimResultLabel: "已在库中",
    claimMessage: "Fab 列表页确认当前已在库中，跳过详情页执行",
    finalUrl: item && item.url ? item.url : null,
  }))
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length)
  let nextIndex = 0

  const runners = Array.from({
    length: Math.max(1, Math.min(concurrency, items.length || 1)),
  }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await worker(items[currentIndex], currentIndex)
    }
  })

  await Promise.all(runners)
  return results
}

async function waitForTabComplete(tabId, options) {
  const timeoutMs = Number(options && options.timeoutMs) || 30000
  const continueOnTimeout = Boolean(options && options.continueOnTimeout)
  const startedAt = Date.now()
  let lastTab = null

  while (Date.now() - startedAt < timeoutMs) {
    lastTab = await chrome.tabs.get(tabId)
    if (lastTab && lastTab.status === "complete") {
      return {
        tab: lastTab,
        timedOut: false,
      }
    }

    await delay(300)
  }

  if (continueOnTimeout) {
    return {
      tab: lastTab,
      timedOut: true,
    }
  }

  throw new Error("标签页加载超时")
}

async function closeTabQuietly(tabId) {
  try {
    await chrome.tabs.remove(tabId)
  } catch (_error) {
    // 标签页可能已经被关闭，这里静默即可。
  }
}

async function focusTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId)
    await chrome.tabs.update(tabId, {
      active: true,
    })

    if (tab && typeof tab.windowId === "number") {
      await chrome.windows.update(tab.windowId, {
        focused: true,
      })
    }
  } catch (_error) {
    // 页面可能已经关闭，忽略即可。
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
