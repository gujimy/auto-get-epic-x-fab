/* global chrome, EpicFabCommon */

const {
  RESULT_LABELS,
  extractEpicPageState,
  extractFabPageState,
  formatResultLabel,
  isCloudflareChallengePage,
  isEpicLoginPage,
  isSafeZeroPriceContext,
  normalizeText,
  parseEpicProductEndDate,
  parseFabListingsFromDocument,
} = EpicFabCommon

const BUTTON_TEXT = {
  epicGet: ["获取", "GET"],
  epicCheckout: ["去结算", "前往结算", "CHECKOUT", "PROCEED TO CHECKOUT"],
  epicOrder: [
    "确认订单",
    "CONFIRM ORDER",
    "完成订单",
    "COMPLETE ORDER",
    "提交订单",
    "PLACE ORDER",
    "确认购买",
    "ORDER NOW",
    "下单",
    "ACCEPT",
    "接受",
    "同意",
    "继续",
  ],
  epicOwned: ["已在库中", "在库中", "已拥有", "IN LIBRARY", "OWNED"],
  fabBuyNow: ["立即购买", "BUY NOW"],
  fabAddToCart: ["添加至购物车", "ADD TO CART"],
  fabCheckout: [
    "去结算",
    "前往结算",
    "PROCEED TO CHECKOUT",
    "GO TO CHECKOUT",
    "CHECKOUT",
    "查看购物车",
    "VIEW CART",
    "购物车",
  ],
  fabOrder: [
    "确认订单",
    "CONFIRM ORDER",
    "完成订单",
    "COMPLETE ORDER",
    "提交订单",
    "PLACE ORDER",
    "确认购买",
    "完成购买",
    "COMPLETE PURCHASE",
    "下单",
  ],
  fabOwned: ["在库中", "查看库", "我的库", "IN LIBRARY", "VIEW IN LIBRARY", "下载", "DOWNLOAD"],
}

const SUCCESS_PATTERNS = [
  "ORDER CONFIRMED",
  "ORDER COMPLETE",
  "THANK YOU FOR YOUR ORDER",
  "THANKS FOR YOUR ORDER",
  "购买成功",
  "订单已完成",
  "订单确认",
  "确认成功",
  "感谢您的购买",
  "谢谢您的购买",
  "领取成功",
]

const EPIC_CHECKOUT_SELECTORS = {
  confirmContainer: [
    ".payment-confirm-container",
    ".payment-order-confirm",
    ".payment-order-confirm__btn",
  ],
  confirmButton: [
    "button.payment-order-confirm__btn",
    ".payment-order-confirm button.payment-btn--primary",
    ".payment-confirm-container button.payment-btn--primary",
    "button.payment-btn--primary",
  ],
}

const EPIC_PURCHASE_SELECTORS = {
  ctaButton: 'button[data-testid="purchase-cta-button"]',
}

const HOSTED_PAYMENT_SELECTORS = {
  confirmContainer: [
    ".payment-confirm-container",
    ".payment-order-confirm",
    ".payment-order-confirm__btn",
    "#purchase-app .payment-confirm-container",
  ],
  confirmButton: [
    "button.payment-order-confirm__btn",
    ".payment-order-confirm button.payment-btn--primary",
    ".payment-confirm-container button.payment-btn--primary",
    "#purchase-app .payment-order-confirm__btn",
    "#purchase-app button.payment-btn--primary",
  ],
}

const FAB_SUCCESS_SELECTORS = {
  heading: [
    "SAVED IN MY LIBRARY",
    "已保存到我的库",
  ],
  followUp: [
    "VIEW IN MY LIBRARY",
    "VIEW IN LAUNCHER",
    "查看我的库",
    "在启动器中查看",
  ],
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse(result))
    .catch((error) =>
      sendResponse({
        status: "error",
        label: RESULT_LABELS.error,
        message: error && error.message ? error.message : String(error),
        url: location.href,
      }),
    )

  return true
})

