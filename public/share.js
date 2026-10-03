/**
 * share.js — 砍一刀分享优惠逻辑（严格执行版）
 * 阶梯规则（原价 599 元）：
 *   0 ~ 2 人     → 19.9 元（分享 1 人测分）
 *   3 ~ 9 人     → 9.9 元（分享 3 人测分）
 *   10 人及以上  → 0 元（分享 10+ 人测分）
 *
 * 分享行为：
 *   - 微信内置浏览器：配置 JS-SDK 分享内容，提示用户点右上角完成转发。
 *   - 支持 navigator.share：调用系统分享面板（必须由用户点击触发）。
 *   - 不支持：复制链接。
 *   - 分享点击【不】直接增加邀请人数；只有好友通过链接完成查分后才计数。
 *
 * 使用方式：
 *   const helper = new ShareHelper({ apiBase: '/api', container: '#share-panel' });
 *   helper.render('#share-panel');
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ShareHelper = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this, function () {
  const ORIGINAL_PRICE = 599;

  const DISTRICT_LABEL = {
    xincheng: "新城区", beilin: "碑林区", lianhu: "莲湖区", yanta: "雁塔区",
    weiyang: "未央区", bashan: "灞桥区", xixian: "西咸新区", changan: "长安区",
  };

  function getParam(name) {
    if (typeof URLSearchParams === "undefined" || typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get(name) || "";
  }
  function districtLabel(code) {
    return DISTRICT_LABEL[code] || code || "本地";
  }
  function generateId() {
    return "ly" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } finally { document.body.removeChild(ta); }
    return Promise.resolve();
  }

  class ShareHelper {
    constructor(options = {}) {
      this.apiBase = options.apiBase || "";
      this.container = options.container || null;
      this.onUpdate = options.onUpdate || null;

      // 邀请人唯一编号（随机，绝不出现手机号/微信号/姓名）
      this.ref =
        options.ref ||
        getParam("ref") ||
        (typeof localStorage !== "undefined" ? localStorage.getItem("ly_share_id") : "") ||
        generateId();
      if (typeof localStorage !== "undefined") localStorage.setItem("ly_share_id", this.ref);

      this.score = options.score || getParam("score") || "";
      this.district = options.district || getParam("district") || "";
      this.category = options.category || getParam("category") || "平衡推荐";

      this._count = 0;
      this._loaded = false;
      this.load();
    }

    get count() { return this._count; }
    set count(n) {
      this._count = Math.max(0, Math.floor(n));
      this.save();
      this._notify();
    }

    // 阶梯价格计算（前端兜底；正式环境以服务端返回为准）
    priceInfo() {
      const c = this._count;
      let currentPrice = ORIGINAL_PRICE, discount = 0, nextPrice = ORIGINAL_PRICE, nextNeed = 1, tier = 0;
      if (c <= 2) {
        currentPrice = 19.9; discount = +(ORIGINAL_PRICE - currentPrice).toFixed(1);
        nextPrice = 9.9; nextNeed = 3 - c; tier = 0;
      } else if (c >= 3 && c <= 9) {
        currentPrice = 9.9; discount = +(ORIGINAL_PRICE - currentPrice).toFixed(1);
        nextPrice = 0; nextNeed = 10 - c; tier = 1;
      } else {
        currentPrice = 0; discount = ORIGINAL_PRICE; nextPrice = 0; nextNeed = 0; tier = 2;
      }
      return {
        originalPrice: ORIGINAL_PRICE, currentPrice, discount, count: c, tier,
        progress: Math.min(100, (c / 10) * 100), nextNeed, nextPrice,
      };
    }

    // 分享链接：带分数 / 区域 / 策略 / 邀请人编号，跳转到结果页
    getShareUrl() {
      const url = new URL("https://laoyou.love/result.html");
      if (this.score) url.searchParams.set("score", this.score);
      if (this.district) url.searchParams.set("district", this.district);
      url.searchParams.set("category", this.category);
      url.searchParams.set("ref", this.ref);
      return url.toString();
    }
    shareLink() { return this.getShareUrl(); }

    save() {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem("ly_share_friends", String(this._count));
    }

    load() {
      if (typeof localStorage !== "undefined") {
        const stored = localStorage.getItem("ly_share_friends");
        if (stored) this._count = Math.max(0, Math.floor(Number(stored)) || 0);
      }
      if (this.apiBase) {
        this._fetchCount().catch(() => {});
        if (typeof window !== "undefined" && !this._poll) {
          this._poll = setInterval(() => this._fetchCount().catch(() => {}), 15000);
        }
      } else {
        this._loaded = true;
      }
    }

    async _fetchCount() {
      const res = await fetch(`${this.apiBase}/referrals/count?ref=${encodeURIComponent(this.ref)}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      this._count = Math.max(this._count, Math.floor(data.friendCount) || 0);
      this._notify();
    }

    // 好友完成查分后的有效转化（服务端权威计数）
    async _recordValidShare(friendSessionId) {
      if (this.apiBase) {
        try {
          const res = await fetch(`${this.apiBase}/referrals/convert`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ref: this.ref,
              friendSessionId,
              score: Number(this.score) || 0,
              district: this.district,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            this._count = data.friendCount;
            this._notify();
            return data;
          }
        } catch (e) {}
      }
      // 本地降级（演示）
      this.count += 1;
      return this.priceInfo();
    }

    _notify() {
      if (typeof this.onUpdate === "function") this.onUpdate(this.priceInfo());
      if (this.container) this.render(this.container);
    }

    _districtLabel() { return districtLabel(this.district); }

    // 系统分享（Web Share API），不支持则复制链接
    async shareBySystem() {
      const url = this.getShareUrl();
      const shareData = {
        title: "一起查分，拿完整匹配抵扣券",
        text: `我在看${this._districtLabel()}的院校推荐，一起查分可以拿抵扣券。`,
        url,
      };
      if (!navigator.share) {
        await copyText(url);
        this.showToast("当前浏览器不支持系统分享，链接已复制，请发到微信。");
        return "copied";
      }
      if (navigator.canShare && !navigator.canShare(shareData)) {
        await copyText(url);
        this.showToast("当前浏览器不支持该分享内容，链接已复制，请发到微信。");
        return "copied";
      }
      try {
        await navigator.share(shareData);
        this.showToast("分享面板已打开，请选择微信好友或其他分享方式。");
        return "opened";
      } catch (e) {
        if (e && e.name === "AbortError") {
          this.showToast("你取消了分享，邀请人数不会变化。");
          return "cancelled";
        }
        await copyText(url);
        this.showToast("系统分享未打开，链接已复制，请发到微信。");
        return "copied";
      }
    }

    // 配置微信 JS-SDK 分享内容（需后端 /api/wechat/js-config 签名）
    async configureWechatShare() {
      if (typeof window === "undefined" || !window.wx) throw new Error("微信 JS-SDK 未加载");
      const url = this.getShareUrl();
      const pageUrl = location.href.split("#")[0];
      const res = await fetch(`/api/wechat/js-config?url=${encodeURIComponent(pageUrl)}`, { credentials: "same-origin" });
      if (!res.ok) throw new Error("微信分享配置获取失败");
      const cfg = await res.json();
      window.wx.config({
        debug: false,
        appId: cfg.appId,
        timestamp: cfg.timestamp,
        nonceStr: cfg.nonceStr,
        signature: cfg.signature,
        jsApiList: ["updateAppMessageShareData", "updateTimelineShareData"],
      });
      return new Promise((resolve, reject) => {
        window.wx.ready(() => {
          window.wx.updateAppMessageShareData({
            title: "一起查分，拿完整匹配抵扣券",
            desc: `${this._districtLabel()}分数相近院校推荐，邀请同学查分可领取抵扣券。`,
            link: url,
            imgUrl: "https://laoyou.love/share-cover.png",
            success: () => resolve(),
          });
          window.wx.updateTimelineShareData({
            title: "一起查分，拿完整匹配抵扣券",
            link: url,
            imgUrl: "https://laoyou.love/share-cover.png",
            success: () => resolve(),
          });
        });
        window.wx.error((err) => reject(new Error("微信分享配置校验失败: " + JSON.stringify(err))));
      });
    }

    // 微信分享按钮：微信内配置+引导；其它环境走系统分享/复制
    shareWechat() {
      const isWechat = typeof navigator !== "undefined" && /MicroMessenger/i.test(navigator.userAgent);
      if (isWechat) {
        this.configureWechatShare()
          .then(() => {
            if (typeof showWechatHint === "function") showWechatHint();
            else alert("分享内容已准备好，请点击微信右上角，选择“发送给朋友”或“分享到朋友圈”。");
          })
          .catch(() => this.shareBySystem());
        return;
      }
      this.shareBySystem();
    }

    copyLink() {
      copyText(this.getShareUrl()).then(() => this.showToast("链接已复制，快去分享吧"));
    }

    // 演示：模拟一位好友通过链接完成查分（localhost 或正式环境均走 /api/referrals/convert）
    simulateFriend() {
      const friendSessionId = "sim-" + Math.random().toString(36).slice(2, 10);
      this._recordValidShare(friendSessionId).then((info) => {
        const cnt = info.friendCount != null ? info.friendCount : this._count;
        const price = info.price != null ? info.price : info.currentPrice;
        this.showToast(`好友助力成功！当前 ${cnt} 人，到手价 ${price} 元`);
      });
    }

    showToast(message) {
      const existing = document.querySelector(".ly-share-toast");
      if (existing) existing.remove();
      const el = document.createElement("div");
      el.className = "ly-share-toast";
      el.textContent = message;
      el.style.cssText =
        "position:fixed;left:50%;bottom:80px;transform:translateX(-50%);background:#10233d;color:#fff;padding:10px 18px;border-radius:999px;font-size:14px;z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,.2);opacity:0;transition:opacity .25s;max-width:80%;text-align:center;";
      document.body.appendChild(el);
      requestAnimationFrame(() => (el.style.opacity = "1"));
      setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 300); }, 2400);
    }

    html(info) {
      const isFree = info.currentPrice <= 0;
      const tierLabels = [
        { price: "19.9", note: "分享1人测分" },
        { price: "9.9", note: "分享3人测分" },
        { price: "0", note: "分享10+人测分" },
      ];
      const badges = tierLabels
        .map((t, i) => {
          const active = i === info.tier ? " active" : "";
          return `<div class="ly-tier-badge${active}"><span class="ly-tier-price">${t.price}</span><span class="ly-tier-unit">元</span><span class="ly-tier-note">${t.note}</span></div>`;
        })
        .join("");

      return `
        <div class="ly-share-panel">
          <div class="ly-share-price">
            <div class="ly-original-price">原价 <s>¥${info.originalPrice.toFixed(0)}</s></div>
            <div class="ly-share-price-label">完整方案到手价</div>
            <div class="ly-share-price-value">
              ${isFree ? '<span class="ly-free">免费</span>' : `<span class="ly-num">${info.currentPrice.toFixed(1)}</span><span class="ly-unit">元</span>`}
            </div>
            <div class="ly-tier-badges">${badges}</div>
            ${info.discount > 0 ? `<div class="ly-share-discount">已抵扣 ¥${info.discount.toFixed(1)}</div>` : ""}
          </div>
          <div class="ly-share-progress">
            <div class="ly-share-progress-bar" style="width:${info.progress}%"></div>
          </div>
          <div class="ly-share-status">
            ${info.count < 1 ? `邀请 1 位同学测分，到手价 <b>19.9</b> 元` : info.count < 3 ? `已助力 <b>${info.count}</b> 人，再邀 <b>${info.nextNeed}</b> 人可享 9.9 元` : info.count < 10 ? `已助力 <b>${info.count}</b> 人，再邀 <b>${info.nextNeed}</b> 人即可免费` : `🎉 已助力 <b>${info.count}</b> 人，完整方案已免费`}
          </div>
          <div class="ly-share-actions">
            <button class="ly-btn ly-btn-primary" type="button" data-action="wechat">微信分享</button>
            <button class="ly-btn ly-btn-secondary" type="button" data-action="copy">复制链接</button>
          </div>
          ${typeof location !== "undefined" && location.hostname === "localhost" ? `<div class="ly-share-demo"><button class="ly-btn ly-btn-ghost" type="button" data-action="simulate">模拟好友查分 +1</button></div>` : ""}
        </div>
      `;
    }

    render(selector) {
      const el = typeof selector === "string" ? document.querySelector(selector) : selector;
      if (!el) return;
      this.container = el;
      const info = this.priceInfo();
      el.innerHTML = this.html(info);
      el.querySelectorAll("[data-action]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          const action = e.currentTarget.getAttribute("data-action");
          if (action === "wechat") this.shareWechat();
          if (action === "copy") this.copyLink();
          if (action === "simulate") this.simulateFriend();
        });
      });
    }
  }

  ShareHelper.ORIGINAL_PRICE = ORIGINAL_PRICE;
  ShareHelper.priceForCount = function (count) {
    const helper = new ShareHelper({});
    helper.count = Number(count) || 0;
    return helper.priceInfo();
  };

  return ShareHelper;
});
