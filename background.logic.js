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

  return {
    buildNextDebugLog,
    getResponsePriority,
    getRunScope,
    pickBestFrameResponse,
    pickFabCampaignEndDate,
    shouldSkipFabDetailInspection,
  }
})
