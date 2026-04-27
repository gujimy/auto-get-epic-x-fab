/* global chrome, EpicFabCommon */

const { DEFAULT_SETTINGS } = EpicFabCommon

const form = {
  autoCheck: document.getElementById("autoCheck"),
  autoClaimEpic: document.getElementById("autoClaimEpic"),
  autoClaimFab: document.getElementById("autoClaimFab"),
  desktopNotifications: document.getElementById("desktopNotifications"),
  closeFinishedTabs: document.getElementById("closeFinishedTabs"),
  country: document.getElementById("country"),
  locale: document.getElementById("locale"),
  saveButton: document.getElementById("saveButton"),
  statusText: document.getElementById("statusText"),
}

form.saveButton.addEventListener("click", async () => {
  const payload = {
    autoCheck: form.autoCheck.checked,
    autoClaimEpic: form.autoClaimEpic.checked,
    autoClaimFab: form.autoClaimFab.checked,
    desktopNotifications: form.desktopNotifications.checked,
    closeFinishedTabs: form.closeFinishedTabs.checked,
    country: String(form.country.value || "US").toUpperCase(),
    locale: form.locale.value || "zh-CN",
  }

  const response = await chrome.runtime.sendMessage({
    type: "save-settings",
    settings: payload,
  })

  if (!response || !response.ok) {
    form.statusText.textContent = "保存失败"
    return
  }

  form.statusText.textContent = "已保存"
})

void load()

async function load() {
  const response = await chrome.runtime.sendMessage({
    type: "get-settings",
  })

  const settings =
    (response && response.ok && response.result) || DEFAULT_SETTINGS

  form.autoCheck.checked = Boolean(settings.autoCheck)
  form.autoClaimEpic.checked = Boolean(settings.autoClaimEpic)
  form.autoClaimFab.checked = Boolean(settings.autoClaimFab)
  form.desktopNotifications.checked = Boolean(settings.desktopNotifications)
  form.closeFinishedTabs.checked = Boolean(settings.closeFinishedTabs)
  form.country.value = settings.country
  form.locale.value = settings.locale
  form.statusText.textContent = "已加载当前设置"
}
