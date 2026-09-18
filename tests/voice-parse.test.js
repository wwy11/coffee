import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseShop, parseDrink, parseTime, parseVoice, cnNum, guessCategory } from '../voice-parse.js';

// parseTime 内部取 new Date()，用假时钟固定住，期望值才钉得死
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 18, 15, 30, 0)); // 2026-09-18 15:30 本地时间
});
afterEach(() => {
  vi.useRealTimers();
});

describe('cnNum 中文数字', () => {
  it.each([
    ['一', 1],
    ['两', 2],
    ['九', 9],
    ['十', 10],
    ['十一', 11],
    ['十九', 19],
    ['二十', 20],
    ['二十一', 21],
    ['九十九', 99],
  ])('%s → %i', (input, expected) => {
    expect(cnNum(input)).toBe(expected);
  });

  it('不认识的输入返回 0', () => {
    expect(cnNum('百')).toBe(0);
    expect(cnNum('abc')).toBe(0);
  });
});

describe('guessCategory 品类推断', () => {
  it('咖啡类关键词', () => {
    expect(guessCategory('一杯瑞幸生椰拿铁')).toBe('coffee');
    expect(guessCategory('starbucks 美式')).toBe('coffee');
  });
  it('奶茶类关键词', () => {
    expect(guessCategory('喜茶的奶茶')).toBe('milktea');
    expect(guessCategory('一点点波霸奶茶')).toBe('milktea');
  });
  it('果汁类关键词', () => {
    expect(guessCategory('一杯柠檬茶')).toBe('juice');
    expect(guessCategory('西瓜汁')).toBe('juice');
  });
  it('推断不出来返回 null', () => {
    expect(guessCategory('随便喝了点什么')).toBe(null);
  });
});

describe('parseShop 店名', () => {
  it('词库命中，保留原文大小写', () => {
    expect(parseShop('在Manner买了个澳白')).toBe('Manner');
    expect(parseShop('刚去了星巴克')).toBe('星巴克');
  });

  it('"X的"模式兜底（前面有标点断开时能取到干净店名）', () => {
    expect(parseShop('味道不错，茶理王的柠檬茶')).toBe('茶理王');
  });

  it('已知局限：X的 前面如果是连续汉字，会把整段都当店名（贪心匹配，现状如此）', () => {
    expect(parseShop('来一杯小小甜的杨梅酸奶')).toBe('来一杯小小甜');
  });

  it('什么都没有返回空串', () => {
    expect(parseShop('好喝')).toBe('');
    expect(parseShop('')).toBe('');
  });
});

describe('parseDrink 饮品名', () => {
  it('后缀词命中 + 往前扩修饰字', () => {
    expect(parseDrink('瑞幸生椰拿铁', '瑞幸')).toBe('生椰拿铁');
    expect(parseDrink('manner的冰博克', 'manner')).toBe('冰博克');
    expect(parseDrink('焦糖玛奇朵', '')).toBe('焦糖玛奇朵');
  });

  it('已知局限：饮品词前面的连续汉字会被一起扩进来（现状如此，后续可优化）', () => {
    expect(parseDrink('来一杯焦糖玛奇朵', '')).toBe('来一杯焦糖玛奇朵');
  });

  it('没有命中任何后缀词返回空串', () => {
    expect(parseDrink('杨枝甘露', '')).toBe('');
  });
});

describe('parseTime 时间解析（假时钟：2026-09-18 15:30）', () => {
  const ts = (y, mo, d, h, mi) => new Date(y, mo, d, h, mi, 0, 0).getTime();

  it('今天/刚才 → 当前时刻', () => {
    expect(parseTime('刚才喝的')).toBe(ts(2026, 8, 18, 15, 30));
    expect(parseTime('今天下午喝的')).toBe(ts(2026, 8, 18, 15, 0));
  });

  it('昨天 + 时段', () => {
    expect(parseTime('昨天晚上喝的')).toBe(ts(2026, 8, 17, 20, 0));
    expect(parseTime('昨天早上')).toBe(ts(2026, 8, 17, 9, 0));
  });

  it('前天', () => {
    expect(parseTime('前天中午')).toBe(ts(2026, 8, 16, 12, 0));
  });

  it('N天前（阿拉伯数字）无时段默认中午', () => {
    expect(parseTime('3天前喝的')).toBe(ts(2026, 8, 15, 12, 0));
  });

  it('N天前（中文数字）', () => {
    expect(parseTime('三天前')).toBe(ts(2026, 8, 15, 12, 0));
    expect(parseTime('二十一天前')).toBe(ts(2026, 7, 28, 12, 0));
  });

  it('没有时间词返回 null', () => {
    expect(parseTime('好喝')).toBe(null);
  });
});

describe('parseVoice 整合', () => {
  it('典型句：店名 + 饮品 + 品类 + 当前时间', () => {
    const now = Date.now();
    const out = parseVoice('刚才喝了一杯 manner 的橘皮拿铁');
    expect(out.shop).toBe('manner');
    expect(out.coffee).toBe('橘皮拿铁');
    expect(out.category).toBe('coffee');
    expect(out.drankAt).toBe(now);
    expect(out.raw).toBe('刚才喝了一杯 manner 的橘皮拿铁');
  });

  it('奶茶句：时间回溯到昨晚 + 品类判断', () => {
    const out = parseVoice('昨天晚上喝了喜茶的奶茶');
    expect(out.shop).toBe('喜茶');
    expect(out.coffee).toBe('奶茶');
    expect(out.category).toBe('milktea');
    expect(out.drankAt).toBe(new Date(2026, 8, 17, 20, 0, 0, 0).getTime());
  });

  it('解析不出任何字段的句子只返回空壳 + raw', () => {
    const out = parseVoice('嗯嗯');
    expect(out.shop).toBe('');
    expect(out.coffee).toBe('');
    expect(out.drankAt).toBeUndefined();
    expect(out.category).toBeUndefined();
    expect(out.raw).toBe('嗯嗯');
  });
});
