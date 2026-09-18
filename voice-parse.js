/*
 * 语音文本解析规则（纯函数，无任何 DOM 依赖）。
 * 单独拆成这个文件是为了能在 Node + Vitest 里直接测试；
 * app.js 以 ES module 方式引入，浏览器端不受影响（iOS 11+ 支持 module）。
 *
 * 输入：语音识别（Web Speech API）转出来的中文句子，例如：
 *   "刚才喝了一杯 manner 的橘皮拿铁"
 * 输出：{ shop, coffee, raw, drankAt?, category? }
 */

// 店名词库（可扩展）
const SHOP_KW = ['manner', 'starbucks', '星巴克', '瑞幸', 'luckin', '库迪', 'cotti', '喜茶', 'heytea', '奈雪', '茶百道', '古茗', '蜜雪冰城', '沪上阿姨', '书亦', 'coco', '一点点', '霸王茶姬', 'tims', 'seesaw', 'm stand', 'arabica', 'blue bottle', 'peets', '皮爷'];
// 饮品后缀词库
const DRINK_KW = ['拿铁', '美式', '摩卡', '卡布奇诺', '卡布', '澳白', '馥芮白', 'dirty', 'espresso', 'latte', '生椰', '手冲', '耶加', '冷萃', '燕麦', '香草', '焦糖玛奇朵', '玛奇朵', '气泡', '冰博克', '奶茶', '奶绿', '红茶', '绿茶', '乌龙', '珍珠', '波霸', '果茶', '柠檬茶', '西瓜汁', '橙汁', '果汁', '奶昔', '冰沙', '气泡水'];

// 品类推断
const CAT_KW = {
  milktea: ['奶茶', '奶绿', '珍珠', '波霸', '喜茶', 'heytea', '奈雪', '茶百道', '古茗', '蜜雪', '沪上阿姨', '书亦', 'coco', '一点点', '霸王茶姬', '乌龙', '红茶', '绿茶'],
  juice: ['果汁', '西瓜汁', '橙汁', '柠檬茶', '果茶', '奶昔', '冰沙', '气泡水'],
  coffee: ['拿铁', '美式', '摩卡', '卡布', '澳白', '馥芮白', 'dirty', 'espresso', 'latte', '生椰', '手冲', '耶加', '冷萃', 'coffee', '咖啡', 'manner', '星巴克', '瑞幸', 'luckin', '库迪', 'tims', 'seesaw', 'arabica', 'blue bottle'],
};

export function guessCategory(text) {
  const t = text.toLowerCase();
  for (const cat of ['milktea', 'juice', 'coffee']) {
    if (CAT_KW[cat].some((k) => t.includes(k.toLowerCase()))) return cat;
  }
  return null;
}

// 简单中文数字（1-99，够用）
export function cnNum(s) {
  const d = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  if (s in d) return d[s];
  if (s.length === 2 && s[0] === '十') return 10 + d[s[1]];       // 十一~十九
  if (s.length === 2 && s[1] === '十') return d[s[0]] * 10;        // 二十~九十
  if (s.length === 3 && s[1] === '十') return d[s[0]] * 10 + d[s[2]]; // 二十一…
  return 0;
}

// 时间词 → 相对天数/时段偏移，返回时间戳或 null
export function parseTime(text) {
  const now = new Date();
  let dayOffset = null;
  if (/前天/.test(text)) dayOffset = -2;
  else if (/昨天|昨晚/.test(text)) dayOffset = -1;
  else if (/今天|刚才|刚刚|方才|现在/.test(text)) dayOffset = 0;
  else {
    const m = text.match(/(\d+)\s*天前/);
    if (m) dayOffset = -Number(m[1]);
    else {
      const cn = text.match(/([一二两三四五六七八九十]+)\s*天前/);
      if (cn) dayOffset = -cnNum(cn[1]);
    }
  }
  if (dayOffset === null) return null;

  const d = new Date(now);
  d.setDate(d.getDate() + dayOffset);
  // 时段：非"今天/刚才"时，把具体时分设为该时段的代表点；今天/刚才保留当前时刻
  if (dayOffset === 0 && /刚才|刚刚|方才|现在/.test(text)) return now.getTime();
  if (/早上|早晨|上午|早/.test(text)) d.setHours(9, 0, 0, 0);
  else if (/中午/.test(text)) d.setHours(12, 0, 0, 0);
  else if (/下午/.test(text)) d.setHours(15, 0, 0, 0);
  else if (/晚上|晚|夜里/.test(text)) d.setHours(20, 0, 0, 0);
  else if (dayOffset === 0) return now.getTime();
  else d.setHours(12, 0, 0, 0); // 无时段的往日，默认中午
  return d.getTime();
}

export function parseShop(text) {
  const t = text.toLowerCase();
  // 先按词库命中（保留原文大小写）
  for (const kw of SHOP_KW) {
    const idx = t.indexOf(kw.toLowerCase());
    if (idx >= 0) return text.slice(idx, idx + kw.length);
  }
  // 再试"X的"模式：一杯 <店名> 的 <饮品>
  const m = text.match(/(?:一杯|杯|喝了|喝的)?\s*([一-龥A-Za-z0-9%]{2,10})的/);
  if (m) return m[1];
  return '';
}

export function parseDrink(text, shop) {
  const lower = text.toLowerCase();
  for (const kw of DRINK_KW) {
    const idx = lower.indexOf(kw.toLowerCase());
    if (idx >= 0) {
      // 往前扩几个修饰字（如"橘皮拿铁""生椰拿铁"）
      let start = idx;
      while (start > 0 && /[一-龥A-Za-z]/.test(text[start - 1]) && idx - start < 4) start--;
      let seg = text.slice(start, idx + kw.length);
      // 去掉"…的"前缀（店名+的）
      seg = seg.replace(/^.*的/, '');
      // 若前扩把店名带了进来，切掉店名部分
      if (shop) {
        const si = seg.toLowerCase().indexOf(shop.toLowerCase());
        if (si >= 0) seg = seg.slice(si + shop.length);
      }
      return seg || text.slice(idx, idx + kw.length);
    }
  }
  return '';
}

export function parseVoice(text) {
  const shop = parseShop(text);
  const out = { shop, coffee: parseDrink(text, shop), raw: text };
  const ts = parseTime(text);
  if (ts) out.drankAt = ts;
  const cat = guessCategory(text);
  if (cat) out.category = cat;
  return out;
}
