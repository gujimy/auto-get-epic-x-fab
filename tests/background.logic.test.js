const test = require("node:test")
const assert = require("node:assert/strict")

const backgroundLogic = require("../background.logic.js")

test("getRunScope keeps manual epic run isolated to Epic", () => {
  const scope = backgroundLogic.getRunScope({
    forceClaimEpic: true,
    forceClaimFab: false,
  })

  assert.equal(scope.isSiteSpecificRun, true)
  assert.equal(scope.shouldProcessEpic, true)
  assert.equal(scope.shouldProcessFab, false)
})

test("getRunScope processes both sites during regular run", () => {
  const scope = backgroundLogic.getRunScope({
    forceClaimEpic: false,
    forceClaimFab: false,
  })

  assert.equal(scope.isSiteSpecificRun, false)
  assert.equal(scope.shouldProcessEpic, true)
  assert.equal(scope.shouldProcessFab, true)
})

test("buildNextDebugLog appends entries and enforces limit", () => {
  const nextLog = backgroundLogic.buildNextDebugLog(
    ["[10:00:00] first", "[10:00:01] second"],
    "third",
    "10:00:02",
    2,
  )

  assert.deepEqual(nextLog, ["[10:00:01] second", "[10:00:02] third"])
})

test("pickBestFrameResponse prefers higher-priority child frame response", () => {
  const response = backgroundLogic.pickBestFrameResponse([
    {
      frameId: 0,
      status: "claimable",
      message: "顶层页面仍可领取",
    },
    {
      frameId: 12,
      status: "navigating",
      message: "子 frame 已进入订单页",
    },
  ])

  assert.equal(response.frameId, 12)
  assert.equal(response.status, "navigating")
})

test("shouldSkipFabDetailInspection only skips auto runs with owned items before deadline", () => {
  const items = [
    {
      id: "fab-1",
      status: "already-owned",
      endDate: "2026-05-05T13:59:00.000Z",
    },
    {
      id: "fab-2",
      status: "already-owned",
      endDate: "2026-05-05T13:59:00.000Z",
    },
  ]

  assert.equal(
    backgroundLogic.shouldSkipFabDetailInspection(items, {
      isManualTrigger: false,
      forceClaimFab: false,
      nowMs: Date.parse("2026-04-24T00:00:00.000Z"),
    }),
    true,
  )

  assert.equal(
    backgroundLogic.shouldSkipFabDetailInspection(items, {
      isManualTrigger: true,
      forceClaimFab: false,
      nowMs: Date.parse("2026-04-24T00:00:00.000Z"),
    }),
    false,
  )

  assert.equal(
    backgroundLogic.shouldSkipFabDetailInspection(
      [
        ...items,
        {
          id: "fab-3",
          status: "claimable",
          endDate: "2026-05-05T13:59:00.000Z",
        },
      ],
      {
        isManualTrigger: false,
        forceClaimFab: false,
        nowMs: Date.parse("2026-04-24T00:00:00.000Z"),
      },
    ),
    false,
  )
})

test("shouldRejectConcurrentRun rejects manual claim while inspect run is active", () => {
  assert.equal(
    backgroundLogic.shouldRejectConcurrentRun(
      {
        reason: "alarm",
        forceClaimEpic: false,
        forceClaimFab: false,
      },
      {
        reason: "manual-epic",
        forceClaimEpic: true,
        forceClaimFab: false,
      },
    ),
    true,
  )
})

test("shouldRejectConcurrentRun allows duplicate claim request for same site", () => {
  assert.equal(
    backgroundLogic.shouldRejectConcurrentRun(
      {
        reason: "manual-fab",
        forceClaimEpic: false,
        forceClaimFab: true,
      },
      {
        reason: "manual-fab",
        forceClaimEpic: false,
        forceClaimFab: true,
      },
    ),
    false,
  )
})

test("shouldRejectConcurrentRun rejects different claim scope", () => {
  assert.equal(
    backgroundLogic.shouldRejectConcurrentRun(
      {
        reason: "manual-epic",
        forceClaimEpic: true,
        forceClaimFab: false,
      },
      {
        reason: "manual-fab",
        forceClaimEpic: false,
        forceClaimFab: true,
      },
    ),
    true,
  )
})