async function handleMessage(message) {
  switch (message && message.type) {
    case "scan-fab-listings":
      if (isCloudflareChallengePage(document)) {
        return {
          status: "challenge-required",
          label: RESULT_LABELS["challenge-required"],
          message: "Fab 当前出现 Cloudflare 验证",
          url: location.href,
          items: [],
          keepTabOpen: true,
        }
      }

      return {
        status: "ok",
        items: parseFabListingsFromDocument(document),
      }
    case "automation-step":
      return await handleAutomationStep(message)
    default:
      return {
        status: "unknown",
        label: RESULT_LABELS.unknown,
        message: "未知消息类型",
        url: location.href,
      }
  }
}

async function handleAutomationStep(message) {
  const step = Number.isFinite(Number(message && message.step))
    ? Number(message.step)
    : -1
  const debugBefore = collectAutomationDebug(message && message.site, step)

  let response
  if (message.site === "epic") {
    response = await handleEpicStep(message)
  } else if (message.site === "fab") {
    response = await handleFabStep(message)
  } else {
    response = {
      status: "needs-manual",
      label: RESULT_LABELS["needs-manual"],
      message: "不支持的站点",
      url: location.href,
    }
  }

  return {
    ...response,
    debug: {
      step,
      before: debugBefore,
      after: collectAutomationDebug(message && message.site, step),
    },
  }
}

async function handleEpicStep({ mode }) {
  const pageEndDate = parseEpicProductEndDate(document)

  if (isCloudflareChallengePage(document)) {
    return result(
      "challenge-required",
      "Epic 当前出现 Cloudflare 验证，请手动完成后重试",
      0,
      { keepTabOpen: true, pageEndDate },
    )
  }

  if (hasSuccessState()) {
    return result("claimed", "检测到 Epic 订单已完成", 0, { pageEndDate })
  }

  if (isEpicLoginPage(location.href)) {
    return result("login-required", "需要先登录 Epic 账号", 0, {
      keepTabOpen: true,
      pageEndDate,
    })
  }

  const epicPurchaseButton = getEpicPurchaseCtaButton()
  if (isEpicOwnedPurchaseButton(epicPurchaseButton)) {
    return result("already-owned", "检测到 Epic 按钮已显示已在库中", 0, {
      pageEndDate,
    })
  }

  const state = extractEpicPageState(document)
  if (state === "already-owned") {
    return result("already-owned", "检测到该游戏已在库中", 0, { pageEndDate })
  }

  if (mode === "inspect" && state === "claimable") {
    return result("claimable", "检测到当前可领取", 0, { pageEndDate })
  }

  if (hasVisibleMatch(BUTTON_TEXT.epicOwned)) {
    return result("already-owned", "检测到按钮已显示在库中", 0, {
      pageEndDate,
    })
  }

  if (mode === "claim" && clickEpicGetButton(epicPurchaseButton)) {
    return result("navigating", "已点击 Epic 获取按钮", 1400, { pageEndDate })
  }

  if (mode === "claim" && clickFirstButton(BUTTON_TEXT.epicGet)) {
    return result("navigating", "已点击 Epic 获取按钮", 1400, { pageEndDate })
  }

  if (mode === "claim") {
    if (isHostedPaymentLoadingState()) {
      return result(
        "navigating",
        "Epic 订单页仍在加载，等待下订单按钮出现",
        1500,
        { pageEndDate },
      )
    }

    if (isHostedPaymentCheckoutPage() && !shouldAttemptOrderSubmission()) {
      return result(
        "needs-manual",
        "已进入 Epic 结算页，但未确认零价订单，停止自动提交",
        0,
        { pageEndDate },
      )
    }

    if (shouldAttemptEpicOrderSubmission()) {
      ensureAllCheckboxesChecked()

      if (await clickHostedPaymentConfirmButton()) {
        return result("navigating", "已点击 Epic 托管结算页 Place Order 按钮", 1800, {
          pageEndDate,
        })
      }

      if (clickFirstButton(BUTTON_TEXT.epicCheckout)) {
        return result("navigating", "已点击 Epic 去结算按钮", 1600, { pageEndDate })
      }

      if (clickFirstKnownSelector(EPIC_CHECKOUT_SELECTORS.confirmButton)) {
        return result("navigating", "已点击 Epic Place Order 按钮", 1800, {
          pageEndDate,
        })
      }

      if (clickFirstButton(BUTTON_TEXT.epicOrder)) {
        return result("navigating", "已点击 Epic 确认订单按钮", 1800, { pageEndDate })
      }

      if (isHostedPaymentCheckoutPage()) {
        return result(
          "navigating",
          "已进入 Epic 托管结算页，等待 Place Order 按钮可点击",
          1200,
          { pageEndDate },
        )
      }
    }

    if (hasEpicActivePurchaseFlow()) {
      return result(
        "navigating",
        "Epic 购买流程进行中，等待订单完成",
        1500,
        { pageEndDate },
      )
    }
  }

  if (state === "claimable") {
    return result("claimable", "页面可领取，但未进入自动提交阶段", 0, {
      pageEndDate,
    })
  }

  return result("needs-manual", "未识别到 Epic 可自动操作按钮", 0, {
    pageEndDate,
  })
}

