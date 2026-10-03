# Local seed content

One `<!-- seed: ... -->` block per database row, consumed by
`scripts/seed-dev-content.mjs`. The localized text lives here instead of the
script so the copy-guard test (Han text only inside `src/shared/copy.ts`)
stays green.

- Block header: `<!-- seed: <type> | <locale> | <sort> | <age> | <extra> -->`
  with age like `4h` / `2d` and `extra` = announcement title, poll
  `single`/`multiple`, or feedback author id.
- The script resets id sequences, so poll ids follow block order: the three
  `en-US` polls are ids 1-3, the three `zh-CN` polls are ids 4-6. Keep the
  `::poll:<locale>:<id>` references in sync with that order.

<!-- seed: poll | en-US | 0 | 2d | single -->

- Strongly agree
- Agree
- Neutral
- Disagree

<!-- seed: poll | en-US | 1 | 5d | multiple -->

- Camping
- Night photography
- Hiking
- Stargazing
- Bonfire

<!-- seed: poll | en-US | 2 | 9d | single -->

- Ship it this week
- Wait for the next drop
- Needs another pass

<!-- seed: poll | zh-CN | 0 | 3d | single -->

- 非常满意
- 基本满意
- 不太满意

<!-- seed: poll | zh-CN | 1 | 7d | multiple -->

- 户外烧烤
- 星空摄影
- 徒步路线
- 篝火晚会

<!-- seed: poll | zh-CN | 2 | 10d | single -->

- 周六出发
- 周日出发
- 都可以

<!-- seed: announcement | en-US | 0 | 4h | Welcome to Infoto -->

A tiny **shared album** for this photo group — every synced shot lands in one waterfall, no sign-ups.

- Photos stream straight from your browser, transcoded on the fly
- Announcements and polls are curated by the album owner
- Feedback lives in its own tab with drag ordering

Leave a reaction to say hi. 🔥

<!-- seed: announcement | en-US | 1 | 1d | Trip plan: pick a date -->

Before we book the campsite, a quick vote on the weekend. Results update live as people vote.

::poll:en-US:3

One vote per person. Hover any timestamp to see the exact moment it was recorded.

<!-- seed: announcement | en-US | 2 | 6d | Activity survey: what should we plan next? -->

Multiple answers allowed, so tick everything that sounds fun:

::poll:en-US:2

Also tell us in the **feedback tab** if we missed a good option.

<!-- seed: announcement | en-US | 3 | 12d | Changelog: what shipped this week -->

> Highlights are aggregated from everyone's likes, so a quiet photo can still make the wall.

- Video uploads now **stream** into storage while the transcode runs
- Polls lost their titles — the option rows are the poll

---

The sync oplog stays tiny; a full pass looks like this:

```ts
const ops = await engine.pull(cursor);
for (const op of ops) apply(op); // idempotent, ordered by seq
```

Run `npm run dev` locally and the same code path executes against a local D1.

<!-- seed: announcement | zh-CN | 0 | 6h | 欢迎来到 Infoto -->

一个为这个照片小组准备的**共享相册**——所有同步的照片都汇入同一个瀑布流，无需注册。

- 照片直接从浏览器流式上传，边转码边传
- 公告和投票由相册管理员维护
- 建议单独一个页签，可拖拽排序

点个表情打个招呼吧。🔥

<!-- seed: announcement | zh-CN | 1 | 2d | 活动报名：选个出发日 -->

订营地之前先投个票，结果实时更新。

::poll:zh-CN:6

每人一票。把鼠标悬停在时间戳上可以看到精确时间。

<!-- seed: announcement | zh-CN | 2 | 8d | 下次活动想玩什么？ -->

可多选，把感兴趣的全勾上：

::poll:zh-CN:5

漏了好选项的话，去**建议页签**补一条。

<!-- seed: announcement | zh-CN | 3 | 15d | 本周更新说明 -->

> 精选墙按大家的点赞汇总，安静的照片也有机会上榜。

- 视频上传改为**流式**写入存储，转码同时进行
- 投票不再有标题——选项行就是投票本身

---

本地跑同一条链路：

```bash
npm run dev   # Worker :8787 + Vite :5173 + 本地图片宿主 :8788
```

<!-- seed: feedback | en-US | 0 | 3h | 1 -->

The lightbox swipe feels great on the phone — no complaints this week!

<!-- seed: feedback | en-US | 1 | 2d | 2 -->

One nit: the upload panel keeps running when I switch tabs, is that on purpose?

Also the `Esc` key closes the editor even while an image is uploading — maybe it should ask first?

<!-- seed: feedback | en-US | 2 | 8d | 1 -->

Feature idea: a **map view** for photos with GPS data.

Most phones embed coordinates already, so it would be mostly frontend work:

```json
{ "lat": 30.5728, "lng": 104.0668, "shotAt": "2026-09-30T18:12:00Z" }
```

<!-- seed: feedback | zh-CN | 0 | 5h | 2 -->

手机上的灯箱滑动很顺手，这周没有要吐槽的！

<!-- seed: feedback | zh-CN | 1 | 1d | 1 -->

一个小问题：切到别的页签时上传面板还在继续跑，这是故意的吗？

另外图片还在上传时按 `Esc` 会直接关掉编辑器，最好先确认一下。

<!-- seed: feedback | zh-CN | 2 | 9d | 2 -->

功能建议：给带 GPS 的照片加一个**地图视图**。

手机拍照基本都带坐标，主要是前端工作量：

- 聚合同一地点的照片簇
- 点击簇展开九宫格
