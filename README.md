# Epic/Fab 每周免费助手

一个可直接加载到 Chrome / Edge 的 Manifest V3 浏览器扩展。

它会做三件事：

1. 自动检测 Epic 本周免费游戏。
2. 自动检测 Fab 当前限时免费资产。
3. 在你已经登录 Epic / Fab 的前提下，尝试自动领取零价商品。

## 当前实现

- Epic 检测：
  - 使用 Epic 当前页面请求的官方 `freeGamesPromotions` 接口。
- Fab 检测：
  - 通过真实页面内容脚本读取 `https://www.fab.com/limited-time-free` 列表。
- Cloudflare 兼容：
  - 已加入 `document_start + MAIN world` 的 `MouseEvent.screenX/screenY` 补丁，参考 `CDP-bug-MouseEvent-.screenX-.screenY-patcher` 的思路。
  - 如果仍命中 Cloudflare 验证，扩展会尽量把标签页切到前台，等待你手动过验证。
- 自动领取：
  - Epic 商品页识别 `获取` / `Place Order`。
  - Fab 商品页识别 `立即购买` / `Add to Cart` / `Place Order`。
  - 只有在页面明确出现 `免费` / `0` / `-100%` 这类零价信号时，才会继续提交。
- 定时检查：
  - 默认每 360 分钟一次，可在设置页修改。
- 界面：
  - Popup 可查看当前状态、手动检测、单独触发 Epic/Fab 领取。

## 安装方法

1. 打开浏览器扩展管理页。
2. 开启“开发者模式”。
3. 选择“加载已解压的扩展程序”。
4. 选择当前目录 `自动领取epic`。

## 使用建议

1. 先在浏览器里手动登录 Epic 与 Fab。
2. 打开扩展 Popup，先点一次“检查一次”。
3. 如果看到“需要登录”，先把对应站点登录完成后再重试。

## 已知限制

- 这是基于当前页面结构和当前接口行为实现的版本。
- Epic / Fab 一旦改版，个别按钮文案或流程可能需要更新。
- 浏览器扩展本身不自带真正的“邮箱通知”能力；当前实现的是浏览器通知和状态面板。
- Fab 直接从后台抓 HTML 容易被 Cloudflare 挑战，因此这里改成了通过真实标签页内容脚本检测。
- `screenX/screenY` 补丁只能降低一部分自动化指纹问题，不能替代真正的人机验证求解。

## 校验

```bash
node --test .\tests\common.test.js
```