async function handleFabStep({ mode }) {
  if (isCloudflareChallengePage(document)) {
    return result(
      "challenge-required",
      "Fab 当前出现 Cloudflare 验证，请手动完成后重试",
      0,
      { keepTabOpen: true },
    )
  }

  if (hasFabSuccessState()) {
    return result("claimed", "检测到 Fab 资产已成功保存到 My Library")
  }

  if (hasSuccessState()) {
    return result("claimed", "检测到 Fab 订单已完成")
  }

  if (isEpicLoginPage(location.href)) {
    return result("login-required", "需要先完成 Epic/Fab 登录授权", 0, {
      keepTabOpen: true,
    })
  }

  const state = extractFabPageState(document)
  if (state === "already-owned") {
    return result("already-owned", "检测到 Fab 资产已在库中")
  }

  if (mode === "inspect" && state === "claimable") {
    return result("claimable", "检测到 Fab 当前可领取")
  }

  if (hasVisibleMatch(BUTTON_TEXT.fabOwned)) {
    return result("already-owned", "检测到 Fab 页面显示已在库中")
  }

  if (mode === "claim") {
    if (isHostedPaymentLoadingState()) {
      return result(
        "navigating",
        "Fab 订单页仍在加载，等待 Place Order 按钮出现",
        1500,
      )
    }

    if (isHostedPaymentCheckoutPage()) {
      if (!shouldAttemptOrderSubmission()) {
        return result(
          "needs-manual",
          "已进入 Fab 结算页，但未确认零价订单，停止自动提交",
        )
      }

      ensureAllCheckboxesChecked()

      if (await clickHostedPaymentConfirmButton()) {
        return result("navigating", "已点击 Fab 托管结算页 Place Order 按钮", 1800)
      }

      return result(
        "navigating",
        "已进入 Fab 托管结算页，等待 Place Order 按钮可点击",
        1200,
      )
    }

    if (clickFirstButton(BUTTON_TEXT.fabBuyNow)) {
      return result("navigating", "已点击 Fab 立即购买按钮", 1600)
    }

    if (clickFirstButton(BUTTON_TEXT.fabAddToCart)) {
      return result("navigating", "已点击 Fab 加入购物车按钮", 1600)
    }

    if (shouldAttemptOrderSubmission()) {
      ensureAllCheckboxesChecked()

      if (clickFirstButton(BUTTON_TEXT.fabCheckout)) {
        return result("navigating", "已点击 Fab 去结算按钮", 1600)
      }

      if (clickFirstButton(BUTTON_TEXT.fabOrder)) {
        return result("navigating", "已点击 Fab 确认订单按钮", 1800)
      }
    }

    if (hasFabActivePurchaseFlow()) {
      return result(
        "navigating",
        "Fab 购买流程进行中，等待订单完成",
        1500,
      )
    }
  }

  if (state === "claimable") {
    return result("claimable", "Fab 页面可领取，但需要进一步确认")
  }

  return result("needs-manual", "未识别到 Fab 可自动操作按钮")
}

