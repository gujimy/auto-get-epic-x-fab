(function universal(root, factory) {
  const exported = factory()

  if (typeof module === "object" && module.exports) {
    module.exports = exported
  }

  root.EpicFabBackgroundLogic = exported
})(typeof globalThis !== "undefined" ? globalThis : this, function factory() {
  const RESPONSE_STATUS_PRIORITY = {
    claimed: 100,
    "already-owned": 90,
    navigating: 80,
    "challenge-required": 70,
    "login-required": 60,
    claimable: 50,
    "needs-manual": 20,
    error: 10,
    unknown: 0,
  }
  const COMPLETED_CLAIM_STATUSES = new Set(["claimed", "already-owned"])
  const DEFAULT_ALARM_DELAY_MINUTES = 1
  // 平台到点后通常不会立刻刷新可领状态，自动领取延后一段时间再启动
  const CLAIM_START_DELAY_MS = 10 * 60 * 1000
  const MANAGED_SITES = ["epic", "fab"]

  function getRunScope(options) {
    const forceClaimEpic = Boolean(options && options.forceClaimEpic)
    const forceClaimFab = Boolean(options && options.forceClaimFab)
    const isSiteSpecificRun = forceClaimEpic || forceClaimFab

    return {
      isSiteSpecificRun,
      shouldProcessEpic: forceClaimEpic || !isSiteSpecificRun,
      shouldProcessFab: forceClaimFab || !isSiteSpecificRun,
    }
  }

  function buildNextDebugLog(previousLog, message, timestampText, limit) {
    const safeLimit = Math.max(1, Number(limit) || 200)
    const items = Array.isArray(previousLog) ? previousLog : []

    return [...items, `[${timestampText}] ${message}`].slice(-safeLimit)
  }

  function getResponsePriority(status) {
    return RESPONSE_STATUS_PRIORITY[status] || 0
  }

  function pickBestFrameResponse(responses) {
    return [...(responses || [])].sort((left, right) => {
      const priorityDiff =
        getResponsePriority(right && right.status) -
        getResponsePriority(left && left.status)
      if (priorityDiff !== 0) {
        return priorityDiff
      }

      if ((left && left.frameId) === 0 && (right && right.frameId) !== 0) {
        return 1
      }

      if ((right && right.frameId) === 0 && (left && left.frameId) !== 0) {
        return -1
      }

      return 0
    })[0]
  }

  function pickFabCampaignEndDate(items) {
    const dates = (items || [])
      .map((item) => item && item.endDate)
      .filter(Boolean)
      .sort()

    return dates[0] || null
  }

  function isCompletedClaimStatus(status) {
    return COMPLETED_CLAIM_STATUSES.has(status)
  }

  function getItemResultStatus(item) {
    return item && (item.claimResult || item.status)
  }

  function areAllCurrentItemsCompleted(items) {
    const currentItems = (items || []).filter(Boolean)
    return (
      currentItems.length > 0 &&
      currentItems.every((item) =>
        isCompletedClaimStatus(getItemResultStatus(item)),
      )
    )
  }

  function parseFutureTime(value, nowMs) {
    const parsedMs = Date.parse(value)
    if (!Number.isFinite(parsedMs) || parsedMs <= nowMs) {
      return null
    }

    return {
      value,
      timeMs: parsedMs,
    }
  }

  function getClaimStartDelayMs(options) {
    if (
      options &&
      Object.prototype.hasOwnProperty.call(options, "claimStartDelayMs")
    ) {
      const override = Number(options.claimStartDelayMs)
      if (Number.isFinite(override) && override >= 0) {
        return override
      }
    }

    return CLAIM_START_DELAY_MS
  }

  function applyClaimStartDelay(timeMs, options) {
    return timeMs + getClaimStartDelayMs(options)
  }

  function pickNextAutoRunAt(currentItems, upcomingItems, options) {
    const nowMs =
      Number.isFinite(options && options.nowMs) ? Number(options.nowMs) : Date.now()
    const candidates = []

    for (const item of (currentItems || []).filter(Boolean)) {
      // 当前批次结束后的切换点，也延后执行，等平台刷新下一轮
      const futureEnd = parseFutureTime(item.endDate, nowMs)
      if (futureEnd) {
        candidates.push({
          value: new Date(applyClaimStartDelay(futureEnd.timeMs, options)).toISOString(),
          timeMs: applyClaimStartDelay(futureEnd.timeMs, options),
        })
      }
    }

    for (const item of (upcomingItems || []).filter(Boolean)) {
      // 预告开领时间到点后延后执行，避免平台尚未刷新
      const futureStart = parseFutureTime(item.startDate, nowMs)
      if (futureStart) {
        candidates.push({
          value: new Date(applyClaimStartDelay(futureStart.timeMs, options)).toISOString(),
          timeMs: applyClaimStartDelay(futureStart.timeMs, options),
        })
      }
    }

    candidates.sort((left, right) => left.timeMs - right.timeMs)
    return candidates[0] ? candidates[0].value : null
  }

  function buildSuccessfulExecutionRecord(site, currentItems, upcomingItems, options) {
    if (!areAllCurrentItemsCompleted(currentItems)) {
      return null
    }

    const nowMs =
      Number.isFinite(options && options.nowMs) ? Number(options.nowMs) : Date.now()
    const recordedAt =
      (options && options.recordedAt) || new Date(nowMs).toISOString()
    const nextAutoRunAt = pickNextAutoRunAt(currentItems, upcomingItems, {
      nowMs,
    })

    if (!nextAutoRunAt) {
      return null
    }

    return {
      site,
      lastSuccessAt: recordedAt,
      nextAutoRunAt,
      itemCount: (currentItems || []).filter(Boolean).length,
      itemIds: (currentItems || [])
        .filter(Boolean)
        .map((item) => item.id || item.url || item.title)
        .filter(Boolean),
    }
  }

  function isManualRunReason(reason) {
    return /^manual(?:-|$)/u.test(String(reason || ""))
  }

  function shouldSkipSiteAutoRun(record, options) {
    if (options && (options.isManualTrigger || options.forceClaim)) {
      return false
    }

    const nextAutoRunAt = record && record.nextAutoRunAt
    const nextAutoRunMs = Date.parse(nextAutoRunAt)
    if (!Number.isFinite(nextAutoRunMs)) {
      return false
    }

    const nowMs =
      Number.isFinite(options && options.nowMs) ? Number(options.nowMs) : Date.now()

    return nowMs < nextAutoRunMs
  }

  function getSiteAutoSkipInfo(records, site, options) {
    const record = records && records[site]
    const shouldSkip = shouldSkipSiteAutoRun(record, options)

    return {
      shouldSkip,
      nextAutoRunAt: shouldSkip ? record.nextAutoRunAt : null,
      record: record || null,
    }
  }

  function computeNextAlarmDelayMinutes(records, options) {
    const nowMs =
      Number.isFinite(options && options.nowMs) ? Number(options.nowMs) : Date.now()
    const defaultDelayMinutes = Math.max(
      1,
      Number(options && options.defaultDelayMinutes) || DEFAULT_ALARM_DELAY_MINUTES,
    )
    const sites =
      Array.isArray(options && options.sites) && options.sites.length
        ? options.sites
        : MANAGED_SITES
    const futureTimes = []

    for (const site of sites) {
      const record = records && records[site]
      const nextAutoRunMs = Date.parse(record && record.nextAutoRunAt)
      if (!Number.isFinite(nextAutoRunMs) || nextAutoRunMs <= nowMs) {
        return defaultDelayMinutes
      }

      futureTimes.push(nextAutoRunMs)
    }

    const earliestMs = Math.min(...futureTimes)
    return Math.max(
      defaultDelayMinutes,
      Math.ceil((earliestMs - nowMs) / 60000),
    )
  }

  function isFabAlreadyOwnedItem(item) {
    const status = item && (item.status || item.claimResult)
    return status === "already-owned" || status === "claimed"
  }

  function shouldSkipFabDetailInspection(items, options) {
    if ((options && options.isManualTrigger) || (options && options.forceClaimFab)) {
      return false
    }

    const currentItems = (items || []).filter(Boolean)
    if (!currentItems.length) {
      return false
    }

    if (currentItems.some((item) => !isFabAlreadyOwnedItem(item))) {
      return false
    }

    const campaignEndDate = pickFabCampaignEndDate(currentItems)
    if (!campaignEndDate) {
      return false
    }

    const campaignEndMs = Date.parse(campaignEndDate)
    if (!Number.isFinite(campaignEndMs)) {
      return false
    }

    const nowMs =
      Number.isFinite(options && options.nowMs) ? Number(options.nowMs) : Date.now()

    return nowMs < campaignEndMs
  }

  function runRequestsClaim(options) {
    return Boolean(
      options && (options.forceClaimEpic || options.forceClaimFab),
    )
  }

  function shouldRejectConcurrentRun(activeOptions, nextOptions) {
    if (!runRequestsClaim(nextOptions)) {
      return false
    }

    if (!runRequestsClaim(activeOptions)) {
      return true
    }

    return (
      Boolean(activeOptions && activeOptions.forceClaimEpic) !==
        Boolean(nextOptions && nextOptions.forceClaimEpic) ||
      Boolean(activeOptions && activeOptions.forceClaimFab) !==
        Boolean(nextOptions && nextOptions.forceClaimFab)
    )
  }

  return {
    CLAIM_START_DELAY_MS,
    areAllCurrentItemsCompleted,
    buildSuccessfulExecutionRecord,
    buildNextDebugLog,
    computeNextAlarmDelayMinutes,
    getClaimStartDelayMs,
    getSiteAutoSkipInfo,
    getResponsePriority,
    getRunScope,
    isManualRunReason,
    pickBestFrameResponse,
    pickFabCampaignEndDate,
    pickNextAutoRunAt,
    runRequestsClaim,
    shouldRejectConcurrentRun,
    shouldSkipSiteAutoRun,
    shouldSkipFabDetailInspection,
  }
})
