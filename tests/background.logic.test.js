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

test("buildSuccessfulExecutionRecord records next auto run after completed batch", () => {
  const record = backgroundLogic.buildSuccessfulExecutionRecord(
    "epic",
    [
      {
        id: "game-1",
        claimResult: "claimed",
        endDate: "2026-04-30T15:00:00.000Z",
      },
      {
        id: "game-2",
        claimResult: "already-owned",
        endDate: "2026-04-30T15:00:00.000Z",
      },
    ],
    [
      {
        id: "next-game",
        startDate: "2026-04-30T15:00:00.000Z",
      },
    ],
    {
      nowMs: Date.parse("2026-04-24T00:00:00.000Z"),
      recordedAt: "2026-04-24T00:00:00.000Z",
    },
  )

  assert.equal(record.site, "epic")
  assert.equal(record.itemCount, 2)
  assert.deepEqual(record.itemIds, ["game-1", "game-2"])
  assert.equal(record.lastSuccessAt, "2026-04-24T00:00:00.000Z")
  // 到点后延后 10 分钟再自动执行，给平台刷新留缓冲
  assert.equal(record.nextAutoRunAt, "2026-04-30T15:10:00.000Z")
})

test("pickNextAutoRunAt delays start and end times by claim start buffer", () => {
  const nextFromStart = backgroundLogic.pickNextAutoRunAt(
    [],
    [
      {
        id: "next-game",
        startDate: "2026-04-30T15:00:00.000Z",
      },
    ],
    {
      nowMs: Date.parse("2026-04-24T00:00:00.000Z"),
    },
  )
  assert.equal(nextFromStart, "2026-04-30T15:10:00.000Z")

  const nextFromEnd = backgroundLogic.pickNextAutoRunAt(
    [
      {
        id: "current-game",
        endDate: "2026-04-30T15:00:00.000Z",
      },
    ],
    [],
    {
      nowMs: Date.parse("2026-04-24T00:00:00.000Z"),
    },
  )
  assert.equal(nextFromEnd, "2026-04-30T15:10:00.000Z")

  const customDelay = backgroundLogic.pickNextAutoRunAt(
    [],
    [
      {
        id: "next-game",
        startDate: "2026-04-30T15:00:00.000Z",
      },
    ],
    {
      nowMs: Date.parse("2026-04-24T00:00:00.000Z"),
      claimStartDelayMs: 5 * 60 * 1000,
    },
  )
  assert.equal(customDelay, "2026-04-30T15:05:00.000Z")
})

test("buildSuccessfulExecutionRecord ignores unfinished current batch", () => {
  const record = backgroundLogic.buildSuccessfulExecutionRecord(
    "fab",
    [
      {
        id: "fab-1",
        claimResult: "claimed",
        endDate: "2026-05-05T13:59:00.000Z",
      },
      {
        id: "fab-2",
        claimResult: "claimable",
        endDate: "2026-05-05T13:59:00.000Z",
      },
    ],
    [],
    {
      nowMs: Date.parse("2026-04-24T00:00:00.000Z"),
    },
  )

  assert.equal(record, null)
})

test("shouldSkipSiteAutoRun skips only automatic runs before next auto time", () => {
  const record = {
    nextAutoRunAt: "2026-04-30T15:00:00.000Z",
  }
  const nowMs = Date.parse("2026-04-24T00:00:00.000Z")

  assert.equal(
    backgroundLogic.shouldSkipSiteAutoRun(record, {
      nowMs,
      isManualTrigger: false,
      forceClaim: false,
    }),
    true,
  )

  assert.equal(
    backgroundLogic.shouldSkipSiteAutoRun(record, {
      nowMs,
      isManualTrigger: true,
      forceClaim: false,
    }),
    false,
  )

  assert.equal(
    backgroundLogic.shouldSkipSiteAutoRun(record, {
      nowMs,
      isManualTrigger: false,
      forceClaim: true,
    }),
    false,
  )

  assert.equal(
    backgroundLogic.shouldSkipSiteAutoRun(record, {
      nowMs: Date.parse("2026-05-01T00:00:00.000Z"),
      isManualTrigger: false,
      forceClaim: false,
    }),
    false,
  )
})

test("computeNextAlarmDelayMinutes delays alarm only when all managed sites are recorded", () => {
  const nowMs = Date.parse("2026-04-24T00:00:00.000Z")

  assert.equal(
    backgroundLogic.computeNextAlarmDelayMinutes(
      {
        epic: {
          nextAutoRunAt: "2026-04-25T00:00:00.000Z",
        },
        fab: {
          nextAutoRunAt: "2026-04-26T00:00:00.000Z",
        },
      },
      {
        nowMs,
        defaultDelayMinutes: 1,
      },
    ),
    1440,
  )

  assert.equal(
    backgroundLogic.computeNextAlarmDelayMinutes(
      {
        epic: {
          nextAutoRunAt: "2026-04-25T00:00:00.000Z",
        },
      },
      {
        nowMs,
        defaultDelayMinutes: 1,
      },
    ),
    1,
  )
})

test("shouldSkipSiteAutoRun keeps waiting during post-start refresh buffer", () => {
  const record = {
    // 对应官方开领时间 15:00，缓冲后的实际执行点 15:10
    nextAutoRunAt: "2026-04-30T15:10:00.000Z",
  }

  assert.equal(
    backgroundLogic.shouldSkipSiteAutoRun(record, {
      nowMs: Date.parse("2026-04-30T15:05:00.000Z"),
      isManualTrigger: false,
      forceClaim: false,
    }),
    true,
  )

  assert.equal(
    backgroundLogic.shouldSkipSiteAutoRun(record, {
      nowMs: Date.parse("2026-04-30T15:10:00.000Z"),
      isManualTrigger: false,
      forceClaim: false,
    }),
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