function clickFirstButton(candidates) {
  const button = findFirstClickableButton(candidates)
  if (!button) {
    return false
  }

  return clickElementRobust(button)
}

function clickFirstKnownSelector(selectors) {
  const element = findFirstKnownSelector(selectors)
  if (!element) {
    return false
  }

  return clickElementRobust(element)
}

async function clickHostedPaymentConfirmButton() {
  if (clickFirstKnownSelector(HOSTED_PAYMENT_SELECTORS.confirmButton)) {
    return true
  }

  const delayedButton = await waitForActionableSelector(
    HOSTED_PAYMENT_SELECTORS.confirmButton,
    8000,
    250,
  )

  if (!delayedButton) {
    return false
  }

  return clickElementRobust(delayedButton)
}

function clickEpicGetButton(epicPurchaseButton) {
  if (!isElementActionable(epicPurchaseButton)) {
    return false
  }

  const text = getButtonText(epicPurchaseButton)
  if (!textMatchesCandidates(text, BUTTON_TEXT.epicGet)) {
    return false
  }

  return clickElementRobust(epicPurchaseButton)
}

function hasVisibleMatch(candidates) {
  return Boolean(findFirstClickableButton(candidates))
}

function getEpicPurchaseCtaButton() {
  return document.querySelector(EPIC_PURCHASE_SELECTORS.ctaButton)
}

function isEpicOwnedPurchaseButton(button) {
  if (!button || !button.disabled) {
    return false
  }

  const text = getButtonText(button)
  return textMatchesCandidates(text, BUTTON_TEXT.epicOwned)
}

function textMatchesCandidates(text, candidates) {
  const normalizedText = normalizeText(text).toUpperCase()
  if (!normalizedText) {
    return false
  }

  return (candidates || []).some((candidate) => {
    const normalizedCandidate = normalizeText(candidate).toUpperCase()
    return normalizedCandidate
      ? normalizedText === normalizedCandidate || normalizedText.includes(normalizedCandidate)
      : false
  })
}

function findFirstKnownSelector(selectors) {
  for (const selector of selectors || []) {
    const element = document.querySelector(selector)
    if (isElementActionable(element)) {
      return element
    }
  }

  return null
}

function findFirstClickableButton(candidates) {
  const buttons = Array.from(
    document.querySelectorAll(
      'button, a, input[type="submit"], input[type="button"]',
    ),
  )
  const matches = []

  for (const button of buttons) {
    const text = getButtonText(button)

    if (!text) {
      continue
    }

    if (!isElementActionable(button)) {
      continue
    }

    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = normalizeText(candidates[index]).toUpperCase()
      if (!candidate) {
        continue
      }

      if (text === candidate || text.includes(candidate)) {
        matches.push({
          button,
          index,
          exact: text === candidate ? 1 : 0,
          length: text.length,
        })
        break
      }
    }
  }

  matches.sort((left, right) => {
    if (right.exact !== left.exact) {
      return right.exact - left.exact
    }

    if (left.index !== right.index) {
      return left.index - right.index
    }

    return left.length - right.length
  })

  return matches[0] ? matches[0].button : null
}

function ensureAllCheckboxesChecked() {
  const checkboxes = Array.from(
    document.querySelectorAll('input[type="checkbox"]'),
  )

  for (const checkbox of checkboxes) {
    if (!checkbox.checked) {
      checkbox.click()
    }
  }
}

function getButtonText(button) {
  return normalizeText(
    button.innerText ||
      button.textContent ||
      button.value ||
      button.getAttribute("aria-label"),
  ).toUpperCase()
}

