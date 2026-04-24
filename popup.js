/* global chrome, EpicFabCommon */

const {
  DEFAULT_SETTINGS,
  formatDateTime,
  formatResultLabel,
} = EpicFabCommon

const REFRESH_INTERVAL_MS = 1500
const EPIC_FREE_PAGE_URL = "https://store.epicgames.com/zh-CN/free-games"
const FAB_FREE_PAGE_URL = "https://www.fab.com/limited-time-free"

const elements = {
  summaryText: document.getElementById("summaryText"),
  epicList: document.getElementById("epicList"),
  fabList: document.getElementById("fabList"),
  upcomingList: document.getElementById("upcomingList"),
  debugList: document.getElementById("debugList"),
  epicCount: document.getElementById("epicCount"),
  fabCount: document.getElementById("fabCount"),
  checkNowButton: document.getElementById("checkNowButton"),
  claimEpicButton: document.getElementById("claimEpicButton"),
  claimFabButton: document.getElementById("claimFabButton"),
  openOptionsButton: document.getElementById("openOptionsButton"),
  openEpicPageButton: document.getElementById("openEpicPageButton"),
  openFabPageButton: document.getElementById("openFabPageButton"),
  homeView: document.getElementById("homeView"),
  settingsView: document.getElementById("settingsView"),
  backToHomeButton: document.getElementById("backToHomeButton"),
  saveSettingsButton: document.getElementById("saveSettingsButton"),
  settingsSummaryText: document.getElementById("settingsSummaryText"),
  settingsStatusText: document.getElementById("settingsStatusText"),
  autoCheck: document.getElementById("autoCheck"),
  autoClaimEpic: document.getElementById("autoClaimEpic"),
  autoClaimFab: document.getElementById("autoClaimFab"),
  desktopNotifications: document.getElementById("desktopNotifications"),
  closeFinishedTabs: document.getElementById("closeFinishedTabs"),
  checkIntervalMinutes: document.getElementById("checkIntervalMinutes"),
  country: document.getElementById("country"),
  locale: document.getElementById("locale"),
}

let isRefreshing = false
let currentView = "home"

elements.checkNowButton.addEventListener("click", async () => {
  await runAction("manual-check")
})

elements.claimEpicButton.addEventListener("click", async () => {
  await runAction("claim-site", { site: "epic" })
})

elements.claimFabButton.addEventListener("click", async () => {
  await runAction("claim-site", { site: "fab" })
})

elements.openOptionsButton.addEventListener("click", async () => {
  await loadSettings()
  switchView("settings")
})

elements.openEpicPageButton.addEventListener("click", async () => {
  await openPage(EPIC_FREE_PAGE_URL)
})

elements.openFabPageButton.addEventListener("click", async () => {
  await openPage(FAB_FREE_PAGE_URL)
})

elements.backToHomeButton.addEventListener("click", () => {
  switchView("home")
})

elements.saveSettingsButton.addEventListener("click", async () => {
  await saveSettings()
})

void refresh()
setInterval(() => {
  void refresh()
}, REFRESH_INTERVAL_MS)

async function refresh() {
  if (isRefreshing) {
    return
  }

  isRefreshing = true

  try {
    const response = await chrome.runtime.sendMessage({
      type: "get-state",
    })

    if (!response || !response.ok) {
      elements.summaryText.textContent = "状态读取失败"
      return
    }

    render(response.result.state)
  } catch (error) {
    elements.summaryText.textContent =
      error && error.message
        ? `后台启动失败：${error.message}`
        : "后台启动失败，请重新加载扩展"
  } finally {
    isRefreshing = false
  }
}

async function runAction(type, payload) {
  setBusy(true)
  elements.summaryText.textContent = "正在执行，请稍候..."

  try {
    const response = await chrome.runtime.sendMessage({
      type,
      ...payload,
    })

    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "操作失败")
    }

    render(response.result.state)
    await refresh()
  } catch (error) {
    elements.summaryText.textContent =
      error && error.message ? error.message : String(error)
  } finally {
    setBusy(false)
  }
}

function setBusy(flag) {
  for (const button of [
    elements.checkNowButton,
    elements.claimEpicButton,
    elements.claimFabButton,
  ]) {
    button.disabled = flag
  }
}

async function openPage(url) {
  await chrome.tabs.create({
    url,
    active: true,
  })
}

function switchView(view) {
  currentView = view
  const showSettings = view === "settings"
  elements.homeView.classList.toggle("view-hidden", showSettings)
  elements.settingsView.classList.toggle("view-hidden", !showSettings)
}

async function loadSettings() {
  elements.settingsStatusText.textContent = "正在加载当前设置..."
  const response = await chrome.runtime.sendMessage({
    type: "get-settings",
  })
  const settings =
    (response && response.ok && response.result) || DEFAULT_SETTINGS

  elements.autoCheck.checked = Boolean(settings.autoCheck)
  elements.autoClaimEpic.checked = Boolean(settings.autoClaimEpic)
  elements.autoClaimFab.checked = Boolean(settings.autoClaimFab)
  elements.desktopNotifications.checked = Boolean(settings.desktopNotifications)
  elements.closeFinishedTabs.checked = Boolean(settings.closeFinishedTabs)
  elements.checkIntervalMinutes.value = String(settings.checkIntervalMinutes)
  elements.country.value = settings.country
  elements.locale.value = settings.locale
  elements.settingsStatusText.textContent = "已加载当前设置"
}

