const test = require("node:test")
const assert = require("node:assert/strict")

const common = require("../common.js")

test("mergeSettings merges overrides", () => {
  const settings = common.mergeSettings({
    country: "CN",
    autoClaimFab: false,
    checkIntervalMinutes: 30,
  })

  assert.equal(settings.country, "CN")
  assert.equal(settings.autoClaimFab, false)
  assert.equal(settings.autoClaimEpic, true)
  assert.equal("checkIntervalMinutes" in settings, false)
})

test("parseEpicPromotionsResponse extracts current and upcoming offers", () => {
  const payload = {
    data: {
      Catalog: {
        searchStore: {
          elements: [
            {
              id: "current-offer",
              title: "Current Free Game",
              seller: { name: "Epic" },
              keyImages: [
                {
                  type: "OfferImageTall",
                  url: "https://cdn.epicgames.com/current-tall.jpg",
                },
                {
                  type: "OfferImageWide",
                  url: "https://cdn.epicgames.com/current-wide.jpg",
                },
              ],
              catalogNs: {
                mappings: [{ pageSlug: "current-free-game", pageType: "productHome" }],
              },
              price: {
                totalPrice: {
                  discountPrice: 0,
                  fmtPrice: {
                    originalPrice: "US$9.99",
                    discountPrice: "0",
                  },
                },
              },
              promotions: {
                promotionalOffers: [
                  {
                    promotionalOffers: [
                      {
                        startDate: "2026-04-16T15:00:00.000Z",
                        endDate: "2026-04-23T15:00:00.000Z",
                        discountSetting: {
                          discountPercentage: 0,
                        },
                      },
                    ],
                  },
                ],
                upcomingPromotionalOffers: [],
              },
            },
            {
              id: "upcoming-offer",
              title: "Upcoming Free Game",
              seller: { name: "Epic" },
              keyImages: [
                {
                  type: "Thumbnail",
                  url: "https://cdn.epicgames.com/upcoming-thumbnail.jpg",
                },
              ],
              catalogNs: {
                mappings: [{ pageSlug: "upcoming-free-game", pageType: "productHome" }],
              },
              price: {
                totalPrice: {
                  discountPrice: 999,
                  fmtPrice: {
                    originalPrice: "US$9.99",
                    discountPrice: "US$9.99",
                  },
                },
              },
              promotions: {
                promotionalOffers: [],
                upcomingPromotionalOffers: [
                  {
                    promotionalOffers: [
                      {
                        startDate: "2026-04-23T15:00:00.000Z",
                        endDate: "2026-04-30T15:00:00.000Z",
                        discountSetting: {
                          discountPercentage: 0,
                        },
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      },
    },
  }

  const parsed = common.parseEpicPromotionsResponse(payload, "zh-CN")

  assert.equal(parsed.current.length, 1)
  assert.equal(parsed.current[0].title, "Current Free Game")
  assert.equal(
    parsed.current[0].url,
    "https://store.epicgames.com/zh-CN/p/current-free-game",
  )
  assert.equal(parsed.current[0].image, "https://cdn.epicgames.com/current-wide.jpg")
  assert.equal(parsed.upcoming.length, 1)
  assert.equal(parsed.upcoming[0].title, "Upcoming Free Game")
  assert.equal(
    parsed.upcoming[0].image,
    "https://cdn.epicgames.com/upcoming-thumbnail.jpg",
  )
})

test("parseEpicPromotionsResponse treats past-startDate upcoming window as current", () => {
  const pastStartDate = "2026-01-01T15:00:00.000Z"
  const futureEndDate = "2099-12-31T15:00:00.000Z"

  const payload = {
    data: {
      Catalog: {
        searchStore: {
          elements: [
            {
              id: "expired-upcoming-offer",
              title: "Expired Upcoming Game",
              seller: { name: "Epic" },
              keyImages: [
                {
                  type: "OfferImageWide",
                  url: "https://cdn.epicgames.com/expired-wide.jpg",
                },
              ],
              catalogNs: {
                mappings: [{ pageSlug: "expired-upcoming", pageType: "productHome" }],
              },
              price: {
                totalPrice: {
                  discountPrice: 0,
                  fmtPrice: {
                    originalPrice: "US$19.99",
                    discountPrice: "0",
                  },
                },
              },
              promotions: {
                promotionalOffers: [],
                upcomingPromotionalOffers: [
                  {
                    promotionalOffers: [
                      {
                        startDate: pastStartDate,
                        endDate: futureEndDate,
                        discountSetting: {
                          discountPercentage: 0,
                        },
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      },
    },
  }

  const parsed = common.parseEpicPromotionsResponse(payload, "zh-CN")

  assert.equal(parsed.current.length, 1)
  assert.equal(parsed.current[0].title, "Expired Upcoming Game")
  assert.equal(parsed.current[0].status, "claimable")
  assert.equal(parsed.current[0].isCurrentFree, true)
  assert.equal(parsed.current[0].startDate, pastStartDate)
  assert.equal(parsed.current[0].endDate, futureEndDate)
  assert.equal(parsed.upcoming.length, 0)
})

test("parseEpicPromotionsResponse avoids portrait epic thumbnails when landscape media exists", () => {
  const payload = {
    data: {
      Catalog: {
        searchStore: {
          elements: [
            {
              id: "landscape-fallback-offer",
              title: "Landscape Fallback",
              seller: { name: "Epic" },
              keyImages: [
                {
                  type: "Thumbnail",
                  url: "https://cdn.epicgames.com/game_S2_1200x1600-thumb.jpg",
                },
                {
                  type: "featuredMedia",
                  url: "https://cdn.epicgames.com/game_S1_2560x1440-wide.jpg",
                },
              ],
              catalogNs: {
                mappings: [{ pageSlug: "landscape-fallback", pageType: "productHome" }],
              },
              price: {
                totalPrice: {
                  discountPrice: 0,
                  fmtPrice: {
                    originalPrice: "US$9.99",
                    discountPrice: "0",
                  },
                },
              },
              promotions: {
                promotionalOffers: [
                  {
                    promotionalOffers: [
                      {
                        startDate: "2026-04-16T15:00:00.000Z",
                        endDate: "2026-04-23T15:00:00.000Z",
                        discountSetting: {
                          discountPercentage: 0,
                        },
                      },
                    ],
                  },
                ],
                upcomingPromotionalOffers: [],
              },
            },
          ],
        },
      },
    },
  }

  const parsed = common.parseEpicPromotionsResponse(payload, "zh-CN")

  assert.equal(parsed.current.length, 1)
  assert.equal(
    parsed.current[0].image,
    "https://cdn.epicgames.com/game_S1_2560x1440-wide.jpg",
  )
})

test("isCloudflareChallengePage detects Cloudflare challenge text", () => {
  const fakeDocument = {
    body: {
      innerText: "再进行一步操作 请完成安全检查以继续",
      textContent: "再进行一步操作 请完成安全检查以继续",
    },
    documentElement: {
      innerHTML: "<div>cloudflare turnstile</div>",
    },
    querySelector(selector) {
      if (selector === 'iframe[src*="challenges.cloudflare.com"]') {
        return null
      }

      if (selector === 'input[name="cf-turnstile-response"]') {
        return null
      }

      return null
    },
  }

  assert.equal(common.isCloudflareChallengePage(fakeDocument), true)
})

test("isSafeZeroPriceContext accepts explicit zero discount checkout", () => {
  const fakeDocument = {
    body: {
      innerText: "Order Summary Limited-Time Free -100% You Pay Today US$0.00",
      textContent: "Order Summary Limited-Time Free -100% You Pay Today US$0.00",
    },
  }

  assert.equal(common.isSafeZeroPriceContext(fakeDocument), true)
})

test("isSafeZeroPriceContext rejects checkout pages with actual payment risk", () => {
  const fakeDocument = {
    body: {
      innerText: "Order Summary You Pay Today US$19.99 Payment Method: Visa ****1234",
      textContent: "Order Summary You Pay Today US$19.99 Payment Method: Visa ****1234",
    },
  }

  assert.equal(common.isSafeZeroPriceContext(fakeDocument), false)
})

test("isSafeZeroPriceContext accepts Epic free game checkout with payment method label", () => {
  const fakeDocument = {
    body: {
      innerText: "Order Summary Limited-Time Free -100% You Pay Today US$0.00 Payment Method",
      textContent: "Order Summary Limited-Time Free -100% You Pay Today US$0.00 Payment Method",
    },
  }

  assert.equal(common.isSafeZeroPriceContext(fakeDocument), true)
})

test("isSafeZeroPriceContext accepts Epic add-to-library confirmation modal", () => {
  const text = "《征服之歌》 US$0.00 这是免费内容。添加到库即可开始体验。添加到库"
  const fakeDocument = {
    body: {
      innerText: text,
      textContent: text,
    },
  }

  assert.equal(common.isSafeZeroPriceContext(fakeDocument), true)
})

test("extractFabPageState treats Add to library free page as claimable", () => {
  const fakeDocument = {
    location: { href: "https://www.fab.com/listings/example" },
    body: {
      innerText: "Advanced Grid Inventory System $0.00 This is free. Add it to your library to get started. Add to library",
      textContent: "Advanced Grid Inventory System $0.00 This is free. Add it to your library to get started. Add to library",
    },
    documentElement: { innerHTML: "" },
    querySelector() {
      return null
    },
  }

  assert.equal(common.extractFabPageState(fakeDocument), "claimable")
  assert.equal(common.isSafeZeroPriceContext(fakeDocument), true)
})

test("extractFabPageState prefers Fab purchase actions over generic library text", () => {
  const fakeDocument = {
    location: { href: "https://www.fab.com/listings/16b82fb0-7ea5-4627-adcc-95f23a387b61" },
    body: {
      innerText: "Kaya Products Advanced Grid Inventory System Game Systems License Select a license Personal $59.99 Free* -100% Sale ends 06/16/2026 Buy now Add to cart View in library Download",
      textContent: "Kaya Products Advanced Grid Inventory System Game Systems License Select a license Personal $59.99 Free* -100% Sale ends 06/16/2026 Buy now Add to cart View in library Download",
    },
    documentElement: { innerHTML: "" },
    querySelector() {
      return null
    },
  }

  assert.equal(common.extractFabPageState(fakeDocument), "claimable")
})

test("parseFabListingsFromDocument marks owned item without opening detail page", () => {
  const heading = {
    textContent: "Limited-Time Free (Until May 5 at 9:59 AM ET)",
    parentElement: null,
  }
  const root = {
    querySelectorAll() {
      return [ownedAnchor]
    },
  }

  const cardRoot = {
    textContent: "Bodycam Backroom VHS Effect Saved in My Library",
    querySelectorAll(selector) {
      if (selector.includes("img")) {
        return [imageNode]
      }

      return []
    },
  }

  const imageNode = {
    currentSrc: "",
    src: "",
    getAttribute(name) {
      if (name === "srcset") {
        return "https://cdn.fab.com/small.jpg 1x, https://cdn.fab.com/large.jpg 2x"
      }

      return null
    },
    querySelectorAll() {
      return []
    },
  }

  const ownedAnchor = {
    textContent: "Bodycam Backroom VHS Effect",
    getAttribute(name) {
      if (name === "href") {
        return "/listings/14e5f29e-26eb-4b7c-82c6-e48e43fd1276"
      }

      if (name === "aria-label") {
        return "Bodycam Backroom VHS Effect by Kaizen Digital Interactive"
      }

      return null
    },
    closest(selector) {
      if (
        selector ===
        '.fabkit-Surface-root, article, li, [class*="Uqqr2JU3"], [class*="nTa5u2sc"]'
      ) {
        return cardRoot
      }

      if (selector === "div") {
        return cardRoot
      }

      return null
    },
    parentElement: root,
  }

  const fakeDocument = {
    querySelectorAll(selector) {
      if (selector === "h1, h2, h3") {
        return [heading]
      }

      if (selector === 'a[href*="/listings/"]') {
        return [ownedAnchor]
      }

      return []
    },
    querySelector(selector) {
      if (selector === "main") {
        return root
      }

      return null
    },
    body: root,
    location: {
      href: "https://www.fab.com/limited-time-free",
    },
  }

  const parsed = common.parseFabListingsFromDocument(fakeDocument)

  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].status, "already-owned")
  assert.equal(parsed[0].image, "https://cdn.fab.com/large.jpg")
  assert.ok(parsed[0].endDate)
})

test("parseFabListingsFromDocument climbs to Fab card container for cover image", () => {
  const heading = {
    textContent: "限时免费（截至北京时间2026年5月5日晚上9:59）",
    parentElement: null,
  }
  const imageNode = {
    currentSrc: "https://media.fab.com/product-cover.jpg",
    src: "",
    getAttribute() {
      return null
    },
    querySelectorAll() {
      return []
    },
  }
  const infoRow = createFakeNode({
    className: "fabkit-Surface-root Uqqr2JU3",
    textContent: "Deep Water Station Kyrylo Sibiriakov -100% 免费",
    children: [],
  })
  const productCard = createFakeNode({
    className: "fabkit-Stack-root nTa5u2sc",
    textContent: "Deep Water Station Kyrylo Sibiriakov -100% 免费",
    children: [infoRow, imageNode],
  })
  const anchor = createFakeNode({
    tagName: "A",
    textContent: "Deep Water Station",
    attributes: {
      href: "/listings/ec2385d7-3e02-494b-a243-e18cac7f4a69",
      "aria-label": "Kyrylo Sibiriakov创作的Deep Water Station",
    },
  })
  const root = createFakeNode({
    children: [productCard],
  })

  infoRow.children.push(anchor)
  anchor.parentElement = infoRow
  infoRow.parentElement = productCard
  productCard.parentElement = root

  const fakeDocument = {
    querySelectorAll(selector) {
      if (selector === "h1, h2, h3") {
        return [heading]
      }

      if (selector === 'a[href*="/listings/"]') {
        return [anchor]
      }

      return []
    },
    querySelector(selector) {
      if (selector === "main") {
        return root
      }

      return null
    },
    body: root,
    location: {
      href: "https://www.fab.com/limited-time-free",
    },
  }
  heading.parentElement = root

  const parsed = common.parseFabListingsFromDocument(fakeDocument)

  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].image, "https://media.fab.com/product-cover.jpg")
  assert.equal(parsed[0].endDate, "2026-05-05T13:59:00.000Z")
})

test("formatRemainingTime formats next claim countdown", () => {
  const remaining = common.formatRemainingTime(
    "2026-04-25T09:00:00.000Z",
    new Date("2026-04-24T00:00:00.000Z"),
  )

  assert.equal(remaining, "剩余 1天9小时")
  assert.equal(
    common.formatRemainingTime(
      "2026-04-24T00:30:00.000Z",
      new Date("2026-04-24T00:00:00.000Z"),
    ),
    "剩余 30分钟",
  )
  assert.equal(
    common.formatRemainingTime(
      "2026-04-23T23:59:00.000Z",
      new Date("2026-04-24T00:00:00.000Z"),
    ),
    "已到时间",
  )
})

test("parseFabCampaignEndDate parses campaign deadline from heading", () => {
  const parsed = common.parseFabCampaignEndDate(
    "Limited-Time Free (Until May 5 at 9:59 AM ET)",
    new Date("2026-04-23T00:00:00.000Z"),
  )

  assert.ok(parsed)
  assert.equal(parsed.startsWith("2026-05-05T"), true)
})

test("parseFabCampaignEndDate parses Chinese Beijing deadline", () => {
  const parsed = common.parseFabCampaignEndDate(
    "限时免费（截至北京时间5月5日晚上9:59）",
    new Date("2026-04-30T00:00:00.000Z"),
  )

  assert.equal(parsed, "2026-05-05T13:59:00.000Z")
})

test("parseFabCampaignEndDate uses explicit Chinese year when present", () => {
  const parsed = common.parseFabCampaignEndDate(
    "限时免费（截至北京时间2026年5月5日晚上9:59）",
    new Date("2027-01-01T00:00:00.000Z"),
  )

  assert.equal(parsed, "2026-05-05T13:59:00.000Z")
})

test("parseFabCampaignEndDate uses explicit English year when present", () => {
  const parsed = common.parseFabCampaignEndDate(
    "Limited-Time Free (Until May 5, 2026 at 9:59 AM ET)",
    new Date("2027-01-01T00:00:00.000Z"),
  )

  assert.ok(parsed)
  assert.equal(parsed.startsWith("2026-05-05T"), true)
})

test("parseEpicProductEndDate parses visible epic page deadline text", () => {
  const fakeDocument = {
    body: {
      innerText: "立即获取 DOOMBLADE 优惠截止于2026/4/30 09:00",
      textContent: "立即获取 DOOMBLADE 优惠截止于2026/4/30 09:00",
    },
    documentElement: {
      innerHTML: "<div>优惠截止于2026/4/30 09:00</div>",
    },
  }

  const parsed = common.parseEpicProductEndDate(fakeDocument)

  assert.equal(parsed, "2026-04-30T01:00:00.000Z")
})

function createFakeNode(options) {
  const node = {
    tagName: options && options.tagName ? options.tagName : "DIV",
    className: (options && options.className) || "",
    textContent: (options && options.textContent) || "",
    currentSrc: options && options.currentSrc,
    src: options && options.src,
    children: (options && options.children) || [],
    parentElement: null,
    attributes: (options && options.attributes) || {},
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name)
        ? this.attributes[name]
        : null
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null
    },
    querySelectorAll(selector) {
      return this.children.flatMap((child) => [
        ...(matchesSelector(child, selector) ? [child] : []),
        ...child.querySelectorAll(selector),
      ])
    },
    closest(selector) {
      let current = this
      while (current) {
        if (matchesSelector(current, selector)) {
          return current
        }

        current = current.parentElement
      }

      return null
    },
  }

  for (const child of node.children) {
    child.parentElement = node
  }

  return node
}

function matchesSelector(node, selector) {
  if (!node) {
    return false
  }

  const selectorText = String(selector || "")
  if (
    selectorText.includes("img") &&
    (node.tagName === "IMG" || node.currentSrc || node.src)
  ) {
    return true
  }

  if (selectorText === 'a[href*="/listings/"]') {
    return node.tagName === "A" &&
      String((node.attributes && node.attributes.href) || "").includes("/listings/")
  }

  if (selectorText.includes('[class*="nTa5u2sc"]')) {
    return String(node.className || "").includes("nTa5u2sc")
  }

  if (selectorText.includes(".fabkit-Surface-root")) {
    return String(node.className || "").includes("fabkit-Surface-root")
  }

  if (selectorText === "div") {
    return node.tagName === "DIV"
  }

  if (selectorText === "article" || selectorText === "li") {
    return node.tagName === selectorText.toUpperCase()
  }

  return false
}