function isElementActionable(element) {
  if (!element) {
    return false
  }

  if (element.disabled) {
    return false
  }

  if (element.getAttribute && element.getAttribute("aria-disabled") === "true") {
    return false
  }

  const style =
    typeof window !== "undefined" && typeof window.getComputedStyle === "function"
      ? window.getComputedStyle(element)
      : null

  if (
    style &&
    (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.pointerEvents === "none"
    )
  ) {
    return false
  }

  const rects = typeof element.getClientRects === "function"
    ? element.getClientRects()
    : null
  const hasBox =
    Boolean(rects && rects.length) ||
    element.offsetWidth > 0 ||
    element.offsetHeight > 0

  return hasBox
}

function clickElementRobust(element) {
  if (!isElementActionable(element)) {
    return false
  }

  if (typeof element.scrollIntoView === "function") {
    element.scrollIntoView({
      block: "center",
      inline: "center",
      behavior: "auto",
    })
  }

  if (typeof element.focus === "function") {
    element.focus({
      preventScroll: true,
    })
  }

  dispatchPointerSequence(element)
  element.click()
  return true
}

function hasSuccessState() {
  const text = normalizeText(document.body && document.body.innerText).toUpperCase()
  return SUCCESS_PATTERNS.some((pattern) =>
    text.includes(normalizeText(pattern).toUpperCase()),
  )
}

function hasFabSuccessState() {
  const headingNode = findNodeByText(FAB_SUCCESS_SELECTORS.heading, "h1, h2, h3")
  if (headingNode) {
    const successContainer =
      headingNode.closest(".fabkit-Surface-root, .fabkit-Stack-root, section, article, div") ||
      headingNode.parentElement
    const containerText = normalizeText(successContainer && successContainer.textContent).toUpperCase()
    const hasSuccessIcon = Boolean(
      successContainer &&
        successContainer.querySelector(
          ".edsicon-check-circle, .edsicon-check-circle-filled",
        ),
    )
    const hasFollowUpAction = FAB_SUCCESS_SELECTORS.followUp.some((pattern) =>
      containerText.includes(normalizeText(pattern).toUpperCase()),
    )

    if (hasSuccessIcon || hasFollowUpAction) {
      return true
    }
  }

  return false
}

function shouldAttemptOrderSubmission() {
  return isSafeZeroPriceContext(document)
}

function shouldAttemptEpicOrderSubmission() {
  return shouldAttemptOrderSubmission()
}

function isHostedPaymentCheckoutPage() {
  if (findFirstKnownSelector(HOSTED_PAYMENT_SELECTORS.confirmContainer)) {
    return true
  }

  const text = normalizeText(document.body && document.body.innerText)
  return /REVIEW AND PLACE ORDER|ORDER SUMMARY|PLACE ORDER|CHECKOUT/iu.test(text)
}

function isHostedPaymentLoadingState() {
  if (
    document.querySelector("#purchaseAppContainer") ||
    document.querySelector("#purchase-app")
  ) {
    const text = normalizeText(document.body && document.body.innerText)
    if (/LOADING YOUR ORDER|加载.*订单|正在加载/iu.test(text)) {
      return true
    }

    const loadingContainer = document.querySelector("#loadingContainer")
    if (
      loadingContainer &&
      loadingContainer.style &&
      loadingContainer.style.display !== "none"
    ) {
      return true
    }
  }

  return false
}

function hasFabActivePurchaseFlow() {
  if (
    /[?&]purchaseToken=/iu.test(location.href) ||
    /[?&]quickBuyOfferId=/iu.test(location.href) ||
    /\/payment\/web\/purchase/iu.test(location.href)
  ) {
    return true
  }

  if (
    document.querySelector('iframe[src*="/payment/web/purchase"]') ||
    document.querySelector("#purchase-app") ||
    document.querySelector("#purchaseAppContainer") ||
    document.querySelector(".payment-confirm-container") ||
    document.querySelector(".payment-order-confirm")
  ) {
    return true
  }

  return false
}