async function saveSettings() {
  elements.saveSettingsButton.disabled = true
  elements.settingsStatusText.textContent = "正在保存..."

  try {
    const response = await chrome.runtime.sendMessage({
      type: "save-settings",
      settings: {
        autoCheck: elements.autoCheck.checked,
        autoClaimEpic: elements.autoClaimEpic.checked,
        autoClaimFab: elements.autoClaimFab.checked,
        desktopNotifications: elements.desktopNotifications.checked,
        closeFinishedTabs: elements.closeFinishedTabs.checked,
        checkIntervalMinutes: Number(elements.checkIntervalMinutes.value) || 360,
        country: String(elements.country.value || "US").toUpperCase(),
        locale: elements.locale.value || "zh-CN",
      },
    })

    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "保存失败")
    }

    elements.settingsStatusText.textContent = "设置已保存"
  } catch (error) {
    elements.settingsStatusText.textContent =
      error && error.message ? error.message : "保存失败"
  } finally {
    elements.saveSettingsButton.disabled = false
  }
}

function render(state) {
  const uiState = captureUiState()
  const epicCurrent = (state && state.epic && state.epic.current) || []
  const fabCurrent = (state && state.fab && state.fab.current) || []
  const upcoming = (state && state.epic && state.epic.upcoming) || []

  if (state && state.running) {
    elements.summaryText.textContent = "后台正在运行自动检测..."
  } else if (state && state.lastError) {
    elements.summaryText.textContent = `最近一次失败：${state.lastError}`
  } else {
    elements.summaryText.textContent = `上次检测：${formatDateTime(state && state.lastCheckAt)}`
  }

  elements.epicCount.textContent = String(epicCurrent.length)
  elements.fabCount.textContent = String(fabCurrent.length)

  renderList(elements.epicList, epicCurrent, { site: "Epic" })
  renderList(elements.fabList, fabCurrent, { site: "Fab" })
  renderList(elements.upcomingList, upcoming, {
    site: "下周",
    fallbackStatus: "upcoming",
  })
  renderDebugList((state && state.debugLog) || [], Boolean(state && state.running))
  restoreUiState(uiState)
}

function renderList(target, items, { site, fallbackStatus }) {
  if (!items || !items.length) {
    target.className = "list empty"
    target.textContent = "暂无数据"
    return
  }

  target.className = "list"
  target.innerHTML = items
    .map((item) => {
      const status = item.claimResult || item.status || fallbackStatus || "unknown"
      const label = item.claimResultLabel || formatResultLabel(status)
      const timeText = item.endDate
        ? `截止：${formatDateTime(item.endDate)}`
        : item.startDate
          ? `开始：${formatDateTime(item.startDate)}`
          : "时间未知"
      const messageText = item.claimMessage
        ? `<p class="item-note">${escapeHtml(item.claimMessage)}</p>`
        : ""
      const detailKey = `${site}:${item.id || item.title}`
      const traceText =
        Array.isArray(item.claimTrace) && item.claimTrace.length
          ? `<details class="item-trace" data-detail-key="${escapeHtml(detailKey)}"><summary>调试日志（${item.claimTrace.length}步）</summary><pre>${escapeHtml(
            item.claimTrace.join("\n"),
          )}</pre></details>`
          : ""

      return `
        <article class="item">
          <p class="item-title">${escapeHtml(item.title)}</p>
          <div class="item-meta">
            <span class="status ${status}">${escapeHtml(label)}</span>
            <span>${escapeHtml(site)}</span>
            <span>${escapeHtml(timeText)}</span>
          </div>
          ${messageText}
          ${traceText}
        </article>
      `
    })
    .join("")
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function renderDebugList(lines, isRunning) {
  if (!lines.length) {
    elements.debugList.className = "list empty"
    elements.debugList.textContent = isRunning
      ? "任务进行中，正在等待日志..."
      : "暂无日志，请先执行一次“只领 Fab”。"
    return
  }

  elements.debugList.className = "debug-list"
  elements.debugList.innerHTML = `<pre class="debug-pre">${escapeHtml(lines.join("\n"))}</pre>`
}

function captureUiState() {
  const scrollingElement = document.scrollingElement || document.documentElement
  const debugPre = elements.debugList.querySelector(".debug-pre")
  const detailKeys = Array.from(
    document.querySelectorAll(".item-trace[data-detail-key]"),
  )
    .filter((detail) => detail.open)
    .map((detail) => detail.getAttribute("data-detail-key"))
    .filter(Boolean)

  return {
    pageScrollTop: scrollingElement ? scrollingElement.scrollTop : 0,
    detailKeys,
    debugScrollTop: debugPre ? debugPre.scrollTop : 0,
    debugWasNearBottom: debugPre
      ? debugPre.scrollHeight - debugPre.scrollTop - debugPre.clientHeight < 24
      : true,
  }
}

function restoreUiState(uiState) {
  const scrollingElement = document.scrollingElement || document.documentElement
  if (scrollingElement && uiState) {
    scrollingElement.scrollTop = uiState.pageScrollTop
  }

  for (const key of (uiState && uiState.detailKeys) || []) {
    const detail = document.querySelector(
      `.item-trace[data-detail-key="${cssEscape(key)}"]`,
    )
    if (detail) {
      detail.open = true
    }
  }

  const debugPre = elements.debugList.querySelector(".debug-pre")
  if (debugPre) {
    if (uiState && uiState.debugWasNearBottom) {
      debugPre.scrollTop = debugPre.scrollHeight
    } else if (uiState) {
      debugPre.scrollTop = uiState.debugScrollTop
    }
  }
}

function cssEscape(value) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value)
  }

  return String(value || "").replaceAll('"', '\\"')
}
