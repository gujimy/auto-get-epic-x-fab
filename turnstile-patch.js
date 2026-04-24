(function patchTurnstileMouseEvent() {
  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min
  }

  function patchPrototype(prototype, key, getter) {
    try {
      Object.defineProperty(prototype, key, {
        configurable: true,
        get: getter,
      })
    } catch (_error) {
      // 某些页面或浏览器版本可能不允许重定义，忽略即可。
    }
  }

  const offsetX = randomInt(800, 1200)
  const offsetY = randomInt(400, 600)

  patchPrototype(MouseEvent.prototype, "screenX", function getScreenX() {
    const clientX = Number(this.clientX || this.x || 0)
    return clientX + offsetX
  })

  patchPrototype(MouseEvent.prototype, "screenY", function getScreenY() {
    const clientY = Number(this.clientY || this.y || 0)
    return clientY + offsetY
  })

  if (typeof PointerEvent !== "undefined") {
    patchPrototype(PointerEvent.prototype, "screenX", function getScreenX() {
      const clientX = Number(this.clientX || this.x || 0)
      return clientX + offsetX
    })

    patchPrototype(PointerEvent.prototype, "screenY", function getScreenY() {
      const clientY = Number(this.clientY || this.y || 0)
      return clientY + offsetY
    })
  }
})()