function hasEpicActivePurchaseFlow() {
  if (
    /\/purchase(?:\/|$|\?)/iu.test(location.href) ||
    /[?&]offers=/iu.test(location.href) ||
    /[?&]showNavigation=true/iu.test(location.href)
  ) {
    return true
  }

  if (
    document.querySelector("#purchase-app") ||
    document.querySelector("#purchaseAppContainer") ||
    document.querySelector(".payment-confirm-container") ||
    document.querySelector(".payment-order-confirm") ||
    document.querySelector('iframe[src*="/purchase"]')
  ) {
    return true
  }

  return false
}

function result(status, message, delayMs, extra) {
  return {
    status,
    label: formatResultLabel(status),
    message,
    delayMs: delayMs || 0,
    url: location.href,
    ...(extra || {}),
  }
}

function findNodeByText(patterns, selector) {
  const nodes = Array.from(document.querySelectorAll(selector || "*"))
  for (const node of nodes) {
    const text = normalizeText(node.textContent).toUpperCase()
    if (!text) {
      continue
    }

    const matched = (patterns || []).some((pattern) =>
      text.includes(normalizeText(pattern).toUpperCase()),
    )

    if (matched) {
      return node
    }
  }

  return null
}

async function waitForActionableSelector(selectors, timeoutMs, intervalMs) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const element = findFirstKnownSelector(selectors)
    if (element) {
      return element
    }

    await sleep(intervalMs)
  }

  return null
}

function dispatchPointerSequence(element) {
  const rect = typeof element.getBoundingClientRect === "function"
    ? element.getBoundingClientRect()
    : { left: 0, top: 0, width: 0, height: 0 }
  const clientX = rect.left + Math.max(1, rect.width / 2)
  const clientY = rect.top + Math.max(1, rect.height / 2)

  for (const eventName of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
    element.dispatchEvent(
      new MouseEvent(eventName, {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX,
        clientY,
      }),
    )
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function collectAutomationDebug(site, step) {
  const pageText = normalizeText(document.body && document.body.innerText)
  return {
    site: site || "unknown",
    step,
    url: location.href,
    title: normalizeText(document.title),
    loading: isHostedPaymentLoadingState(),
    checkout: isHostedPaymentCheckoutPage(),
    hasFabSuccess: site === "fab" ? hasFabSuccessState() : false,
    hasGenericSuccess: hasSuccessState(),
    hostedConfirmButton: getButtonSnapshotBySelectors(HOSTED_PAYMENT_SELECTORS.confirmButton),
    epicCtaButton: getButtonSnapshotBySelectors([EPIC_PURCHASE_SELECTORS.ctaButton]),
    matchedFabOrderButtons: listMatchedButtons(BUTTON_TEXT.fabOrder),
    matchedEpicOrderButtons: listMatchedButtons(BUTTON_TEXT.epicOrder),
    pageTextHint: normalizeText(pageText).slice(0, 200),
  }
}

function getButtonSnapshotBySelectors(selectors) {
  for (const selector of selectors || []) {
    const element = document.querySelector(selector)
    if (!element) {
      continue
    }

    return {
      selector,
      text: getButtonText(element),
      disabled: Boolean(element.disabled),
      ariaDisabled: element.getAttribute
        ? element.getAttribute("aria-disabled")
        : null,
      actionable: isElementActionable(element),
    }
  }

  return null
}

function listMatchedButtons(candidates) {
  const nodes = Array.from(
    document.querySelectorAll('button, a, input[type="submit"], input[type="button"]'),
  )
  const matched = []

  for (const node of nodes) {
    const text = getButtonText(node)
    if (!text || !textMatchesCandidates(text, candidates)) {
      continue
    }

    matched.push({
      text,
      disabled: Boolean(node.disabled),
      ariaDisabled: node.getAttribute ? node.getAttribute("aria-disabled") : null,
      actionable: isElementActionable(node),
    })

    if (matched.length >= 3) {
      break
    }
  }

  return matched
}
