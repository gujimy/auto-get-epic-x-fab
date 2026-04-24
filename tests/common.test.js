const test = require("node:test")
const assert = require("node:assert/strict")

const common = require("../common.js")

test("mergeSettings merges overrides", () => {
  const settings = common.mergeSettings({
    country: "CN",
    autoClaimFab: false,
  })

  assert.equal(settings.country, "CN")
  assert.equal(settings.autoClaimFab, false)
  assert.equal(settings.autoClaimEpic, true)
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
  assert.equal(parsed.upcoming.length, 1)
  assert.equal(parsed.upcoming[0].title, "Upcoming Free Game")
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
  }

  const parsed = common.parseFabListingsFromDocument(fakeDocument)

  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].status, "already-owned")
  assert.ok(parsed[0].endDate)
})

test("parseFabCampaignEndDate parses campaign deadline from heading", () => {
  const parsed = common.parseFabCampaignEndDate(
    "Limited-Time Free (Until May 5 at 9:59 AM ET)",
    new Date("2026-04-23T00:00:00.000Z"),
  )

  assert.ok(parsed)
  assert.equal(parsed.startsWith("2026-05-05T"), true)
})
