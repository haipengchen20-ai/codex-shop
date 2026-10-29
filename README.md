# 多平台游戏图片收藏器

一个本地 Web 小工具，可从官方商店公开页面获取游戏封面和截图并保存到本地；也可设定定时自动同步。

## 使用

1. 安装 Node.js 18 或更高版本。
2. 推荐双击 `Steam图片收藏器.lnk`：它显示 Steam 图标并自动打开浏览器。启动窗口必须保持开启。
3. 也可双击 `StartSteamImageKeeper.cmd`，作为无图标的兼容启动入口。
4. 或者在本目录运行 `npm start`，再打开 `http://localhost:3210`。输入 Steam AppID（如 `730`）或受支持的官方商品链接：

   - Steam：`https://store.steampowered.com/app/730/`
   - Nintendo：`https://www.nintendo.com/us/store/products/<商品名>/`
   - PlayStation：`https://store.playstation.com/en-us/product/<商品ID>`
   - Xbox：`https://www.xbox.com/en-us/games/store/<商品名>/<商品ID>`

   使用相应地区的官方商品页；搜索页、非官方镜像和其他域名不受支持。Steam 原有 AppID 和 `id` 接口仍可使用。

首次使用时，请在页面点击“选择文件夹”设置图片保存位置。该位置会记住，并供手动保存及页面中的可选间隔自动保存任务共用；这些任务的配置储存在 `data/subscriptions.json`。页面间隔自动保存依赖本程序保持运行；关闭后再次启动会继续检查到期任务。它与下述 Codex 定时自动化相互独立。

若本机的代理程序监听在 `127.0.0.1:7897`（常见于 Clash），启动器会自动通过它访问 Steam 商店。

只处理官方公开页面和允许的官方图片域名，不绕过登录、付费或访问限制。不同商店提供的素材可能不同：主机商店可能只有封面、没有可用截图；这仍是成功结果，页面会提示。Steam 还会生成系统需求图片。请遵守各商店的服务条款和游戏素材的版权/使用规则。

## 每日同步

批量同步读取工作簿 `C:\Users\33756\Desktop\自动化\游戏图片.xls`，并将图片保存到网页中配置的图片目录（当前为 `D:\iwen-codex\codex-shop\data\images`）。请先按上面的手动 UI 指引设置图片目录。

表格可在同一工作表混合不同平台：每行填写游戏名称及 Steam AppID 或上述官方商品链接。每行独立处理；某一链接失败不会阻止其他行。输出目录包含平台和商品身份，以区分同名游戏。

当前 Codex 定时自动化在周一至周六 11:00 运行批量同步；无需再注册 Windows 任务计划程序任务，以免重复运行。每次运行的结构化 JSON 报告保存在 `data\logs\daily-sync-*.json`。
