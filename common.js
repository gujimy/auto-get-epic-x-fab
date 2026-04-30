(function universal(root, factory) {
  const exported = factory()

  if (typeof module === "object" && module.exports) {
    module.exports = exported
  }

  root.EpicFabCommon = exported
})(typeof globalThis !== "undefined" ? globalThis : this, function factory() {
  const DEFAULT_SETTINGS = {
    autoCheck: true,
    autoClaimEpic: true,
    autoClaimFab: true,
    locale: "zh-CN",
    country: "US",
    desktopNotifications: true,
    closeFinishedTabs: true,
  }

  const STORAGE_KEYS = {
    settings: "settings",
    state: "state",
  }

  const SITE_LABELS = {
    epic: "Epic",
    fab: "Fab",
  }

  const RESULT_LABELS = {
    claimed: "已领取",
    "already-owned": "已在库中",
    claimable: "可领取",
    upcoming: "即将开始",
    "challenge-required": "需要 Cloudflare 验证",
    "login-required": "需要登录",
    "needs-manual": "需要人工确认",
    error: "失败",
    unknown: "未知",
  }

  const EPIC_PRODUCT_PATH_PREFIX = "https://store.epicgames.com"
  const FAB_LISTING_PATH_PREFIX = "https://www.fab.com"

  const EPIC_OWNED_PATTERNS = [
    "已在库中",
    "在库中",
    "已拥有",
    "已领取",
    "IN LIBRARY",
    "OWNED",
  ]

  const FAB_OWNED_PATTERNS = [
    "在库中",
    "我的库",
    "查看库",
    "SAVED IN MY LIBRARY",
    "VIEW IN MY LIBRARY",
    "已保存到我的库",
    "IN LIBRARY",
    "VIEW IN LIBRARY",
    "DOWNLOAD",
    "下载",
  ]

  const CHECKOUT_ZERO_PATTERNS = [
    /免费/iu,
    /\bFREE\b/iu,
    /-100%/u,
    /\$0(?:\.00)?/u,
    /US\$0(?:\.00)?/u,
    /\b0(?:\.00)?\b/u,
  ]

  const CHECKOUT_RISK_PATTERNS = [
    /信用卡/iu,
    /借记卡/iu,
    /卡号/iu,
    /PAYPAL/iu,
    /BILLING/iu,
    /PAYMENT METHOD/iu,
    /付款方式/iu,
    /支付方式/iu,
  ]

  const CLOUDFLARE_PATTERNS = [
    /cloudflare/iu,
    /turnstile/iu,
    /one more step/iu,
    /enable javascript and cookies to continue/iu,
    /请完成安全检查以继续/iu,
    /再进行一步操作/iu,
    /security check to continue/iu,
  ]

  const MONTH_INDEX = {
    january: 0,
    february: 1,
    march: 2,
    april: 3,
    may: 4,
    june: 5,
    july: 6,
    august: 7,
    september: 8,
    october: 9,
    november: 10,
    december: 11,
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value))
  }

  function mergeSettings(overrides) {
    const merged = { ...DEFAULT_SETTINGS }
    const source = overrides || {}

    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        merged[key] = source[key]
      }
    }

    return merged
  }

  function nowIso() {
    return new Date().toISOString()
  }

  function normalizeText(value) {
    return String(value || "")
      .replace(/\s+/gu, " ")
      .trim()
  }

  function normalizeUpper(value) {
    return normalizeText(value).toUpperCase()
  }

  function createIdFromUrl(url) {
    const match = String(url || "").match(
      /(?:\/p\/|\/listings\/)([^/?#]+)/u,
    )
    return match ? match[1] : String(url || "")
  }

  function dedupeBy(items, getKey) {
    const seen = new Set()
    return (items || []).filter((item) => {
      const key = getKey(item)
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
  }

  function safeArray(value) {
    return Array.isArray(value) ? value : []
  }

  function pickPageSlug(offer) {
    const mappings = [
      ...safeArray(offer && offer.catalogNs && offer.catalogNs.mappings),
      ...safeArray(offer && offer.offerMappings),
    ]

    const mapping =
      mappings.find((item) => item && item.pageSlug) ||
      (offer && offer.urlSlug
        ? { pageSlug: offer.urlSlug, pageType: "productHome" }
        : null)

    return mapping ? mapping.pageSlug : null
  }

  function buildEpicOfferUrl(offer, locale) {
    const pageSlug = pickPageSlug(offer)
    if (!pageSlug) {
      return null
    }

    return `${EPIC_PRODUCT_PATH_PREFIX}/${locale || "zh-CN"}/p/${pageSlug}`
  }

  function buildFabListingUrl(pathname) {
    if (!pathname) {
      return null
    }

    return pathname.startsWith("http")
      ? pathname
      : `${FAB_LISTING_PATH_PREFIX}${pathname}`
  }

  function normalizeAssetUrl(value, baseUrl) {
    const url = String(value || "").trim()
    if (!url) {
      return null
    }

    try {
      const parsedUrl = new URL(url, baseUrl || FAB_LISTING_PATH_PREFIX)
      return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:"
        ? parsedUrl.href
        : null
    } catch (_error) {
      return null
    }
  }

  function pickFirstSrcFromSrcset(value) {
    const entries = String(value || "")
      .split(",")
      .map((item) => item.trim().split(/\s+/u)[0])
      .filter(Boolean)

    return entries[entries.length - 1] || null
  }

  function getNodeAttribute(node, name) {
    if (!node || typeof node.getAttribute !== "function") {
      return null
    }

    return node.getAttribute(name)
  }

  function queryAllSafe(node, selector) {
    if (!node || typeof node.querySelectorAll !== "function") {
      return []
    }

    return Array.from(node.querySelectorAll(selector))
  }

  function queryOneSafe(node, selector) {
    if (!node || typeof node.querySelector !== "function") {
      return null
    }

    return node.querySelector(selector)
  }

  function closestSafe(node, selector) {
    if (!node || typeof node.closest !== "function") {
      return null
    }

    return node.closest(selector)
  }

  function hasImageCandidate(node) {
    return Boolean(
      queryOneSafe(
        node,
        'img, source[srcset], [data-image], [data-src], [style*="background"]',
      ),
    )
  }

  function findNearestAncestorWithImage(node, maxDepth) {
    let current = node

    for (let depth = 0; current && depth < maxDepth; depth += 1) {
      if (hasImageCandidate(current)) {
        return current
      }

      current = current.parentElement || null
    }

    return null
  }

  function findFabCardRoot(anchor, root) {
    const preferredSelectors = [
      '[class*="nTa5u2sc"]',
      "article",
      "li",
      '[data-testid*="product"]',
      '[data-testid*="listing"]',
      '[class*="ProductCard"]',
      '[class*="ListingCard"]',
    ]

    for (const selector of preferredSelectors) {
      const candidate = closestSafe(anchor, selector)
      if (candidate && hasImageCandidate(candidate)) {
        return candidate
      }
    }

    const imageAncestor = findNearestAncestorWithImage(anchor, 8)
    if (imageAncestor) {
      return imageAncestor
    }

    return (
      closestSafe(anchor, ".fabkit-Surface-root") ||
      closestSafe(anchor, 'article, li, [class*="Uqqr2JU3"], [class*="nTa5u2sc"]') ||
      closestSafe(anchor, "div") ||
      anchor.parentElement ||
      root
    )
  }

  function pickImageFromNode(node, baseUrl) {
    const candidates = []
    const mediaNodes = queryAllSafe(
      node,
      "img, source[srcset], [data-image], [data-src], [style]",
    )

    for (const mediaNode of mediaNodes) {
      candidates.push(
        pickFirstSrcFromSrcset(getNodeAttribute(mediaNode, "srcset")),
        getNodeAttribute(mediaNode, "data-src"),
        getNodeAttribute(mediaNode, "data-image"),
        mediaNode.currentSrc,
        mediaNode.src,
        getNodeAttribute(mediaNode, "src"),
      )

      const inlineStyle =
        (mediaNode.style && mediaNode.style.backgroundImage) ||
        getNodeAttribute(mediaNode, "style")
      const backgroundMatch = String(inlineStyle || "").match(
        /url\(["']?([^"')]+)["']?\)/iu,
      )
      if (backgroundMatch) {
        candidates.push(backgroundMatch[1])
      }
    }

    for (const candidate of candidates) {
      const normalizedUrl = normalizeAssetUrl(candidate, baseUrl)
      if (normalizedUrl) {
        return normalizedUrl
      }
    }

    return null
  }

  function pickFabListingImage(anchor, cardRoot, baseUrl) {
    return (
      pickImageFromNode(anchor, baseUrl) ||
      pickImageFromNode(cardRoot, baseUrl) ||
      null
    )
  }

  function pickEpicOfferImage(offer) {
    const candidates = safeArray(offer && offer.keyImages)
      .filter((item) => item && normalizeAssetUrl(item.url))
      .map((item, index) => ({
        image: item,
        index,
        score: scoreEpicOfferImage(item),
      }))

    const landscapeCandidates = candidates
      .filter((item) => item.score >= 500)
      .sort(compareScoredImages)

    if (landscapeCandidates.length) {
      return landscapeCandidates[0].image.url
    }

    const fallbackCandidates = candidates.sort(compareScoredImages)
    return fallbackCandidates.length ? fallbackCandidates[0].image.url : null
  }

  function compareScoredImages(left, right) {
    if (right.score !== left.score) {
      return right.score - left.score
    }

    return left.index - right.index
  }

  function scoreEpicOfferImage(image) {
    const type = normalizeUpper(image && image.type)
    const dimensions = parseImageDimensionsFromUrl(image && image.url)
    const isLandscape =
      dimensions && dimensions.width > dimensions.height
    const isPortrait =
      dimensions && dimensions.width < dimensions.height

    let score = 0
    if (
      type.includes("WIDE") ||
      type === "FEATUREDMEDIA" ||
      type === "GALLERYIMAGE"
    ) {
      score += 700
    }

    if (type.includes("TALL")) {
      score -= 300
    }

    if (type === "THUMBNAIL") {
      score -= 100
    }

    if (isLandscape) {
      score += 300
    } else if (isPortrait) {
      score -= 500
    }

    return score
  }

  function parseImageDimensionsFromUrl(url) {
    const decodedUrl = decodeURIComponent(String(url || ""))
    const matches = Array.from(
      decodedUrl.matchAll(/(?:^|[^\d])(\d{3,5})x(\d{3,5})(?:[^\d]|$)/giu),
    )

    if (!matches.length) {
      return null
    }

    const match = matches[matches.length - 1]
    return {
      width: Number(match[1]),
      height: Number(match[2]),
    }
  }

  function isCurrentPromotion(offer) {
    const groups = safeArray(
      offer &&
        offer.promotions &&
        offer.promotions.promotionalOffers,
    )
    return groups.some((group) =>
      safeArray(group && group.promotionalOffers).some(
        (item) => item && item.discountSetting && item.discountSetting.discountPercentage === 0,
      ),
    )
  }

  function getCurrentPromotionWindow(offer) {
    const groups = safeArray(
      offer &&
        offer.promotions &&
        offer.promotions.promotionalOffers,
    )

    for (const group of groups) {
      for (const item of safeArray(group && group.promotionalOffers)) {
        if (
          item &&
          item.discountSetting &&
          item.discountSetting.discountPercentage === 0
        ) {
          return item
        }
      }
    }

    return null
  }

  function getUpcomingPromotionWindow(offer) {
    const groups = safeArray(
      offer &&
        offer.promotions &&
        offer.promotions.upcomingPromotionalOffers,
    )

    for (const group of groups) {
      for (const item of safeArray(group && group.promotionalOffers)) {
        if (
          item &&
          item.discountSetting &&
          item.discountSetting.discountPercentage === 0
        ) {
          return item
        }
      }
    }

    return null
  }

  function parseEpicPromotionsResponse(payload, locale) {
    const elements =
      payload &&
      payload.data &&
      payload.data.Catalog &&
      payload.data.Catalog.searchStore &&
      safeArray(payload.data.Catalog.searchStore.elements)

    const normalizedOffers = safeArray(elements)
      .map((offer) => {
        const currentWindow = getCurrentPromotionWindow(offer)
        const upcomingWindow = getUpcomingPromotionWindow(offer)
        const isClaimableNow =
          currentWindow &&
          offer &&
          offer.price &&
          offer.price.totalPrice &&
          offer.price.totalPrice.discountPrice === 0

        return {
          id: offer && offer.id,
          offerType: offer && offer.offerType,
          title: normalizeText(offer && offer.title),
          seller:
            normalizeText(
              offer && offer.seller && offer.seller.name,
            ) || "未知发行商",
          url: buildEpicOfferUrl(offer, locale),
          image: pickEpicOfferImage(offer),
          originalPrice:
            offer &&
            offer.price &&
            offer.price.totalPrice &&
            offer.price.totalPrice.fmtPrice &&
            offer.price.totalPrice.fmtPrice.originalPrice,
          discountPrice:
            offer &&
            offer.price &&
            offer.price.totalPrice &&
            offer.price.totalPrice.fmtPrice &&
            offer.price.totalPrice.fmtPrice.discountPrice,
          startDate:
            (currentWindow && currentWindow.startDate) ||
            (upcomingWindow && upcomingWindow.startDate) ||
            null,
          endDate:
            (currentWindow && currentWindow.endDate) ||
            (upcomingWindow && upcomingWindow.endDate) ||
            null,
          status: isClaimableNow
            ? "claimable"
            : upcomingWindow
              ? "upcoming"
              : "unknown",
          isCurrentFree: Boolean(isClaimableNow),
          isUpcomingFree:
            !isClaimableNow && Boolean(upcomingWindow),
          raw: offer,
        }
      })
      .filter((item) => item.url)

    return {
      current: dedupeBy(
        normalizedOffers.filter((item) => item.isCurrentFree),
        (item) => item.id || item.url,
      ),
      upcoming: dedupeBy(
        normalizedOffers.filter((item) => item.isUpcomingFree),
        (item) => item.id || item.url,
      ),
    }
  }

  function parseFabListingsFromDocument(doc) {
    if (!doc) {
      return []
    }

    const heading = Array.from(
      doc.querySelectorAll("h1, h2, h3"),
    ).find((node) =>
      /限时免费|limited[\s-]?time free/iu.test(
        normalizeText(node.textContent),
      ),
    )

    const root =
      (heading && heading.parentElement) ||
      doc.querySelector("main") ||
      doc.body
    const campaignEndDate = parseFabCampaignEndDate(
      normalizeText(heading && heading.textContent),
    )

    const anchors = Array.from(
      root.querySelectorAll('a[href*="/listings/"]'),
    )

    const baseUrl =
      (doc.location && doc.location.href) || FAB_LISTING_PATH_PREFIX
    const listings = anchors
      .map((anchor) => {
        const title =
          normalizeText(anchor.textContent) ||
          normalizeText(anchor.getAttribute("aria-label")).replace(
            /^.*?创作的/u,
            "",
          )

        const cardRoot = findFabCardRoot(anchor, root)
        const cardText = normalizeText(cardRoot.textContent)

        const href = buildFabListingUrl(anchor.getAttribute("href"))
        const id = createIdFromUrl(href)

        if (!title || !href) {
          return null
        }

        const isOwned = /SAVED IN MY LIBRARY|已保存到我的库|VIEW IN MY LIBRARY|在库中/iu.test(
          cardText,
        )
        const isClaimable =
          !isOwned &&
          /免费|-100%|\bFREE\b|ADD LISTING TO CART|ADD TO CART|添加至购物车/iu.test(
            cardText,
          )

        return {
          id,
          title,
          url: href,
          image: pickFabListingImage(anchor, cardRoot, baseUrl),
          status: isOwned ? "already-owned" : isClaimable ? "claimable" : "unknown",
          endDate: campaignEndDate,
          cardText,
        }
      })
      .filter(Boolean)

    return dedupeBy(listings, (item) => item.id)
  }

  function getDocumentText(doc) {
    if (!doc || !doc.body) {
      return ""
    }

    return normalizeText(doc.body.innerText || doc.body.textContent || "")
  }

  function detectOwnedStatus(text, patterns) {
    const normalized = normalizeUpper(text)
    return patterns.some((pattern) =>
      normalized.includes(normalizeUpper(pattern)),
    )
  }

  function isCloudflareChallengePage(doc) {
    if (!doc) {
      return false
    }

    const text = getDocumentText(doc)
    const html = normalizeUpper(
      doc.documentElement ? doc.documentElement.innerHTML.slice(0, 8000) : "",
    )

    if (
      doc.querySelector('iframe[src*="challenges.cloudflare.com"]') ||
      doc.querySelector('input[name="cf-turnstile-response"]')
    ) {
      return true
    }

    return CLOUDFLARE_PATTERNS.some(
      (pattern) => pattern.test(text) || pattern.test(html),
    )
  }

  function extractEpicPageState(doc) {
    if (isCloudflareChallengePage(doc)) {
      return "challenge-required"
    }

    const text = getDocumentText(doc)
    if (isEpicLoginPage(doc.location.href)) {
      return "login-required"
    }

    if (detectOwnedStatus(text, EPIC_OWNED_PATTERNS)) {
      return "already-owned"
    }

    if (/\bGET\b|获取/iu.test(text)) {
      return "claimable"
    }

    if (/\bPLACE ORDER\b|下单|订单/iu.test(text) && isSafeZeroPriceContext(doc)) {
      return "claimable"
    }

    return "unknown"
  }

  function parseEpicProductEndDate(doc) {
    const text = getDocumentText(doc)
    const match = text.match(
      /优惠截止于\s*(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{2})/u,
    )

    if (!match) {
      return null
    }

    const year = Number(match[1])
    const monthIndex = Number(match[2]) - 1
    const day = Number(match[3])
    const hour = Number(match[4])
    const minute = Number(match[5])

    const candidate = new Date(year, monthIndex, day, hour, minute, 0, 0)
    if (Number.isNaN(candidate.getTime())) {
      return null
    }

    return candidate.toISOString()
  }

  function extractFabPageState(doc) {
    if (isCloudflareChallengePage(doc)) {
      return "challenge-required"
    }

    const text = getDocumentText(doc)
    if (isEpicLoginPage(doc.location.href)) {
      return "login-required"
    }

    if (detectOwnedStatus(text, FAB_OWNED_PATTERNS)) {
      return "already-owned"
    }

    if (
      /\bBUY NOW\b|立即购买|\bADD TO CART\b|添加至购物车|\bCHECKOUT\b|结算|\bPLACE ORDER\b|确认订单|REVIEW AND PLACE ORDER/iu.test(
        text,
      )
    ) {
      return "claimable"
    }

    return "unknown"
  }

  function isEpicLoginPage(url) {
    return /epicgames\.com\/id\/(?:login|authorize)/iu.test(String(url || ""))
  }

  function isSafeZeroPriceContext(doc) {
    const text = getDocumentText(doc)
    const hasZeroSignal = CHECKOUT_ZERO_PATTERNS.some((pattern) =>
      pattern.test(text),
    )
    const hasRiskSignal = CHECKOUT_RISK_PATTERNS.some((pattern) =>
      pattern.test(text),
    )

    return hasZeroSignal && !hasRiskSignal
  }

  function formatResultLabel(status) {
    return RESULT_LABELS[status] || RESULT_LABELS.unknown
  }

  function formatDateTime(value) {
    if (!value) {
      return "未记录"
    }

    try {
      return new Date(value).toLocaleString("zh-CN", {
        hour12: false,
      })
    } catch (_error) {
      return String(value)
    }
  }

  function formatRemainingTime(value, referenceDate) {
    const targetMs = Date.parse(value)
    if (!Number.isFinite(targetMs)) {
      return null
    }

    const referenceMs =
      referenceDate instanceof Date
        ? referenceDate.getTime()
        : Number.isFinite(Number(referenceDate))
          ? Number(referenceDate)
          : Date.now()
    const remainingMs = targetMs - referenceMs

    if (remainingMs <= 0) {
      return "已到时间"
    }

    const totalMinutes = Math.max(1, Math.ceil(remainingMs / 60000))
    const days = Math.floor(totalMinutes / 1440)
    const hours = Math.floor((totalMinutes % 1440) / 60)
    const minutes = totalMinutes % 60

    if (days > 0) {
      return hours > 0 ? `剩余 ${days}天${hours}小时` : `剩余 ${days}天`
    }

    if (hours > 0) {
      return minutes > 0 ? `剩余 ${hours}小时${minutes}分钟` : `剩余 ${hours}小时`
    }

    return `剩余 ${minutes}分钟`
  }

  function computePendingCount(state) {
    const epic = safeArray(state && state.epic && state.epic.current)
    const fab = safeArray(state && state.fab && state.fab.current)
    const all = [...epic, ...fab]

    return all.filter(
      (item) =>
        item &&
        (item.claimResult === "claimable" || item.status === "claimable"),
    ).length
  }

  function summarizeState(state) {
    const epicCurrent = safeArray(state && state.epic && state.epic.current)
    const fabCurrent = safeArray(state && state.fab && state.fab.current)

    return {
      pendingCount: computePendingCount(state),
      epicCurrentCount: epicCurrent.length,
      fabCurrentCount: fabCurrent.length,
      lastCheckAt: state && state.lastCheckAt,
    }
  }

  function serializeError(error) {
    if (!error) {
      return "未知错误"
    }

    if (typeof error === "string") {
      return error
    }

    if (error instanceof Error) {
      return error.message || error.name || "未知错误"
    }

    try {
      return JSON.stringify(error)
    } catch (_jsonError) {
      return String(error)
    }
  }

  function parseFabCampaignEndDate(text, referenceDate) {
    const normalizedText = normalizeText(text)
    const match = normalizedText.match(
      /UNTIL\s+([A-Z]+)\s+(\d{1,2})\s+AT\s+(\d{1,2}):(\d{2})\s*(AM|PM)\s*ET/iu,
    )

    const now = referenceDate instanceof Date ? referenceDate : new Date()
    const currentYear = now.getUTCFullYear()

    if (match) {
      const monthIndex = MONTH_INDEX[String(match[1] || "").toLowerCase()]
      if (!Number.isInteger(monthIndex)) {
        return null
      }

      const day = Number(match[2])
      const minute = Number(match[4])
      let hour = Number(match[3]) % 12
      if (String(match[5]).toUpperCase() === "PM") {
        hour += 12
      }

      return pickFabDeadlineYear({
        buildDate: (year) => buildEasternDate(year, monthIndex, day, hour, minute),
        currentYear,
        now,
      })
    }

    const beijingMatch = normalizedText.match(
      /截至\s*(?:北京时间)?\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(上午|下午|晚上|中午|凌晨)?\s*(\d{1,2}):(\d{2})/u,
    )

    if (!beijingMatch) {
      return null
    }

    const monthIndex = Number(beijingMatch[1]) - 1
    const day = Number(beijingMatch[2])
    const hour = normalizeChineseHour(
      Number(beijingMatch[4]),
      beijingMatch[3],
    )
    const minute = Number(beijingMatch[5])

    return pickFabDeadlineYear({
      buildDate: (year) => buildZonedDate(
        year,
        monthIndex,
        day,
        hour,
        minute,
        "Asia/Shanghai",
      ),
      currentYear,
      now,
    })
  }

  function normalizeChineseHour(hour, marker) {
    const normalizedMarker = String(marker || "")

    if ((normalizedMarker === "下午" || normalizedMarker === "晚上") && hour < 12) {
      return hour + 12
    }

    if ((normalizedMarker === "上午" || normalizedMarker === "凌晨") && hour === 12) {
      return 0
    }

    if (normalizedMarker === "中午" && hour < 11) {
      return hour + 12
    }

    return hour
  }

  function pickFabDeadlineYear({ buildDate, currentYear, now }) {
    let candidate = buildDate(currentYear)
    if (!candidate) {
      return null
    }

    if (candidate.getTime() + 7 * 24 * 60 * 60 * 1000 < now.getTime()) {
      candidate = buildDate(currentYear + 1)
    }

    return candidate ? candidate.toISOString() : null
  }

  function buildEasternDate(year, monthIndex, day, hour, minute) {
    return buildZonedDate(
      year,
      monthIndex,
      day,
      hour,
      minute,
      "America/New_York",
    )
  }

  function buildZonedDate(year, monthIndex, day, hour, minute, timeZone) {
    const targetLocalMs = Date.UTC(year, monthIndex, day, hour, minute)
    let guess = new Date(Date.UTC(year, monthIndex, day, hour, minute))

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const parts = getZonedDateParts(guess, timeZone)
      if (!parts) {
        return null
      }

      const currentLocalMs = Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
      )
      const delta = targetLocalMs - currentLocalMs
      if (delta === 0) {
        return guess
      }

      guess = new Date(guess.getTime() + delta)
    }

    return guess
  }

  function getZonedDateParts(date, timeZone) {
    try {
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
      const values = {}
      for (const part of formatter.formatToParts(date)) {
        if (part.type !== "literal") {
          values[part.type] = Number(part.value)
        }
      }

      return {
        year: values.year,
        month: values.month,
        day: values.day,
        hour: values.hour,
        minute: values.minute,
      }
    } catch (_error) {
      return null
    }
  }

  return {
    DEFAULT_SETTINGS,
    EPIC_PRODUCT_PATH_PREFIX,
    FAB_LISTING_PATH_PREFIX,
    RESULT_LABELS,
    SITE_LABELS,
    STORAGE_KEYS,
    clone,
    computePendingCount,
    createIdFromUrl,
    dedupeBy,
    extractEpicPageState,
    parseEpicProductEndDate,
    extractFabPageState,
    formatDateTime,
    formatRemainingTime,
    formatResultLabel,
    isCloudflareChallengePage,
    isEpicLoginPage,
    isSafeZeroPriceContext,
    mergeSettings,
    normalizeText,
    nowIso,
    parseFabCampaignEndDate,
    parseEpicPromotionsResponse,
    parseFabListingsFromDocument,
    serializeError,
    summarizeState,
  }
})
